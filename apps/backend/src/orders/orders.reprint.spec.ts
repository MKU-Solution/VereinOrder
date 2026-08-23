import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { OrdersService } from "./orders.service";
import { createAuditServiceStub } from "./test-support/audit-service.stub";

// Issue #98: reprintOrder rief dispatchPrintJobs bisher ohne Zusatzangaben
// auf. Das erzeugte einen erneuten Stationsbon (doppelte Zubereitung),
// druckte den Produktbon gar nicht nach, ließ Titel und Bargeldangaben auf
// den Kassenbeleg-Standard zurückfallen und machte eine Kopie vom Original
// nicht unterscheidbar. Diese Tests decken die Behebung ab.
describe("OrdersService – Wiederholungsdruck für Issue #98", () => {
  let prisma: any;
  let service: OrdersService;

  const product = {
    id: "product-schnitzel",
    name: "Schnitzel",
    targetStationId: null,
    category: { id: "category-food", targetStationId: "station-kitchen" },
  };

  const baseOrder = {
    id: "order-1",
    orderNumber: 101,
    eventId: "event-1",
    totalAmount: 900,
    tableName: null,
    isPriority: false,
    createdAt: new Date("2026-08-20T10:00:00Z"),
    items: [
      {
        id: "item-1",
        productId: product.id,
        quantity: 2,
        priceAtTime: 450,
        variantName: null,
        extras: null,
        product,
      },
    ],
    payments: [
      {
        id: "payment-1",
        method: "CASH",
        amount: 900,
        tenderedAmount: 1000,
        changeAmount: 100,
      },
    ],
    vouchers: [
      {
        id: "voucher-1",
        code: "VOUCHER-1",
        productId: product.id,
        orderItemId: "item-1",
        issuedAt: new Date("2026-08-20T10:00:05Z"),
      },
      {
        id: "voucher-2",
        code: "VOUCHER-2",
        productId: product.id,
        orderItemId: "item-1",
        issuedAt: new Date("2026-08-20T10:00:06Z"),
      },
    ],
  };

  beforeEach(() => {
    prisma = {
      order: {
        findUnique: jest.fn().mockResolvedValue(baseOrder),
      },
      cashierSession: {
        findFirst: jest.fn().mockResolvedValue({
          id: "session-1",
          userId: "cashier-1",
          eventId: "event-1",
          status: "ACTIVE",
        }),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: "cashier-1",
          username: "bonkasse",
          role: "CASHIER",
          isActive: true,
        }),
      },
      printJob: {
        findFirst: jest.fn().mockResolvedValue({
          id: "job-original-receipt",
          jobType: "RECEIPT",
          content: { title: "INTERNER ZAHLUNGSNACHWEIS" },
        }),
        create: jest.fn().mockResolvedValue({}),
      },
      event: {
        findUnique: jest.fn().mockResolvedValue({
          id: "event-1",
          name: "Testfest",
        }),
      },
      printer: {
        findFirst: jest.fn().mockResolvedValue({
          id: "printer-1",
          isActive: true,
        }),
      },
      station: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      productVoucher: {
        create: jest.fn(),
      },
      auditLog: {
        create: jest.fn().mockResolvedValue({}),
      },
    };
    service = new OrdersService(prisma, createAuditServiceStub() as any);
  });

  it("erzeugt beim Nachdruck keinen Stationsbon", async () => {
    await service.reprintOrder("order-1", "cashier-1");

    const jobTypes = prisma.printJob.create.mock.calls.map(
      ([call]: any[]) => call.data.jobType,
    );
    expect(jobTypes).not.toContain("STATION_TICKET");
  });

  it("druckt die vorhandenen Produktbons erneut, ohne neue Gutscheine anzulegen", async () => {
    await service.reprintOrder("order-1", "cashier-1");

    expect(prisma.productVoucher.create).not.toHaveBeenCalled();
    // vouchers stammen ausschließlich aus der geladenen Bestellung.
    expect(prisma.order.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({ vouchers: true }),
      }),
    );

    const voucherJobs = prisma.printJob.create.mock.calls
      .map(([call]: any[]) => call.data)
      .filter((data: any) => data.jobType === "PRODUCT_VOUCHER");
    expect(voucherJobs).toHaveLength(2);
    expect(voucherJobs.map((j: any) => j.content.voucherCode).sort()).toEqual([
      "VOUCHER-1",
      "VOUCHER-2",
    ]);
    for (const job of voucherJobs) {
      expect(job.content.isCopy).toBe(true);
      expect(job.content.reprintedAt).toBeInstanceOf(Date);
    }
  });

  it("übernimmt Titel sowie gegebenen Betrag und Rückgeld aus dem Original", async () => {
    await service.reprintOrder("order-1", "cashier-1");

    const receiptJob = prisma.printJob.create.mock.calls
      .map(([call]: any[]) => call.data)
      .find((data: any) => data.jobType === "RECEIPT");

    expect(receiptJob).toBeDefined();
    expect(receiptJob.content.title).toBe("INTERNER ZAHLUNGSNACHWEIS");
    expect(receiptJob.content.tenderedAmount).toBe(1000);
    expect(receiptJob.content.changeAmount).toBe(100);
    expect(receiptJob.content.isCopy).toBe(true);
    expect(receiptJob.content.reprintedAt).toBeInstanceOf(Date);
  });

  it("lässt Titel, gegebenen Betrag und Rückgeld weg, statt sie zu erfinden, wenn nichts gespeichert ist", async () => {
    prisma.printJob.findFirst.mockResolvedValue(null);
    prisma.order.findUnique.mockResolvedValue({
      ...baseOrder,
      payments: [
        { id: "payment-1", method: "CARD", amount: 900, tenderedAmount: null },
      ],
    });

    await service.reprintOrder("order-1", "cashier-1");

    const receiptJob = prisma.printJob.create.mock.calls
      .map(([call]: any[]) => call.data)
      .find((data: any) => data.jobType === "RECEIPT");

    // Kein gespeicherter Originaltitel -> derselbe Standardrückfall wie beim
    // ursprünglichen Verkauf, kein erfundener Titel.
    expect(receiptJob.content.title).toBe("KASSENBELEG");
    // Keine Barzahlung mit gespeichertem tenderedAmount -> Feld bleibt weg.
    expect(receiptJob.content.tenderedAmount).toBeUndefined();
  });

  it("weist eine Bestellung einer fremden Veranstaltung ab, ohne Druckaufträge oder Audit zu erzeugen", async () => {
    prisma.cashierSession.findFirst.mockResolvedValue(null);

    await expect(
      service.reprintOrder("order-1", "cashier-1"),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.cashierSession.findFirst).toHaveBeenCalledWith({
      where: { userId: "cashier-1", eventId: "event-1", status: "ACTIVE" },
    });
    expect(prisma.printJob.create).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it("erlaubt ADMINISTRATOR den Nachdruck ohne aktive Kassensitzung (Eskalationsweg, z. B. Druckerausfall)", async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: "admin-1",
      username: "chef",
      role: "ADMINISTRATOR",
      isActive: true,
    });
    prisma.cashierSession.findFirst.mockResolvedValue(null);

    await expect(
      service.reprintOrder("order-1", "admin-1"),
    ).resolves.toMatchObject({ success: true });

    // Für ADMINISTRATOR wird die Sitzung gar nicht erst geprüft.
    expect(prisma.cashierSession.findFirst).not.toHaveBeenCalled();
    expect(
      prisma.printJob.create.mock.calls.some(
        ([call]: any[]) => call.data.jobType === "RECEIPT",
      ),
    ).toBe(true);
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: "admin-1" }),
      }),
    );
  });

  it("weist WAITER ohne passende aktive Kassensitzung ab", async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: "waiter-1",
      username: "kellner",
      role: "WAITER",
      isActive: true,
    });
    prisma.cashierSession.findFirst.mockResolvedValue(null);

    await expect(
      service.reprintOrder("order-1", "waiter-1"),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.cashierSession.findFirst).toHaveBeenCalledWith({
      where: { userId: "waiter-1", eventId: "event-1", status: "ACTIVE" },
    });
    expect(prisma.printJob.create).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it("weist den Nachdruck ohne angemeldete Person ab", async () => {
    await expect(service.reprintOrder("order-1")).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.printJob.create).not.toHaveBeenCalled();
  });

  it("weist eine unbekannte Bestellung ab", async () => {
    prisma.order.findUnique.mockResolvedValue(null);

    await expect(
      service.reprintOrder("unknown-order", "cashier-1"),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("schreibt weiterhin den Audit-Eintrag und verändert Bestellung, Zahlung und Gutscheine nicht", async () => {
    await service.reprintOrder("order-1", "cashier-1");

    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "REPRINT_ORDER",
        entityId: "order-1",
        userId: "cashier-1",
        details: expect.objectContaining({
          orderNumber: 101,
          totalAmount: 900,
          vouchersReprinted: 2,
        }),
      }),
    });

    // Der Service darf Bestellung, Zahlung und Gutscheine ausschließlich
    // lesen - keine dieser Tabellen kennt hier eine Schreibmethode.
    expect(prisma.order.findUnique).toHaveBeenCalledTimes(1);
  });
});
