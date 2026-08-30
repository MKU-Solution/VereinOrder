import { BadRequestException } from "@nestjs/common";
import { ORDER_REJECTION_CODES } from "@vereinorder/shared";
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

  it("weist Produkte eines anderen Events innerhalb der Schreibtransaktion zurück", async () => {
    const prisma = createPrisma({ status: "TEST_MODE", testMode: true });
    prisma.product.findMany.mockResolvedValue([]);
    const service = new OrdersService(prisma, createAuditServiceStub() as any);

    const promise = service.createOrder("waiter-1", {
      eventId: "event-1",
      items: [{ productId: "foreign-product", quantity: 1 }],
    });
    await expect(promise).rejects.toBeInstanceOf(BadRequestException);
    await expect(promise).rejects.toMatchObject({
      response: expect.objectContaining({
        code: ORDER_REJECTION_CODES.PRODUCT_UNAVAILABLE,
      }),
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.order.create).not.toHaveBeenCalled();
  });

  it.each([
    { status: "PLANNED", testMode: false },
    { status: "COMPLETED", testMode: false },
    { status: "ACTIVE", testMode: true },
    { status: "TEST_MODE", testMode: false },
  ])(
    "kennzeichnet den nicht bestellbaren Eventzustand $status/$testMode als EVENT_MODE",
    async (event) => {
      const prisma = createPrisma(event);
      const service = new OrdersService(
        prisma,
        createAuditServiceStub() as any,
      );
      const promise = service.createOrder("waiter-1", {
        eventId: "event-1",
        items: [{ productId: "product-1", quantity: 1 }],
      });

      await expect(promise).rejects.toMatchObject({
        response: expect.objectContaining({
          code: ORDER_REJECTION_CODES.EVENT_MODE,
        }),
      });
      expect(prisma.order.create).not.toHaveBeenCalled();
    },
  );

  it("kennzeichnet ein ausverkauftes Produkt als PRODUCT_UNAVAILABLE", async () => {
    const prisma = createPrisma({ status: "TEST_MODE", testMode: true });
    prisma.product.findMany.mockResolvedValue([
      { ...product, availability: "OUT_OF_STOCK" },
    ]);
    const service = new OrdersService(prisma, createAuditServiceStub() as any);

    await expect(
      service.createOrder("waiter-1", {
        eventId: "event-1",
        items: [{ productId: "product-1", quantity: 1 }],
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: ORDER_REJECTION_CODES.PRODUCT_UNAVAILABLE,
      }),
    });
    expect(prisma.order.create).not.toHaveBeenCalled();
  });

  it("kennzeichnet ein inzwischen gesperrtes Benutzerkonto als FORBIDDEN", async () => {
    const prisma = createPrisma({ status: "TEST_MODE", testMode: true });
    prisma.user.findUnique.mockResolvedValue({
      id: "waiter-1",
      username: "kellner1",
      isActive: false,
    });
    const service = new OrdersService(prisma, createAuditServiceStub() as any);

    await expect(
      service.createOrder("waiter-1", {
        eventId: "event-1",
        items: [{ productId: "product-1", quantity: 1 }],
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: ORDER_REJECTION_CODES.FORBIDDEN,
      }),
    });
    expect(prisma.order.create).not.toHaveBeenCalled();
  });

  // Belegt Befund 2 aus der Pruefung der Projektleitung: eine doppelt
  // angegebene optionId darf nicht still entdoppelt werden, sonst zaehlt
  // sie in einer MULTIPLE-Gruppe ohne maxSelect doppelt und verdoppelt den
  // Aufpreis. Die Ablehnung greift innerhalb derselben Transaktion wie der
  // spätere Write und lässt dadurch keine Teilbuchung zurück.
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
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.order.create).not.toHaveBeenCalled();
  });
});

describe("OrdersService – Kassenkontext (getQuickSaleContext)", () => {
  // Issue #152: vor der zentralen Ableitung (resolveOperationalDataMode)
  // fiel eine unmoegliche status/testMode-Kombination hier still auf
  // dataMode=undefined zurueck. Kein Bestandssatz traegt dieses "undefined",
  // also fand die Bestandssuche nie einen Treffer, und die effektive
  // Verfuegbarkeit fiel auf den rohen manuellen Uebersteuerungswert zurueck
  // - ein ausverkauftes Produkt erschien der Kasse als verfuegbar. Der
  // Kassenkontext muss diesen Zustand jetzt laut ablehnen.
  it("weist eine unmögliche status/testMode-Kombination im Kassenkontext ab, statt Bestand stillschweigend zu ignorieren", async () => {
    const prisma: any = {
      event: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "event-1",
            name: "Testfest",
            status: "ACTIVE",
            testMode: true,
            products: [],
          },
        ]),
      },
      cashierSession: { findMany: jest.fn().mockResolvedValue([]) },
      printer: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const service = new OrdersService(prisma, createAuditServiceStub() as any);

    await expect(service.getQuickSaleContext("waiter-1")).rejects.toThrow(
      BadRequestException,
    );
  });
});
