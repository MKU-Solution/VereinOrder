import { ConflictException } from "@nestjs/common";
import { OrdersService } from "./orders.service";
import { createAuditServiceStub } from "./test-support/audit-service.stub";

// Regressionstests fuer Issue #65, Abschnitt 8 Punkt 5 (Befund B7):
// createOrder verlangte bisher keine passende Kassensitzung - eine
// Vormerkung, die waehrend Sitzung X erfasst und nach deren Abschluss
// uebertragen wird, landete stillschweigend ohne Sitzung. Jetzt: ist
// cashierSessionId gesetzt, muss sie der heute aktiven Sitzung des
// Benutzers fuer diese Veranstaltung entsprechen, sonst ConflictException.
// Fehlt das Feld, bleibt das heutige Verhalten unveraendert.
describe("OrdersService – erfasste Kassensitzung in createOrder für Issue #65", () => {
  const product = {
    id: "product-1",
    eventId: "event-1",
    name: "Saft",
    price: 350,
    availability: "AVAILABLE",
    optionGroups: [],
    categoryId: "category-1",
    category: { id: "category-1", name: "Getränke", targetStationId: null },
    targetStationId: null,
  };

  const createPrisma = (
    activeSession: { id: string; dataMode: string } | null,
  ) => {
    const prisma: any = {
      $transaction: jest.fn((callback) => callback(prisma)),
      $queryRaw: jest
        .fn()
        .mockResolvedValue([{ status: "TEST_MODE", testMode: true }]),
      product: { findMany: jest.fn().mockResolvedValue([product]) },
      area: { findFirst: jest.fn() },
      cashierSession: { findFirst: jest.fn().mockResolvedValue(activeSession) },
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: "waiter-1",
          username: "kellner1",
          isActive: true,
        }),
      },
      order: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({
            id: "order-new",
            orderNumber: 1,
            createdAt: new Date(),
            ...data,
            items: [{ id: "item-1", quantity: 1, priceAtTime: 350, product }],
            payments: [],
          }),
        ),
      },
      event: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: "event-1", name: "Testfest" }),
      },
      printer: { findFirst: jest.fn().mockResolvedValue(null) },
      station: { findMany: jest.fn().mockResolvedValue([]) },
    };
    return prisma;
  };

  it("bucht ohne cashierSessionId im Auftrag weiterhin unverändert, auch ohne aktive Sitzung", async () => {
    const prisma = createPrisma(null);
    const service = new OrdersService(prisma, createAuditServiceStub() as any);

    const result = await service.createOrder("waiter-1", {
      eventId: "event-1",
      items: [{ productId: "product-1", quantity: 1 }],
    });

    expect(prisma.order.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ cashierSessionId: null }),
      }),
    );
    expect(result).toBeDefined();
  });

  it("akzeptiert eine erfasste Kassensitzung, die noch aktiv ist", async () => {
    const prisma = createPrisma({ id: "session-1", dataMode: "TEST" });
    const service = new OrdersService(prisma, createAuditServiceStub() as any);

    await service.createOrder("waiter-1", {
      eventId: "event-1",
      items: [{ productId: "product-1", quantity: 1 }],
      cashierSessionId: "session-1",
    });

    expect(prisma.order.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ cashierSessionId: "session-1" }),
      }),
    );
  });

  it("weist eine erfasste Kassensitzung zurück, die inzwischen geschlossen wurde", async () => {
    const prisma = createPrisma(null);
    const service = new OrdersService(prisma, createAuditServiceStub() as any);

    await expect(
      service.createOrder("waiter-1", {
        eventId: "event-1",
        items: [{ productId: "product-1", quantity: 1 }],
        cashierSessionId: "session-that-is-now-closed",
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.order.create).not.toHaveBeenCalled();
  });

  it("weist eine erfasste Kassensitzung zurück, die durch eine andere ersetzt wurde", async () => {
    const prisma = createPrisma({ id: "session-2", dataMode: "TEST" });
    const service = new OrdersService(prisma, createAuditServiceStub() as any);

    await expect(
      service.createOrder("waiter-1", {
        eventId: "event-1",
        items: [{ productId: "product-1", quantity: 1 }],
        cashierSessionId: "session-1",
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.order.create).not.toHaveBeenCalled();
  });
});
