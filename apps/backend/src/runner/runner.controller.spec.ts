import { RunnerController } from "./runner.controller";
import { ROLES_KEY } from "../common/decorators/roles.decorator";

describe("RunnerController – Vertrag für Issue #50", () => {
  const runner = { userId: "runner-1", role: "RUNNER" };
  const runnerService = {
    listOrders: jest.fn(),
    claimOrder: jest.fn(),
    deliverOrder: jest.fn(),
  };
  let controller: RunnerController;

  beforeEach(() => {
    jest.resetAllMocks();
    controller = new RunnerController(runnerService as any);
  });

  it("reicht Event, optionalen Bereich und den angemeldeten Nutzer an die READY-Liste weiter", async () => {
    runnerService.listOrders.mockResolvedValue([]);

    await controller.listOrders({ user: runner }, "event-1", "area-zelt");

    expect(runnerService.listOrders).toHaveBeenCalledWith(
      runner,
      "event-1",
      "area-zelt",
    );
  });

  it("verwendet für die Übernahme den angemeldeten Nutzer, nicht Daten aus dem Request-Body", async () => {
    runnerService.claimOrder.mockResolvedValue({ id: "order-1" });

    await controller.claimOrder({ user: runner }, "order-1");

    expect(runnerService.claimOrder).toHaveBeenCalledWith(runner, "order-1");
  });

  it("verwendet für die Zustellung den angemeldeten Claim-Eigentümer", async () => {
    runnerService.deliverOrder.mockResolvedValue({ id: "order-1" });

    await controller.deliverOrder({ user: runner }, "order-1");

    expect(runnerService.deliverOrder).toHaveBeenCalledWith(runner, "order-1");
  });

  it.each(["listOrders", "claimOrder", "deliverOrder"] as const)(
    "schützt %s im Backend mit RUNNER und ADMINISTRATOR",
    (method) => {
      expect(Reflect.getMetadata(ROLES_KEY, controller[method])).toEqual([
        "RUNNER",
        "ADMINISTRATOR",
      ]);
    },
  );
});
