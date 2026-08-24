import { ConflictException, Inject, Injectable, Logger } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { PrismaClient } from "@vereinorder/database";
import { PRISMA_CLIENT } from "../prisma/prisma.module";
import { AuditService } from "../audit/audit.service";
import { MaintenanceStateService } from "./maintenance-state.service";
import { MaintenanceState } from "./maintenance.types";
import * as path from "node:path";
import { FileRestoreSwapStateStore } from "../backup/restore-swap";

/**
 * Entwurf Abschnitt 6, Vorschlag: mindestens 20 Sekunden zwischen dem Beginn
 * von DRAINING und der ersten Prüfung auf LOCKED. Über die Umgebungsvariable
 * überschreibbar, ausschließlich damit Tests nicht real 20 Sekunden warten
 * müssen. Als Funktion statt als beim Modulimport eingefrorene Konstante,
 * damit ein Test die Umgebungsvariable auch NACH dem Import noch wirksam
 * setzen kann (Standardparameter werden in JavaScript bei jedem Aufruf neu
 * ausgewertet, ein einmal berechneter `const`-Wert dagegen nicht).
 */
export function getDrainMinWaitMs(): number {
  return Number(process.env.MAINTENANCE_DRAIN_MIN_WAIT_MS ?? 20_000);
}

/** Prüfintervall für den Übergang DRAINING -> LOCKED. */
const DRAIN_CHECK_INTERVAL_MS = 2_000;

/**
 * Reine Prüfung ohne Seiteneffekt, damit sie ohne Datenbank und ohne echtes
 * Warten getestet werden kann (siehe `maintenance.service.spec.ts`).
 */
export function isDrainWaitElapsed(
  state: Pick<MaintenanceState, "since">,
  now: number,
  minWaitMs: number = getDrainMinWaitMs(),
): boolean {
  if (!state.since) return true;
  const since = new Date(state.since).getTime();
  if (!Number.isFinite(since)) return true;
  return now - since >= minWaitMs;
}

@Injectable()
export class MaintenanceService {
  private readonly logger = new Logger(MaintenanceService.name);

  constructor(
    private readonly stateService: MaintenanceStateService,
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    private readonly auditService: AuditService,
  ) {}

  getState(): MaintenanceState {
    return this.stateService.read();
  }

  /**
   * Setzt den Wartungsmodus, ADMINISTRATOR-only (Controller-Ebene). Beginnt
   * immer mit DRAINING, niemals direkt mit LOCKED — die feste Wartezeit und
   * die Druckauftragsprüfung müssen in jedem Fall durchlaufen werden.
   */
  async start(
    userId: string,
    username: string,
    reason?: string,
    expectedUntil?: string,
  ): Promise<MaintenanceState> {
    const current = this.stateService.read();
    if (current.phase !== "OPEN") {
      throw new ConflictException(
        "Wartungsmodus ist bereits aktiv — zuerst beenden, bevor er erneut gesetzt wird.",
      );
    }
    const next: MaintenanceState = {
      phase: "DRAINING",
      since: new Date().toISOString(),
      byUserId: userId,
      byUsername: username,
      reason: reason?.trim() || null,
      expectedUntil: expectedUntil?.trim() || null,
    };
    this.stateService.write(next);
    await this.auditService.log({
      action: "MAINTENANCE_STARTED",
      entityId: "maintenance",
      entityType: "Maintenance",
      userId,
      details: { reason: next.reason, expectedUntil: next.expectedUntil },
    });
    return next;
  }

  /** Beendet den Wartungsmodus, ADMINISTRATOR-only. Danach gilt OPEN. */
  async end(userId: string, username: string): Promise<MaintenanceState> {
    const current = this.stateService.read();
    if (current.phase === "OPEN") {
      throw new ConflictException("Wartungsmodus ist nicht aktiv.");
    }
    const restoreStore = new FileRestoreSwapStateStore(
      path.resolve(process.env.STATE_DIR || path.join(process.cwd(), "state")),
    );
    if (await restoreStore.read()) {
      throw new ConflictException(
        "Die Wiederherstellung muss zuerst ausdrücklich abgenommen oder zurückgenommen werden.",
      );
    }
    this.stateService.clear();
    await this.auditService.log({
      action: "MAINTENANCE_ENDED",
      entityId: "maintenance",
      entityType: "Maintenance",
      userId,
      details: {
        previousPhase: current.phase,
        since: current.since,
        endedBy: username,
      },
    });
    return this.stateService.read();
  }

  /**
   * Übergang DRAINING -> LOCKED. Frühestens nach `DRAIN_MIN_WAIT_MS` und erst
   * dann, wenn keine `PrintJob`-Zeile mehr in `DELIVERING` oder `SPOOLED`
   * steht — ein Blatt Papier, das gerade entsteht, wird nicht mitten im
   * Vorgang begraben (Entwurf Abschnitt 6). Fehlschläge der Datenbankabfrage
   * werden geloggt und beim nächsten Intervall erneut versucht, wie beim
   * Lease-Reaper (`print-jobs.reaper.ts`).
   */
  @Interval(DRAIN_CHECK_INTERVAL_MS)
  async tryAdvanceToLocked(): Promise<void> {
    const current = this.stateService.read();
    if (current.phase !== "DRAINING") return;
    if (!isDrainWaitElapsed(current, Date.now())) return;

    let blockingPrintJobs: number;
    try {
      blockingPrintJobs = await this.prisma.printJob.count({
        where: { attemptPhase: { in: ["DELIVERING", "SPOOLED"] } },
      });
    } catch (error) {
      this.logger.error(
        `Prüfung auf offene Druckaufträge fehlgeschlagen: ${(error as Error).message}`,
      );
      return;
    }
    if (blockingPrintJobs > 0) return;

    // Zwischenzeitlich könnte ein anderer Prozess (oder ein Administrator)
    // den Zustand bereits geändert haben; nur aus DRAINING heraus sperren.
    const stillDraining = this.stateService.read();
    if (stillDraining.phase !== "DRAINING") return;

    const next: MaintenanceState = { ...stillDraining, phase: "LOCKED" };
    this.stateService.write(next);
    await this.auditService.log({
      action: "MAINTENANCE_LOCKED",
      entityId: "maintenance",
      entityType: "Maintenance",
      userId: current.byUserId ?? undefined,
      details: { since: current.since },
    });
  }
}
