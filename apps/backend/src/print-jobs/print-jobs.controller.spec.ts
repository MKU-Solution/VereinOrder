import { Test, TestingModule } from "@nestjs/testing";
import { ROLES_KEY } from "../common/decorators/roles.decorator";
import { PrintJobsController } from "./print-jobs.controller";
import { PrintJobsService } from "./print-jobs.service";

describe("PrintJobsController", () => {
  let controller: PrintJobsController;
  const printJobsService = {
    claimNextJob: jest.fn(),
    transitionPhase: jest.fn(),
    heartbeat: jest.fn(),
    reportOutcome: jest.fn(),
    findUnresolvedJobs: jest.fn(),
    resolveJob: jest.fn(),
    findJobStatus: jest.fn(),
    findAllPrinters: jest.fn(),
    createPrinter: jest.fn(),
    updatePrinter: jest.fn(),
    createTestJob: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PrintJobsController],
      providers: [{ provide: PrintJobsService, useValue: printJobsService }],
    }).compile();

    controller = module.get<PrintJobsController>(PrintJobsController);
  });

  it.each([
    "getPrinters",
    "createPrinter",
    "updatePrinter",
    "testPrinter",
    "getJobStatus",
    "getUnresolvedJobs",
    "resolveJob",
  ] as const)(
    "schützt %s im Backend für ADMINISTRATOR und EVENT_MANAGER",
    (method) => {
      expect(Reflect.getMetadata(ROLES_KEY, controller[method])).toEqual([
        "ADMINISTRATOR",
        "EVENT_MANAGER",
      ]);
    },
  );

  it("löst den Testdruck für den angefragten Drucker aus", async () => {
    printJobsService.createTestJob.mockResolvedValue({ id: "job-1" });

    await expect(controller.testPrinter("printer-1")).resolves.toEqual({
      id: "job-1",
    });
    expect(printJobsService.createTestJob).toHaveBeenCalledWith("printer-1");
  });

  it("liefert den Zustand eines Auftrags für die Erfolgsanzeige", async () => {
    printJobsService.findJobStatus.mockResolvedValue({
      id: "job-1",
      status: "FAILED",
      errorMessage: "Verbindung zu 192.168.1.50:9100 wurde abgelehnt.",
    });

    await expect(controller.getJobStatus("job-1")).resolves.toMatchObject({
      status: "FAILED",
    });
    expect(printJobsService.findJobStatus).toHaveBeenCalledWith("job-1");
  });

  it("reicht den Claim-Aufruf unverändert an den Dienst weiter", async () => {
    printJobsService.claimNextJob.mockResolvedValue({ id: "job-1" });
    await expect(controller.claimNextJob()).resolves.toEqual({ id: "job-1" });
  });

  it("reicht den Phasenwechsel mit Lease-Token und optionaler cupsJobId weiter", async () => {
    printJobsService.transitionPhase.mockResolvedValue({ id: "job-1" });

    await controller.transitionPhase("job-1", {
      leaseId: "lease-1",
      phase: "SPOOLED",
      cupsJobId: 42,
    });

    expect(printJobsService.transitionPhase).toHaveBeenCalledWith(
      "job-1",
      "lease-1",
      "SPOOLED",
      42,
    );
  });

  it("reicht den Herzschlag weiter", async () => {
    printJobsService.heartbeat.mockResolvedValue({
      leaseExpiresAt: new Date(),
    });
    await controller.heartbeat("job-1", { leaseId: "lease-1" });
    expect(printJobsService.heartbeat).toHaveBeenCalledWith("job-1", "lease-1");
  });

  it("reicht die Ergebnismeldung des Workers unverändert weiter", async () => {
    printJobsService.reportOutcome.mockResolvedValue({ id: "job-1" });
    const body = { leaseId: "lease-1", outcome: "NOT_PRINTED" as const };

    await controller.reportOutcome("job-1", body);

    expect(printJobsService.reportOutcome).toHaveBeenCalledWith("job-1", body);
  });

  it("liefert die Liste unklarer Druckaufträge", async () => {
    printJobsService.findUnresolvedJobs.mockResolvedValue([{ id: "job-1" }]);
    await expect(controller.getUnresolvedJobs()).resolves.toEqual([
      { id: "job-1" },
    ]);
  });

  it("übergibt Person und Rolle aus dem Request an die Admin-Entscheidung", async () => {
    printJobsService.resolveJob.mockResolvedValue({ id: "job-1" });
    const req = { user: { userId: "user-1", role: "ADMINISTRATOR" } };
    const body = { resolution: "DISCARDED" as const, comment: "kein Bon" };

    await controller.resolveJob(req, "job-1", body);

    expect(printJobsService.resolveJob).toHaveBeenCalledWith(
      "job-1",
      body,
      "user-1",
      "ADMINISTRATOR",
    );
  });
});
