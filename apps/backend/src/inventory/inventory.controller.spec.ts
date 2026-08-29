import "reflect-metadata";
import { ROLES_KEY } from "../common/decorators/roles.decorator";
import { InventoryController } from "./inventory.controller";

describe("InventoryController – Rollenwächter", () => {
  const controller = new InventoryController({} as never);

  it("erlaubt Lesesicht nur den dafür vorgesehenen Betriebsrollen", () => {
    expect(Reflect.getMetadata(ROLES_KEY, controller.detail)).toEqual([
      "ADMINISTRATOR",
      "EVENT_MANAGER",
      "WAITER",
      "CASHIER",
      "STATION",
    ]);
    expect(Reflect.getMetadata(ROLES_KEY, controller.history)).toEqual([
      "ADMINISTRATOR",
      "EVENT_MANAGER",
    ]);
  });

  it.each(["initialize", "settings", "correction"] as const)(
    "%s sperrt unbekannte und nicht berechtigte Rollen im Backend",
    (method) => {
      expect(Reflect.getMetadata(ROLES_KEY, controller[method])).toEqual([
        "ADMINISTRATOR",
        "EVENT_MANAGER",
      ]);
    },
  );
});
