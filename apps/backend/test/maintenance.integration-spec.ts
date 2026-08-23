import { randomUUID } from "node:crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { Printer, PrintJob, PrismaClient } from "@vereinorder/database";
import { assertTestDatabaseUrl } from "./test-database";
import { AuditService } from "../src/audit/audit.service";
import { MaintenanceStateService } from "../src/maintenance/maintenance-state.service";
import { MaintenanceService } from "../src/maintenance/maintenance.service";

/**
 * Übergang DRAINING -> LOCKED hängt an einer echten Datenbankabfrage
 * (`PrintJob.count` mit `attemptPhase in (DELIVERING, SPOOLED)`) und an
 * `AuditLog`-Zeilen. Wörtlich wie die Lehre aus B1 im Entwurf (Abschnitt 12):
 * ein gemocktes Prisma-Objekt kann diese Zusagen strukturell nicht prüfen -
 * deshalb hier gegen echtes PostgreSQL.
 */
describe("MaintenanceService – Übergänge gegen echtes PostgreSQL (Issue #67)", () => {
  assertTestDatabaseUrl();

  const prisma = new PrismaClient();
  const audit = new AuditService(prisma);

  let stateDir: string;
  let previousStateDir: string | undefined;
  let previousMinWait: string | undefined;
  let stateService: MaintenanceStateService;
  let service: MaintenanceService;
  // AuditLog.userId ist ein Fremdschluessel auf User (Lehre aus B1/B8 im
  // Entwurf) - MaintenanceService.start/end schreiben ihn immer, deshalb
  // braucht dieser Test einen tatsaechlich existierenden Benutzer.
  let testUserId: string;

  const printerIds: string[] = [];
  const jobIds: string[] = [];

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        username: `wartungsmodus-test-${randomUUID()}`,
        pinHash: "unbenutzt",
        role: "ADMINISTRATOR",
      },
    });
    testUserId = user.id;
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { userId: testUserId } });
    await prisma.user.delete({ where: { id: testUserId } });
    await prisma.$disconnect();
  });

  async function makePrinter(): Promise<Printer> {
    const printer = await prisma.printer.create({
      data: {
        name: `Wartungsmodus-Test-Drucker-${randomUUID()}`,
        type: "ESC_POS_NETWORK",
        isActive: true,
      },
    });
    printerIds.push(printer.id);
    return printer;
  }

  async function makeJob(
    printerId: string,
    attemptPhase: "DELIVERING" | "SPOOLED" | null,
  ): Promise<PrintJob> {
    const job = await prisma.printJob.create({
      data: {
        printerId,
        jobType: "STATION_TICKET",
        content: { kind: "WARTUNGSMODUS_TEST" },
        status: attemptPhase ? "PROCESSING" : "PENDING",
        attemptPhase,
      } as any,
    });
    jobIds.push(job.id);
    return job;
  }

  beforeEach(() => {
    previousStateDir = process.env.STATE_DIR;
    previousMinWait = process.env.MAINTENANCE_DRAIN_MIN_WAIT_MS;
    stateDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "vereinorder-maintenance-it-"),
    );
    process.env.STATE_DIR = stateDir;
    stateService = new MaintenanceStateService();
    service = new MaintenanceService(stateService, prisma, audit);
  });

  afterEach(async () => {
    if (previousStateDir === undefined) delete process.env.STATE_DIR;
    else process.env.STATE_DIR = previousStateDir;
    if (previousMinWait === undefined)
      delete process.env.MAINTENANCE_DRAIN_MIN_WAIT_MS;
    else process.env.MAINTENANCE_DRAIN_MIN_WAIT_MS = previousMinWait;
    fs.rmSync(stateDir, { recursive: true, force: true });

    if (jobIds.length) {
      await prisma.printJob.deleteMany({ where: { id: { in: jobIds } } });
      jobIds.length = 0;
    }
    if (printerIds.length) {
      await prisma.printer.deleteMany({ where: { id: { in: printerIds } } });
      printerIds.length = 0;
    }
  });

  it("start() schreibt DRAINING und eine auditierte MAINTENANCE_STARTED-Zeile", async () => {
    const state = await service.start(
      testUserId,
      "tester",
      "Integrationstest",
      undefined,
    );
    expect(state.phase).toBe("DRAINING");

    const logs = await prisma.auditLog.findMany({
      where: { action: "MAINTENANCE_STARTED", entityId: "maintenance" },
      orderBy: { createdAt: "desc" },
      take: 1,
    });
    expect(logs).toHaveLength(1);
  });

  it("end() setzt zurück auf OPEN und auditiert MAINTENANCE_ENDED", async () => {
    await service.start(testUserId, "tester", undefined, undefined);
    await service.end(testUserId, "tester");

    expect(stateService.read().phase).toBe("OPEN");

    const logs = await prisma.auditLog.findMany({
      where: { action: "MAINTENANCE_ENDED", entityId: "maintenance" },
      orderBy: { createdAt: "desc" },
      take: 1,
    });
    expect(logs).toHaveLength(1);
  });

  it("bleibt in DRAINING, solange ein Druckauftrag in DELIVERING steht", async () => {
    process.env.MAINTENANCE_DRAIN_MIN_WAIT_MS = "0";
    stateService = new MaintenanceStateService();
    service = new MaintenanceService(stateService, prisma, audit);

    await service.start(testUserId, "tester", undefined, undefined);
    const printer = await makePrinter();
    await makeJob(printer.id, "DELIVERING");

    await service.tryAdvanceToLocked();

    expect(stateService.read().phase).toBe("DRAINING");
  });

  it("bleibt in DRAINING, solange ein Druckauftrag in SPOOLED steht", async () => {
    process.env.MAINTENANCE_DRAIN_MIN_WAIT_MS = "0";
    stateService = new MaintenanceStateService();
    service = new MaintenanceService(stateService, prisma, audit);

    await service.start(testUserId, "tester", undefined, undefined);
    const printer = await makePrinter();
    await makeJob(printer.id, "SPOOLED");

    await service.tryAdvanceToLocked();

    expect(stateService.read().phase).toBe("DRAINING");
  });

  it("wechselt nach LOCKED, sobald kein Druckauftrag mehr in DELIVERING/SPOOLED steht", async () => {
    process.env.MAINTENANCE_DRAIN_MIN_WAIT_MS = "0";
    stateService = new MaintenanceStateService();
    service = new MaintenanceService(stateService, prisma, audit);

    await service.start(testUserId, "tester", undefined, undefined);
    const printer = await makePrinter();
    // Ein abgeschlossener Auftrag (kein attemptPhase mehr) darf den Übergang
    // nicht blockieren.
    await makeJob(printer.id, null);

    await service.tryAdvanceToLocked();

    expect(stateService.read().phase).toBe("LOCKED");

    const logs = await prisma.auditLog.findMany({
      where: { action: "MAINTENANCE_LOCKED", entityId: "maintenance" },
      orderBy: { createdAt: "desc" },
      take: 1,
    });
    expect(logs).toHaveLength(1);
  });
});
