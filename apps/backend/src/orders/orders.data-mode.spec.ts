import { BadRequestException } from "@nestjs/common";
import { OrdersService } from "./orders.service";
import { createAuditServiceStub } from "./test-support/audit-service.stub";

describe("OrdersService – eventgebundener Betriebsmodus", () => {
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

  const createPrisma = (event: { status: string; testMode: boolean }) => {
    const prisma: any = {
      $transaction: jest.fn((callback) => callback(prisma)),
      $queryRaw: jest.fn().mockResolvedValue([{ ...event }]),
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
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({
            id: "order-1",
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

  it.each([
    { status: "TEST_MODE", testMode: true, expected: "TEST" },
    { status: "ACTIVE", testMode: false, expected: "LIVE" },
  ])(
    "setzt für $status explizit $expected",
    async ({ status, testMode, expected }) => {
      const prisma = createPrisma({ status, testMode });
      const service = new OrdersService(
        prisma,
        createAuditServiceStub() as any,
      );

      await service.createOrder("waiter-1", {
        eventId: "event-1",
        items: [{ productId: "product-1", quantity: 1 }],
      });

      expect(prisma.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ eventId: "event-1" }),
        }),
      );
      expect(prisma.order.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            eventId: "event-1",
            dataMode: expected,
          }),
        }),
      );
    },
  );

  it("weist Produkte eines anderen Events vor der Transaktion zurück", async () => {
    const prisma = createPrisma({ status: "TEST_MODE", testMode: true });
    prisma.product.findMany.mockResolvedValue([]);
    const service = new OrdersService(prisma, createAuditServiceStub() as any);

    await expect(
      service.createOrder("waiter-1", {
        eventId: "event-1",
        items: [{ productId: "foreign-product", quantity: 1 }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.order.create).not.toHaveBeenCalled();
  });

  // Belegt Befund 2 aus der Pruefung der Projektleitung: eine doppelt
  // angegebene optionId darf nicht still entdoppelt werden, sonst zaehlt
  // sie in einer MULTIPLE-Gruppe ohne maxSelect doppelt und verdoppelt den
  // Aufpreis. Die Ablehnung greift schon vor der Transaktion, weil
  // resolveOrderItemPricing beim Aufbau von orderItemsData ausgefuehrt wird.
  it("weist eine doppelt angegebene Antwortkennung ab, statt den Aufpreis stillschweigend zu verdoppeln", async () => {
    const productWithToppings = {
      ...product,
      optionGroups: [
        {
          id: "group-toppings",
          name: "Toppings",
          minSelect: 0,
          maxSelect: null,
          priceMode: "SURCHARGE",
          options: [
            {
              id: "option-cheese",
              name: "Käse",
              priceEffect: 100,
              isActive: true,
            },
          ],
        },
      ],
    };
    const prisma = createPrisma({ status: "TEST_MODE", testMode: true });
    prisma.product.findMany.mockResolvedValue([productWithToppings]);
    const service = new OrdersService(prisma, createAuditServiceStub() as any);

    await expect(
      service.createOrder("waiter-1", {
        eventId: "event-1",
        items: [
          {
            productId: "product-1",
            quantity: 1,
            optionIds: ["option-cheese", "option-cheese"],
          },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.order.create).not.toHaveBeenCalled();
  });
});
