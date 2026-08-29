import { OrdersService } from "./orders.service";
import { createAuditServiceStub } from "./test-support/audit-service.stub";

describe("OrdersService – Produktbons bei Storno", () => {
  let prisma: any;
  let service: OrdersService;

  beforeEach(() => {
    prisma = {
      $transaction: jest.fn((callback) => callback(prisma)),
      order: {
        findUnique: jest.fn().mockResolvedValue({
          id: "order-1",
          orderNumber: 7,
          lifecycleStatus: "SUBMITTED",
          totalAmount: 900,
          payments: [{ id: "payment-1" }],
          items: [{ id: "item-1" }],
        }),
        update: jest.fn().mockResolvedValue({ id: "order-1" }),
      },
      orderItem: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      productVoucher: {
        updateMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    service = new OrdersService(prisma, createAuditServiceStub() as any);
  });

  it("annulliert nur noch nicht eingelöste Bons und protokolliert ihre Anzahl", async () => {
    await service.cancelOrder("order-1", "Fehlbon", "admin-1");

    expect(prisma.productVoucher.updateMany).toHaveBeenCalledWith({
      where: { orderId: "order-1", status: "ISSUED" },
      data: { status: "CANCELLED" },
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "CANCEL_ORDER",
        details: expect.objectContaining({ vouchersCancelled: 2 }),
      }),
    });
  });

  it("delegiert den Vollstorno an die zentrale Bestandsumkehr", async () => {
    const inventory = {
      reverseSales: jest.fn().mockResolvedValue([
        {
          productId: "product-1",
          stockQuantity: 8,
          lowStockThreshold: 2,
          version: 3,
          manualAvailability: "AVAILABLE",
        },
      ]),
      publishChanges: jest.fn(),
    };
    prisma.$queryRaw = jest.fn().mockResolvedValue([{ id: "order-1" }]);
    prisma.order.findUnique.mockResolvedValue({
      id: "order-1",
      eventId: "event-1",
      dataMode: "TEST",
      lifecycleStatus: "SUBMITTED",
      totalAmount: 900,
      payments: [],
      items: [{ id: "item-1" }],
    });
    prisma.order.update.mockResolvedValue({
      id: "order-1",
      eventId: "event-1",
      dataMode: "TEST",
    });
    service = new OrdersService(
      prisma,
      createAuditServiceStub() as any,
      inventory as any,
    );

    await service.cancelOrder("order-1", "Fehlbon", "admin-1");

    expect(inventory.reverseSales).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        eventId: "event-1",
        dataMode: "TEST",
        orderItemIds: ["item-1"],
      }),
    );
    expect(inventory.publishChanges).toHaveBeenCalledWith(
      "event-1",
      "TEST",
      expect.any(Array),
    );
  });
});
