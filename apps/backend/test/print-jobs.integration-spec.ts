import { randomUUID } from "node:crypto";
import { PrismaClient, Printer, PrintJob } from "@vereinorder/database";
import { assertTestDatabaseUrl } from "./test-database";
import { AuditService } from "../src/audit/audit.service";
import { PrintJobsService } from "../src/print-jobs/print-jobs.service";
import { PrintJobsReaperService } from "../src/print-jobs/print-jobs.reaper";
import { DiagnosticsService } from "../src/diagnostics/diagnostics.service";

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

  // Issue #261: DiagnosticsService.getStatus() ist der öffentliche Weg, über
  // den die Betriebssicht (bypassed/lastErrorAt/lastOkAt) tatsächlich
  // ausgeliefert wird - eine Backup-Service-Attrappe genügt, das Backup ist
  // hier nicht Gegenstand.
  const backupServiceStub = {
    listBackups: async () => [],
    getToolStatus: () => ({ enabled: true, message: "" }),
    getStorageStatus: async () => ({ creationAllowed: true }),
  };
  const diagnostics = new DiagnosticsService(prisma, backupServiceStub as any);

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

  // -------------------------------------------------------------------
  // Issue #261: Betriebssicht des Druckers (lastOkAt/lastErrorAt/
  // lastErrorCode) wird bei jedem abgeschlossenen Zustellversuch
  // fortgeschrieben - vorher wurden diese Felder nie beschrieben, wodurch
  // DiagnosticsService.isBypassed() nie ansprang (bestätigt an echter
  // Hardware, siehe Issue).
  //
  // Rot-Beweis: gegen den unveränderten Stand 17471f6 (vor dieser
  // Umsetzung) schlägt "isBypassed springt nach einem Fehlschlag an..."
  // fehl, weil lastErrorAt/lastOkAt dort dauerhaft NULL bleiben - siehe
  // Abschlussbericht.
  // -------------------------------------------------------------------
  it("isBypassed springt nach einem Fehlschlag an und fällt nach einem erneuten Erfolg wieder ab (Issue #261, Kernaussage)", async () => {
    const printer = await makePrinter(); // kein Ersatzdrucker - reiner Erfolg/Fehlschlag-Kreislauf

    const findPrinterEntry = async () => {
      const status = await diagnostics.getStatus();
      const entry = status.printers.list.find((p: any) => p.id === printer.id);
      if (!entry) throw new Error("Drucker nicht in der Diagnose gefunden.");
      return entry;
    };

    // Ausgangslage: frisch angelegter Drucker, nichts belegt.
    const before = await findPrinterEntry();
    expect(before.bypassed).toBe(false);
    expect(before.lastErrorAt).toBeNull();
    expect(before.lastOkAt).toBeNull();

    // Erster Versuch schlägt fehl (kein Ersatzdrucker -> FAILED, terminal).
    const failingJob = await makeJob(printer.id);
    const failingClaim = (await service.claimNextJob())!;
    expect(failingClaim).not.toBeNull();
    const afterFailure = await service.reportOutcome(failingJob.id, {
      leaseId: failingClaim.leaseId!,
      outcome: "NOT_PRINTED",
      errorCode: "CONNECTION_REFUSED",
    });
    expect(afterFailure.status).toBe("FAILED");

    const storedAfterFailure = await prisma.printer.findUniqueOrThrow({
      where: { id: printer.id },
    });
    expect(storedAfterFailure.lastErrorAt).not.toBeNull();
    expect(storedAfterFailure.lastErrorCode).toBe("CONNECTION_REFUSED");
    expect(storedAfterFailure.lastOkAt).toBeNull();

    const bypassedAfterFailure = await findPrinterEntry();
    expect(bypassedAfterFailure.bypassed).toBe(true);

    // Zweiter Versuch gelingt - isBypassed muss wieder abfallen.
    const okJob = await makeJob(printer.id);
    const okClaim = (await service.claimNextJob())!;
    expect(okClaim).not.toBeNull();
    const afterOk = await service.reportOutcome(okJob.id, {
      leaseId: okClaim.leaseId!,
      outcome: "PRINTED",
      bytesWritten: 673,
    });
    expect(afterOk.status).toBe("PRINTED");

    const storedAfterOk = await prisma.printer.findUniqueOrThrow({
      where: { id: printer.id },
    });
    expect(storedAfterOk.lastOkAt).not.toBeNull();
    expect(storedAfterOk.lastOkAt!.getTime()).toBeGreaterThan(
      storedAfterOk.lastErrorAt!.getTime(),
    );

    const bypassedAfterOk = await findPrinterEntry();
    expect(bypassedAfterOk.bypassed).toBe(false);
  });

  // -------------------------------------------------------------------
  // Issue #261, Falle 1: die Betriebssicht gehört an den Drucker, der den
  // Versuch TATSÄCHLICH unternommen hat - nicht an printerId, wenn nach
  // einem Failover ein anderer Drucker aktiv ist. Sonst erbt der gesunde
  // Ersatzdrucker den Fehler des ausgefallenen, oder der ausgefallene sieht
  // durch den Erfolg des Ersatzes fälschlich gesund aus.
  // -------------------------------------------------------------------
  it("schreibt Fehler und Erfolg beim Failover an den jeweils tatsächlich attemptierenden Drucker, nicht an den anderen (Issue #261, Falle 1)", async () => {
    const fallback = await makePrinter();
    const primary = await makePrinter({ fallbackPrinterId: fallback.id });
    const job = await makeJob(primary.id);

    const firstClaim = (await service.claimNextJob())!;
    expect(firstClaim.printer.id).toBe(primary.id);
    const afterFailure = await service.reportOutcome(job.id, {
      leaseId: firstClaim.leaseId!,
      outcome: "NOT_PRINTED",
      errorCode: "CONNECTION_REFUSED",
    });
    expect(afterFailure.status).toBe("PENDING");
    expect(afterFailure.activePrinterId).toBe(fallback.id);

    // Der AUSGEFALLENE Drucker (primary) trägt jetzt den Fehler ...
    const primaryAfterFailure = await prisma.printer.findUniqueOrThrow({
      where: { id: primary.id },
    });
    expect(primaryAfterFailure.lastErrorAt).not.toBeNull();
    expect(primaryAfterFailure.lastErrorCode).toBe("CONNECTION_REFUSED");

    // ... der ERSATZDRUCKER ist in diesem Moment noch vollkommen unberührt -
    // er hat ja noch gar nichts versucht.
    const fallbackAfterFailure = await prisma.printer.findUniqueOrThrow({
      where: { id: fallback.id },
    });
    expect(fallbackAfterFailure.lastErrorAt).toBeNull();
    expect(fallbackAfterFailure.lastOkAt).toBeNull();

    // Der Ersatzdrucker übernimmt den Auftrag und liefert erfolgreich aus.
    const secondClaim = (await service.claimNextJob())!;
    expect(secondClaim.printer.id).toBe(fallback.id);
    const afterOk = await service.reportOutcome(job.id, {
      leaseId: secondClaim.leaseId!,
      outcome: "PRINTED",
      bytesWritten: 512,
    });
    expect(afterOk.status).toBe("PRINTED");

    // Der Ersatzdrucker ist jetzt als erfolgreich vermerkt ...
    const fallbackAfterOk = await prisma.printer.findUniqueOrThrow({
      where: { id: fallback.id },
    });
    expect(fallbackAfterOk.lastOkAt).not.toBeNull();

    // ... der ausgefallene Drucker bleibt unverändert auf seinem Fehler
    // stehen - der Erfolg des Ersatzes darf ihn NICHT gesund erscheinen
    // lassen.
    const primaryAfterOk = await prisma.printer.findUniqueOrThrow({
      where: { id: primary.id },
    });
    expect(primaryAfterOk.lastOkAt).toBeNull();
    expect(primaryAfterOk.lastErrorAt).toEqual(primaryAfterFailure.lastErrorAt);

    const status = await diagnostics.getStatus();
    const primaryEntry = status.printers.list.find(
      (p: any) => p.id === primary.id,
    );
    const fallbackEntry = status.printers.list.find(
      (p: any) => p.id === fallback.id,
    );
    expect(primaryEntry.bypassed).toBe(true);
    expect(fallbackEntry.bypassed).toBe(false);
  });

  // -------------------------------------------------------------------
  // Issue #261, Falle 2: UNCLEAR ist weder Erfolg noch Fehler und darf
  // weder lastOkAt noch lastErrorAt/lastErrorCode verändern - weder bei
  // einer Worker-Meldung noch beim Lease-Timeout im Reaper.
  // -------------------------------------------------------------------
  it("lässt die Betriebssicht des Druckers bei UNCLEAR unangetastet - weder als Meldung noch per Reaper-Timeout (Issue #261, Falle 2)", async () => {
    const printer = await makePrinter();

    const reportedJob = await makeJob(printer.id);
    const reportedClaim = (await service.claimNextJob())!;
    const afterUnclear = await service.reportOutcome(reportedJob.id, {
      leaseId: reportedClaim.leaseId!,
      outcome: "UNCLEAR",
      bytesWritten: 120,
    });
    expect(afterUnclear.status).toBe("UNRESOLVED");

    const afterReportedUnclear = await prisma.printer.findUniqueOrThrow({
      where: { id: printer.id },
    });
    expect(afterReportedUnclear.lastOkAt).toBeNull();
    expect(afterReportedUnclear.lastErrorAt).toBeNull();
    expect(afterReportedUnclear.lastErrorCode).toBeNull();

    // Zweiter Fall: der Reaper räumt eine abgelaufene DELIVERING-Lease
    // ebenfalls nach UNRESOLVED/UNCLEAR - auch das darf die Betriebssicht
    // nicht anfassen.
    const timedOutJob = await makeJob(printer.id, {
      status: "PROCESSING",
      attemptPhase: "DELIVERING",
      leaseId: randomUUID(),
      leaseExpiresAt: new Date(Date.now() - 60_000),
    });
    await reaper.sweepExpiredLeases();

    const timedOutAfter = await prisma.printJob.findUniqueOrThrow({
      where: { id: timedOutJob.id },
    });
    expect(timedOutAfter.status).toBe("UNRESOLVED");

    const afterTimeoutUnclear = await prisma.printer.findUniqueOrThrow({
      where: { id: printer.id },
    });
    expect(afterTimeoutUnclear.lastOkAt).toBeNull();
    expect(afterTimeoutUnclear.lastErrorAt).toBeNull();
    expect(afterTimeoutUnclear.lastErrorCode).toBeNull();

    const status = await diagnostics.getStatus();
    const entry = status.printers.list.find((p: any) => p.id === printer.id);
    expect(entry.bypassed).toBe(false);
  });

  // -------------------------------------------------------------------
  // Issue #261, Falle 3: die Schreibvorgänge dürfen nicht auseinanderlaufen
  // - der Auftragszustand und die Betriebssicht des Druckers werden in
  // DERSELBEN Transaktion gültig. Ein Rollback des Auftrags darf niemals
  // eine bereits vermerkte Betriebssicht hinterlassen.
  // -------------------------------------------------------------------
  it("schreibt bei einem verworfenen Fencing-Versuch weder den Auftrag noch die Betriebssicht fort (Transaktionsgleichheit)", async () => {
    const printer = await makePrinter();
    const job = await makeJob(printer.id);
    await service.claimNextJob(); // reserviert den Auftrag mit einem echten Lease-Token

    // Eine Meldung mit einem FALSCHEN Token darf nichts verändern - weder
    // am Auftrag noch am Drucker.
    await expect(
      service.reportOutcome(job.id, {
        leaseId: "fremdes-token",
        outcome: "PRINTED",
      }),
    ).rejects.toThrow();

    const printerAfter = await prisma.printer.findUniqueOrThrow({
      where: { id: printer.id },
    });
    expect(printerAfter.lastOkAt).toBeNull();
    expect(printerAfter.lastErrorAt).toBeNull();
  });
});
