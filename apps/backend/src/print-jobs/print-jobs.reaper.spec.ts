import { PrintJobsReaperService } from "./print-jobs.reaper";

function makePrisma() {
  return {
    $transaction: jest.fn((callback: any) => callback(prisma)),
    printJob: {
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
  } as any;
}

function makeMaintenanceState(phase: "OPEN" | "DRAINING" | "LOCKED" = "OPEN") {
  return { read: jest.fn(() => ({ phase })) };
}

let prisma: any;
let audit: { log: jest.Mock };
let maintenanceState: ReturnType<typeof makeMaintenanceState>;
let reaper: PrintJobsReaperService;

describe("PrintJobsReaperService – Übergänge 8 und 9 (Abschnitt 4.3)", () => {
  beforeEach(() => {
    prisma = makePrisma();
    audit = { log: jest.fn() };
    maintenanceState = makeMaintenanceState("OPEN");
    reaper = new PrintJobsReaperService(
      prisma,
      audit as any,
      maintenanceState as any,
    );
  });

  it("setzt CLAIMED mit abgelaufener Lease zurück nach PENDING, ohne Failover auszulösen", async () => {
    prisma.printJob.findMany
      .mockResolvedValueOnce([
        {
          id: "job-1",
          activePrinterId: null,
          printerId: "printer-1",
          attemptCount: 1,
        },
      ])
      .mockResolvedValueOnce([]); // zweiter findMany-Aufruf: DELIVERING/SPOOLED, keine Treffer
    prisma.printJob.updateMany.mockResolvedValue({ count: 1 });

    await reaper.sweepExpiredLeases();

    expect(prisma.printJob.updateMany).toHaveBeenCalledWith({
      where: { id: "job-1", status: "PROCESSING", attemptPhase: "CLAIMED" },
      data: expect.objectContaining({
        status: "PENDING",
        attemptPhase: null,
        leaseId: null,
        leaseExpiresAt: null,
      }),
    });
    // Die Reaper-Datenänderung darf niemals failoverCount/activePrinterId
    // berühren - genau eine Codestelle (tryFailover) darf das.
    const data = prisma.printJob.updateMany.mock.calls[0][0].data;
    expect(data).not.toHaveProperty("failoverCount");
    expect(data).not.toHaveProperty("activePrinterId");

    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "PRINT_JOB_REQUEUED",
        details: expect.objectContaining({
          reason: "LEASE_EXPIRED",
          attemptPhase: "CLAIMED",
        }),
      }),
      prisma,
    );
  });

  it("setzt DELIVERING mit abgelaufener Lease nach UNRESOLVED", async () => {
    prisma.printJob.findMany
      .mockResolvedValueOnce([]) // CLAIMED: keine Treffer
      .mockResolvedValueOnce([
        {
          id: "job-2",
          activePrinterId: null,
          printerId: "printer-1",
          errorCode: null,
          attemptPhase: "DELIVERING",
          cupsJobId: null,
          cupsJobState: null,
          bytesWritten: 0,
        },
      ]);
    prisma.printJob.updateMany.mockResolvedValue({ count: 1 });

    await reaper.sweepExpiredLeases();

    expect(prisma.printJob.updateMany).toHaveBeenCalledWith({
      where: { id: "job-2", status: "PROCESSING", attemptPhase: "DELIVERING" },
      data: expect.objectContaining({
        status: "UNRESOLVED",
        attemptPhase: null,
        outcomeClass: "UNCLEAR",
        unresolvedReason: "LEASE_EXPIRED",
      }),
    });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: "PRINT_JOB_UNRESOLVED" }),
      prisma,
    );
  });

  it("setzt SPOOLED mit abgelaufener Lease ebenfalls nach UNRESOLVED", async () => {
    prisma.printJob.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        id: "job-3",
        activePrinterId: "printer-2",
        printerId: "printer-1",
        errorCode: null,
        attemptPhase: "SPOOLED",
        cupsJobId: 99,
        cupsJobState: "pending",
        bytesWritten: null,
      },
    ]);
    prisma.printJob.updateMany.mockResolvedValue({ count: 1 });

    await reaper.sweepExpiredLeases();

    expect(prisma.printJob.updateMany).toHaveBeenCalledWith({
      where: { id: "job-3", status: "PROCESSING", attemptPhase: "SPOOLED" },
      data: expect.objectContaining({ status: "UNRESOLVED" }),
    });
  });

  it("überspringt eine Zeile ohne Audit-Eintrag, wenn sie zwischenzeitlich schon behandelt wurde", async () => {
    prisma.printJob.findMany
      .mockResolvedValueOnce([
        {
          id: "job-1",
          activePrinterId: null,
          printerId: "printer-1",
          attemptCount: 1,
        },
      ])
      .mockResolvedValueOnce([]);
    prisma.printJob.updateMany.mockResolvedValue({ count: 0 });

    await reaper.sweepExpiredLeases();

    expect(audit.log).not.toHaveBeenCalled();
  });

  it("lässt einen Durchlauf nicht am Backend-Prozess reißen, wenn eine Abfrage fehlschlägt", async () => {
    prisma.printJob.findMany.mockRejectedValue(new Error("DB down"));
    await expect(reaper.sweepExpiredLeases()).resolves.toBeUndefined();
  });

  // Issue #67 (Wartungsmodus): Ein Reaper, der während einer
  // Wiederherstellung Druckaufträge auf UNRESOLVED setzt, arbeitet an Daten,
  // die es gleich nicht mehr gibt.
  it("setzt bei LOCKED aus und fasst keine Zeile an", async () => {
    maintenanceState.read.mockReturnValue({ phase: "LOCKED" });

    await reaper.sweepExpiredLeases();

    expect(prisma.printJob.findMany).not.toHaveBeenCalled();
    expect(prisma.printJob.updateMany).not.toHaveBeenCalled();
  });

  // Während DRAINING bleibt der Reaper aktiv: er hilft, echte Leichen
  // abzuräumen, damit der Übergang nach LOCKED (der auf "keine Zeile mehr in
  // DELIVERING/SPOOLED" wartet) überhaupt terminieren kann.
  it("bleibt bei DRAINING aktiv", async () => {
    maintenanceState.read.mockReturnValue({ phase: "DRAINING" });
    prisma.printJob.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    await reaper.sweepExpiredLeases();

    expect(prisma.printJob.findMany).toHaveBeenCalled();
  });
});
