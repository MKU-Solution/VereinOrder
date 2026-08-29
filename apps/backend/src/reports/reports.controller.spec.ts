import "reflect-metadata";
import { ROLES_KEY } from "../common/decorators/roles.decorator";
import { ReportsController } from "./reports.controller";

describe("ReportsController – Bestandsbericht (Issue #141)", () => {
  const reports = { getInventoryReport: jest.fn(), exportCsv: jest.fn() };
  const controller = new ReportsController(reports as any);

  beforeEach(() => jest.clearAllMocks());

  it("schützt den Bestandsbericht im Backend mit den vorgesehenen Rollen", () => {
    expect(Reflect.getMetadata(ROLES_KEY, ReportsController)).toEqual([
      "ADMINISTRATOR",
      "REVISION",
      "EVENT_MANAGER",
    ]);
  });

  it("übergibt eventId und dataMode unverändert an den strikten Bestandsbericht", async () => {
    reports.getInventoryReport.mockResolvedValue([]);
    await expect(
      controller.getInventoryReport({ eventId: "event", dataMode: "TEST" }),
    ).resolves.toEqual([]);
    expect(reports.getInventoryReport).toHaveBeenCalledWith("event", "TEST");
  });

  it("erweitert den bestehenden CSV-Vertrag um dataMode für Inventur", async () => {
    reports.exportCsv.mockResolvedValue("csv");
    const response = { header: jest.fn().mockReturnThis(), send: jest.fn() };
    await controller.exportCsv("inventory", "event", "LIVE", response);
    expect(reports.exportCsv).toHaveBeenCalledWith(
      "inventory",
      "event",
      "LIVE",
    );
  });
});
