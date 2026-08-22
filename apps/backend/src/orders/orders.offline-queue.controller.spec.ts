import { ROLES_KEY } from "../common/decorators/roles.decorator";
import { OrdersController } from "./orders.controller";

// Vertragstests fuer die beiden neuen Endpunkte aus Issue #65, Abschnitt 8
// Punkte 1 und 2: der Controller muss die JWT-Identitaet (userId, role)
// unveraendert an den Service durchreichen und mit den vorgesehenen Rollen
// geschuetzt sein.
describe("OrdersController – Offline-Warteschlange für Issue #65", () => {
  const service = {
    getOrderByIdempotencyKey: jest.fn(),
    discardOfflineQueueEntry: jest.fn(),
  };
  let controller: OrdersController;

  beforeEach(() => {
    jest.resetAllMocks();
    controller = new OrdersController(service as any);
  });

  it("reicht userId und role an getOrderByIdempotencyKey weiter", async () => {
    service.getOrderByIdempotencyKey.mockResolvedValue({ id: "order-1" });
    const request = { user: { userId: "waiter-1", role: "WAITER" } };

    await controller.getOrderByIdempotencyKey(request, "some-key");

    expect(service.getOrderByIdempotencyKey).toHaveBeenCalledWith(
      "waiter-1",
      "WAITER",
      "some-key",
    );
  });

  it("reicht userId, role und Body an discardOfflineQueueEntry weiter", async () => {
    service.discardOfflineQueueEntry.mockResolvedValue({ success: true });
    const request = { user: { userId: "waiter-1", role: "WAITER" } };
    const body = {
      idempotencyKey: "offline-queue-key-1",
      reason: "Doppelerfassung",
      capturedByUserId: "waiter-1",
    };

    await controller.discardOfflineQueueEntry(request, body);

    expect(service.discardOfflineQueueEntry).toHaveBeenCalledWith(
      "waiter-1",
      "WAITER",
      body,
    );
  });

  it("schützt GET by-idempotency-key/:key mit ADMINISTRATOR, EVENT_MANAGER, WAITER und CASHIER", () => {
    expect(
      Reflect.getMetadata(ROLES_KEY, controller.getOrderByIdempotencyKey),
    ).toEqual(["ADMINISTRATOR", "EVENT_MANAGER", "WAITER", "CASHIER"]);
  });

  it("schützt POST offline-queue/discard mit denselben Rollen wie die Auskunft davor", () => {
    expect(
      Reflect.getMetadata(ROLES_KEY, controller.discardOfflineQueueEntry),
    ).toEqual(["ADMINISTRATOR", "EVENT_MANAGER", "WAITER", "CASHIER"]);
  });

  // Regressionstest fuer den von der Projektleitung bestaetigten Befund:
  // EVENT_MANAGER durfte laut discardOfflineQueueEntry verwerfen, konnte
  // den vorgeschriebenen Serverkontakt (Abschnitt 7: GET
  // by-idempotency-key/:key vor jedem Verwerfen) aber nicht aufrufen und
  // scheiterte dort an 403, bevor er das Verwerfen je erreichte. Die Regel
  // dahinter, nicht nur der eine Fall: jede Rolle, die verwerfen darf, muss
  // auch die Auskunft davor abrufen duerfen - die Rollenliste von
  // discardOfflineQueueEntry muss also stets eine Teilmenge der Rollenliste
  // von getOrderByIdempotencyKey sein.
  it("erlaubt jeder zum Verwerfen berechtigten Rolle auch den vorgeschriebenen Serverkontakt davor", () => {
    const discardRoles = Reflect.getMetadata(
      ROLES_KEY,
      controller.discardOfflineQueueEntry,
    ) as string[];
    const lookupRoles = Reflect.getMetadata(
      ROLES_KEY,
      controller.getOrderByIdempotencyKey,
    ) as string[];

    for (const role of discardRoles) {
      expect(lookupRoles).toContain(role);
    }
  });
});
