import { BadRequestException, NotFoundException } from "@nestjs/common";
import { PrintJobsService } from "./print-jobs.service";

describe("PrintJobsService – atomare Worker-Reservierung", () => {
  let prisma: any;
  let service: PrintJobsService;

  beforeEach(() => {
    prisma = {
      $transaction: jest.fn((callback) => callback(prisma)),
      $queryRaw: jest.fn(),
      printJob: {
        findUniqueOrThrow: jest.fn(),
        updateMany: jest.fn(),
        findUnique: jest.fn(),
      },
    };
    service = new PrintJobsService(prisma);
  });

  it("reserviert genau den gesperrten Auftrag vor der Ausgabe an den Worker", async () => {
    prisma.$queryRaw.mockResolvedValue([{ id: "job-1" }]);
    prisma.printJob.findUniqueOrThrow.mockResolvedValue({
      id: "job-1",
      status: "PROCESSING",
      printer: { id: "printer-1" },
    });

    await expect(service.claimNextJob()).resolves.toMatchObject({
      id: "job-1",
      status: "PROCESSING",
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.printJob.findUniqueOrThrow).toHaveBeenCalledWith({
      where: { id: "job-1" },
      include: { printer: true },
    });
  });

  it("liefert null, wenn kein Auftrag atomar reserviert werden konnte", async () => {
    prisma.$queryRaw.mockResolvedValue([]);

    await expect(service.claimNextJob()).resolves.toBeNull();
    expect(prisma.printJob.findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it("erlaubt nur terminale Zustände für einen reservierten Auftrag", async () => {
    await expect(
      service.updateJobStatus("job-1", "PENDING"),
    ).rejects.toBeInstanceOf(BadRequestException);

    prisma.printJob.updateMany.mockResolvedValue({ count: 1 });
    prisma.printJob.findUnique.mockResolvedValue({
      id: "job-1",
      status: "PRINTED",
    });
    await expect(
      service.updateJobStatus("job-1", "PRINTED"),
    ).resolves.toMatchObject({ status: "PRINTED" });
    expect(prisma.printJob.updateMany).toHaveBeenCalledWith({
      where: { id: "job-1", status: "PROCESSING" },
      data: { status: "PRINTED", errorMessage: undefined },
    });
  });

  it("weist fremde oder nicht reservierte Aufträge zurück", async () => {
    prisma.printJob.updateMany.mockResolvedValue({ count: 0 });
    prisma.printJob.findUnique.mockResolvedValue(null);
    await expect(
      service.updateJobStatus("missing", "FAILED", "offline"),
    ).rejects.toBeInstanceOf(NotFoundException);

    prisma.printJob.findUnique.mockResolvedValue({ id: "job-1" });
    await expect(
      service.updateJobStatus("job-1", "FAILED", "offline"),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
