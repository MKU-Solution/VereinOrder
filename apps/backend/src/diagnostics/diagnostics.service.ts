import { Injectable, Inject } from "@nestjs/common";
import { PrismaClient } from "@vereinorder/database";
import { PRISMA_CLIENT } from "../prisma/prisma.module";
import { BackupService } from "../backup/backup.service";

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
    private backupService: BackupService,
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
      printersCount,
      activePrintersCount,
      pendingPrintJobs,
      failedPrintJobs,
      printedPrintJobs,
    ] = await Promise.all([
      this.prisma.event.count(),
      this.prisma.event.count({ where: { status: "ACTIVE" } }),
      this.prisma.order.count(),
      this.prisma.product.count(),
      this.prisma.user.count(),
      this.prisma.printer.count(),
      this.prisma.printer.count({ where: { isActive: true } }),
      this.prisma.printJob.count({ where: { status: "PENDING" } }),
      this.prisma.printJob.count({ where: { status: "FAILED" } }),
      this.prisma.printJob.count({ where: { status: "PRINTED" } }),
    ]);

    // 3. Backup Status
    const backups = await this.backupService.listBackups();
    const latestBackup = backups.length > 0 ? backups[0] : null;
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
    if (dbStatus === "ERROR" || failedPrintJobs > 0) {
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
        },
      },
      backup: {
        totalBackups: backups.length,
        latestBackup,
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
}
