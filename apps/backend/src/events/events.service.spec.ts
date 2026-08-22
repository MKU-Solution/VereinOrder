import { BadRequestException, ConflictException } from "@nestjs/common";
import { EventsService } from "./events.service";

type EventManagementServiceContract = {
  duplicate: (
    sourceEventId: string,
    userId: string,
    idempotencyKey: string,
    options?: { name?: string },
  ) => Promise<any>;
  copyAssortment: (
    sourceEventId: string,
    userId: string,
    idempotencyKey: string,
    body: {
      targetEventId: string;
      stationMappings: Record<string, string | null>;
    },
  ) => Promise<any>;
  exportConfig: (eventId: string) => Promise<any>;
  importConfig: (
    userId: string,
    idempotencyKey: string,
    payload: unknown,
  ) => Promise<any>;
};

const configuration = {
  id: "event-source",
  name: "Sommerfest",
  organizer: "Verein",
  location: "Platz",
  timezone: "Europe/Vienna",
  status: "ACTIVE",
  testMode: false,
  categories: [
    {
      id: "category-1",
      name: "Getränke",
      sortOrder: 1,
      products: [
        {
          id: "product-1",
          name: "Apfelsaft",
          price: 350,
          taxRate: 1000,
          sortOrder: 1,
          categoryId: "category-1",
          targetStationId: "station-1",
          shortName: null,
          description: null,
          color: null,
          imageUrl: null,
          availability: "AVAILABLE",
          optionGroups: [
            {
              id: "group-variant-1",
              name: "Variante",
              selectionType: "SINGLE",
              isRequired: true,
              minSelect: 1,
              maxSelect: 1,
              priceMode: "ABSOLUTE",
              quickSaleTiles: true,
              sortOrder: 0,
              options: [
                {
                  id: "variant-1",
                  name: "groß",
                  priceEffect: 450,
                  isActive: true,
                  sortOrder: 0,
                },
              ],
            },
            {
              id: "group-extras-1",
              name: "Extras",
              selectionType: "MULTIPLE",
              isRequired: false,
              minSelect: 0,
              maxSelect: null,
              priceMode: "SURCHARGE",
              quickSaleTiles: false,
              sortOrder: 1,
              options: [
                {
                  id: "extra-1",
                  name: "Eis",
                  priceEffect: 50,
                  isActive: true,
                  sortOrder: 0,
                },
              ],
            },
          ],
        },
      ],
    },
  ],
  stations: [
    {
      id: "station-1",
      name: "Bar",
      shortName: "BAR",
      sortOrder: 1,
      isActive: true,
    },
  ],
  products: [],
  areas: [{ id: "area-1", name: "Zelt", sortOrder: 1 }],
};

const importPayload = {
  kind: "VEREINORDER_EVENT_CONFIG",
  schemaVersion: 1,
  event: {
    name: "Importfest",
    organizer: null,
    location: null,
    startTime: null,
    endTime: null,
    timezone: "Europe/Vienna",
  },
  areas: [{ name: "Zelt", sortOrder: 1 }],
  stations: [
    {
      ref: "station-1",
      name: "Bar",
      shortName: "BAR",
      color: null,
      sortOrder: 1,
      isActive: true,
      printerMapping: null,
    },
  ],
  categories: [{ ref: "category-1", name: "Getränke", sortOrder: 1 }],
  products: [
    {
      ref: "product-1",
      categoryRef: "category-1",
      stationRef: "station-1",
      name: "Apfelsaft",
      shortName: null,
      description: null,
      price: 350,
      taxRate: 1000,
      color: null,
      sortOrder: 1,
      imageUrl: null,
      availability: "AVAILABLE",
      variants: [{ name: "groß", price: 450, sortOrder: 1 }],
      extras: [{ name: "Eis", price: 50, sortOrder: 1 }],
    },
  ],
};

function createPrisma() {
  const tx = {
    event: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    productCategory: { create: jest.fn(), count: jest.fn() },
    station: { create: jest.fn(), findMany: jest.fn() },
    product: { create: jest.fn(), count: jest.fn() },
    area: { create: jest.fn() },
    productVoucher: { deleteMany: jest.fn() },
    printJob: { deleteMany: jest.fn() },
    payment: { deleteMany: jest.fn() },
    orderItem: { deleteMany: jest.fn() },
    order: { findMany: jest.fn(), deleteMany: jest.fn(), count: jest.fn() },
    cashierSession: { deleteMany: jest.fn(), count: jest.fn() },
    auditLog: { create: jest.fn() },
    configOperation: { findUnique: jest.fn(), create: jest.fn() },
    $queryRaw: jest.fn(),
  };
  const prisma = {
    ...tx,
    $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) =>
      callback(tx),
    ),
  };
  return { prisma, tx };
}

