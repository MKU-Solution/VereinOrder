import { BadRequestException } from "@nestjs/common";
import { OrdersService } from "./orders.service";
import { SessionsService } from "../sessions/sessions.service";
import { ReportsService } from "../reports/reports.service";

describe("OrdersService & ReportsService – Pfandverwaltung (Issue #137)", () => {
  let ordersService: OrdersService;
  let reportsService: ReportsService;
  let sessionsService: SessionsService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      $transaction: jest.fn(async (cb) => cb(mockPrisma)),
      $queryRaw: jest.fn().mockImplementation(async (query: any) => {
        const text =
          typeof query === "string" ? query : query?.strings?.join(" ") || "";
        if (text.includes("CashierSession")) {
          return [{ id: "session-1", dataMode: "LIVE" }];
        }
        return [{ status: "ACTIVE", testMode: false }];
      }),
      product: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
      },
      order: {
        create: jest.fn(),
        update: jest.fn().mockImplementation(async ({ data }: any) => ({
          id: "order-split-1",
          ...data,
        })),
        findUnique: jest.fn(),
        findMany: jest.fn(),
      },
      orderItem: {
        update: jest.fn(),
        updateMany: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
      },
      payment: {
        createMany: jest.fn(),
        findMany: jest.fn(),
      },
      cashierSession: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: "session-1", dataMode: "LIVE" }),
        findUnique: jest.fn(),
      },
      user: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: "user-1", isActive: true }),
      },
      auditLog: {
        create: jest.fn().mockResolvedValue({ id: "audit-1" }),
      },
      printer: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: "printer-1", isActive: true }),
      },
      printJob: {
        create: jest.fn().mockResolvedValue({ id: "print-job-1" }),
      },
      productVoucher: {
        create: jest.fn().mockResolvedValue({
          id: "voucher-1",
          code: "VOUCHER-123",
          issuedAt: new Date(),
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      station: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      event: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: "event-1", name: "Sommerfest" }),
      },
    };

    ordersService = new OrdersService(mockPrisma as any, {} as any);
    reportsService = new ReportsService(mockPrisma as any);
    sessionsService = new SessionsService(mockPrisma as any);
  });

  it("berücksichtigt deposit bei der Gesamtbetragsberechnung in createOrder", async () => {
    mockPrisma.product.findMany.mockResolvedValue([
      {
        id: "prod-beer",
        name: "Helles Bier",
        price: 450,
        deposit: 100, // 1,00 € Pfand
        availability: "AVAILABLE",
        optionGroups: [],
        targetStationId: null,
        category: { targetStationId: null },
      },
    ]);

    mockPrisma.order.create.mockImplementation(async ({ data }: any) => ({
      id: "order-1",
      ...data,
      items: data.items.create.map((i: any) => ({
        ...i,
        product: {
          name: "Helles Bier",
          targetStationId: null,
          category: { targetStationId: null },
        },
      })),
    }));

    const result = await ordersService.createOrder("user-1", {
      eventId: "event-1",
      items: [{ productId: "prod-beer", quantity: 2 }],
      depositRefundTotal: 100, // 1x Pfand zurück (-1,00 €)
    });

    // 2x (450 + 100) = 1100 - 100 Pfandrückgabe = 1000 Cent (10,00 €)
    expect(result.totalAmount).toBe(1000);
    expect(result.depositRefundTotal).toBe(100);
    expect(mockPrisma.order.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          totalAmount: 1000,
          depositRefundTotal: 100,
          items: {
            create: [
              expect.objectContaining({
                productId: "prod-beer",
                quantity: 2,
                priceAtTime: 450,
                depositAtTime: 100,
              }),
            ],
          },
        }),
      }),
    );
  });

  it("übernimmt die Pfandvorgabe der Kategorie ohne Produktpfand", async () => {
    mockPrisma.product.findMany.mockResolvedValue([
      {
        id: "prod-water",
        name: "Wasser",
        price: 250,
        deposit: 0,
        availability: "AVAILABLE",
        optionGroups: [],
        category: { deposit: 50 },
      },
    ]);
    mockPrisma.order.create.mockImplementation(async ({ data }: any) => ({
      id: "order-category-deposit",
      ...data,
      items: data.items.create.map((item: any) => ({
        ...item,
        product: { name: "Wasser", category: { deposit: 50 } },
      })),
    }));

    const result = await ordersService.createOrder("user-1", {
      eventId: "event-1",
      items: [{ productId: "prod-water", quantity: 2 }],
    });

    expect(result.totalAmount).toBe(600);
    expect(mockPrisma.order.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          items: {
            create: [expect.objectContaining({ depositAtTime: 50 })],
          },
        }),
      }),
    );
  });

  it("berücksichtigt deposit und depositRefundTotal in createQuickSale", async () => {
    mockPrisma.product.findMany.mockResolvedValue([
      {
        id: "prod-beer",
        name: "Helles Bier",
        price: 450,
        deposit: 100,
        availability: "AVAILABLE",
        optionGroups: [],
        targetStationId: null,
        category: { targetStationId: null },
      },
    ]);

    mockPrisma.order.create.mockImplementation(async ({ data }: any) => ({
      id: "order-2",
      ...data,
      payments: [{ amount: data.totalAmount, method: "CASH" }],
      items: data.items.create.map((i: any) => ({
        ...i,
        product: {
          name: "Helles Bier",
          targetStationId: null,
          category: { targetStationId: null },
        },
      })),
    }));

    const result = await ordersService.createQuickSale("user-1", {
      eventId: "event-1",
      idempotencyKey: "quick-sale-key-12345",
      items: [{ productId: "prod-beer", quantity: 2 }],
      paymentMethod: "CASH",
      tenderedAmount: 1000,
      depositRefundTotal: 100,
    });

    expect(result.order.totalAmount).toBe(1000);
    expect(result.order.depositRefundTotal).toBe(100);
    expect(result.changeAmount).toBe(0); // 1000 gegeben - 1000 fällig = 0
    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "QUICK_SALE_COMPLETED",
        details: expect.objectContaining({ depositRefundTotal: 100 }),
      }),
    });
  });

  it("erfasst eine reine Pfandrückgabe als auditierbare Barauszahlung", async () => {
    mockPrisma.product.findMany.mockResolvedValue([]);
    mockPrisma.order.create.mockImplementation(async ({ data }: any) => ({
      id: "order-refund-only",
      orderNumber: 42,
      createdAt: new Date("2026-08-27T10:00:00Z"),
      ...data,
      items: [],
      payments: Array.isArray(data.payments.create)
        ? data.payments.create
        : [data.payments.create],
    }));

    const result = await ordersService.createQuickSale("user-1", {
      eventId: "event-1",
      idempotencyKey: "refund-only-key-12345",
      items: [],
      paymentMethod: "CASH",
      tenderedAmount: 0,
      depositRefundTotal: 200,
    });

    expect(result.order.totalAmount).toBe(0);
    expect(result.order.depositRefundTotal).toBe(200);
    expect(mockPrisma.order.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          payments: {
            create: expect.arrayContaining([
              expect.objectContaining({ amount: 0, method: "CASH" }),
              expect.objectContaining({ amount: 200, method: "REFUND" }),
            ]),
          },
        }),
      }),
    );
    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "QUICK_SALE_COMPLETED",
        details: expect.objectContaining({
          depositRefundTotal: 200,
          depositRefundPayout: 200,
        }),
      }),
    });
  });

  it("lehnt eine nicht atomar auszahlbare Pfandrückgabe in createOrder ab", async () => {
    mockPrisma.product.findMany.mockResolvedValue([
      {
        id: "prod-water",
        name: "Wasser",
        price: 100,
        deposit: 100,
        availability: "AVAILABLE",
        optionGroups: [],
      },
    ]);

    await expect(
      ordersService.createOrder("user-1", {
        eventId: "event-1",
        items: [{ productId: "prod-water", quantity: 1 }],
        depositRefundTotal: 300,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(mockPrisma.order.create).not.toHaveBeenCalled();
  });

  it("weist einen wiederverwendeten Schnellverkaufs-Schlüssel mit geändertem Pfandrückgabebetrag zurück", async () => {
    mockPrisma.order.findUnique.mockResolvedValue({
      id: "order-existing",
      userId: "user-1",
      eventId: "event-1",
      totalAmount: 1000,
      depositRefundTotal: 100,
      cashierSessionId: "session-1",
      stationId: null,
      pickupNumber: null,
      items: [
        {
          productId: "prod-beer",
          quantity: 2,
          variantId: null,
          extras: null,
          product: { name: "Helles Bier" },
        },
      ],
      payments: [
        {
          method: "CASH",
          tenderedAmount: 1000,
          changeAmount: 0,
        },
      ],
      vouchers: [{ id: "voucher-1" }, { id: "voucher-2" }],
    });

    await expect(
      ordersService.createQuickSale("user-1", {
        eventId: "event-1",
        idempotencyKey: "quick-sale-deposit-replay",
        items: [{ productId: "prod-beer", quantity: 2 }],
        paymentMethod: "CASH",
        tenderedAmount: 1000,
        depositRefundTotal: 200,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(mockPrisma.order.create).not.toHaveBeenCalled();
  });

  it("weist einen wiederverwendeten Bestell-Schlüssel mit geändertem Pfandrückgabebetrag zurück", async () => {
    mockPrisma.order.findUnique.mockResolvedValue({
      id: "order-existing",
      userId: "user-1",
      eventId: "event-1",
      depositRefundTotal: 100,
      items: [
        {
          productId: "prod-beer",
          quantity: 1,
          variantId: null,
          extras: null,
          product: { name: "Helles Bier" },
        },
      ],
      payments: [],
    });

    await expect(
      ordersService.createOrder("user-1", {
        eventId: "event-1",
        idempotencyKey: "order-deposit-replay",
        items: [{ productId: "prod-beer", quantity: 1 }],
        depositRefundTotal: 200,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(mockPrisma.order.create).not.toHaveBeenCalled();
  });

  it("berechnet Teilbetrag im Rechnungs-Splitting inklusive depositAtTime", async () => {
    mockPrisma.order.findUnique.mockResolvedValue({
      id: "order-split-1",
      eventId: "event-1",
      lifecycleStatus: "SUBMITTED",
      paymentStatus: "OPEN",
      totalAmount: 1100,
      items: [
        {
          id: "item-1",
          productId: "prod-beer",
          quantity: 2,
          paidQuantity: 0,
          priceAtTime: 450,
          depositAtTime: 100,
          product: { name: "Helles Bier" },
        },
      ],
    });

    const result = await ordersService.splitPaymentOrder(
      "order-split-1",
      [{ orderItemId: "item-1", quantity: 1 }],
      [{ amount: 550, method: "CARD" }],
      "user-1",
    );

    // 1x (450 + 100) = 550 Cent
    expect(mockPrisma.orderItem.update).toHaveBeenCalledWith({
      where: { id: "item-1" },
      data: { paidQuantity: 1 },
    });
    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "ORDER_SPLIT_PAYMENT",
        details: expect.objectContaining({
          splitItems: [
            expect.objectContaining({
              depositAtTime: 100,
              totalCents: 550,
            }),
          ],
        }),
      }),
    });
    expect(result.id).toBe("order-split-1");
  });

  it("behält beim Teilstorno Pfand und bereits verrechnete Pfandrückgabe im neuen Bestellbetrag", async () => {
    mockPrisma.orderItem.findUnique.mockResolvedValue({
      id: "item-cancel",
      productId: "prod-water",
      quantity: 1,
      priceAtTime: 300,
      depositAtTime: 100,
      status: "PENDING",
      order: {
        id: "order-cancel",
        lifecycleStatus: "SUBMITTED",
        depositRefundTotal: 100,
        items: [
          {
            id: "item-cancel",
            priceAtTime: 300,
            depositAtTime: 100,
            quantity: 1,
            status: "PENDING",
          },
          {
            id: "item-remaining",
            priceAtTime: 450,
            depositAtTime: 100,
            quantity: 1,
            status: "PENDING",
          },
        ],
      },
    });

    await ordersService.cancelOrderItem(
      "item-cancel",
      "Falsch erfasst",
      "user-1",
    );

    // Verbleibend: 450 + 100 Pfand - 100 bereits verrechnete Rückgabe.
    expect(mockPrisma.order.update).toHaveBeenCalledWith({
      where: { id: "order-cancel" },
      data: {
        totalAmount: 450,
        lifecycleStatus: "SUBMITTED",
      },
    });
    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "CANCEL_ORDER_ITEM",
        details: expect.objectContaining({ itemDeposit: 100 }),
      }),
    });
  });

  it("weist Pfandeinnahmen, Pfandrückgaben und Pfandsaldo in ReportsService.getSummary aus", async () => {
    mockPrisma.order.findMany.mockImplementation(async ({ where }: any) => {
      if (where?.lifecycleStatus?.not === "CANCELLED") {
        return [
          {
            id: "order-1",
            totalAmount: 1000,
            depositRefundTotal: 200,
            paymentStatus: "PAID",
            payments: [{ amount: 1000, status: "COMPLETED" }],
            items: [
              {
                priceAtTime: 450,
                depositAtTime: 100,
                quantity: 2,
                paidQuantity: 2,
              }, // 2x 100 = 200 Cent Pfand
              {
                priceAtTime: 300,
                depositAtTime: 0,
                quantity: 1,
                paidQuantity: 1,
              }, // 0 Pfand
            ],
          },
        ];
      }
      return [];
    });

    mockPrisma.payment.findMany.mockResolvedValue([
      { amount: 1000, method: "CASH", status: "COMPLETED" },
    ]);

    const summary = await reportsService.getSummary("event-1");

    expect(summary.totalAmount).toBe(1000);
    expect(summary.depositCollected).toBe(200);
    expect(summary.depositRefunded).toBe(200);
    expect(summary.depositNet).toBe(0);
    expect(summary.netProductSales).toBe(1200); // 2 × 450 + 1 × 300 ohne Pfand
    expect(mockPrisma.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          items: { where: { status: { not: "CANCELLED" } } },
        }),
      }),
    );
  });

  it("zählt in Veranstaltungsberichten Pfand nur für tatsächlich bezahlte Mengen", async () => {
    mockPrisma.order.findMany.mockImplementation(async ({ where }: any) => {
      if (where?.lifecycleStatus?.not === "CANCELLED") {
        return [
          {
            id: "order-partial",
            totalAmount: 1100,
            depositRefundTotal: 0,
            paymentStatus: "PARTIALLY_PAID",
            payments: [{ amount: 550, status: "COMPLETED" }],
            items: [
              {
                priceAtTime: 450,
                depositAtTime: 100,
                quantity: 2,
                paidQuantity: 1,
              },
              {
                priceAtTime: 300,
                depositAtTime: 100,
                quantity: 1,
                paidQuantity: 0,
              },
            ],
          },
        ];
      }
      return [];
    });
    mockPrisma.payment.findMany.mockResolvedValue([
      { amount: 550, method: "CASH", status: "COMPLETED" },
    ]);

    const summary = await reportsService.getSummary("event-1");

    expect(summary.depositCollected).toBe(100);
  });

  it("weist Pfandsaldo in SessionsService.getSummary aus", async () => {
    mockPrisma.cashierSession.findUnique.mockResolvedValue({
      id: "session-1",
      userId: "user-1",
      status: "ACTIVE",
      startingBalance: 10000,
      payments: [{ amount: 1000, method: "CASH", status: "COMPLETED" }],
      orders: [
        {
          id: "order-1",
          depositRefundTotal: 100,
          paymentStatus: "PAID",
          items: [
            {
              priceAtTime: 450,
              depositAtTime: 100,
              quantity: 2,
              paidQuantity: 2,
            },
          ],
        },
      ],
    });

    const summary = await sessionsService.getSummary("session-1", "user-1");

    expect(summary.depositCollected).toBe(200); // 2x 100
    expect(summary.depositRefunded).toBe(100);
    expect(summary.depositNet).toBe(100);
    expect(summary.expectedCash).toBe(11000); // 10000 + 1000
    expect(mockPrisma.cashierSession.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          orders: expect.objectContaining({
            include: {
              items: { where: { status: { not: "CANCELLED" } } },
            },
          }),
        }),
      }),
    );
  });

  it("zieht eine Pfand-Barauszahlung vom Soll-Kassenbestand ab", async () => {
    mockPrisma.cashierSession.findUnique.mockResolvedValue({
      id: "session-1",
      userId: "user-1",
      status: "ACTIVE",
      startingBalance: 10000,
      payments: [
        { amount: 1000, method: "CASH", status: "COMPLETED" },
        { amount: 200, method: "REFUND", status: "COMPLETED" },
      ],
      orders: [
        {
          id: "order-refund-only",
          depositRefundTotal: 200,
          paymentStatus: "PAID",
          items: [],
        },
      ],
    });

    const summary = await sessionsService.getSummary("session-1", "user-1");

    expect(summary.cashSales).toBe(1000);
    expect(summary.cashPayouts).toBe(200);
    expect(summary.expectedCash).toBe(10800);
  });

  it("zählt in Kassensitzungen Pfand nur für tatsächlich bezahlte Mengen", async () => {
    mockPrisma.cashierSession.findUnique.mockResolvedValue({
      id: "session-1",
      userId: "user-1",
      status: "ACTIVE",
      startingBalance: 10000,
      payments: [{ amount: 550, method: "CASH", status: "COMPLETED" }],
      orders: [
        {
          id: "order-partial",
          depositRefundTotal: 0,
          paymentStatus: "PARTIALLY_PAID",
          items: [
            {
              priceAtTime: 450,
              depositAtTime: 100,
              quantity: 2,
              paidQuantity: 1,
            },
          ],
        },
      ],
    });

    const summary = await sessionsService.getSummary("session-1", "user-1");

    expect(summary.depositCollected).toBe(100);
  });
});
