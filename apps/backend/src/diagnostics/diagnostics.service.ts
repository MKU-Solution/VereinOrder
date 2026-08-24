import { Injectable, Inject } from "@nestjs/common";
import * as net from "net";
import { PrismaClient } from "@vereinorder/database";
import { PRISMA_CLIENT } from "../prisma/prisma.module";
import { NativeBackupService } from "../backup/native-backup.service";

/** Zeitbudget einer einzelnen TCP-Erreichbarkeitspruefung gegen einen CUPS-Host. */
const CUPS_PROBE_TIMEOUT_MS = 800;

export interface Recommendation {
  level: "SUCCESS" | "INFO" | "WARNING" | "ERROR";
  title: string;
  message: string;
  actionTab?: string;
}

@Injectable()
export class DiagnosticsService {
  constructor(
    @Inject(PRISMA_CLIENT) private prisma: PrismaClient,
    private backupService: NativeBackupService,
  ) {}

  async getStatus() {
    const serverTime = new Date().toISOString();
    const uptimeSeconds = Math.floor(process.uptime());
    const memory = process.memoryUsage();

    // 1. PostgreSQL DB Check & Latency
    const startTime = Date.now();
    let dbStatus = "ONLINE";
    let dbLatencyMs = 0;
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      dbLatencyMs = Date.now() - startTime;
    } catch (e) {
      dbStatus = "ERROR";
      dbLatencyMs = -1;
    }

    // 2. Counts
    const [
      eventsCount,
      activeEventsCount,
      ordersCount,
      productsCount,
      usersCount,
      pendingPrintJobs,
      failedPrintJobs,
      printedPrintJobs,
      unresolvedPrintJobs,
      printers,
    ] = await Promise.all([
      this.prisma.event.count(),
      this.prisma.event.count({ where: { status: "ACTIVE" } }),
      this.prisma.order.count(),
      this.prisma.product.count(),
      this.prisma.user.count(),
      this.prisma.printJob.count({ where: { status: "PENDING" } }),
      this.prisma.printJob.count({ where: { status: "FAILED" } }),
      this.prisma.printJob.count({ where: { status: "PRINTED" } }),
      this.prisma.printJob.count({ where: { status: "UNRESOLVED" } }),
      this.prisma.printer.findMany({
        select: {
          id: true,
          name: true,
          type: true,
          isActive: true,
          ipAddress: true,
          port: true,
          queueName: true,
          fallbackPrinterId: true,
          lastErrorCode: true,
          lastErrorAt: true,
          lastOkAt: true,
        },
        orderBy: { name: "asc" },
      }),
    ]);
    const printersCount = printers.length;
    const activePrintersCount = printers.filter((p) => p.isActive).length;
    const cupsReachability = await this.probeCupsReachability(printers);

    // 3. Backup Status
    const backups = await this.backupService.listBackups();
    const latestBackup = backups.length > 0 ? backups[0] : null;
    const backupToolStatus = this.backupService.getToolStatus();
    const backupStorage = await this.backupService.getStorageStatus(backups);
    let backupAgeHours: number | null = null;
    if (latestBackup) {
      const backupTime = new Date(latestBackup.createdAt).getTime();
      backupAgeHours = (Date.now() - backupTime) / (1000 * 60 * 60);
    }

    // 4. Generate Smart Health Recommendations
    const recommendations: Recommendation[] = [];

    if (dbStatus === "ERROR") {
      recommendations.push({
        level: "ERROR",
        title: "Datenbankverbindung unterbrochen",
        message:
          "PostgreSQL antwortet nicht. Bitte Docker-Container oder Datenbankdienst prüfen.",
      });
    }

    if (failedPrintJobs > 0) {
      recommendations.push({
        level: "ERROR",
        title: `${failedPrintJobs} fehlgeschlagene Druckaufträge`,
        message:
          "Ein oder mehrere Bondrucker konnten nicht erreicht werden. Prüfe Papierstand und USB/Netzwerkkabel.",
        actionTab: "diagnostics",
      });
    }

    if (!latestBackup) {
      recommendations.push({
        level: "WARNING",
        title: "Keine Datensicherung vorhanden",
        message:
          "Es wurde noch kein Backup erstellt. Erstelle vor Festbeginn ein manuelles Backup.",
        actionTab: "backups",
      });
    } else if (
      backupAgeHours !== null &&
      backupAgeHours > 3 &&
      activeEventsCount > 0
    ) {
      recommendations.push({
        level: "WARNING",
        title: `Letztes Backup ist ${backupAgeHours.toFixed(0)} Stunden alt`,
        message:
          "Bei aktivem Festbetrieb wird eine regelmäßige Sicherung auf einen externen USB-Stick empfohlen.",
        actionTab: "backups",
      });
    }

    if (!backupToolStatus.enabled) {
      recommendations.push({
        level: "ERROR",
        title: "Datenbanksicherung ist deaktiviert",
        message: backupToolStatus.message,
        actionTab: "backups",
      });
    }

    if (!backupStorage.creationAllowed) {
      recommendations.push({
        level: "ERROR",
        title: "Zu wenig freier Speicher für Datensicherungen",
        message:
          "Die konfigurierte Speicherreserve ist unterschritten. Es wird keine neue Sicherung erstellt; bitte Speicherplatz freigeben oder Sicherungen extern archivieren.",
        actionTab: "backups",
      });
    }

    if (unresolvedPrintJobs > 0) {
      recommendations.push({
        level: "WARNING",
        title: `${unresolvedPrintJobs} Druckaufträge mit unklarem Ausgang`,
        message:
          "Diese Aufträge warten auf eine Entscheidung: erneut drucken, als gedruckt bestätigen oder verwerfen.",
        actionTab: "printers",
      });
    }