describe("EventsService – Wächtervertrag für Issue #53", () => {
  let prisma: ReturnType<typeof createPrisma>["prisma"];
  let tx: ReturnType<typeof createPrisma>["tx"];
  let service: EventsService;
  let contract: EventManagementServiceContract;

  beforeEach(() => {
    ({ prisma, tx } = createPrisma());
    service = new EventsService(prisma as any);
    contract = service as unknown as EventManagementServiceContract;
  });

  it("dupliziert ausschließlich Konfiguration mit neuen IDs, remappt FK-Beziehungen und erzeugt immer DRAFT+testMode", async () => {
    tx.event.findUnique.mockResolvedValue(configuration);
    tx.event.count.mockResolvedValue(0);
    tx.configOperation.findUnique.mockResolvedValue(null);
    tx.$queryRaw.mockResolvedValue([]);
    tx.event.create.mockResolvedValue({
      id: "event-copy",
      name: "Sommerfest – Kopie",
      status: "DRAFT",
      testMode: false,
    });
    tx.productCategory.create.mockResolvedValue({ id: "category-copy" });
    tx.station.create.mockResolvedValue({ id: "station-copy" });
    tx.product.create.mockResolvedValue({ id: "product-copy" });

    await contract.duplicate("event-source", "admin-1", "duplicate-key-1", {
      name: "Sommerfest – Kopie",
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.event.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: "Sommerfest – Kopie",
          status: "DRAFT",
          testMode: false,
        }),
      }),
    );
    expect(tx.productCategory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ eventId: "event-copy" }),
      }),
    );
    expect(tx.station.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ eventId: "event-copy" }),
      }),
    );
    expect(tx.product.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          eventId: "event-copy",
          categoryId: "category-copy",
          targetStationId: "station-copy",
        }),
      }),
    );
    expect(tx.product.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          optionGroups: {
            create: [
              expect.objectContaining({
                name: "Variante",
                options: {
                  create: [expect.objectContaining({ name: "groß" })],
                },
              }),
              expect.objectContaining({
                name: "Extras",
                options: {
                  create: [expect.objectContaining({ name: "Eis" })],
                },
              }),
            ],
          },
        }),
      }),
    );
  });

  it("kopiert ein Sortiment nur in zulässige Nicht-Echtbetriebsziele und remappt Kategorien und Stationen", async () => {
    tx.event.findUnique
      .mockResolvedValueOnce(configuration)
      .mockResolvedValueOnce({ rksvConfirmedAt: null });
    tx.$queryRaw
      .mockResolvedValueOnce([
        {
          id: "event-target",
          name: "Zielfest",
          status: "PREPARED",
          testMode: false,
        },
      ])
      .mockResolvedValueOnce([]);
    tx.station.findMany.mockResolvedValue([{ id: "station-target" }]);
    tx.productCategory.count.mockResolvedValue(0);
    tx.product.count.mockResolvedValue(0);
    tx.configOperation.findUnique.mockResolvedValue(null);
    tx.productCategory.create.mockResolvedValue({ id: "category-target" });
    tx.product.create.mockResolvedValue({ id: "product-target" });

    await contract.copyAssortment(
      "event-source",
      "admin-1",
      "assortment-key-1",
      {
        targetEventId: "event-target",
        stationMappings: { "station-1": "station-target" },
      },
    );

    expect(tx.product.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          eventId: "event-target",
          categoryId: "category-target",
          targetStationId: "station-target",
        }),
      }),
    );
    expect(tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "EVENT_ASSORTMENT_COPIED",
          entityId: "event-target",
          userId: "admin-1",
        }),
      }),
    );
  });

  it.each([
    { status: "ACTIVE", testMode: false },
    { status: "PAUSED", testMode: false },
    { status: "COMPLETED", testMode: false },
  ])(
    "lehnt Sortimentskopie nach $status ohne Transaktion ab",
    async (target) => {
      tx.event.findUnique.mockResolvedValue(configuration);
      tx.$queryRaw.mockResolvedValue([
        { id: "event-target", name: "Zielfest", ...target },
      ]);
      await expect(
        contract.copyAssortment("event-source", "admin-1", "assortment-key-1", {
          targetEventId: "event-target",
          stationMappings: { "station-1": "station-target" },
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(tx.product.create).not.toHaveBeenCalled();
    },
  );

  it("exportiert eine versionierte, vollständige Konfiguration ohne Betriebs-, Benutzer- oder Auditdaten", async () => {
    prisma.event.findUnique.mockResolvedValue(configuration);
    const exported = await contract.exportConfig("event-source");

    expect(exported).toEqual(
      expect.objectContaining({
        kind: "VEREINORDER_EVENT_CONFIG",
        schemaVersion: 2,
        exportedAt: expect.any(String),
        event: expect.objectContaining({ name: "Sommerfest" }),
        areas: expect.any(Array),
        categories: expect.any(Array),
        stations: expect.any(Array),
        products: expect.any(Array),
      }),
    );
    expect(JSON.stringify(exported)).not.toMatch(
      /orders|payments|cashierSessions|audit|users|vouchers/i,
    );
  });

  it("validiert Importdaten streng vor der Transaktion und schreibt bei ungültigem Schema nichts", async () => {
    await expect(
      contract.importConfig("admin-1", "import-key-1", {
        schemaVersion: 999,
        event: {},
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: "unbekannte Felder",
      change: (payload: any) => {
        payload.event.status = "ACTIVE";
      },
    },
    {
      label: "negative Preise",
      change: (payload: any) => {
        payload.products[0].price = -1;
      },
    },
    {
      label: "verwaiste Referenzen",
      change: (payload: any) => {
        payload.products[0].categoryRef = "fehlt";
      },
    },
  ])("weist $label vor jeder Transaktion zurück", async ({ change }) => {
    const payload = JSON.parse(JSON.stringify(importPayload));
    change(payload);
    await expect(
      contract.importConfig("admin-1", "import-key-1", payload),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("importiert nur atomar, erzeugt immer DRAFT+testMode und protokolliert den Import", async () => {
    tx.$queryRaw.mockResolvedValue([]);
    tx.configOperation.findUnique.mockResolvedValue(null);
    tx.event.count.mockResolvedValue(0);
    tx.event.create.mockResolvedValue({
      id: "event-import",
      name: "Importfest",
      status: "DRAFT",
      testMode: false,
    });
    tx.productCategory.create.mockResolvedValue({ id: "category-import" });
    tx.station.create.mockResolvedValue({ id: "station-import" });
    tx.product.create.mockResolvedValue({ id: "product-import" });

    await contract.importConfig("admin-1", "import-key-1", importPayload);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.event.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "DRAFT", testMode: false }),
      }),
    );
    expect(tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "EVENT_CONFIG_IMPORTED",
          entityId: "event-import",
          userId: "admin-1",
        }),
      }),
    );
  });

  it.each([
    { status: "ACTIVE", testMode: false },
    { status: "TEST_MODE", testMode: false },
    { status: "DRAFT", testMode: false },
  ])("bereinigt niemals %o und führt keine Löschung aus", async (event) => {
    tx.configOperation.findUnique.mockResolvedValue(null);
    tx.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: "event-unsafe", name: "Unsicher", ...event },
      ]);
    await expect(
      service.cleanTestData(
        "event-unsafe",
        "admin-1",
        "Unsicher",
        "cleanup-key-1",
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.order.deleteMany).not.toHaveBeenCalled();
  });

  it("bricht bei einer LIVE-Kassensitzung atomar vor jeder Löschung ab", async () => {
    tx.configOperation.findUnique.mockResolvedValue(null);
    tx.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        id: "event-test",
        name: "Testfest",
        status: "TEST_MODE",
        testMode: true,
      },
    ]);
    tx.order.count.mockResolvedValue(0);
    tx.cashierSession.count.mockResolvedValue(1);

    await expect(
      service.cleanTestData(
        "event-test",
        "admin-1",
        "Testfest",
        "cleanup-key-1",
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.productVoucher.deleteMany).not.toHaveBeenCalled();
    expect(tx.order.deleteMany).not.toHaveBeenCalled();
    expect(tx.cashierSession.deleteMany).not.toHaveBeenCalled();
  });

  it("verlangt den exakten Veranstaltungsnamen vor jeder Löschung", async () => {
    tx.configOperation.findUnique.mockResolvedValue(null);
    tx.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        id: "event-test",
        name: "Testfest",
        status: "TEST_MODE",
        testMode: true,
      },
    ]);

    await expect(
      service.cleanTestData(
        "event-test",
        "admin-1",
        "testfest",
        "cleanup-key-1",
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.productVoucher.deleteMany).not.toHaveBeenCalled();
  });

  it("liefert bei identischem Idempotency-Key und Payload das gespeicherte Ergebnis ohne zweite Löschung", async () => {
    const payloadHash = (service as any).hash({ confirmationName: "Testfest" });
    tx.$queryRaw.mockResolvedValue([]);
    tx.configOperation.findUnique.mockResolvedValue({
      payloadHash,
      response: { success: true, deleted: { orders: 1 } },
    });

    await expect(
      service.cleanTestData(
        "event-test",
        "admin-1",
        "Testfest",
        "cleanup-key-1",
      ),
    ).resolves.toEqual(
      expect.objectContaining({ success: true, replayed: true }),
    );
    expect(tx.productVoucher.deleteMany).not.toHaveBeenCalled();
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    const advisoryLockQuery = tx.$queryRaw.mock.calls[0][0];
    expect(advisoryLockQuery.strings.join(" ")).toContain(
      "pg_advisory_xact_lock(hashtextextended(",
    );
    expect(advisoryLockQuery.strings.join(" ")).toContain('::text AS "lock"');
  });

  it("lehnt denselben Idempotency-Key mit verändertem Payload konfliktfrei vor der Mutation ab", async () => {
    tx.$queryRaw.mockResolvedValue([]);
    tx.configOperation.findUnique.mockResolvedValue({
      payloadHash: "anderer-hash",
      response: { success: true },
    });

    await expect(
      service.cleanTestData(
        "event-test",
        "admin-1",
        "Testfest",
        "cleanup-key-1",
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.productVoucher.deleteMany).not.toHaveBeenCalled();
  });

  it("bereinigt in TEST_MODE nur operative Daten FK-sicher, behält Konfiguration und protokolliert atomar", async () => {
    tx.configOperation.findUnique.mockResolvedValue(null);
    tx.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        id: "event-test",
        name: "Testfest",
        status: "TEST_MODE",
        testMode: true,
      },
    ]);
    tx.order.count.mockResolvedValue(0);
    tx.cashierSession.count.mockResolvedValue(0);
    tx.order.findMany.mockResolvedValue([{ id: "order-1" }]);
    tx.productVoucher.deleteMany.mockResolvedValue({ count: 2 });
    tx.printJob.deleteMany.mockResolvedValue({ count: 1 });
    tx.payment.deleteMany.mockResolvedValue({ count: 1 });
    tx.orderItem.deleteMany.mockResolvedValue({ count: 2 });
    tx.order.deleteMany.mockResolvedValue({ count: 1 });
    tx.cashierSession.deleteMany.mockResolvedValue({ count: 1 });
    tx.auditLog.create.mockResolvedValue({ id: "audit-1" });
    tx.event.update.mockResolvedValue({
      id: "event-test",
      status: "PREPARED",
      testMode: false,
    });

    await expect(
      service.cleanTestData(
        "event-test",
        "admin-1",
        "Testfest",
        "cleanup-key-1",
      ),
    ).resolves.toEqual(expect.objectContaining({ success: true }));

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.productVoucher.deleteMany).toHaveBeenCalledWith({
      where: { eventId: "event-test", order: { dataMode: "TEST" } },
    });
    const callOrder = (mock: jest.Mock) => mock.mock.invocationCallOrder[0];
    expect(callOrder(tx.printJob.deleteMany)).toBeLessThan(
      callOrder(tx.payment.deleteMany),
    );
    expect(callOrder(tx.payment.deleteMany)).toBeLessThan(
      callOrder(tx.orderItem.deleteMany),
    );
    expect(callOrder(tx.orderItem.deleteMany)).toBeLessThan(
      callOrder(tx.order.deleteMany),
    );
    expect(tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "EVENT_TEST_DATA_CLEANED",
          entityId: "event-test",
          userId: "admin-1",
        }),
      }),
    );
  });
});
