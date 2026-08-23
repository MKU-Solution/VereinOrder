import { MaintenanceController } from "./maintenance.controller";
import { MaintenanceState } from "./maintenance.types";

const FULL_STATE: MaintenanceState = {
  phase: "LOCKED",
  since: "2026-08-23T10:00:00.000Z",
  byUserId: "admin-1",
  byUsername: "admin",
  reason: "Wiederherstellung",
  expectedUntil: "2026-08-23T10:30:00.000Z",
};

function makeController(state: MaintenanceState = FULL_STATE) {
  const maintenanceService = {
    getState: jest.fn(() => state),
    start: jest.fn(),
    end: jest.fn(),
  };
  const jwtService = { verify: jest.fn() };
  const controller = new MaintenanceController(
    maintenanceService as any,
    jwtService as any,
  );
  return { controller, maintenanceService, jwtService };
}

describe("MaintenanceController.getStatus (Ergänzung 1 der Projektleitung)", () => {
  it("liefert unangemeldet AUSSCHLIESSLICH phase, since, expectedUntil", async () => {
    const { controller } = makeController();

    const result = await controller.getStatus(undefined);

    // Bewusst nicht "enthält phase", sondern die vollständige Feldmenge -
    // sonst rutscht beim nächsten Feld in maintenance.types.ts wieder etwas
    // mit durch, ohne dass ein Test es bemerkt.
    expect(Object.keys(result).sort()).toEqual(
      ["expectedUntil", "phase", "since"].sort(),
    );
    expect(result).toEqual({
      phase: "LOCKED",
      since: "2026-08-23T10:00:00.000Z",
      expectedUntil: "2026-08-23T10:30:00.000Z",
    });
    expect((result as any).byUserId).toBeUndefined();
    expect((result as any).byUsername).toBeUndefined();
    expect((result as any).reason).toBeUndefined();
  });

  it("liefert unangemeldet dieselben drei Felder auch ohne 'Bearer '-Header", async () => {
    const { controller } = makeController();
    const result = await controller.getStatus("nicht-bearer xyz");
    expect(Object.keys(result).sort()).toEqual(
      ["expectedUntil", "phase", "since"].sort(),
    );
  });

  it("liefert mit einem gültigen Token den vollständigen Zustand", async () => {
    const { controller, jwtService } = makeController();
    jwtService.verify.mockReturnValue({ sub: "admin-1" });

    const result = await controller.getStatus("Bearer gueltiges-token");

    expect(result).toEqual(FULL_STATE);
  });

  it("behandelt ein ungültiges/abgelaufenes Token wie unangemeldet", async () => {
    const { controller, jwtService } = makeController();
    jwtService.verify.mockImplementation(() => {
      throw new Error("jwt expired");
    });

    const result = await controller.getStatus("Bearer abgelaufen");

    expect(Object.keys(result).sort()).toEqual(
      ["expectedUntil", "phase", "since"].sort(),
    );
  });
});

describe("MaintenanceController.start/end – delegiert an den Dienst", () => {
  it("start() reicht Aufrufer und Eingaben durch", async () => {
    const { controller, maintenanceService } = makeController();
    const req = { user: { userId: "admin-1", username: "admin" } };

    await controller.start(req, {
      reason: "Update",
      expectedUntil: "2026-08-23T12:00:00.000Z",
    });

    expect(maintenanceService.start).toHaveBeenCalledWith(
      "admin-1",
      "admin",
      "Update",
      "2026-08-23T12:00:00.000Z",
    );
  });

  it("end() reicht den Aufrufer durch", async () => {
    const { controller, maintenanceService } = makeController();
    const req = { user: { userId: "admin-1", username: "admin" } };

    await controller.end(req);

    expect(maintenanceService.end).toHaveBeenCalledWith("admin-1", "admin");
  });
});
