import { Injectable, Inject, Logger } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { PrismaClient } from "@vereinorder/database";
import { PRISMA_CLIENT } from "../prisma/prisma.module";
import { AuditService } from "../audit/audit.service";

/**
 * Architekturvorgabe Abschnitt 3.2, M5: Der Reaper läuft periodisch im
 * Backend, nicht beiläufig im Claim. Vorgabe: alle 15 Sekunden.
 */
export const REAPER_INTERVAL_MS = 15_000;

/**
 * Räumt abgelaufene Leases auf (Übergänge 8 und 9 aus Abschnitt 4.3). Die
 * Phase ist das EINZIGE Kriterium: CLAIMED bedeutet nachweislich kein
 * gesendetes Byte und geht zurück nach PENDING (kein Failover - kein
 * Druckerfehler); DELIVERING/SPOOLED bedeuten offenen Ausgang und gehen
 * nach UNRESOLVED. Löst NIE ein Failover aus - failoverCount wird
 * ausschließlich in PrintJobsService.tryFailover erhöht (Abschnitt 4.4).
 */
@Injectable()
export class PrintJobsReaperService {
  private readonly logger = new Logger(PrintJobsReaperService.name);

  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    private readonly auditService: AuditService,
  ) {}

  @Interval(REAPER_INTERVAL_MS)
  async sweepExpiredLeases(): Promise<void> {
    try {
      await this.requeueClaimedExpired();
      await this.unresolveActiveExpired();
    } catch (error) {
      // Der Reaper darf den Backend-Prozess niemals mitreißen; ein
      // fehlgeschlagener Durchlauf wird beim nächsten Intervall wiederholt.
      this.logger.error(
        `Reaper-Durchlauf fehlgeschlagen: ${(error as Error).message}`,
        (error as Error).stack,
      );
    }
  }

  /** Übergang 8: CLAIMED + Lease abgelaufen -> PENDING, kein Failover. */
  private async requeueClaimedExpired(): Promise<void> {
    const candidates = await this.prisma.printJob.findMany({
      where: {
        status: "PROCESSING",
        attemptPhase: "CLAIMED",
        leaseExpiresAt: { lt: new Date() },
      },
      select: {
        id: true,
        activePrinterId: true,
        printerId: true,
        attemptCount: true,
      },
    });

    for (const job of candidates) {
      await this.prisma.$transaction(async (tx) => {
        const updated = await tx.printJob.updateMany({
          where: { id: job.id, status: "PROCESSING", attemptPhase: "CLAIMED" },
          data: {
            status: "PENDING",
            attemptPhase: null,
            leaseId: null,
            leaseExpiresAt: null,
            lastHeartbeatAt: null,
            updatedAt: new Date(),
          },
        });
        // Zwischenzeitlich hat der Worker selbst gemeldet oder ein anderer
        // Reaper-Lauf hat die Zeile bereits behandelt: nichts zu tun.
        if (updated.count === 0) return;

        await this.auditService.log(
          {
            action: "PRINT_JOB_REQUEUED",
            entityId: job.id,
            entityType: "PrintJob",
            details: {
              printerId: job.activePrinterId ?? job.printerId,
              attemptPhase: "CLAIMED",
              reason: "LEASE_EXPIRED",
              attemptCount: job.attemptCount,
            },
          },
          tx,
        );
      });
    }
  }

  /** Übergang 9: DELIVERING/SPOOLED + Lease abgelaufen -> UNRESOLVED. */
  private async unresolveActiveExpired(): Promise<void> {
    const candidates = await this.prisma.printJob.findMany({
      where: {
        status: "PROCESSING",
        attemptPhase: { in: ["DELIVERING", "SPOOLED"] },
        leaseExpiresAt: { lt: new Date() },
      },
      select: {
        id: true,
        activePrinterId: true,
        printerId: true,
        errorCode: true,
        attemptPhase: true,
        cupsJobId: true,
        cupsJobState: true,
        bytesWritten: true,
      },
    });

    for (const job of candidates) {
      const expectedPhase = job.attemptPhase as "DELIVERING" | "SPOOLED";
      await this.prisma.$transaction(async (tx) => {
        const updated = await tx.printJob.updateMany({
          where: {
            id: job.id,
            status: "PROCESSING",
            attemptPhase: expectedPhase,
          },
          data: {
            status: "UNRESOLVED",
            attemptPhase: null,
            outcomeClass: "UNCLEAR",
            unresolvedAt: new Date(),
            unresolvedReason: "LEASE_EXPIRED",
            updatedAt: new Date(),
          },
        });
        if (updated.count === 0) return;

        await this.auditService.log(
          {
            action: "PRINT_JOB_UNRESOLVED",
            entityId: job.id,
            entityType: "PrintJob",
            details: {
              printerId: job.activePrinterId ?? job.printerId,
              errorCode: job.errorCode,
              unresolvedReason: "LEASE_EXPIRED",
              attemptPhase: expectedPhase,
              cupsJobId: job.cupsJobId,
              cupsJobState: job.cupsJobState,
              bytesWritten: job.bytesWritten,
            },
          },
          tx,
        );
      });
    }
  }
}
