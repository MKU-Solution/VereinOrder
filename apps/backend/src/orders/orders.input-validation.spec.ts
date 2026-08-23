import { BadRequestException } from "@nestjs/common";
import { ORDER_REJECTION_CODES } from "@vereinorder/shared";
import { OrdersService } from "./orders.service";
import { createAuditServiceStub } from "./test-support/audit-service.stub";

describe("OrdersService – Eingabegrenzen und Atomizität", () => {
  it("legt bei einer negativen Zahlung in createOrder keinerlei Datensatz an", async () => {
    const prisma = { $transaction: jest.fn(), order: { create: jest.fn() } };
    const service = new OrdersService(
      prisma as any,
      createAuditServiceStub() as any,
    );

    const promise = service.createOrder("waiter-1", {
      eventId: "event-1",
      items: [{ productId: "product-1", quantity: 1 }],
      payments: [{ amount: -1, method: "CASH" }],
    });
    await expect(promise).rejects.toBeInstanceOf(BadRequestException);
    await expect(promise).rejects.toMatchObject({
      response: expect.objectContaining({
        code: ORDER_REJECTION_CODES.VALIDATION,
      }),
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.order.create).not.toHaveBeenCalled();
  });

  it.each([
    { payments: [{ amount: -1, method: "CASH" as const }] },
    { payments: [{ amount: 2_147_483_648, method: "CARD" as const }] },
    {
      payments: [
        { amount: 2_147_483_647, method: "CASH" as const },
        { amount: 1, method: "CARD" as const },
      ],
    },
  ])(
    "weist ungültige Zahlung(en) vor dem Öffnen der Transaktion ab",
    async ({ payments }) => {
      const prisma = { $transaction: jest.fn() };
      const service = new OrdersService(
        prisma as any,
        createAuditServiceStub() as any,
      );

      await expect(
        service.addPaymentsToOrder("order-1", payments, "cashier-1"),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    },
  );

  it("schreibt bei Überlauf zusammen mit bestehenden Zahlungen weder Zahlung noch Bestellung", async () => {
    const prisma: any = {
      $transaction: jest.fn((callback) => callback(prisma)),
      order: {
        findUnique: jest.fn().mockResolvedValue({
          id: "order-1",
          totalAmount: 2_147_483_647,
          paymentStatus: "OPEN",
          payments: [{ amount: 2_147_483_647 }],
        }),
        update: jest.fn(),
      },
      payment: { createMany: jest.fn() },
    };
    const service = new OrdersService(prisma, createAuditServiceStub() as any);

    await expect(
      service.addPaymentsToOrder(
        "order-1",
        [{ amount: 1, method: "CASH" }],
        "cashier-1",
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.payment.createMany).not.toHaveBeenCalled();
    expect(prisma.order.update).not.toHaveBeenCalled();
  });

  it("lehnt ein eventfremdes Produkt innerhalb der Schreibtransaktion vollständig ab", async () => {
    const prisma: any = {
      $transaction: jest.fn((callback) => callback(prisma)),
      $queryRaw: jest
        .fn()
        .mockResolvedValue([{ status: "TEST_MODE", testMode: true }]),
      product: { findMany: jest.fn().mockResolvedValue([]) },
      order: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
      },
    };
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

  it("lehnt einen eventfremden Bereich vor dem Order-Write vollständig ab", async () => {
    const product = {
      id: "product-1",
      name: "Saft",
      price: 300,
      availability: "AVAILABLE",
      optionGroups: [],
    };
    const prisma: any = {
      $transaction: jest.fn((callback) => callback(prisma)),
      $queryRaw: jest
        .fn()
        .mockResolvedValue([{ status: "TEST_MODE", testMode: true }]),
      product: { findMany: jest.fn().mockResolvedValue([product]) },
      area: { findFirst: jest.fn().mockResolvedValue(null) },
      order: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
      },
    };
    const service = new OrdersService(prisma, createAuditServiceStub() as any);

    const promise = service.createOrder("waiter-1", {
      eventId: "event-1",
      areaId: "foreign-area",
      items: [{ productId: product.id, quantity: 1 }],
    });
    await expect(promise).rejects.toBeInstanceOf(BadRequestException);
    await expect(promise).rejects.toMatchObject({
      response: expect.objectContaining({
        code: ORDER_REJECTION_CODES.VALIDATION,
      }),
    });
    expect(prisma.order.create).not.toHaveBeenCalled();
  });
});
