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

describe("PrintJobsService – Druckerkonfiguration und Testdruck", () => {
  let prisma: any;
  let service: PrintJobsService;

  beforeEach(() => {
    prisma = {
      printer: {
        findUnique: jest.fn(),
        create: jest.fn((args: any) => Promise.resolve(args.data)),
        update: jest.fn((args: any) => Promise.resolve(args.data)),
      },
      printJob: {
        create: jest.fn((args: any) => Promise.resolve(args.data)),
        findUnique: jest.fn(),
      },
    };
    service = new PrintJobsService(prisma);
  });

  it("legt einen Netzwerkdrucker mit geprüfter Adresse an", async () => {
    await service.createPrinter({
      name: "  Küchendrucker  ",
      type: "esc_pos_network",
      ipAddress: " 192.168.1.50 ",
      port: 9100,
      paperWidth: 58,
      codepage: "cp858",
      cutMode: "full",
      copies: 2,
      timeoutMs: 3000,
    });

    expect(prisma.printer.create).toHaveBeenCalledWith({
      data: {
        name: "Küchendrucker",
        type: "ESC_POS_NETWORK",
        ipAddress: "192.168.1.50",
        port: 9100,
        paperWidth: 58,
        codepage: "CP858",
        cutMode: "FULL",
        copies: 2,
        timeoutMs: 3000,
      },
    });
  });

  it("weist Druckertypen ab, die der Worker nicht bedienen kann", async () => {
    await expect(
      service.createPrinter({ name: "Alt", type: "ESC_POS_USB" }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.createPrinter({ name: "Alt", type: "WINDOWS_DRIVER" }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.printer.create).not.toHaveBeenCalled();
  });

  it("verlangt für Netzwerkdrucker eine gültige Adresse", async () => {
    await expect(
      service.createPrinter({ name: "Küche", type: "ESC_POS_NETWORK" }),
    ).rejects.toThrow(/IP-Adresse/);

    await expect(
      service.createPrinter({
        name: "Küche",
        type: "ESC_POS_NETWORK",
        ipAddress: "http://192.168.1.50/drucken",
      }),
    ).rejects.toThrow(/gültige/);
  });

  it("begrenzt Papierbreite, Kopienzahl und Zeitlimit", async () => {
    const base = { name: "Küche", type: "CONSOLE" };

    await expect(
      service.createPrinter({ ...base, paperWidth: 72 }),
    ).rejects.toThrow(/Papierbreite/);
    await expect(service.createPrinter({ ...base, copies: 0 })).rejects.toThrow(
      /Kopienzahl/,
    );
    await expect(
      service.createPrinter({ ...base, timeoutMs: 10 }),
    ).rejects.toThrow(/Zeitlimit/);
    await expect(
      service.createPrinter({ ...base, codepage: "UTF-8" }),
    ).rejects.toThrow(/Zeichensatz/);
  });

  it("erlaubt Teiländerungen an bestehenden Druckern", async () => {
    prisma.printer.findUnique.mockResolvedValue({
      id: "printer-1",
      type: "ESC_POS_NETWORK",
      ipAddress: "192.168.1.50",
    });

    await service.updatePrinter("printer-1", { isActive: false });

    expect(prisma.printer.update).toHaveBeenCalledWith({
      where: { id: "printer-1" },
      data: { isActive: false },
    });
  });

  it("meldet einen unbekannten Drucker beim Bearbeiten", async () => {
    prisma.printer.findUnique.mockResolvedValue(null);

    await expect(
      service.updatePrinter("fehlt", { name: "Neu" }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("erzeugt einen Testbon mit dem Ausgabeprofil des Druckers", async () => {
    prisma.printer.findUnique.mockResolvedValue({
      id: "printer-1",
      name: "Küchendrucker",
      type: "ESC_POS_NETWORK",
      paperWidth: 58,
      codepage: "CP858",
    });

    await service.createTestJob("printer-1");

    const content = prisma.printJob.create.mock.calls[0][0].data.content;
    expect(content).toMatchObject({
      kind: "TEST_PRINT",
      printerName: "Küchendrucker",
      printerType: "ESC_POS_NETWORK",
      paperWidth: 58,
      codepage: "CP858",
    });
  });

  it("meldet einen unbekannten Auftrag bei der Statusabfrage", async () => {
    prisma.printJob.findUnique.mockResolvedValue(null);

    await expect(service.findJobStatus("fehlt")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
