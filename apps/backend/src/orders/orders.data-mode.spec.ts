import { BadRequestException } from "@nestjs/common";
import { OrdersService } from "./orders.service";

describe("OrdersService – eventgebundener Betriebsmodus", () => {
  const product = {
    id: "product-1",
    eventId: "event-1",
    name: "Saft",
    price: 350,
    availability: "AVAILABLE",
    variants: [],
    extras: [],
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
      const service = new OrdersService(prisma);

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
    const service = new OrdersService(prisma);

    await expect(
      service.createOrder("waiter-1", {
        eventId: "event-1",
        items: [{ productId: "foreign-product", quantity: 1 }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.order.create).not.toHaveBeenCalled();
  });
});