    if (printersCount === 0) {
      recommendations.push({
        level: "INFO",
        title: "Keine Drucker eingerichtet",
        message:
          "Aktuell sind keine Bondrucker hinterlegt. Druckaufträge werden simuliert.",
        actionTab: "printers",
      });
    }

    if (recommendations.length === 0) {
      recommendations.push({
        level: "SUCCESS",
        title: "Alle Systeme bereit für den Festbetrieb",
        message:
          "PostgreSQL-Datenbank, Backend-Dienste und Druck-Warteschlangen laufen einwandfrei.",
      });
    }

    // Overall health determination
    let overallHealth: "GREEN" | "YELLOW" | "RED" = "GREEN";
    if (
      dbStatus === "ERROR" ||
      failedPrintJobs > 0 ||
      !backupToolStatus.enabled ||
      !backupStorage.creationAllowed
    ) {
      overallHealth = "RED";
    } else if (recommendations.some((r) => r.level === "WARNING")) {
      overallHealth = "YELLOW";
    }

    return {
      overallHealth,
      serverTime,
      backend: {
        appVersion: "0.1.0",
        nodeVersion: process.version,
        uptimeSeconds,
        memory: {
          rssMb: (memory.rss / 1024 / 1024).toFixed(1),
          heapUsedMb: (memory.heapUsed / 1024 / 1024).toFixed(1),
          heapTotalMb: (memory.heapTotal / 1024 / 1024).toFixed(1),
        },
      },
      database: {
        status: dbStatus,
        latencyMs: dbLatencyMs,
        counts: {
          events: eventsCount,
          activeEvents: activeEventsCount,
          orders: ordersCount,
          products: productsCount,
          users: usersCount,
        },
      },
      printers: {
        total: printersCount,
        active: activePrintersCount,
        queue: {
          pending: pendingPrintJobs,
          failed: failedPrintJobs,
          printed: printedPrintJobs,
          unclear: unresolvedPrintJobs,
        },
        cupsHostReachable: cupsReachability.hasCupsPrinters
          ? cupsReachability.reachable
          : null,
        cupsCheckedAt: cupsReachability.hasCupsPrinters
          ? cupsReachability.checkedAt
          : null,
        list: printers.map((p) => ({
          id: p.id,
          name: p.name,
          type: p.type,
          isActive: p.isActive,
          queueName: p.queueName,
          lastErrorCode: p.lastErrorCode,
          lastErrorAt: p.lastErrorAt,
          lastOkAt: p.lastOkAt,
          fallbackPrinterId: p.fallbackPrinterId,
          bypassed: this.isBypassed(p),
        })),
      },
      backup: {
        totalBackups: backups.length,
        latestBackup,
        toolStatus: backupToolStatus,
        storage: backupStorage,
      },
      recommendations,
    };
  }

  async retryFailedPrintJobs() {
    const updated = await this.prisma.printJob.updateMany({
      where: { status: "FAILED" },
      data: { status: "PENDING", errorMessage: null },
    });

    return {
      success: true,
      message: `${updated.count} fehlgeschlagene Druckaufträge wurden erneut in die Warteschlange eingereiht.`,
      retriedCount: updated.count,
    };
  }

  /**
   * Leichte TCP-Erreichbarkeitsprüfung gegen jeden distinct CUPS-Host. Kein
   * vollständiger IPP-Roundtrip - das bleibt Sache des Print-Workers -, nur
   * ein Verbindungsversuch, der die Oberfläche über "Host erreichbar oder
   * nicht" informiert. Ohne CUPS_IPP-Drucker ist das Feld nicht sinnvoll.
   */
  private async probeCupsReachability(
    printers: Array<{
      type: string;
      ipAddress: string | null;
      port: number | null;
    }>,
  ): Promise<{
    hasCupsPrinters: boolean;
    reachable: boolean;
    checkedAt: string;
  }> {
    const checkedAt = new Date().toISOString();
    const cupsPrinters = printers.filter((p) => p.type === "CUPS_IPP");
    if (cupsPrinters.length === 0) {
      return { hasCupsPrinters: false, reachable: false, checkedAt };
    }

    const hosts = new Map<string, { host: string; port: number }>();
    for (const p of cupsPrinters) {
      const host = p.ipAddress?.trim() || "localhost";
      const port = p.port ?? 631;
      hosts.set(`${host}:${port}`, { host, port });
    }

    const results = await Promise.all(
      [...hosts.values()].map((h) => this.probeTcp(h.host, h.port)),
    );
    return {
      hasCupsPrinters: true,
      reachable: results.some(Boolean),
      checkedAt,
    };
  }

  private probeTcp(
    host: string,
    port: number,
    timeoutMs = CUPS_PROBE_TIMEOUT_MS,
  ): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = new net.Socket();
      let settled = false;
      const finish = (ok: boolean) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        resolve(ok);
      };
      socket.setTimeout(timeoutMs);
      socket.once("connect", () => finish(true));
      socket.once("timeout", () => finish(false));
      socket.once("error", () => finish(false));
      socket.connect(port, host);
    });
  }

  /**
   * bypassed = isActive UND lastErrorAt neuer als lastOkAt. Bewusst OHNE
   * Zeitfenster: ein selten benutzter defekter Drucker darf nicht als
   * gesund erscheinen, nur weil sein Fehler alt ist.
   */
  private isBypassed(printer: {
    isActive: boolean;
    lastErrorAt: Date | null;
    lastOkAt: Date | null;
  }): boolean {
    if (!printer.isActive || !printer.lastErrorAt) return false;
    if (!printer.lastOkAt) return true;
    return printer.lastErrorAt.getTime() > printer.lastOkAt.getTime();
  }
}
