import { ROLES_KEY } from "../common/decorators/roles.decorator";
import { OrdersController } from "./orders.controller";

describe("OrdersController – Bonkassen-Vertrag für Issue #52", () => {
  const service = {
    getQuickSaleContext: jest.fn(),
    createQuickSale: jest.fn(),
  };
  let controller: OrdersController;

  beforeEach(() => {
    jest.resetAllMocks();
    controller = new OrdersController(service as any);
  });

  it("verwendet für Kontext und Verkauf ausschließlich die JWT-Identität", async () => {
    service.getQuickSaleContext.mockResolvedValue([]);
    service.createQuickSale.mockResolvedValue({ order: { id: "order-1" } });
    const request = { user: { userId: "cashier-1", role: "CASHIER" } };
    const body = {
      eventId: "event-1",
      idempotencyKey: "quick-sale-1234",
      items: [{ productId: "product-1", quantity: 1 }],
      paymentMethod: "CASH" as const,
      tenderedAmount: 500,
    };

    await controller.getQuickSaleContext(request);
    await controller.createQuickSale(request, body);

    expect(service.getQuickSaleContext).toHaveBeenCalledWith("cashier-1");
    expect(service.createQuickSale).toHaveBeenCalledWith("cashier-1", body);
  });

  it.each(["getQuickSaleContext", "createQuickSale"] as const)(
    "schützt %s im Backend mit CASHIER und ADMINISTRATOR",
    (method) => {
      expect(Reflect.getMetadata(ROLES_KEY, controller[method])).toEqual([
        "ADMINISTRATOR",
        "CASHIER",
      ]);
    },
  );
});
