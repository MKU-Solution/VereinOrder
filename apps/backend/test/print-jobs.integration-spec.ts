import { randomUUID } from "node:crypto";
import { PrismaClient, Printer, PrintJob } from "@vereinorder/database";
import { assertTestDatabaseUrl } from "./test-database";
import { AuditService } from "../src/audit/audit.service";
import { PrintJobsService } from "../src/print-jobs/print-jobs.service";
import { PrintJobsReaperService } from "../src/print-jobs/print-jobs.reaper";

/**
 * Wächtertests gegen Issue #64 gegen eine echte PostgreSQL-Instanz.
 *
 * Diese Tests prüfen bewusst nicht dasselbe wie die gemockten Unit-Tests in
 * apps/backend/src/print-jobs/*.spec.ts. Ihr Zweck ist, Dinge zu fangen, die
 * ein gemocktes Prisma-Objekt strukturell nicht sehen kann:
 *  - die drei CHECK-Constraints aus der Migration existieren tatsächlich
 *    im Systemkatalog und werden nicht durch ein künftiges
 *    "prisma db push --force-reset" oder eine unbedachte Migration entfernt
 *  - echte Nebenläufigkeit (FOR UPDATE SKIP LOCKED) über zwei parallele
 *    Verbindungen/Transaktionen
 *  - der volle Rundlauf über mehrere Service-Aufrufe hinweg gegen echte
 *    Datenbankzeilen, nicht gegen vorprogrammierte Mock-Antworten
 */
