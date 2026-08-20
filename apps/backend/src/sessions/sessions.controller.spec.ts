import { ROLES_KEY } from "../common/decorators/roles.decorator";
import { SessionsController } from "./sessions.controller";

describe("SessionsController – Identität und Rollen", () => {
  const service = {
    getContext: jest.fn(),
    getActiveSession: jest.fn(),
    startSession: jest.fn(),
    getSummary: jest.fn(),
    closeSession: jest.fn(),
  };
  let controller: SessionsController;

  beforeEach(() => {
    jest.resetAllMocks();
    controller = new SessionsController(service as any);
  });

  it("reicht userId aus dem JWT an alle Kassensitzungsaktionen weiter", async () => {
    const request = { user: { userId: "cashier-1", role: "CASHIER" } };
    await controller.getContext(request);
    await controller.getActiveSession(request, "event-1");
    await controller.startSession(request, {
      eventId: "event-1",
      startingBalance: 5000,
    });
    await controller.getSummary(request, "session-1");
    await controller.closeSession(request, "session-1", {
      closingBalance: 7500,
    });

    expect(service.getContext).toHaveBeenCalledWith("cashier-1");
    expect(service.getActiveSession).toHaveBeenCalledWith(
      "cashier-1",
      "event-1",
    );
    expect(service.startSession).toHaveBeenCalledWith(
      "cashier-1",
      "event-1",
      5000,
    );
    expect(service.getSummary).toHaveBeenCalledWith("session-1", "cashier-1");
    expect(service.closeSession).toHaveBeenCalledWith(
      "session-1",
      "cashier-1",
      7500,
    );
  });

  it("beschränkt Kassensitzungen zentral auf operative Kassenrollen", () => {
    expect(Reflect.getMetadata(ROLES_KEY, SessionsController)).toEqual([
      "ADMINISTRATOR",
      "WAITER",
      "CASHIER",
    ]);
  });
});
