import { BadRequestException } from "@nestjs/common";
import { OrdersService } from "./orders.service";

describe("OrdersService - Rechnungs-Splitting und Teilzahlungen (#136)", () => {
  let service: OrdersService;
  let prisma: any;

  const mockEvent = {
    id: "evt-1",
    name: "Sommerfest",
    status: "ACTIVE",
    testMode: false,
  };

  const mockItem1 = {
    id: "item-1",
    orderId: "order-1",
    productId: "prod-1",
    quantity: 2,
    paidQuantity: 0,
    priceAtTime: 1200,
    product: { id: "prod-1", name: "Schnitzel" },
  };

  const mockItem2 = {
    id: "item-2",
    orderId: "order-1",
    productId: "prod-2",
    quantity: 3,
    paidQuantity: 0,
    priceAtTime: 450,
    product: { id: "prod-2", name: "Bier 0,5l" },
  };

  const mockOrder = {
    id: "order-1",
    orderNumber: 101,
    eventId: "evt-1",
    tableName: "Tisch 14",
    lifecycleStatus: "SUBMITTED",
    paymentStatus: "OPEN",
    totalAmount: 3750, // 2*1200 + 3*450 = 2400 + 1350 = 3750
    items: [mockItem1, mockItem2],
    payments: [],
    event: mockEvent,
  };

  beforeEach(() => {
    prisma = {
      $transaction: jest.fn(async (callback) => callback(prisma)),
      order: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      orderItem: {
        update: jest.fn(),
      },
      payment: {
        createMany: jest.fn(),
      },
      cashierSession: {
        findFirst: jest.fn(),
      },
      auditLog: {
        create: jest.fn(),
      },
      printer: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      station: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      printJob: {
        create: jest.fn(),
      },
    };

    service = new OrdersService(prisma, {} as any);
  });

  it("führt eine Teilzahlung für einzelne Positionen erfolgreich durch und setzt Status auf PARTIALLY_PAID", async () => {
    prisma.order.findUnique.mockResolvedValueOnce({
      ...mockOrder,
      items: [
        { ...mockItem1, paidQuantity: 0 },
        { ...mockItem2, paidQuantity: 0 },
      ],
      payments: [],
    });

    prisma.cashierSession.findFirst.mockResolvedValueOnce({
      id: "session-kellner-1",
      userId: "user-kellner",
      eventId: "evt-1",
      status: "ACTIVE",
    });

    prisma.order.update.mockResolvedValueOnce({
      ...mockOrder,
      paymentStatus: "PARTIALLY_PAID",
      items: [
        { ...mockItem1, paidQuantity: 1 },
        { ...mockItem2, paidQuantity: 0 },
      ],
      payments: [{ amount: 1200, method: "CASH" }],
    });

    // Gast 1 zahlt 1x Schnitzel = 1200 Cent
    const result = await service.splitPaymentOrder(
      "order-1",
      [{ orderItemId: "item-1", quantity: 1 }],
      [{ amount: 1200, method: "CASH" }],
      "user-kellner",
    );

    // OrderItem 1 paidQuantity muss um 1 erhöht werden
    expect(prisma.orderItem.update).toHaveBeenCalledWith({
      where: { id: "item-1" },
      data: { paidQuantity: 1 },
    });

    // Payment muss mit Kassensitzung erfasst werden
    expect(prisma.payment.createMany).toHaveBeenCalledWith({
      data: [
        {
          orderId: "order-1",
          amount: 1200,
          method: "CASH",
          status: "COMPLETED",
          cashierSessionId: "session-kellner-1",
        },
      ],
    });

    // Status der Bestellung muss PARTIALLY_PAID werden
    expect(prisma.order.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "order-1" },
        data: { paymentStatus: "PARTIALLY_PAID" },
      }),
    );

    // Audit-Log muss geschrieben werden
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "ORDER_SPLIT_PAYMENT",
        entityId: "order-1",
        userId: "user-kellner",
        details: expect.objectContaining({
          amountPaid: 1200,
          newPaymentStatus: "PARTIALLY_PAID",
          cashierSessionId: "session-kellner-1",
        }),
      }),
    });

    expect(result.paymentStatus).toBe("PARTIALLY_PAID");
  });

  it("schließt die Bestellung mit Status PAID ab, wenn alle verbleibenden Positionen beglichen werden", async () => {
    // Vorheriger Stand: 1x Schnitzel bereits bezahlt
    prisma.order.findUnique.mockResolvedValueOnce({
      ...mockOrder,
      paymentStatus: "PARTIALLY_PAID",
      items: [
        { ...mockItem1, paidQuantity: 1 },
        { ...mockItem2, paidQuantity: 0 },
      ],
      payments: [{ amount: 1200, method: "CASH" }],
    });

    prisma.cashierSession.findFirst.mockResolvedValueOnce({
      id: "session-kellner-2",
      userId: "user-kellner-2",
      eventId: "evt-1",
      status: "ACTIVE",
    });

    prisma.order.update.mockResolvedValueOnce({
      ...mockOrder,
      paymentStatus: "PAID",
      items: [
        { ...mockItem1, paidQuantity: 2 },
        { ...mockItem2, paidQuantity: 3 },
      ],
      payments: [
        { amount: 1200, method: "CASH" },
        { amount: 2550, method: "CARD" },
      ],
    });

    // Gast 2 zahlt restliches 1x Schnitzel (1200) + 3x Bier (1350) = 2550 Cent per Karte
    const result = await service.splitPaymentOrder(
      "order-1",
      [
        { orderItemId: "item-1", quantity: 1 },
        { orderItemId: "item-2", quantity: 3 },
      ],
      [{ amount: 2550, method: "CARD" }],
      "user-kellner-2",
    );

    expect(prisma.orderItem.update).toHaveBeenCalledWith({
      where: { id: "item-1" },
      data: { paidQuantity: 2 },
    });
    expect(prisma.orderItem.update).toHaveBeenCalledWith({
      where: { id: "item-2" },
      data: { paidQuantity: 3 },
    });

    expect(prisma.order.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "order-1" },
        data: { paymentStatus: "PAID" },
      }),
    );

    expect(result.paymentStatus).toBe("PAID");
  });

  it("lehnt Teilzahlungen ab, wenn die Menge die offene Restmenge übersteigt", async () => {
    prisma.order.findUnique.mockResolvedValueOnce({
      ...mockOrder,
      items: [
        { ...mockItem1, quantity: 2, paidQuantity: 1 }, // nur noch 1 offen
        { ...mockItem2, quantity: 3, paidQuantity: 0 },
      ],
    });

    // Versuch, 2x Schnitzel zu bezahlen, obwohl nur noch 1 offen ist
    await expect(
      service.splitPaymentOrder(
        "order-1",
        [{ orderItemId: "item-1", quantity: 2 }],
        [{ amount: 2400, method: "CASH" }],
        "user-kellner",
      ),
    ).rejects.toThrow(BadRequestException);

    expect(prisma.orderItem.update).not.toHaveBeenCalled();
    expect(prisma.payment.createMany).not.toHaveBeenCalled();
  });

  it("lehnt Teilzahlungen ab, wenn Zahlbetrag und berechneter Positionswert nicht übereinstimmen", async () => {
    prisma.order.findUnique.mockResolvedValueOnce({
      ...mockOrder,
      items: [
        { ...mockItem1, quantity: 2, paidQuantity: 0 },
        { ...mockItem2, quantity: 3, paidQuantity: 0 },
      ],
    });

    // 1x Schnitzel kostet 1200 Cent, übergeben werden aber 1000 Cent
    await expect(
      service.splitPaymentOrder(
        "order-1",
        [{ orderItemId: "item-1", quantity: 1 }],
        [{ amount: 1000, method: "CASH" }],
        "user-kellner",
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it("lehnt Teilzahlungen ab, wenn die Position nicht zur Bestellung gehört", async () => {
    prisma.order.findUnique.mockResolvedValueOnce({
      ...mockOrder,
      items: [{ ...mockItem1 }],
    });

    await expect(
      service.splitPaymentOrder(
        "order-1",
        [{ orderItemId: "foreign-item-id", quantity: 1 }],
        [{ amount: 1200, method: "CASH" }],
        "user-kellner",
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it("lehnt Teilzahlungen für bereits bezahlte oder stornierte Bestellungen ab", async () => {
    prisma.order.findUnique.mockResolvedValueOnce({
      ...mockOrder,
      paymentStatus: "PAID",
    });

    await expect(
      service.splitPaymentOrder(
        "order-1",
        [{ orderItemId: "item-1", quantity: 1 }],
        [{ amount: 1200, method: "CASH" }],
        "user-kellner",
      ),
    ).rejects.toThrow("bereits vollständig bezahlt");

    prisma.order.findUnique.mockResolvedValueOnce({
      ...mockOrder,
      lifecycleStatus: "CANCELLED",
      paymentStatus: "OPEN",
    });

    await expect(
      service.splitPaymentOrder(
        "order-1",
        [{ orderItemId: "item-1", quantity: 1 }],
        [{ amount: 1200, method: "CASH" }],
        "user-kellner",
      ),
    ).rejects.toThrow("stornierte Bestellung");
  });
});