describe("PrintJobs – Datenbank-Invarianten gegen echtes PostgreSQL (Issue #64)", () => {
  const prisma = new PrismaClient();
  assertTestDatabaseUrl();

  const audit = new AuditService(prisma);
  const service = new PrintJobsService(prisma, audit);
  // Issue #67: der Reaper braucht seither MaintenanceStateService, um bei
  // LOCKED auszusetzen. Diese Tests prüfen die Übergänge 8/9 unabhängig vom
  // Wartungsmodus - eine simple OPEN-Attrappe reicht.
  const reaper = new PrintJobsReaperService(prisma, audit, {
    read: () => ({ phase: "OPEN" }),
  } as any);

  const printerIds: string[] = [];
  const jobIds: string[] = [];

  async function makePrinter(
    overrides: Partial<Printer> = {},
  ): Promise<Printer> {
    const printer = await prisma.printer.create({
      data: {
        name: `Wächtertest-Drucker-${randomUUID()}`,
        type: "ESC_POS_NETWORK",
        isActive: true,
        ...overrides,
      },
    });
    printerIds.push(printer.id);
    return printer;
  }

  async function makeJob(
    printerId: string,
    overrides: Record<string, unknown> = {},
  ): Promise<PrintJob> {
    const job = await prisma.printJob.create({
      data: {
        printerId,
        jobType: "STATION_TICKET",
        content: { kind: "WAECHTERTEST" },
        ...overrides,
      } as any,
    });
    jobIds.push(job.id);
    return job;
  }

  afterEach(async () => {
    if (jobIds.length) {
      await prisma.printJob.deleteMany({ where: { id: { in: jobIds } } });
      jobIds.length = 0;
    }
    if (printerIds.length) {
      await prisma.printer.deleteMany({ where: { id: { in: printerIds } } });
      printerIds.length = 0;
    }
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  // -------------------------------------------------------------------
  // Aussage 1: Die drei Prüfbedingungen existieren im Systemkatalog.
  // -------------------------------------------------------------------
  it("die drei Prüfbedingungen aus der Migration existieren tatsächlich in pg_constraint (Aussage 1)", async () => {
    const rows = await prisma.$queryRaw<{ conname: string }[]>`
      SELECT conname FROM pg_constraint
      WHERE conname IN (
        'PrintJob_failoverCount_range_check',
        'PrintJob_attemptPhase_status_check',
        'Printer_fallback_not_self_check'
      )
    `;
    const names = rows.map((r) => r.conname).sort();
    expect(names).toEqual(
      [
        "PrintJob_attemptPhase_status_check",
        "PrintJob_failoverCount_range_check",
        "Printer_fallback_not_self_check",
      ].sort(),
    );
  });

  // -------------------------------------------------------------------
  // Aussage 2: Die Prüfbedingungen greifen tatsächlich.
  // -------------------------------------------------------------------
  describe("Die Prüfbedingungen greifen tatsächlich (Aussage 2)", () => {
    it("weist failoverCount = 2 zurück", async () => {
      const printer = await makePrinter();
      const job = await makeJob(printer.id);

      await expect(
        prisma.printJob.update({
          where: { id: job.id },
          data: { failoverCount: 2 },
        }),
      ).rejects.toThrow();
    });

    it("weist attemptPhase gesetzt bei status PRINTED zurück", async () => {
      const printer = await makePrinter();
      const job = await makeJob(printer.id);

      await expect(
        prisma.printJob.update({
          where: { id: job.id },
          data: { status: "PRINTED", attemptPhase: "CLAIMED" },
        }),
      ).rejects.toThrow();
    });

    it("weist einen Drucker als eigenen Ersatzdrucker zurück", async () => {
      const printer = await makePrinter();

      await expect(
        prisma.printer.update({
          where: { id: printer.id },
          data: { fallbackPrinterId: printer.id },
        }),
      ).rejects.toThrow();
    });
  });

  // -------------------------------------------------------------------
  // Aussage 3: Zwei gleichzeitige Claims -> genau ein Gewinner.
  // -------------------------------------------------------------------
  it("zwei gleichzeitige Claims auf denselben wartenden Auftrag ergeben genau einen Gewinner (Aussage 3)", async () => {
    const printer = await makePrinter();
    const job = await makeJob(printer.id);

    const [a, b] = await Promise.all([
      service.claimNextJob(),
      service.claimNextJob(),
    ]);

    const winners = [a, b].filter((result) => result !== null);
    expect(winners).toHaveLength(1);
    const loserResults = [a, b].filter((result) => result === null);
    expect(loserResults).toHaveLength(1);

    const stored = await prisma.printJob.findUniqueOrThrow({
      where: { id: job.id },
    });
    // Der Verlierer bekam nichts: genau ein Claim-Zyklus fand statt.
    expect(stored.attemptCount).toBe(1);
    expect(stored.leaseId).toBe((winners[0] as any).leaseId);
    expect(stored.status).toBe("PROCESSING");
    expect(stored.attemptPhase).toBe("CLAIMED");
  });

  // -------------------------------------------------------------------
  // Aussage 4: Lease-Ablauf kehrt NUR aus CLAIMED nach PENDING zurück.
  // -------------------------------------------------------------------
  it("ein abgelaufener Lease kehrt nur aus CLAIMED nach PENDING zurück - aus DELIVERING/SPOOLED nach UNRESOLVED, nie erneut gedruckt (Aussage 4)", async () => {
    const printer = await makePrinter();
    const expired = new Date(Date.now() - 60_000);

    const claimed = await makeJob(printer.id, {
      status: "PROCESSING",
      attemptPhase: "CLAIMED",
      leaseId: randomUUID(),
      leaseExpiresAt: expired,
    });
    const delivering = await makeJob(printer.id, {
      status: "PROCESSING",
      attemptPhase: "DELIVERING",
      leaseId: randomUUID(),
      leaseExpiresAt: expired,
    });
    const spooled = await makeJob(printer.id, {
      status: "PROCESSING",
      attemptPhase: "SPOOLED",
      leaseId: randomUUID(),
      leaseExpiresAt: expired,
      cupsJobId: 42,
    });

    await reaper.sweepExpiredLeases();

    const [claimedAfter, deliveringAfter, spooledAfter] = await Promise.all([
      prisma.printJob.findUniqueOrThrow({ where: { id: claimed.id } }),
      prisma.printJob.findUniqueOrThrow({ where: { id: delivering.id } }),
      prisma.printJob.findUniqueOrThrow({ where: { id: spooled.id } }),
    ]);

    expect(claimedAfter.status).toBe("PENDING");
    expect(claimedAfter.attemptPhase).toBeNull();
    expect(claimedAfter.leaseId).toBeNull();

    // Niemals erneut gedruckt: kein Übergang zurück nach PENDING aus
    // DELIVERING/SPOOLED. Der einzige zulässige Zielzustand ist UNRESOLVED.
    expect(deliveringAfter.status).toBe("UNRESOLVED");
    expect(deliveringAfter.status).not.toBe("PENDING");
    expect(spooledAfter.status).toBe("UNRESOLVED");
    expect(spooledAfter.status).not.toBe("PENDING");
  });

  // -------------------------------------------------------------------
  // Aussage 5: Failover genau einmal.
  // -------------------------------------------------------------------
  it("zwei aufeinanderfolgende NOT_PRINTED-Meldungen führen zu genau einem Wechsel - der zweite Versuch wechselt nicht noch einmal (Aussage 5)", async () => {
    const fallback = await makePrinter({ isActive: true });
    const primary = await makePrinter({ fallbackPrinterId: fallback.id });
    const job = await makeJob(primary.id);

    const firstClaim = (await service.claimNextJob())!;
    expect(firstClaim).not.toBeNull();

    const afterFirstFailure = await service.reportOutcome(job.id, {
      leaseId: firstClaim.leaseId!,
      outcome: "NOT_PRINTED",
      errorCode: "CONNECTION_REFUSED",
    });
    expect(afterFirstFailure.status).toBe("PENDING");
    expect(afterFirstFailure.failoverCount).toBe(1);
    expect(afterFirstFailure.activePrinterId).toBe(fallback.id);

    const secondClaim = (await service.claimNextJob())!;
    expect(secondClaim).not.toBeNull();
    // Der aufgelöste Drucker des zweiten Claims ist bereits der Ersatzdrucker.
    expect(secondClaim.printer.id).toBe(fallback.id);

    const afterSecondFailure = await service.reportOutcome(job.id, {
      leaseId: secondClaim.leaseId!,
      outcome: "NOT_PRINTED",
      errorCode: "CONNECTION_REFUSED",
    });

    // Kein zweiter Wechsel: failoverCount bleibt bei 1, der Auftrag endet
    // terminal in FAILED statt in einem Ping-Pong zwischen zwei Druckern.
    expect(afterSecondFailure.failoverCount).toBe(1);
    expect(afterSecondFailure.status).toBe("FAILED");
  });
});
