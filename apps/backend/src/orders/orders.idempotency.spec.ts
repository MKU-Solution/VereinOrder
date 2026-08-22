import { BadRequestException } from "@nestjs/common";
import { OrdersService } from "./orders.service";
import { createAuditServiceStub } from "./test-support/audit-service.stub";

// Regressionstests fuer Issue #86: der Idempotenz-Kurzschluss von
// createOrder darf eine vorhandene Bestellung nur zurueckgeben, wenn
// Benutzer, Veranstaltung, Positionen und Zahlungen tatsaechlich der
// Anfrage entsprechen. Bei Abweichung muss abgelehnt werden, ohne Inhalt
// der fremden Bestellung preiszugeben.
describe("OrdersService – Idempotenzpruefung von createOrder für Issue #86", () => {
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

  const existingOrderBase = {
    id: "order-existing",
    userId: "waiter-1",
    eventId: "event-1",
    items: [
      {
        productId: "product-1",
        quantity: 2,
        variantId: null,
        extras: null,
        product,
      },
      {
        productId: "product-2",
        quantity: 1,
        variantId: "variant-a",
        extras: [{ id: "extra-1", name: "Extra", price: 50 }],
        product: { ...product, id: "product-2" },
      },
    ],
    payments: [
      { amount: 700, method: "CASH" },
      { amount: 100, method: "CARD" },
    ],
  };

  const createPrisma = (existingOrder: any) => {
    const prisma: any = {
      $transaction: jest.fn((callback) => callback(prisma)),
      $queryRaw: jest
        .fn()
        .mockResolvedValue([{ status: "TEST_MODE", testMode: true }]),
      product: { findMany: jest.fn().mockResolvedValue([product]) },
      area: { findFirst: jest.fn() },
      cashierSession: { findFirst: jest.fn().mockResolvedValue(null) },
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: "waiter-1",
          username: "kellner1",
          isActive: true,
        }),
      },
      order: {
        findUnique: jest.fn().mockResolvedValue(existingOrder),
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

  // Eine tatsaechlich identische Wiederholung mit denselben Positionen
  // (einschließlich Auswahlkennungen) und Zahlungen liefert weiterhin die
  // vorhandene Bestellung und legt keine zweite an.
  it("liefert bei einer echten Wiederholung derselben Anfrage die vorhandene Bestellung zurück", async () => {
    const prisma = createPrisma(existingOrderBase);
    const service = new OrdersService(prisma, createAuditServiceStub() as any);

    const result = await service.createOrder("waiter-1", {
      eventId: "event-1",
      idempotencyKey: "same-request-key",
      items: [
        { productId: "product-1", quantity: 2 },
        {
          productId: "product-2",
          quantity: 1,
          optionIds: ["variant-a", "extra-1"],
        },
      ],
      payments: [
        { amount: 100, method: "CARD" },
        { amount: 700, method: "CASH" },
      ],
    });

    expect(result).toBe(existingOrderBase);
    expect(prisma.order.create).not.toHaveBeenCalled();
  });

  // Reihenfolge der Positionen, sowie der Auswahlkennungen innerhalb einer
  // Position, darf die Wiedererkennung nicht verhindern.
  it("erkennt dieselben Positionen unabhängig von deren Reihenfolge als dieselbe Anfrage", async () => {
    const prisma = createPrisma(existingOrderBase);
    const service = new OrdersService(prisma, createAuditServiceStub() as any);

    const result = await service.createOrder("waiter-1", {
      eventId: "event-1",
      idempotencyKey: "same-request-key",
      items: [
        {
          productId: "product-2",
          quantity: 1,
          optionIds: ["extra-1", "variant-a"],
        },
        { productId: "product-1", quantity: 2 },
      ],
      payments: [
        { amount: 700, method: "CASH" },
        { amount: 100, method: "CARD" },
      ],
    });

    expect(result).toBe(existingOrderBase);
    expect(prisma.order.create).not.toHaveBeenCalled();
  });

  it("weist eine Anfrage mit demselben Schlüssel, aber fremdem Benutzer zurück", async () => {
    const prisma = createPrisma(existingOrderBase);
    const service = new OrdersService(prisma, createAuditServiceStub() as any);

    await expect(
      service.createOrder("other-user", {
        eventId: "event-1",
        idempotencyKey: "same-request-key",
        items: [
          { productId: "product-1", quantity: 2 },
          {
            productId: "product-2",
            quantity: 1,
            optionIds: ["variant-a", "extra-1"],
          },
        ],
        payments: [
          { amount: 700, method: "CASH" },
          { amount: 100, method: "CARD" },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.order.create).not.toHaveBeenCalled();
  });

  it("weist eine Anfrage mit demselben Schlüssel, aber abweichender Veranstaltung zurück", async () => {
    const prisma = createPrisma(existingOrderBase);
    const service = new OrdersService(prisma, createAuditServiceStub() as any);

    await expect(
      service.createOrder("waiter-1", {
        eventId: "event-2",
        idempotencyKey: "same-request-key",
        items: [
          { productId: "product-1", quantity: 2 },
          {
            productId: "product-2",
            quantity: 1,
            optionIds: ["variant-a", "extra-1"],
          },
        ],
        payments: [
          { amount: 700, method: "CASH" },
          { amount: 100, method: "CARD" },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.order.create).not.toHaveBeenCalled();
  });

  it("weist eine Anfrage mit demselben Schlüssel, aber abweichenden Positionen zurück", async () => {
    const prisma = createPrisma(existingOrderBase);
    const service = new OrdersService(prisma, createAuditServiceStub() as any);

    await expect(
      service.createOrder("waiter-1", {
        eventId: "event-1",
        idempotencyKey: "same-request-key",
        items: [{ productId: "product-1", quantity: 3 }],
        payments: [
          { amount: 700, method: "CASH" },
          { amount: 100, method: "CARD" },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.order.create).not.toHaveBeenCalled();
  });

  it("weist eine Anfrage mit demselben Schlüssel, aber abweichenden Zahlungen zurück", async () => {
    const prisma = createPrisma(existingOrderBase);
    const service = new OrdersService(prisma, createAuditServiceStub() as any);

    await expect(
      service.createOrder("waiter-1", {
        eventId: "event-1",
        idempotencyKey: "same-request-key",
        items: [
          { productId: "product-1", quantity: 2 },
          {
            productId: "product-2",
            quantity: 1,
            optionIds: ["variant-a", "extra-1"],
          },
        ],
        payments: [{ amount: 800, method: "CASH" }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.order.create).not.toHaveBeenCalled();
  });

  // Die Ablehnung darf keinen Inhalt der fremden Bestellung nennen - weder
  // Betrag, noch Produktname, noch Benutzer.
  it("nennt bei Ablehnung keinen Inhalt der fremden Bestellung", async () => {
    const prisma = createPrisma(existingOrderBase);
    const service = new OrdersService(prisma, createAuditServiceStub() as any);

    await expect(
      service.createOrder("other-user", {
        eventId: "event-1",
        idempotencyKey: "same-request-key",
        items: [{ productId: "product-1", quantity: 99 }],
        payments: [{ amount: 12345, method: "CARD" }],
      }),
    ).rejects.toThrow(/idempotencyKey is already in use/);

    try {
      await service.createOrder("other-user", {
        eventId: "event-1",
        idempotencyKey: "same-request-key",
        items: [{ productId: "product-1", quantity: 99 }],
        payments: [{ amount: 12345, method: "CARD" }],
      });
      throw new Error("expected rejection");
    } catch (error) {
      const message = (error as Error).message;
      expect(message).not.toContain("waiter-1");
      expect(message).not.toContain("Saft");
      expect(message).not.toContain("700");
      expect(message).not.toContain(existingOrderBase.id);
    }
  });
});
