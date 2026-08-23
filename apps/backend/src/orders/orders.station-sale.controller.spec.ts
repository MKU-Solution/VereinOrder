import { BadRequestException } from "@nestjs/common";
import { ROLES_KEY } from "../common/decorators/roles.decorator";
import { OrdersController } from "./orders.controller";

// Issue #66, Stationskasse: ein gemeinsamer Weg im Service
// (OrdersService.createQuickSale/getQuickSaleContext), aber zwei getrennte
// Endpunkte für die Rollenmatrix (docs/development/stationskasse.md,
// Abschnitt 2). STATION darf /orders/station-sale erreichen, aber nicht
// /orders/quick-sale - sonst wäre die zentrale Bonkasse für die Rolle
// erreichbar, obwohl darunter derselbe Code läuft.
describe("OrdersController – Stationsverkauf für Issue #66", () => {
  const service = {
    getQuickSaleContext: jest.fn(),
    createQuickSale: jest.fn(),
    getStationSaleContext: jest.fn(),
  };
  let controller: OrdersController;

  beforeEach(() => {
    jest.resetAllMocks();
    controller = new OrdersController(service as any);
  });

  it("lässt /orders/quick-sale bei ADMINISTRATOR und CASHIER, STATION bleibt ausgeschlossen", () => {
    expect(Reflect.getMetadata(ROLES_KEY, controller.createQuickSale)).toEqual([
      "ADMINISTRATOR",
      "CASHIER",
    ]);
    expect(
      Reflect.getMetadata(ROLES_KEY, controller.getQuickSaleContext),
    ).toEqual(["ADMINISTRATOR", "CASHIER"]);
  });

  it.each(["getStationSaleContext", "createStationSale"] as const)(
    "öffnet %s zusätzlich für STATION",
    (method) => {
      expect(
        Reflect.getMetadata(ROLES_KEY, (controller as any)[method]),
      ).toEqual(["ADMINISTRATOR", "CASHIER", "STATION"]);
    },
  );

  it("leitet den Stationsverkauf unverändert an createQuickSale weiter", async () => {
    service.createQuickSale.mockResolvedValue({ order: { id: "order-1" } });
    const request = { user: { userId: "station-user-1", role: "STATION" } };
    const body = {
      eventId: "event-1",
      idempotencyKey: "station-sale-1234",
      items: [{ productId: "product-1", quantity: 1 }],
      paymentMethod: "CASH" as const,
      tenderedAmount: 500,
      stationId: "station-grill",
    };

    await controller.createStationSale(request, body);

    expect(service.createQuickSale).toHaveBeenCalledWith(
      "station-user-1",
      body,
    );
  });

  it("leitet den Stationskontext unverändert an getStationSaleContext weiter", async () => {
    service.getStationSaleContext.mockResolvedValue([]);
    const request = { user: { userId: "station-user-1", role: "STATION" } };

    await controller.getStationSaleContext(request);

    expect(service.getStationSaleContext).toHaveBeenCalledWith(
      "station-user-1",
    );
  });

  it("weist ein stationId im Rumpf von /quick-sale ab, statt es stillschweigend zu ignorieren", async () => {
    const request = { user: { userId: "cashier-1", role: "CASHIER" } };
    const body: any = {
      eventId: "event-1",
      idempotencyKey: "quick-sale-1234",
      items: [{ productId: "product-1", quantity: 1 }],
      paymentMethod: "CASH",
      tenderedAmount: 500,
      stationId: "station-grill",
    };

    await expect(
      controller.createQuickSale(request, body),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(service.createQuickSale).not.toHaveBeenCalled();
  });

  it("lässt /orders/quick-sale ohne stationId unverändert durch", async () => {
    service.createQuickSale.mockResolvedValue({ order: { id: "order-1" } });
    const request = { user: { userId: "cashier-1", role: "CASHIER" } };
    const body = {
      eventId: "event-1",
      idempotencyKey: "quick-sale-1234",
      items: [{ productId: "product-1", quantity: 1 }],
      paymentMethod: "CASH" as const,
      tenderedAmount: 500,
    };

    await controller.createQuickSale(request, body);

    expect(service.createQuickSale).toHaveBeenCalledWith("cashier-1", body);
  });
});
