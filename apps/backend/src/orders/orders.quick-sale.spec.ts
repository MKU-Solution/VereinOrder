import { BadRequestException } from "@nestjs/common";
import { OrdersService } from "./orders.service";
import { createAuditServiceStub } from "./test-support/audit-service.stub";

describe("OrdersService – Bonkassen-Schnellverkauf für Issue #52", () => {
  let prisma: any;
  let service: OrdersService;

  const product = {
    id: "product-beer",
    name: "Bier",
    price: 450,
    eventId: "event-1",
    categoryId: "category-drinks",
    category: {
      id: "category-drinks",
      name: "Getränke",
      targetStationId: null,
    },
    targetStationId: null,
    availability: "AVAILABLE",
    optionGroups: [],
  };

  beforeEach(() => {
    prisma = {
      $transaction: jest.fn((callback) => callback(prisma)),
      $queryRaw: jest.fn().mockImplementation((query: any) => {
        const sql = query?.strings?.join("") || "";
        if (sql.includes('FROM "Event"')) {
          return Promise.resolve([
            { id: "event-1", status: "TEST_MODE", testMode: true },
          ]);
        }
        return Promise.resolve([{ id: "session-1", dataMode: "TEST" }]);
      }),
      event: {
        findFirst: jest.fn().mockResolvedValue({ id: "event-1" }),
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: "event-1", name: "Testfest" }),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: "cashier-1",
          username: "bonkasse",
          isActive: true,
        }),
      },
      product: {
        findMany: jest.fn().mockResolvedValue([product]),
      },
      cashierSession: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      order: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({
          id: "order-1",
          orderNumber: 42,
          eventId: "event-1",
          userId: "cashier-1",
          totalAmount: 900,
          dataMode: "TEST",
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
              amount: 900,
              method: "CASH",
              tenderedAmount: 1000,
              changeAmount: 100,
            },
          ],
        }),
      },
      productVoucher: {
        create: jest
          .fn()
          .mockResolvedValueOnce({
            code: "VOUCHER-1",
            issuedAt: new Date("2026-08-20T10:00:00Z"),
          })
          .mockResolvedValueOnce({
            code: "VOUCHER-2",
            issuedAt: new Date("2026-08-20T10:00:00Z"),
          }),
      },
      printer: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: "printer-1", isActive: true }),
      },
      station: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      printJob: {
        create: jest.fn().mockResolvedValue({}),
      },
      auditLog: {
        create: jest.fn().mockResolvedValue({}),
      },
    };
    service = new OrdersService(prisma, createAuditServiceStub() as any);
  });

  it("berechnet Preise und Rückgeld ausschließlich serverseitig und speichert nur den Umsatz als Zahlung", async () => {
    const result = await service.createQuickSale("cashier-1", {
      eventId: "event-1",
      idempotencyKey: "quick-sale-1234",
      items: [{ productId: product.id, quantity: 2 }],
      paymentMethod: "CASH",
      tenderedAmount: 1000,
    });

    expect(result).toMatchObject({
      vouchersIssued: 2,
      tenderedAmount: 1000,
      changeAmount: 100,
    });
    expect(prisma.order.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          totalAmount: 900,
          paymentStatus: "PAID",
          cashierSessionId: "session-1",
          payments: {
            create: expect.objectContaining({
              amount: 900,
              method: "CASH",
              tenderedAmount: 1000,
              changeAmount: 100,
            }),
          },
        }),
      }),
    );
  });

  it("legt je verkaufter Einheit einen eindeutigen Produktbon sowie Druckaufträge und Audit an", async () => {
    await service.createQuickSale("cashier-1", {
      eventId: "event-1",
      idempotencyKey: "quick-sale-1234",
      items: [{ productId: product.id, quantity: 2 }],
      paymentMethod: "CASH",
      tenderedAmount: 1000,
    });

    expect(prisma.productVoucher.create).toHaveBeenCalledTimes(2);
    expect(
      prisma.printJob.create.mock.calls.filter(
        ([call]: any[]) => call.data.jobType === "PRODUCT_VOUCHER",
      ),
    ).toHaveLength(2);
    expect(prisma.printJob.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          jobType: "RECEIPT",
          content: expect.objectContaining({
            title: "INTERNER ZAHLUNGSNACHWEIS",
            changeAmount: 100,
            rksvDisclaimer: "VereinOrder ist keine RKSV-Registrierkasse.",
          }),
        }),
      }),
    );
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "QUICK_SALE_COMPLETED",
        entityId: "order-1",
        userId: "cashier-1",
        details: expect.objectContaining({
          vouchersIssued: 2,
          totalAmount: 900,
        }),
      }),
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it("bricht ohne aktive Kassensitzung vor Bestellung und Zahlung ab", async () => {
    prisma.$queryRaw.mockImplementation((query: any) => {
      const sql = query?.strings?.join("") || "";
      return Promise.resolve(
        sql.includes('FROM "Event"')
          ? [{ id: "event-1", status: "TEST_MODE", testMode: true }]
          : [],
      );
    });

    await expect(
      service.createQuickSale("cashier-1", {
        eventId: "event-1",
        idempotencyKey: "quick-sale-1234",
        items: [{ productId: product.id, quantity: 1 }],
        paymentMethod: "CASH",
        tenderedAmount: 500,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.order.create).not.toHaveBeenCalled();
  });

  it("bricht ohne aktiven Drucker vor Bestellung, Zahlung und Bonerzeugung ab", async () => {
    prisma.printer.findFirst.mockResolvedValue(null);

    await expect(
      service.createQuickSale("cashier-1", {
        eventId: "event-1",
        idempotencyKey: "quick-sale-no-printer",
        items: [{ productId: product.id, quantity: 1 }],
        paymentMethod: "CASH",
        tenderedAmount: 500,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.order.create).not.toHaveBeenCalled();
    expect(prisma.productVoucher.create).not.toHaveBeenCalled();
  });

  it("weist manipulierte Varianten, ausverkaufte Produkte und zu geringe Barbeträge zurück", async () => {
    await expect(
      service.createQuickSale("cashier-1", {
        eventId: "event-1",
        idempotencyKey: "quick-sale-variant",
        items: [
          {
            productId: product.id,
            quantity: 1,
            optionIds: ["foreign-option"],
          },
        ],
        paymentMethod: "CASH",
        tenderedAmount: 500,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    prisma.product.findMany.mockResolvedValue([
      { ...product, availability: "OUT_OF_STOCK" },
    ]);
    await expect(
      service.createQuickSale("cashier-1", {
        eventId: "event-1",
        idempotencyKey: "quick-sale-stock",
        items: [{ productId: product.id, quantity: 1 }],
        paymentMethod: "CASH",
        tenderedAmount: 500,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    prisma.product.findMany.mockResolvedValue([product]);
    await expect(
      service.createQuickSale("cashier-1", {
        eventId: "event-1",
        idempotencyKey: "quick-sale-cash",
        items: [{ productId: product.id, quantity: 1 }],
        paymentMethod: "CASH",
        tenderedAmount: 400,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("gibt einen vorhandenen idempotenten Verkauf ohne zweite Buchung zurück", async () => {
    prisma.order.findUnique.mockResolvedValue({
      id: "order-existing",
      userId: "cashier-1",
      eventId: "event-1",
      totalAmount: 900,
      cashierSessionId: "session-1",
      // Issue #66: findUnique laedt hier ohne select, liefert also alle
      // Skalarspalten - stationId/pickupNumber sind bei einem regulaeren
      // Zentralverkauf null, nicht undefined. Das bildet
      // orders.service.ts:423 exakt ab, siehe die Normalisierung in der
      // Wiederholungspruefung (Kommentar dort).
      stationId: null,
      pickupNumber: null,
      items: [{ productId: product.id, variantId: null, quantity: 2, product }],
      payments: [
        {
          method: "CASH",
          tenderedAmount: 1000,
          changeAmount: 100,
        },
      ],
      vouchers: [{ id: "voucher-1" }, { id: "voucher-2" }],
    });

    await expect(
      service.createQuickSale("cashier-1", {
        eventId: "event-1",
        idempotencyKey: "quick-sale-replay",
        items: [{ productId: product.id, quantity: 2 }],
        paymentMethod: "CASH",
        tenderedAmount: 1000,
      }),
    ).resolves.toMatchObject({
      idempotentReplay: true,
      vouchersIssued: 2,
      changeAmount: 100,
    });
    expect(prisma.order.create).not.toHaveBeenCalled();
    expect(prisma.productVoucher.create).not.toHaveBeenCalled();
  });

  it("weist denselben Idempotenzschlüssel für einen veränderten Warenkorb zurück", async () => {
    prisma.order.findUnique.mockResolvedValue({
      id: "order-existing",
      userId: "cashier-1",
      eventId: "event-1",
      totalAmount: 900,
      cashierSessionId: "session-1",
      // Issue #66: findUnique laedt hier ohne select, liefert also alle
      // Skalarspalten - stationId/pickupNumber sind bei einem regulaeren
      // Zentralverkauf null, nicht undefined. Das bildet
      // orders.service.ts:423 exakt ab, siehe die Normalisierung in der
      // Wiederholungspruefung (Kommentar dort).
      stationId: null,
      pickupNumber: null,
      items: [{ productId: product.id, variantId: null, quantity: 2, product }],
      payments: [
        {
          method: "CASH",
          tenderedAmount: 1000,
          changeAmount: 100,
        },
      ],
      vouchers: [{ id: "voucher-1" }, { id: "voucher-2" }],
    });

    await expect(
      service.createQuickSale("cashier-1", {
        eventId: "event-1",
        idempotencyKey: "quick-sale-reused",
        items: [{ productId: product.id, quantity: 1 }],
        paymentMethod: "CASH",
        tenderedAmount: 500,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.order.create).not.toHaveBeenCalled();
  });
});
