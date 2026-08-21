import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { PrintJobsService } from "./print-jobs.service";

function makePrisma() {
  return {
    $transaction: jest.fn((callback: any) => callback(prisma)),
    $queryRaw: jest.fn(),
    printJob: {
      findUniqueOrThrow: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      updateMany: jest.fn(),
      create: jest.fn((args: any) => Promise.resolve(args.data)),
    },
    printer: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn((args: any) => Promise.resolve(args.data)),
      update: jest.fn((args: any) => Promise.resolve(args.data)),
    },
  } as any;
}

let prisma: any;
let audit: { log: jest.Mock };
let service: PrintJobsService;

describe("PrintJobsService – Lease und Fencing (M2, M3)", () => {
  beforeEach(() => {
    prisma = makePrisma();
    audit = { log: jest.fn() };
    service = new PrintJobsService(prisma, audit as any);
  });

  it("reserviert atomar, setzt CLAIMED, ein neues Lease-Token und löst den Drucker per COALESCE auf", async () => {
    prisma.$queryRaw.mockResolvedValue([{ id: "job-1" }]);
    prisma.printJob.findUniqueOrThrow.mockResolvedValue({
      id: "job-1",
      status: "PROCESSING",
      attemptPhase: "CLAIMED",
      printerId: "printer-1",
      activePrinterId: "printer-2",
      printer: { id: "printer-1", name: "Original" },
      activePrinter: { id: "printer-2", name: "Ersatz" },
    });

    const result = await service.claimNextJob();

    expect(result).toMatchObject({ id: "job-1" });
    // COALESCE(activePrinterId, printerId): nach Failover gilt der Ersatzdrucker.
    expect(result?.printer).toMatchObject({ id: "printer-2" });
    expect((result as any).activePrinter).toBeUndefined();
  });

  it("liefert null, wenn kein Auftrag atomar reserviert werden konnte", async () => {
    prisma.$queryRaw.mockResolvedValue([]);
    await expect(service.claimNextJob()).resolves.toBeNull();
    expect(prisma.printJob.findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it("löst den ursprünglichen Drucker auf, wenn kein Failover stattgefunden hat", async () => {
    prisma.$queryRaw.mockResolvedValue([{ id: "job-1" }]);
    prisma.printJob.findUniqueOrThrow.mockResolvedValue({
      id: "job-1",
      printerId: "printer-1",
      activePrinterId: null,
      printer: { id: "printer-1", name: "Original" },
      activePrinter: null,
    });

    const result = await service.claimNextJob();
    expect(result?.printer).toMatchObject({ id: "printer-1" });
  });

  it("weist einen Phasenwechsel mit fremdem oder abgelaufenem Lease-Token zurück (409)", async () => {
    prisma.printJob.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      service.transitionPhase("job-1", "fremdes-token", "DELIVERING"),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("bestätigt den Phasenwechsel CLAIMED -> DELIVERING bei gültigem Token", async () => {
    prisma.printJob.updateMany.mockResolvedValue({ count: 1 });
    prisma.printJob.findUniqueOrThrow.mockResolvedValue({
      id: "job-1",
      attemptPhase: "DELIVERING",
    });

    await service.transitionPhase("job-1", "lease-1", "DELIVERING");

    expect(prisma.printJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "job-1",
          leaseId: "lease-1",
          status: "PROCESSING",
          attemptPhase: "CLAIMED",
        }),
        data: expect.objectContaining({ attemptPhase: "DELIVERING" }),
      }),
    );
  });

  it("verlangt cupsJobId beim Wechsel nach SPOOLED", async () => {
    await expect(
      service.transitionPhase("job-1", "lease-1", "SPOOLED"),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.printJob.updateMany).not.toHaveBeenCalled();
  });

  it("weist einen Herzschlag mit fremdem Lease-Token zurück (409)", async () => {
    prisma.printJob.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      service.heartbeat("job-1", "fremdes-token"),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("verlängert die Lease bei gültigem Herzschlag", async () => {
    prisma.printJob.updateMany.mockResolvedValue({ count: 1 });
    const result = await service.heartbeat("job-1", "lease-1");
    expect(result.leaseExpiresAt).toBeInstanceOf(Date);
    expect(prisma.printJob.updateMany).toHaveBeenCalledWith({
      where: { id: "job-1", leaseId: "lease-1", status: "PROCESSING" },
      data: expect.objectContaining({ leaseExpiresAt: expect.any(Date) }),
    });
  });
});

describe("PrintJobsService – Ergebnismeldung, Failover genau einmal (Abschnitt 4.4)", () => {
  beforeEach(() => {
    prisma = makePrisma();
    audit = { log: jest.fn() };
    service = new PrintJobsService(prisma, audit as any);
  });

  it("schließt einen Auftrag bei outcome = PRINTED ab", async () => {
    prisma.$queryRaw.mockResolvedValue([{ id: "job-1" }]);
    prisma.printJob.findUniqueOrThrow.mockResolvedValue({
      id: "job-1",
      status: "PRINTED",
    });

    const result = await service.reportOutcome("job-1", {
      leaseId: "lease-1",
      outcome: "PRINTED",
    });
    expect(result).toMatchObject({ status: "PRINTED" });
  });

  it("meldet eine erneute PRINTED-Meldung mit demselben Token idempotent zurück", async () => {
    prisma.$queryRaw.mockResolvedValue([]); // Fencing-Update trifft 0 Zeilen (bereits abgeschlossen)
    prisma.printJob.findUnique.mockResolvedValue({
      id: "job-1",
      leaseId: "lease-1",
      status: "PRINTED",
    });

    const result = await service.reportOutcome("job-1", {
      leaseId: "lease-1",
      outcome: "PRINTED",
    });
    expect(result).toMatchObject({ status: "PRINTED" });
  });

  it("weist eine PRINTED-Meldung mit fremdem Token zurück (409)", async () => {
    prisma.$queryRaw.mockResolvedValue([]);
    prisma.printJob.findUnique.mockResolvedValue({
      id: "job-1",
      leaseId: "anderes-token",
      status: "PROCESSING",
    });

    await expect(
      service.reportOutcome("job-1", {
        leaseId: "lease-1",
        outcome: "PRINTED",
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("wechselt bei NOT_PRINTED genau einmal auf den aktiven Ersatzdrucker", async () => {
    prisma.printJob.findUnique.mockResolvedValueOnce({
      id: "job-1",
      failoverCount: 0,
      printerId: "printer-1",
      activePrinterId: null,
      printer: {
        id: "printer-1",
        type: "ESC_POS_NETWORK",
        fallbackPrinterId: "printer-2",
      },
      activePrinter: null,
    });
    prisma.printer.findUnique.mockResolvedValueOnce({
      id: "printer-2",
      isActive: true,
    });
    prisma.$queryRaw.mockResolvedValue([{ id: "job-1" }]);
    prisma.printJob.findUniqueOrThrow.mockResolvedValue({
      id: "job-1",
      status: "PENDING",
      failoverCount: 1,
      failoverAt: new Date(),
      attemptCount: 1,
    });

    const result = await service.reportOutcome("job-1", {
      leaseId: "lease-1",
      outcome: "NOT_PRINTED",
      errorCode: "CONNECTION_REFUSED",
    });

    expect(result).toMatchObject({ status: "PENDING", failoverCount: 1 });
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    // Prisma.sql liefert parametrisierte Platzhalter, keine Literale - die
    // eine bedingte Anweisung aus Abschnitt 4.4 muss AND leaseId = ? UND
    // AND failoverCount = 0 tragen (siehe .sql-Text und die gebundenen Werte).
    const sqlFragment = prisma.$queryRaw.mock.calls[0][0];
    expect(sqlFragment.sql).toContain('"failoverCount" = 0');
    expect(sqlFragment.sql).toContain('"leaseId" = ?');
    expect(sqlFragment.values).toEqual(
      expect.arrayContaining(["lease-1", "printer-2"]),
    );
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: "PRINT_JOB_FAILOVER" }),
      prisma,
    );
  });

  it("löst KEIN zweites Failover aus, wenn failoverCount bereits 1 ist - Ergebnis FAILED", async () => {
    prisma.printJob.findUnique.mockResolvedValueOnce({
      id: "job-1",
      failoverCount: 1,
      printerId: "printer-1",
      activePrinterId: "printer-2",
      printer: {
        id: "printer-1",
        type: "ESC_POS_NETWORK",
        fallbackPrinterId: "printer-2",
      },
      activePrinter: {
        id: "printer-2",
        type: "ESC_POS_NETWORK",
        fallbackPrinterId: null,
      },
    });
    prisma.$queryRaw.mockResolvedValue([{ id: "job-1" }]);
    prisma.printJob.findUniqueOrThrow.mockResolvedValue({
      id: "job-1",
      status: "FAILED",
    });

    const result = await service.reportOutcome("job-1", {
      leaseId: "lease-1",
      outcome: "NOT_PRINTED",
      errorCode: "CONNECTION_LOST",
    });

    expect(result).toMatchObject({ status: "FAILED" });
    // Der Ersatzdrucker wurde nicht einmal nachgeschlagen - failoverCount
    // war bereits 1, kein zweiter Wechselversuch.
    expect(prisma.printer.findUnique).not.toHaveBeenCalled();
  });

  it("löst kein Failover bei PrinterConfigurationError-artigen Fehlercodes aus", async () => {
    prisma.printJob.findUnique.mockResolvedValueOnce({
      id: "job-1",
      failoverCount: 0,
      printerId: "printer-1",
      activePrinterId: null,
      printer: {
        id: "printer-1",
        type: "ESC_POS_NETWORK",
        fallbackPrinterId: "printer-2",
      },
      activePrinter: null,
    });
    prisma.$queryRaw.mockResolvedValue([{ id: "job-1" }]);
    prisma.printJob.findUniqueOrThrow.mockResolvedValue({
      id: "job-1",
      status: "FAILED",
    });

    await service.reportOutcome("job-1", {
      leaseId: "lease-1",
      outcome: "NOT_PRINTED",
      errorCode: "PRINTER_CONFIG_ERROR",
    });

    expect(prisma.printer.findUnique).not.toHaveBeenCalled();
  });

  it("löst kein Failover für einen Simulator (CONSOLE) aus, auch mit konfiguriertem Ersatzdrucker (R6)", async () => {
    prisma.printJob.findUnique.mockResolvedValueOnce({
      id: "job-1",
      failoverCount: 0,
      printerId: "printer-1",
      activePrinterId: null,
      printer: {
        id: "printer-1",
        type: "CONSOLE",
        fallbackPrinterId: "printer-2",
      },
      activePrinter: null,
    });
    prisma.$queryRaw.mockResolvedValue([{ id: "job-1" }]);
    prisma.printJob.findUniqueOrThrow.mockResolvedValue({
      id: "job-1",
      status: "FAILED",
    });

    await service.reportOutcome("job-1", {
      leaseId: "lease-1",
      outcome: "NOT_PRINTED",
      errorCode: "OUTPUT_FAILED",
    });

    expect(prisma.printer.findUnique).not.toHaveBeenCalled();
  });

  it("fällt bei einem verlorenen Wettlauf um das Failover NICHT blind auf FAILED zurück", async () => {
    prisma.printJob.findUnique
      .mockResolvedValueOnce({
        id: "job-1",
        failoverCount: 0,
        printerId: "printer-1",
        activePrinterId: null,
        printer: {
          id: "printer-1",
          type: "ESC_POS_NETWORK",
          fallbackPrinterId: "printer-2",
        },
        activePrinter: null,
      })
      // zweiter Aufruf: resolveIdempotentOrConflict prüft den tatsächlichen Zustand
      .mockResolvedValueOnce({
        id: "job-1",
        leaseId: "lease-1",
        status: "FAILED",
      });
    prisma.printer.findUnique.mockResolvedValueOnce({
      id: "printer-2",
      isActive: true,
    });
    // Die bedingte Failover-Anweisung trifft 0 Zeilen (Wettlauf verloren).
    prisma.$queryRaw.mockResolvedValue([]);

    const result = await service.reportOutcome("job-1", {
      leaseId: "lease-1",
      outcome: "NOT_PRINTED",
      errorCode: "CONNECTION_LOST",
    });

    expect(result).toMatchObject({ status: "FAILED" });
    expect(audit.log).not.toHaveBeenCalled();
  });

  it("schließt einen Auftrag bei outcome = UNCLEAR NIEMALS mit Failover ab, sondern nach UNRESOLVED", async () => {
    prisma.$queryRaw.mockResolvedValue([{ id: "job-1" }]);
    prisma.printJob.findUniqueOrThrow.mockResolvedValue({
      id: "job-1",
      status: "UNRESOLVED",
      unresolvedReason: "TRANSPORT",
    });

    const result = await service.reportOutcome("job-1", {
      leaseId: "lease-1",
      outcome: "UNCLEAR",
      bytesWritten: 412,
    });

    expect(result).toMatchObject({ status: "UNRESOLVED" });
    expect(prisma.printJob.findUnique).not.toHaveBeenCalled();
    expect(prisma.printer.findUnique).not.toHaveBeenCalled();
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: "PRINT_JOB_UNRESOLVED" }),
      prisma,
    );
  });
});

describe("PrintJobsService – unklare Druckaufträge und Admin-Entscheidung (Abschnitt 6.2)", () => {
  beforeEach(() => {
    prisma = makePrisma();
    audit = { log: jest.fn() };
    service = new PrintJobsService(prisma, audit as any);
  });

  it("gibt aus content ausschließlich die Wiedererkennungs-Metadaten heraus", async () => {
    prisma.printJob.findMany.mockResolvedValue([
      {
        id: "job-1",
        jobType: "STATION_TICKET",
        unresolvedAt: new Date(),
        unresolvedReason: "TRANSPORT",
        bytesWritten: 412,
        cupsJobState: null,
        attemptCount: 1,
        failoverCount: 0,
        printerId: "printer-1",
        activePrinterId: null,
        printer: { id: "printer-1", name: "Kueche" },
        activePrinter: null,
        content: {
          title: "Bestellung 42",
          orderNumber: 42,
          stationName: "Kueche",
          tableName: "Tisch 3",
          items: [{ name: "Bier", price: 350 }],
          paymentMethod: "CASH",
        },
      },
    ]);

    const [job] = await service.findUnresolvedJobs();
    expect(job.content).toEqual({
      title: "Bestellung 42",
      orderNumber: 42,
      stationName: "Kueche",
      tableName: "Tisch 3",
    });
    expect((job.content as any).items).toBeUndefined();
    expect((job.content as any).paymentMethod).toBeUndefined();
  });

  it("verwirft nur für ADMINISTRATOR - EVENT_MANAGER wird abgewiesen", async () => {
    await expect(
      service.resolveJob(
        "job-1",
        { resolution: "DISCARDED", comment: "Kein Bon am Drucker gefunden" },
        "user-1",
        "EVENT_MANAGER",
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("verlangt beim Verwerfen einen nicht-leeren Kommentar", async () => {
    await expect(
      service.resolveJob(
        "job-1",
        { resolution: "DISCARDED", comment: "   " },
        "user-1",
        "ADMINISTRATOR",
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("weist einen Zieldrucker außerhalb von REPRINTED zurück", async () => {
    await expect(
      service.resolveJob(
        "job-1",
        { resolution: "CONFIRMED_PRINTED", targetPrinterId: "printer-9" },
        "user-1",
        "EVENT_MANAGER",
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("liefert 409, wenn der Auftrag inzwischen nicht mehr UNRESOLVED ist", async () => {
    prisma.printJob.updateMany.mockResolvedValue({ count: 0 });
    prisma.printJob.findUnique.mockResolvedValue({ id: "job-1" });

    await expect(
      service.resolveJob(
        "job-1",
        { resolution: "CONFIRMED_PRINTED" },
        "user-1",
        "EVENT_MANAGER",
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("bestätigt einen Auftrag als gedruckt", async () => {
    prisma.printJob.updateMany.mockResolvedValue({ count: 1 });
    prisma.printJob.findUniqueOrThrow.mockResolvedValue({
      id: "job-1",
      status: "PRINTED",
    });

    const result = await service.resolveJob(
      "job-1",
      { resolution: "CONFIRMED_PRINTED" },
      "user-1",
      "EVENT_MANAGER",
    );
    expect(result).toMatchObject({ status: "PRINTED" });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "PRINT_JOB_RESOLVED",
        userId: "user-1",
        details: expect.objectContaining({ resolution: "CONFIRMED_PRINTED" }),
      }),
      prisma,
    );
  });

  it("weist ein Erneut-Drucken auf einen inaktiven Zieldrucker zurück", async () => {
    prisma.printer.findUnique.mockResolvedValue({
      id: "printer-9",
      isActive: false,
    });

    await expect(
      service.resolveJob(
        "job-1",
        { resolution: "REPRINTED", targetPrinterId: "printer-9" },
        "user-1",
        "ADMINISTRATOR",
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe("PrintJobsService – Druckerkonfiguration und Testdruck", () => {
  beforeEach(() => {
    prisma = makePrisma();
    audit = { log: jest.fn() };
    service = new PrintJobsService(prisma, audit as any);
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

  it("legt einen CUPS-Drucker mit Warteschlangenname und Vorgabe-Port 631 an", async () => {
    await service.createPrinter({
      name: "Bar CUPS",
      type: "cups_ipp",
      queueName: "bar-raw",
    });

    expect(prisma.printer.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: "CUPS_IPP",
        queueName: "bar-raw",
        port: 631,
      }),
    });
  });

  it("verlangt für CUPS-Drucker einen Warteschlangennamen", async () => {
    await expect(
      service.createPrinter({ name: "Bar CUPS", type: "CUPS_IPP" }),
    ).rejects.toThrow(/Warteschlangennamen/);
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

describe("PrintJobsService – Kettenfreiheit des Ersatzdruckers", () => {
  beforeEach(() => {
    prisma = makePrisma();
    audit = { log: jest.fn() };
    service = new PrintJobsService(prisma, audit as any);
    prisma.printer.findUnique.mockResolvedValue({
      id: "printer-1",
      type: "ESC_POS_NETWORK",
      fallbackPrinterId: null,
    });
  });

  it("weist einen Drucker als eigenen Ersatzdrucker zurück", async () => {
    prisma.printer.findUnique.mockResolvedValue({
      id: "printer-1",
      type: "ESC_POS_NETWORK",
    });

    await expect(
      service.updatePrinter("printer-1", { fallbackPrinterId: "printer-1" }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("weist einen inaktiven Ersatzdrucker zurück", async () => {
    prisma.printer.findUnique
      .mockResolvedValueOnce({ id: "printer-1", type: "ESC_POS_NETWORK" }) // existing
      .mockResolvedValueOnce({ id: "printer-2", isActive: false }); // Ziel

    await expect(
      service.updatePrinter("printer-1", { fallbackPrinterId: "printer-2" }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("weist eine Kette zurück, wenn der Zieldrucker selbst schon einen Ersatzdrucker hat", async () => {
    prisma.printer.findUnique
      .mockResolvedValueOnce({ id: "printer-1", type: "ESC_POS_NETWORK" }) // existing
      .mockResolvedValueOnce({
        id: "printer-2",
        isActive: true,
        fallbackPrinterId: "printer-3",
      }); // Ziel hat selbst schon einen Ersatz

    await expect(
      service.updatePrinter("printer-1", { fallbackPrinterId: "printer-2" }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("weist eine Kette zurück, wenn dieser Drucker bereits der Ersatzdrucker eines anderen ist", async () => {
    prisma.printer.findUnique
      .mockResolvedValueOnce({ id: "printer-1", type: "ESC_POS_NETWORK" }) // existing
      .mockResolvedValueOnce({
        id: "printer-2",
        isActive: true,
        fallbackPrinterId: null,
      }); // Ziel selbst ohne eigenen Ersatz
    prisma.printer.findFirst.mockResolvedValue({ id: "printer-0" }); // printer-1 ist bereits jemandes Ersatz

    await expect(
      service.updatePrinter("printer-1", { fallbackPrinterId: "printer-2" }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("erlaubt eine gültige, kettenfreie Zuordnung und schreibt einen Audit-Eintrag", async () => {
    prisma.printer.findUnique
      .mockResolvedValueOnce({
        id: "printer-1",
        type: "ESC_POS_NETWORK",
        fallbackPrinterId: null,
      }) // existing
      .mockResolvedValueOnce({
        id: "printer-2",
        isActive: true,
        fallbackPrinterId: null,
      }); // Ziel
    prisma.printer.findFirst.mockResolvedValue(null);

    await service.updatePrinter(
      "printer-1",
      { fallbackPrinterId: "printer-2" },
      "admin-1",
    );

    expect(prisma.printer.update).toHaveBeenCalledWith({
      where: { id: "printer-1" },
      data: expect.objectContaining({ fallbackPrinterId: "printer-2" }),
    });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "PRINTER_FALLBACK_CHANGED",
        userId: "admin-1",
        details: { printerId: "printer-1", from: null, to: "printer-2" },
      }),
    );
  });
});
