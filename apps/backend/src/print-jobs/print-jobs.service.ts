import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Inject,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "crypto";
import { Prisma, PrismaClient, PrintJob, Printer } from "@vereinorder/database";
import { PRISMA_CLIENT } from "../prisma/prisma.module";
import { AuditService } from "../audit/audit.service";

/** Druckertypen, die der Print-Worker tatsächlich bedienen kann. */
export const SUPPORTED_PRINTER_TYPES = [
  "CONSOLE",
  "ESC_POS_NETWORK",
  "CUPS_IPP",
] as const;
export const SUPPORTED_PAPER_WIDTHS = [58, 80];
export const SUPPORTED_CODEPAGES = ["CP437", "CP850", "CP858"];
export const SUPPORTED_CUT_MODES = ["NONE", "PARTIAL", "FULL"];

const HOST_PATTERN = /^[A-Za-z0-9._-]+$/;
const QUEUE_NAME_PATTERN = /^[A-Za-z0-9_-]+$/;
const CUPS_DEFAULT_PORT = 631;

/**
 * Lease-Dauer eines Zustellversuchs (Architekturvorgabe Abschnitt 3.2, M2).
 * Ersetzt die frühere feste 5-Minuten-Requeue-Konstante vollständig.
 */
const LEASE_DURATION_MS = 60_000;

/**
 * Fehlerkennungen, bei denen ein Ersatzdrucker die Ursache nicht beheben
 * würde. Eine ungültige Konfiguration darf nicht stillschweigend umgangen
 * werden (Architekturvorgabe Abschnitt 2.2: PrinterConfigurationError /
 * client-error-not-found / Simulator).
 */
const NO_FAILOVER_ERROR_CODES = new Set([
  "PRINTER_CONFIG_ERROR",
  "CUPS_QUEUE_NOT_FOUND",
  "OUTPUT_FAILED",
]);

/** Druckertypen, die niemals ein Failover auslösen (R6: Simulator/Konsole). */
const NO_FAILOVER_PRINTER_TYPES = new Set(["CONSOLE"]);

const VALID_PHASES = ["DELIVERING", "SPOOLED"] as const;
const VALID_OUTCOMES = ["PRINTED", "NOT_PRINTED", "UNCLEAR"] as const;
const VALID_RESOLUTIONS = [
  "REPRINTED",
  "CONFIRMED_PRINTED",
  "DISCARDED",
] as const;

export type PrintAttemptPhaseTarget = (typeof VALID_PHASES)[number];
export type PrintOutcome = (typeof VALID_OUTCOMES)[number];
export type PrintJobResolution = (typeof VALID_RESOLUTIONS)[number];

export interface PrinterInput {
  name?: string;
  type?: string;
  ipAddress?: string | null;
  port?: number | null;
  isActive?: boolean;
  paperWidth?: number;
  codepage?: string;
  cutMode?: string;
  copies?: number;
  timeoutMs?: number;
  queueName?: string | null;
  fallbackPrinterId?: string | null;
}

export interface ReportOutcomeInput {
  leaseId: string;
  outcome: PrintOutcome;
  errorCode?: string | null;
  errorMessage?: string | null;
  bytesWritten?: number | null;
  cupsJobState?: string | null;
}

export interface ResolveJobInput {
  resolution: PrintJobResolution;
  targetPrinterId?: string | null;
  comment?: string | null;
}

interface OutcomeEvidence {
  errorCode?: string | null;
  errorMessage?: string | null;
  bytesWritten?: number | null;
  cupsJobState?: string | null;
}

@Injectable()
export class PrintJobsService {
  constructor(
    @Inject(PRISMA_CLIENT) private prisma: PrismaClient,
    private auditService: AuditService,
  ) {}

  // ---------------------------------------------------------------------
  // Worker-Vertrag (Architekturvorgabe Abschnitt 5.5)
  // ---------------------------------------------------------------------

