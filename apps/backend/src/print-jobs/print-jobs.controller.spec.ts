import { Test, TestingModule } from "@nestjs/testing";
import { ROLES_KEY } from "../common/decorators/roles.decorator";
import { PrintJobsController } from "./print-jobs.controller";
import { PrintJobsService } from "./print-jobs.service";

describe("PrintJobsController", () => {
  let controller: PrintJobsController;
  const printJobsService = {
    claimNextJob: jest.fn(),
    updateJobStatus: jest.fn(),
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
});
