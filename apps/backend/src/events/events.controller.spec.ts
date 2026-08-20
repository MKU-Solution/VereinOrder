import { ROLES_KEY } from "../common/decorators/roles.decorator";
import { EventsController } from "./events.controller";

/** Öffentlicher HTTP-Vertrag für Issue #53. */
type EventManagementControllerContract = {
  duplicate: (
    request: any,
    sourceEventId: string,
    body: { name?: string },
    idempotencyKey: string,
  ) => Promise<unknown>;
  copyAssortment: (
    request: any,
    sourceEventId: string,
    body: {
      targetEventId: string;
      stationMappings: Record<string, string | null>;
    },
    idempotencyKey: string,
  ) => Promise<unknown>;
  exportConfig: (sourceEventId: string) => Promise<unknown>;
  importConfig: (
    request: any,
    body: unknown,
    idempotencyKey: string,
  ) => Promise<unknown>;
  testDataSummary: (eventId: string) => Promise<unknown>;
  cleanTestData: (
    request: any,
    eventId: string,
    confirmationName: string,
    idempotencyKey: string,
  ) => Promise<unknown>;
};

describe("EventsController – Verwaltungsvertrag für Issue #53", () => {
  const service = {
    duplicate: jest.fn(),
    copyAssortment: jest.fn(),
    exportConfig: jest.fn(),
    importConfig: jest.fn(),
    testDataSummary: jest.fn(),
    cleanTestData: jest.fn(),
  };
  let controller: EventsController;
  let contract: EventManagementControllerContract;

  beforeEach(() => {
    jest.resetAllMocks();
    controller = new EventsController(service as any);
    contract = controller as unknown as EventManagementControllerContract;
  });

  it.each([
    "duplicate",
    "copyAssortment",
    "exportConfig",
    "importConfig",
    "testDataSummary",
    "cleanTestData",
  ] as const)("schützt %s ausschließlich mit ADMINISTRATOR", (method) =>
    expect(Reflect.getMetadata(ROLES_KEY, (controller as any)[method])).toEqual(
      ["ADMINISTRATOR"],
    ),
  );

  it("reicht nur die JWT-Identität und geprüfte Parameter an die Verwaltungsoperationen weiter", async () => {
    const request = { user: { userId: "admin-1", role: "ADMINISTRATOR" } };
    service.duplicate.mockResolvedValue({ id: "copy-1" });
    service.copyAssortment.mockResolvedValue({ copiedProducts: 2 });
    service.exportConfig.mockResolvedValue({ schemaVersion: 1 });
    service.importConfig.mockResolvedValue({ id: "import-1" });
    service.testDataSummary.mockResolvedValue({ orders: 1 });
    service.cleanTestData.mockResolvedValue({ success: true });

    const key = "operation-key-1";
    const copyBody = {
      targetEventId: "target-1",
      stationMappings: { "station-1": "station-2" },
    };
    const importBody = { schemaVersion: 1, event: { name: "Import" } };
    await contract.duplicate(request, "source-1", { name: "Kopie" }, key);
    await contract.copyAssortment(request, "source-1", copyBody, key);
    await contract.exportConfig("source-1");
    await contract.importConfig(request, importBody, key);
    await contract.testDataSummary("test-event-1");
    await contract.cleanTestData(request, "test-event-1", "Testfest", key);

    expect(service.duplicate).toHaveBeenCalledWith("source-1", "admin-1", key, {
      name: "Kopie",
    });
    expect(service.copyAssortment).toHaveBeenCalledWith(
      "source-1",
      "admin-1",
      key,
      copyBody,
    );
    expect(service.exportConfig).toHaveBeenCalledWith("source-1");
    expect(service.importConfig).toHaveBeenCalledWith(
      "admin-1",
      key,
      importBody,
    );
    expect(service.testDataSummary).toHaveBeenCalledWith("test-event-1");
    expect(service.cleanTestData).toHaveBeenCalledWith(
      "test-event-1",
      "admin-1",
      "Testfest",
      key,
    );
  });
});