  /**
   * Reserviert atomar den ältesten wartenden Auftrag für einen Worker.
   * Auswahl NUR über status = 'PENDING' (M1) - der zeitgesteuerte Requeue
   * über updatedAt entfällt ersatzlos. Erzeugt ein neues Fencing-Token
   * (leaseId), setzt die Phase auf CLAIMED und erhöht attemptCount. Löscht
   * NICHT errorCode/errorMessage/outcomeClass/failover*-Felder - das wäre
   * die letzte Diagnose eines vorherigen Versuchs.
   */
  async claimNextJob(): Promise<(PrintJob & { printer: Printer }) | null> {
    const leaseId = randomUUID();
    const leaseExpiresAt = new Date(Date.now() + LEASE_DURATION_MS);

    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
        UPDATE "PrintJob"
        SET
          "status" = 'PROCESSING',
          "attemptPhase" = 'CLAIMED',
          "leaseId" = ${leaseId},
          "leaseExpiresAt" = ${leaseExpiresAt},
          "lastHeartbeatAt" = NULL,
          "attemptCount" = "attemptCount" + 1,
          "updatedAt" = NOW()
        WHERE "id" = (
          SELECT "id"
          FROM "PrintJob"
          WHERE "status" = 'PENDING'
          ORDER BY "createdAt" ASC
          LIMIT 1
          FOR UPDATE SKIP LOCKED
        )
        RETURNING "id"
      `);
      const id = rows[0]?.id;
      if (!id) return null;

      const job = await tx.printJob.findUniqueOrThrow({
        where: { id },
        include: { printer: true, activePrinter: true },
      });
      return this.resolveActivePrinter(job);
    });
  }

  /**
   * Bestätigt den Phasenwechsel CLAIMED -> DELIVERING bzw.
   * DELIVERING -> SPOOLED. Nur über das mitgeführte leaseId gefenct; ein
   * fremdes oder abgelaufenes Token führt zu 409 (Übergänge 2 und 3).
   */
  async transitionPhase(
    id: string,
    leaseId: string,
    phase: PrintAttemptPhaseTarget,
    cupsJobId?: number,
  ): Promise<PrintJob> {
    if (!leaseId) {
      throw new BadRequestException("leaseId ist erforderlich.");
    }
    if (!VALID_PHASES.includes(phase)) {
      throw new BadRequestException("Ungültiger Phasenwechsel.");
    }
    if (
      phase === "SPOOLED" &&
      (cupsJobId === undefined || cupsJobId === null)
    ) {
      throw new BadRequestException(
        "cupsJobId ist beim Wechsel nach SPOOLED erforderlich.",
      );
    }
    const expectedFrom = phase === "DELIVERING" ? "CLAIMED" : "DELIVERING";

    const updated = await this.prisma.printJob.updateMany({
      where: {
        id,
        leaseId,
        status: "PROCESSING",
        attemptPhase: expectedFrom,
        leaseExpiresAt: { gt: new Date() },
      },
      data: {
        attemptPhase: phase,
        ...(phase === "SPOOLED" ? { cupsJobId } : {}),
        updatedAt: new Date(),
      },
    });
    if (updated.count === 0) {
      throw new ConflictException(
        "Fremder oder abgelaufener Lease-Token, oder der Auftrag befindet sich nicht in der erwarteten Phase.",
      );
    }
    return this.prisma.printJob.findUniqueOrThrow({ where: { id } });
  }

  /**
   * Verlängert die Reservierung um eine weitere Lease-Dauer und trägt das
   * letzte Lebenszeichen des Workers ein. 409 bei fremdem Token.
   */
  async heartbeat(
    id: string,
    leaseId: string,
  ): Promise<{ leaseExpiresAt: Date }> {
    if (!leaseId) {
      throw new BadRequestException("leaseId ist erforderlich.");
    }
    const leaseExpiresAt = new Date(Date.now() + LEASE_DURATION_MS);
    const updated = await this.prisma.printJob.updateMany({
      where: { id, leaseId, status: "PROCESSING" },
      data: { leaseExpiresAt, lastHeartbeatAt: new Date() },
    });
    if (updated.count === 0) {
      throw new ConflictException(
        "Fremder Lease-Token oder der Auftrag ist nicht mehr reserviert.",
      );
    }
    return { leaseExpiresAt };
  }

  /**
   * Der Worker meldet die Ergebnisklasse (PRINTED | NOT_PRINTED | UNCLEAR),
   * niemals einen Status direkt - das Backend leitet Status und Failover
   * aus der Klasse ab (Übergänge 4-7). 409 bei fremdem Token, idempotent
   * bei doppelter Meldung mit demselben Token.
   */
  async reportOutcome(
    id: string,
    input: ReportOutcomeInput,
  ): Promise<PrintJob> {
    const { leaseId, outcome } = input;
    if (!leaseId) {
      throw new BadRequestException("leaseId ist erforderlich.");
    }
    if (!VALID_OUTCOMES.includes(outcome)) {
      throw new BadRequestException("Ungültige Ergebnisklasse.");
    }
    const evidence: OutcomeEvidence = {
      errorCode: input.errorCode ?? null,
      errorMessage: input.errorMessage ?? null,
      bytesWritten: input.bytesWritten ?? null,
      cupsJobState: input.cupsJobState ?? null,
    };

    if (outcome === "PRINTED") {
      return this.finalizeAsPrinted(id, leaseId, evidence);
    }
    if (outcome === "UNCLEAR") {
      return this.finalizeAsUnresolved(id, leaseId, evidence);
    }
    return this.finalizeNotPrinted(id, leaseId, evidence);
  }

  // ---------------------------------------------------------------------
  // Ergebnisverarbeitung
  // ---------------------------------------------------------------------

  /** Übergang 4: Meldung PRINTED -> PRINTED, unabhängig von der Phase. */
  private async finalizeAsPrinted(
    id: string,
    leaseId: string,
    evidence: OutcomeEvidence,
  ): Promise<PrintJob> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
        UPDATE "PrintJob"
        SET "status" = 'PRINTED',
            "attemptPhase" = NULL,
            "outcomeClass" = 'PRINTED',
            "errorCode" = ${evidence.errorCode},
            "errorMessage" = ${evidence.errorMessage},
            "bytesWritten" = ${evidence.bytesWritten},
            "cupsJobState" = ${evidence.cupsJobState},
            "deliveredAt" = NOW(),
            "updatedAt" = NOW()
        WHERE "id" = ${id} AND "status" = 'PROCESSING' AND "leaseId" = ${leaseId}
        RETURNING "id"
      `);
      if (rows.length === 0) {
        return this.resolveIdempotentOrConflict(tx, id, leaseId, ["PRINTED"]);
      }
      return tx.printJob.findUniqueOrThrow({ where: { id } });
    });
  }

  /** Übergang 7: Meldung UNCLEAR -> UNRESOLVED. Niemals automatischer Zweitdruck. */
  private async finalizeAsUnresolved(
    id: string,
    leaseId: string,
    evidence: OutcomeEvidence,
  ): Promise<PrintJob> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
        UPDATE "PrintJob"
        SET "status" = 'UNRESOLVED',
            "attemptPhase" = NULL,
            "outcomeClass" = 'UNCLEAR',
            "errorCode" = ${evidence.errorCode},
            "errorMessage" = ${evidence.errorMessage},
            "bytesWritten" = ${evidence.bytesWritten},
            "cupsJobState" = ${evidence.cupsJobState},
            "unresolvedAt" = NOW(),
            "unresolvedReason" = 'TRANSPORT',
            "updatedAt" = NOW()
        WHERE "id" = ${id} AND "status" = 'PROCESSING' AND "leaseId" = ${leaseId}
        RETURNING "id"
      `);
      if (rows.length === 0) {
        return this.resolveIdempotentOrConflict(tx, id, leaseId, [
          "UNRESOLVED",
        ]);
      }
      const job = await tx.printJob.findUniqueOrThrow({ where: { id } });
      await this.auditService.log(
        {
          action: "PRINT_JOB_UNRESOLVED",
          entityId: id,
          entityType: "PrintJob",
          details: {
            printerId: job.activePrinterId ?? job.printerId,
            errorCode: job.errorCode,
            unresolvedReason: job.unresolvedReason,
            attemptPhase: null,
            cupsJobId: job.cupsJobId,
            cupsJobState: job.cupsJobState,
            bytesWritten: job.bytesWritten,
          },
        },
        tx,
      );
      return job;
    });
  }

  /**
   * Meldung NOT_PRINTED. Entscheidet zwischen Failover (Übergang 5) und
   * endgültigem Fehlschlag (Übergang 6). Der Failover-Versuch ist die
   * einzige Codestelle, die failoverCount erhöht (Abschnitt 4.4).
   */
  private async finalizeNotPrinted(
    id: string,
    leaseId: string,
    evidence: OutcomeEvidence,
  ): Promise<PrintJob> {
    const current = await this.prisma.printJob.findUnique({
      where: { id },
      include: { printer: true, activePrinter: true },
    });
    if (!current) {
      throw new NotFoundException("Druckauftrag nicht gefunden.");
    }

    const currentPrinter = current.activePrinter ?? current.printer;
    const currentPrinterId = current.activePrinterId ?? current.printerId;

    let fallback: Printer | null = null;
    const excludedByErrorCode =
      !!evidence.errorCode && NO_FAILOVER_ERROR_CODES.has(evidence.errorCode);
    const excludedByPrinterType = NO_FAILOVER_PRINTER_TYPES.has(
      currentPrinter.type,
    );
    if (
      current.failoverCount === 0 &&
      !excludedByErrorCode &&
      !excludedByPrinterType &&
      currentPrinter.fallbackPrinterId
    ) {
      const candidate = await this.prisma.printer.findUnique({
        where: { id: currentPrinter.fallbackPrinterId },
      });
      if (candidate && candidate.isActive) {
        fallback = candidate;
      }
    }

    if (fallback) {
      const applied = await this.tryFailover(
        id,
        leaseId,
        currentPrinterId,
        fallback.id,
        evidence,
      );
      if (applied) return applied;
      // Die bedingte Anweisung hat null Zeilen getroffen: entweder ein
      // fremdes/abgelaufenes Token, oder ein paralleler Aufruf war schneller
      // (failoverCount bereits 1). Es darf jetzt NICHT blind auf FAILED
      // weitergefallen werden - das würde die Ein-Wechsel-Invariante
      // verletzen. Nur der tatsächliche Zustand entscheidet.
      return this.prisma.$transaction((tx) =>
        this.resolveIdempotentOrConflict(tx, id, leaseId, ["FAILED"]),
      );
    }

    return this.finalizeAsFailed(id, leaseId, evidence);
  }

  /**
   * Die eine bedingte SQL-Anweisung aus Abschnitt 4.4: Failover gelingt nur,
   * wenn Lease, Status UND failoverCount = 0 gleichzeitig zutreffen. Damit
   * hält "genau einmal wechseln" bei parallelen Workern und über Neustarts
   * hinweg, ohne zusätzliche Sperren.
   */
  private async tryFailover(
    id: string,
    leaseId: string,
    currentPrinterId: string,
    fallbackPrinterId: string,
    evidence: OutcomeEvidence,
  ): Promise<PrintJob | null> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
        UPDATE "PrintJob"
        SET "status" = 'PENDING',
            "activePrinterId" = ${fallbackPrinterId},
            "failoverCount" = 1,
            "failoverAt" = NOW(),
            "failoverReason" = ${evidence.errorCode},
            "failoverFromPrinterId" = ${currentPrinterId},
            "leaseId" = NULL,
            "leaseExpiresAt" = NULL,
            "attemptPhase" = NULL,
            "outcomeClass" = 'NOT_PRINTED',
            "errorCode" = ${evidence.errorCode},
            "errorMessage" = ${evidence.errorMessage},
            "bytesWritten" = ${evidence.bytesWritten},
            "updatedAt" = NOW()
        WHERE "id" = ${id}
          AND "status" = 'PROCESSING'
          AND "leaseId" = ${leaseId}
          AND "failoverCount" = 0
        RETURNING "id"
      `);
      if (rows.length === 0) return null;

      const job = await tx.printJob.findUniqueOrThrow({ where: { id } });
      await this.auditService.log(
        {
          action: "PRINT_JOB_FAILOVER",
          entityId: id,
          entityType: "PrintJob",
          details: {
            fromPrinterId: currentPrinterId,
            toPrinterId: fallbackPrinterId,
            errorCode: evidence.errorCode,
            outcomeClass: "NOT_PRINTED",
            attemptCount: job.attemptCount,
            occurredAt: job.failoverAt,
          },
        },
        tx,
      );
      return job;
    });
  }

  /** Übergang 6: kein Ersatzdrucker verfügbar/zulässig -> FAILED, terminal. */
  private async finalizeAsFailed(
    id: string,
    leaseId: string,
    evidence: OutcomeEvidence,
  ): Promise<PrintJob> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
        UPDATE "PrintJob"
        SET "status" = 'FAILED',
            "attemptPhase" = NULL,
            "outcomeClass" = 'NOT_PRINTED',
            "errorCode" = ${evidence.errorCode},
            "errorMessage" = ${evidence.errorMessage},
            "bytesWritten" = ${evidence.bytesWritten},
            "updatedAt" = NOW()
        WHERE "id" = ${id} AND "status" = 'PROCESSING' AND "leaseId" = ${leaseId}
        RETURNING "id"
      `);
      if (rows.length === 0) {
        return this.resolveIdempotentOrConflict(tx, id, leaseId, ["FAILED"]);
      }
      const job = await tx.printJob.findUniqueOrThrow({ where: { id } });
      await this.auditService.log(
        {
          action: "PRINT_JOB_FAILED",
          entityId: id,
          entityType: "PrintJob",
          details: {
            printerId: job.activePrinterId ?? job.printerId,
            errorCode: job.errorCode,
            outcomeClass: job.outcomeClass,
            attemptCount: job.attemptCount,
            failoverCount: job.failoverCount,
          },
        },
        tx,
      );
      return job;
    });
  }

  /**
   * Wird aufgerufen, wenn die bedingte Fencing-Anweisung null Zeilen
   * getroffen hat. Trägt der Idempotenz aus M4 Rechnung: eine zweite
   * Meldung mit demselben leaseId, die denselben Endzustand bereits
   * erreicht hat, ist kein Fehler. Alles andere ist ein echter
   * Fencing-Konflikt (fremdes oder abgelaufenes Token).
   */
  private async resolveIdempotentOrConflict(
    tx: Prisma.TransactionClient,
    id: string,
    leaseId: string,
    acceptableStatuses: string[],
  ): Promise<PrintJob> {
    const job = await tx.printJob.findUnique({ where: { id } });
    if (!job) {
      throw new NotFoundException("Druckauftrag nicht gefunden.");
    }
    if (job.leaseId === leaseId && acceptableStatuses.includes(job.status)) {
      return job;
    }
    throw new ConflictException(
      "Der Druckauftrag gehört nicht mehr zu diesem Lease-Token oder befindet sich nicht mehr im erwarteten Zustand.",
    );
  }

  /**
   * Löst den für den Worker maßgeblichen Drucker auf:
   * COALESCE(activePrinterId, printerId). Nach einem Failover ist
   * activePrinter gesetzt, sonst gilt weiterhin der ursprüngliche printerId.
   */
  private resolveActivePrinter(
    job: PrintJob & { printer: Printer; activePrinter: Printer | null },
  ): PrintJob & { printer: Printer } {
    const { activePrinter, ...rest } = job;
    return { ...rest, printer: activePrinter ?? job.printer };
  }

  // ---------------------------------------------------------------------
  // Admin: unklare Druckaufträge (Architekturvorgabe Abschnitt 6.2)
  // ---------------------------------------------------------------------

  /**
   * Liste "Unklare Druckaufträge". Aus content werden AUSSCHLIESSLICH die
   * Wiedererkennungs-Metadaten title/orderNumber/stationName/tableName
   * herausgelöst - ausdrücklich keine Positionen, Preise, Zahlungen oder
   * Bedienungsnamen (Vorgabe der Projektleitung).
   */
  async findUnresolvedJobs() {
    const jobs = await this.prisma.printJob.findMany({
      where: { status: "UNRESOLVED" },
      include: { printer: true, activePrinter: true },
      orderBy: { unresolvedAt: "asc" },
    });

    return jobs.map((job) => {
      const printer = job.activePrinter ?? job.printer;
      const content = (job.content ?? {}) as Record<string, unknown>;
      return {
        id: job.id,
        jobType: job.jobType,
        printerId: printer.id,
        printerName: printer.name,
        unresolvedAt: job.unresolvedAt,
        unresolvedReason: job.unresolvedReason,
        bytesWritten: job.bytesWritten,
        cupsJobState: job.cupsJobState,
        attemptCount: job.attemptCount,
        failoverCount: job.failoverCount,
        content: {
          title: content.title ?? null,
          orderNumber: content.orderNumber ?? null,
          stationName: content.stationName ?? null,
          tableName: content.tableName ?? null,
        },
      };
    });
  }

  /**
   * Die drei zulässigen Admin-Entscheidungen aus Abschnitt 6.2 - keine
   * vierte. Selbst gefenct über status = 'UNRESOLVED': zwei gleichzeitig
   * klickende Admins erzeugen keinen zweiten Auftrag, der zweite Aufruf
   * erhält 409.
   */
  async resolveJob(
    id: string,
    input: ResolveJobInput,
    actorUserId: string | undefined,
    actorRole: string | undefined,
  ): Promise<PrintJob> {
    const { resolution, targetPrinterId, comment } = input;
    if (!VALID_RESOLUTIONS.includes(resolution)) {
      throw new BadRequestException("Ungültige Entscheidung.");
    }
    if (!actorUserId) {
      throw new BadRequestException(
        "Die Entscheidung erfordert eine angemeldete Person.",
      );
    }
    if (resolution === "DISCARDED" && actorRole !== "ADMINISTRATOR") {
      throw new ForbiddenException(
        "Nur die Administration darf einen Druckauftrag verwerfen.",
      );
    }
    if (resolution === "DISCARDED" && !(comment && comment.trim().length > 0)) {
      throw new BadRequestException(
        "Beim Verwerfen ist ein Kommentar zur Begründung Pflicht.",
      );
    }
    if (targetPrinterId && resolution !== "REPRINTED") {
      throw new BadRequestException(
        "Ein Zieldrucker ist nur beim erneuten Drucken zulässig.",
      );
    }

    let resolvedTargetPrinterId: string | null = null;
    if (resolution === "REPRINTED" && targetPrinterId) {
      const target = await this.prisma.printer.findUnique({
        where: { id: targetPrinterId },
      });
      if (!target) {
        throw new NotFoundException("Zieldrucker nicht gefunden.");
      }
      if (!target.isActive) {
        throw new BadRequestException("Der gewählte Drucker ist nicht aktiv.");
      }
      resolvedTargetPrinterId = target.id;
    }

    return this.prisma.$transaction(async (tx) => {
      const data: Prisma.PrintJobUncheckedUpdateManyInput = {
        resolvedAt: new Date(),
        resolvedByUserId: actorUserId,
        resolution,
        updatedAt: new Date(),
      };
      if (resolution === "REPRINTED") {
        data.status = "PENDING";
        data.attemptCount = { increment: 1 };
        if (resolvedTargetPrinterId) {
          data.activePrinterId = resolvedTargetPrinterId;
        }
      } else if (resolution === "CONFIRMED_PRINTED") {
        data.status = "PRINTED";
        data.deliveredAt = new Date();
      } else {
        data.status = "CANCELLED";
      }

      const updated = await tx.printJob.updateMany({
        where: { id, status: "UNRESOLVED" },
        data,
      });
      if (updated.count === 0) {
        const exists = await tx.printJob.findUnique({
          where: { id },
          select: { id: true },
        });
        if (!exists)
          throw new NotFoundException("Druckauftrag nicht gefunden.");
        throw new ConflictException(
          "Der Druckauftrag befindet sich nicht mehr im Zustand UNRESOLVED - vermutlich hat bereits jemand entschieden.",
        );
      }

      const job = await tx.printJob.findUniqueOrThrow({ where: { id } });
      await this.auditService.log(
        {
          action: "PRINT_JOB_RESOLVED",
          entityId: id,
          entityType: "PrintJob",
          userId: actorUserId,
          details: {
            resolution,
            targetPrinterId: resolvedTargetPrinterId,
            previousStatus: "UNRESOLVED",
            comment: comment ?? null,
          },
        },
        tx,
      );
      return job;
    });
  }

  /**
   * Zustand eines einzelnen Auftrags. Die Administration fragt damit das
   * Ergebnis eines Testdrucks ab, ohne die gesamte Warteschlange zu laden.
   */
  async findJobStatus(id: string) {
    const job = await this.prisma.printJob.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        errorMessage: true,
        errorCode: true,
        outcomeClass: true,
        jobType: true,
        printerId: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!job) throw new NotFoundException("Print job not found");
    return job;
  }

  async findAllPrinters(): Promise<Printer[]> {
    return this.prisma.printer.findMany({
      include: { stations: true },
      orderBy: { name: "asc" },
    });
  }

  async createPrinter(
    data: PrinterInput,
    actorUserId?: string,
  ): Promise<Printer> {
    const values = this.sanitizePrinter(data, { partial: false });
    if (data.fallbackPrinterId !== undefined) {
      await this.assertFallbackAssignmentAllowed(null, data.fallbackPrinterId);
      values.fallbackPrinterId = data.fallbackPrinterId;
    }
    if (!values.name || !values.type) {
      throw new BadRequestException(
        "Druckername und Druckertyp sind erforderlich.",
      );
    }
    const printer = await this.prisma.printer.create({
      data: {
        name: values.name,
        type: values.type,
        ipAddress: values.ipAddress,
        port: values.port,
        isActive: values.isActive,
        paperWidth: values.paperWidth,
        codepage: values.codepage,
        cutMode: values.cutMode,
        copies: values.copies,
        timeoutMs: values.timeoutMs,
        queueName: values.queueName,
        fallbackPrinterId: values.fallbackPrinterId,
      },
    });
    if (data.fallbackPrinterId) {
      await this.auditService.log({
        action: "PRINTER_FALLBACK_CHANGED",
        entityId: printer.id,
        entityType: "Printer",
        userId: actorUserId,
        details: {
          printerId: printer.id,
          from: null,
          to: data.fallbackPrinterId,
        },
      });
    }
    return printer;
  }

  async updatePrinter(
    id: string,
    data: PrinterInput,
    actorUserId?: string,
  ): Promise<Printer> {
    const existing = await this.prisma.printer.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Printer not found");

    const values = this.sanitizePrinter(data, {
      partial: true,
      existingType: existing.type,
    });
    if (data.fallbackPrinterId !== undefined) {
      await this.assertFallbackAssignmentAllowed(id, data.fallbackPrinterId);
      values.fallbackPrinterId = data.fallbackPrinterId;
    }
    const printer = await this.prisma.printer.update({
      where: { id },
      data: {
        name: values.name,
        type: values.type,
        ipAddress: values.ipAddress,
        port: values.port,
        isActive: values.isActive,
        paperWidth: values.paperWidth,
        codepage: values.codepage,
        cutMode: values.cutMode,
        copies: values.copies,
        timeoutMs: values.timeoutMs,
        queueName: values.queueName,
        fallbackPrinterId: values.fallbackPrinterId,
      },
    });
    if (
      data.fallbackPrinterId !== undefined &&
      data.fallbackPrinterId !== existing.fallbackPrinterId
    ) {
      await this.auditService.log({
        action: "PRINTER_FALLBACK_CHANGED",
        entityId: id,
        entityType: "Printer",
        userId: actorUserId,
        details: {
          printerId: id,
          from: existing.fallbackPrinterId,
          to: data.fallbackPrinterId,
        },
      });
    }
    return printer;
  }

  /**
   * Legt einen Testbon an. Der Auftrag durchläuft dieselbe Warteschlange und
   * denselben Transport wie ein echter Bon, damit der Test aussagekräftig ist.
   */
  async createTestJob(printerId: string): Promise<PrintJob> {
    const printer = await this.prisma.printer.findUnique({
      where: { id: printerId },
    });
    if (!printer) throw new NotFoundException("Printer not found");

    return this.prisma.printJob.create({
      data: {
        printerId,
        jobType: "RECEIPT",
        content: {
          kind: "TEST_PRINT",
          title: "TEST-DRUCK",
          printerName: printer.name,
          printerType: printer.type,
          paperWidth: printer.paperWidth,
          codepage: printer.codepage,
          timestamp: new Date().toISOString(),
          message: "Druckerschnittstelle erfolgreich verbunden!",
        },
      },
    });
  }

  // ---------------------------------------------------------------------
  // Druckerverwaltung
  // ---------------------------------------------------------------------

  /**
   * Prüft, was die Datenbank nicht garantieren kann (siehe Blockkommentar
   * über model Printer in schema.prisma): Der Zieldrucker muss existieren
   * und aktiv sein, und es darf keine Kette entstehen - weder indem der
   * Ersatzdrucker selbst schon einen Ersatzdrucker hat, noch indem dieser
   * Drucker bereits der Ersatzdrucker eines anderen ist. Die
   * Selbstreferenzfreiheit prüft bereits die Datenbank.
   */
  private async assertFallbackAssignmentAllowed(
    printerId: string | null,
    fallbackPrinterId: string | null | undefined,
  ): Promise<void> {
    if (!fallbackPrinterId) return; // Entfernen der Zuordnung ist immer erlaubt

    if (printerId && fallbackPrinterId === printerId) {
      throw new BadRequestException(
        "Ein Drucker kann nicht sein eigener Ersatzdrucker sein.",
      );
    }

    const target = await this.prisma.printer.findUnique({
      where: { id: fallbackPrinterId },
    });
    if (!target) {
      throw new BadRequestException(
        "Der gewählte Ersatzdrucker existiert nicht.",
      );
    }
    if (!target.isActive) {
      throw new BadRequestException(
        "Der gewählte Ersatzdrucker ist nicht aktiv.",
      );
    }
    if (target.fallbackPrinterId) {
      throw new BadRequestException(
        "Der gewählte Ersatzdrucker hat selbst bereits einen Ersatzdrucker - eine Kette ist nicht zulässig.",
      );
    }

    if (printerId) {
      const usedAsFallbackBy = await this.prisma.printer.findFirst({
        where: { fallbackPrinterId: printerId },
      });
      if (usedAsFallbackBy) {
        throw new BadRequestException(
          "Dieser Drucker ist bereits der Ersatzdrucker eines anderen Druckers und darf deshalb selbst keinen Ersatzdrucker erhalten - eine Kette ist nicht zulässig.",
        );
      }
    }
  }

  /**
   * Prüft die Eingaben der Administration. Ein Drucker, den der Worker nicht
   * bedienen kann, darf gar nicht erst gespeichert werden.
   */
  private sanitizePrinter(
    data: PrinterInput,
    options: { partial: boolean; existingType?: string },
  ): PrinterInput {
    const values: PrinterInput = {};
    const has = (key: keyof PrinterInput) =>
      data[key] !== undefined && data[key] !== null;

    if (has("name") || !options.partial) {
      if (typeof data.name !== "string") {
        throw new BadRequestException("Der Druckername muss Text sein.");
      }
      const name = data.name.trim();
      if (name.length === 0) {
        throw new BadRequestException("Der Druckername darf nicht leer sein.");
      }
      values.name = name;
    }

    if (data.type !== undefined && typeof data.type !== "string") {
      throw new BadRequestException("Der Druckertyp muss Text sein.");
    }
    const providedType = data.type?.toUpperCase();
    if (providedType !== undefined || !options.partial) {
      if (!SUPPORTED_PRINTER_TYPES.some((type) => type === providedType)) {
        throw new BadRequestException(
          `Druckertyp "${providedType ?? ""}" wird nicht unterstützt. Erlaubt: ${SUPPORTED_PRINTER_TYPES.join(", ")}.`,
        );
      }
      values.type = providedType;
    }

    // Adresse/Warteschlange nur prüfen, wenn Typ oder das Feld selbst
    // geändert werden.
    const effectiveType =
      providedType ?? (options.existingType ?? "").toUpperCase();
    const touchesTransport =
      providedType !== undefined || data.ipAddress !== undefined;
    const touchesQueue =
      providedType !== undefined || data.queueName !== undefined;

    if (effectiveType === "ESC_POS_NETWORK") {
      if (touchesTransport) {
        if (typeof data.ipAddress !== "string") {
          throw new BadRequestException("Die IP-Adresse muss Text sein.");
        }
        const host = data.ipAddress.trim();
        if (host.length === 0) {
          throw new BadRequestException(
            "Netzwerkdrucker brauchen eine IP-Adresse oder einen Hostnamen.",
          );
        }
        if (!HOST_PATTERN.test(host)) {
          throw new BadRequestException(
            `"${host}" ist keine gültige IP-Adresse und kein gültiger Hostname.`,
          );
        }
        values.ipAddress = host;
      }
    } else if (effectiveType === "CUPS_IPP") {
      // ipAddress ist bei CUPS_IPP optional (abweichender CUPS-Host).
      if (data.ipAddress !== undefined) {
        if (data.ipAddress !== null && typeof data.ipAddress !== "string") {
          throw new BadRequestException("Die Druckeradresse muss Text sein.");
        }
        const host = data.ipAddress?.trim() ?? "";
        if (host.length === 0) {
          values.ipAddress = null;
        } else if (!HOST_PATTERN.test(host)) {
          throw new BadRequestException(
            `"${host}" ist keine gültige IP-Adresse und kein gültiger Hostname.`,
          );
        } else {
          values.ipAddress = host;
        }
      }
      if (touchesQueue || !options.partial) {
        if (typeof data.queueName !== "string") {
          throw new BadRequestException(
            "Einen Warteschlangennamen bitte als Text angeben.",
          );
        }
        const queueName = data.queueName.trim();
        if (queueName.length === 0) {
          throw new BadRequestException(
            "CUPS-Drucker brauchen einen Warteschlangennamen (queueName).",
          );
        }
        if (!QUEUE_NAME_PATTERN.test(queueName)) {
          throw new BadRequestException(
            `"${queueName}" ist kein gültiger CUPS-Warteschlangenname.`,
          );
        }
        values.queueName = queueName;
      }
    } else {
      if (data.ipAddress !== undefined) values.ipAddress = null;
      if (data.queueName !== undefined) values.queueName = null;
    }

    if (has("port")) {
      values.port = this.expectRange(data.port, "Port", 1, 65535);
    }
    if (has("copies")) {
      values.copies = this.expectRange(data.copies, "Kopienzahl", 1, 9);
    }
    if (has("timeoutMs")) {
      values.timeoutMs = this.expectRange(
        data.timeoutMs,
        "Zeitlimit",
        250,
        120000,
      );
    }
    if (has("paperWidth")) {
      const width = data.paperWidth;
      if (!SUPPORTED_PAPER_WIDTHS.includes(width)) {
        throw new BadRequestException(
          `Papierbreite muss ${SUPPORTED_PAPER_WIDTHS.join(" oder ")} Millimeter sein.`,
        );
      }
      values.paperWidth = width;
    }
    if (has("codepage")) {
      if (typeof data.codepage !== "string") {
        throw new BadRequestException("Der Zeichensatz muss Text sein.");
      }
      const codepage = data.codepage.toUpperCase();
      if (!SUPPORTED_CODEPAGES.includes(codepage)) {
        throw new BadRequestException(
          `Zeichensatz muss einer von ${SUPPORTED_CODEPAGES.join(", ")} sein.`,
        );
      }
      values.codepage = codepage;
    }
    if (has("cutMode")) {
      if (typeof data.cutMode !== "string") {
        throw new BadRequestException("Die Schnittart muss Text sein.");
      }
      const cutMode = data.cutMode.toUpperCase();
      if (!SUPPORTED_CUT_MODES.includes(cutMode)) {
        throw new BadRequestException(
          `Schnittart muss einer von ${SUPPORTED_CUT_MODES.join(", ")} sein.`,
        );
      }
      values.cutMode = cutMode;
    }
    if (data.isActive !== undefined) {
      if (typeof data.isActive !== "boolean") {
        throw new BadRequestException("isActive muss ein Wahrheitswert sein.");
      }
      values.isActive = data.isActive;
    }

    // Vorgabe-Port 631 für neu angelegte CUPS_IPP-Drucker ohne expliziten Port.
    if (
      effectiveType === "CUPS_IPP" &&
      !options.partial &&
      values.port === undefined
    ) {
      values.port = CUPS_DEFAULT_PORT;
    }

    return values;
  }

  private expectRange(
    value: unknown,
    label: string,
    min: number,
    max: number,
  ): number {
    if (
      typeof value !== "number" ||
      !Number.isInteger(value) ||
      value < min ||
      value > max
    ) {
      throw new BadRequestException(
        `${label} muss zwischen ${min} und ${max} liegen.`,
      );
    }
    return value;
  }
}
