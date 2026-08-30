import { BadRequestException, ConflictException } from "@nestjs/common";
import type { EventStatus } from "@vereinorder/database";
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
      targetStationId: "station-1",
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
  // Issue #84: "categoryId" ist Pflicht, die Datenhaltung liefert nie mehr
  // Produkte ohne Kategorie. Die Fixture spiegelt das wider und enthält
  // absichtlich kein top-level "products" mehr.
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
    eventPickupCounter: { deleteMany: jest.fn() },
    // Issue #141: Die Bereinigung raeumt zusaetzlich das Bestands-Ledger der
    // Betriebsart TEST ab. Die Vorbelegung entspricht einer Veranstaltung
    // ohne Bestandsfuehrung, damit die uebrigen Tests unveraendert gelten.
    inventoryMovement: {
      groupBy: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    inventoryStock: {
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn(),
    },
    auditLog: { create: jest.fn() },
    configOperation: { findUnique: jest.fn(), create: jest.fn() },
    $queryRaw: jest.fn(),
    $executeRaw: jest.fn(),
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
        data: expect.objectContaining({
          eventId: "event-copy",
          // Issue #84: die Zielstation der Kategorie läuft durch dieselbe
          // Stationsabbildung wie die Ausnahme-Station der Produkte.
          targetStationId: "station-copy",
        }),
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

    expect(tx.productCategory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          eventId: "event-target",
          // Issue #84: dieselbe Stationsabbildung wie für Produkte.
          targetStationId: "station-target",
        }),
      }),
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
        schemaVersion: 3,
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
    // Issue #84: die Kategorie führt ab Version 3 ihre Zielstation als
    // Verweis, und der Kategorieverweis am Produkt ist nie leer.
    expect(exported.categories[0]).toEqual(
      expect.objectContaining({ stationRef: "station-1" }),
    );
    expect(exported.products[0]).toEqual(
      expect.objectContaining({
        categoryRef: expect.any(String),
        stationRef: "station-1",
      }),
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

  it("ordnet Produkten ohne Kategorie aus einer Vorlage der Version 1 oder 2 beim Import dieselbe Auffangkategorie zu wie die Migration", async () => {
    tx.$queryRaw.mockResolvedValue([]);
    tx.configOperation.findUnique.mockResolvedValue(null);
    tx.event.count.mockResolvedValue(0);
    tx.event.create.mockResolvedValue({
      id: "event-import-2",
      name: "Importfest ohne Kategorie",
      status: "DRAFT",
      testMode: false,
    });
    tx.station.create.mockResolvedValue({ id: "station-import-2" });
    tx.productCategory.create.mockResolvedValue({ id: "fallback-import" });
    tx.product.create.mockResolvedValue({ id: "product-import-2" });

    const payload = JSON.parse(JSON.stringify(importPayload));
    payload.event.name = "Importfest ohne Kategorie";
    payload.categories = [];
    payload.products[0].categoryRef = null;

    await contract.importConfig("admin-1", "import-key-2", payload);

    // Dieselbe Regel wie die SQL-Migration
    // 20260822120000_move_target_station_to_category: "Sonstige Artikel",
    // ans Ende der Sortierung angehängt, ohne eigene Zielstation. So bleibt
    // eine bereits exportierte Datei importierbar.
    expect(tx.productCategory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: "Sonstige Artikel",
          sortOrder: 0,
          targetStationId: null,
        }),
      }),
    );
    expect(tx.product.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ categoryId: "fallback-import" }),
      }),
    );
  });

  it("weicht bei Namenskollision mit der Auffangkategorie auf denselben zweiten Namen aus wie die Migration", async () => {
    tx.$queryRaw.mockResolvedValue([]);
    tx.configOperation.findUnique.mockResolvedValue(null);
    tx.event.count.mockResolvedValue(0);
    tx.event.create.mockResolvedValue({
      id: "event-import-3",
      name: "Importfest mit Namenskollision",
      status: "DRAFT",
      testMode: false,
    });
    tx.station.create.mockResolvedValue({ id: "station-import-3" });
    tx.productCategory.create.mockResolvedValue({ id: "category-import-3" });
    tx.product.create.mockResolvedValue({ id: "product-import-3" });

    const payload = JSON.parse(JSON.stringify(importPayload));
    payload.event.name = "Importfest mit Namenskollision";
    payload.categories = [
      { ref: "category-1", name: "Sonstige Artikel", sortOrder: 0 },
    ];
    payload.products[0].categoryRef = null;

    await contract.importConfig("admin-1", "import-key-3", payload);

    expect(tx.productCategory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: "Sonstige Artikel (ohne Kategorie)",
          sortOrder: 1,
        }),
      }),
    );
  });

  it("nimmt Vorlagendateien der Version 3 mit Zielstation an der Kategorie an", async () => {
    tx.$queryRaw.mockResolvedValue([]);
    tx.configOperation.findUnique.mockResolvedValue(null);
    tx.event.count.mockResolvedValue(0);
    tx.event.create.mockResolvedValue({
      id: "event-v3",
      name: "Fest V3",
      status: "DRAFT",
      testMode: false,
    });
    tx.station.create.mockResolvedValue({ id: "station-v3" });
    tx.productCategory.create.mockResolvedValue({ id: "category-v3" });
    tx.product.create.mockResolvedValue({ id: "product-v3" });

    const payloadV3 = {
      kind: "VEREINORDER_EVENT_CONFIG",
      schemaVersion: 3,
      event: {
        name: "Fest V3",
        organizer: null,
        location: null,
        startTime: null,
        endTime: null,
        timezone: "Europe/Vienna",
      },
      areas: [],
      stations: [
        {
          ref: "station-1",
          name: "Bar",
          shortName: null,
          color: null,
          sortOrder: 1,
          isActive: true,
          printerMapping: null,
        },
      ],
      categories: [
        {
          ref: "category-1",
          name: "Getränke",
          sortOrder: 1,
          stationRef: "station-1",
        },
      ],
      products: [
        {
          ref: "product-1",
          categoryRef: "category-1",
          stationRef: null,
          name: "Bier",
          shortName: null,
          description: null,
          price: 350,
          taxRate: 2000,
          color: null,
          sortOrder: 1,
          imageUrl: null,
          availability: "AVAILABLE",
          optionGroups: [],
        },
      ],
    };

    await contract.importConfig("admin-1", "import-key-4", payloadV3);

    expect(tx.productCategory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ targetStationId: "station-v3" }),
      }),
    );
    expect(tx.product.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          categoryId: "category-v3",
          targetStationId: null,
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
    tx.eventPickupCounter.deleteMany.mockResolvedValue({ count: 1 });
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

  // Issue #66: ohne diese Loeschung zaehlt eine bereinigte Testveranstaltung
  // beim naechsten Probeverkauf beim alten Stand weiter, obwohl keine
  // Bestellung mehr dahintersteht. Der Echtzaehler bleibt dabei unberuehrt -
  // deshalb wird der Filter hier woertlich geprueft und nicht nur, DASS
  // geloescht wurde.
  it("löscht den Testzähler der Abholnummer mit und weist ihn in Antwort und Protokoll aus", async () => {
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
    tx.eventPickupCounter.deleteMany.mockResolvedValue({ count: 1 });
    tx.auditLog.create.mockResolvedValue({ id: "audit-1" });
    tx.event.update.mockResolvedValue({
      id: "event-test",
      status: "PREPARED",
      testMode: false,
    });

    const result = await service.cleanTestData(
      "event-test",
      "admin-1",
      "Testfest",
      "cleanup-key-1",
    );

    expect(tx.eventPickupCounter.deleteMany).toHaveBeenCalledWith({
      where: { eventId: "event-test", dataMode: "TEST" },
    });
    expect(result).toEqual(
      expect.objectContaining({
        deleted: expect.objectContaining({ pickupCounters: 1 }),
      }),
    );
    expect(tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          details: expect.objectContaining({ pickupCountersDeleted: 1 }),
        }),
      }),
    );
  });

  // Issue #141: Reihenfolge und Reichweite des Bestandsteils. Ob die
  // Fremdschlüssel und der Append-only-Trigger das tatsächlich hergeben,
  // beweist ausschließlich der Integrationstest
  // test/event-test-data-cleanup-inventory.integration-spec.ts – hier wird
  // nur festgehalten, was der Dienst in welcher Reihenfolge anweist.
  it("räumt das TEST-Ledger vor den Bestellungen ab, schaltet die Ausnahme wieder aus und setzt den Bestand auf den Ledgerstand", async () => {
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
    tx.productVoucher.deleteMany.mockResolvedValue({ count: 0 });
    tx.printJob.deleteMany.mockResolvedValue({ count: 0 });
    tx.payment.deleteMany.mockResolvedValue({ count: 0 });
    tx.orderItem.deleteMany.mockResolvedValue({ count: 1 });
    tx.order.deleteMany.mockResolvedValue({ count: 1 });
    tx.cashierSession.deleteMany.mockResolvedValue({ count: 0 });
    tx.eventPickupCounter.deleteMany.mockResolvedValue({ count: 1 });
    tx.inventoryMovement.groupBy
      .mockResolvedValueOnce([
        { productId: "product-1", _count: { _all: 3 } },
        { productId: "product-2", _count: { _all: 1 } },
      ])
      .mockResolvedValueOnce([
        { productId: "product-1", _sum: { quantityDelta: 10 } },
        { productId: "product-2", _sum: { quantityDelta: 4 } },
      ]);
    tx.inventoryMovement.deleteMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 3 });
    tx.inventoryStock.findMany.mockResolvedValue([
      { productId: "product-1", stockQuantity: 6 },
      { productId: "product-2", stockQuantity: 4 },
    ]);
    tx.auditLog.create.mockResolvedValue({ id: "audit-1" });
    tx.event.update.mockResolvedValue({
      id: "event-test",
      status: "PREPARED",
      testMode: false,
    });

    const result = await service.cleanTestData(
      "event-test",
      "admin-1",
      "Testfest",
      "cleanup-key-1",
    );

    // Stornobewegungen zuerst: "reversesMovementId" ist ebenfalls RESTRICT.
    expect(
      tx.inventoryMovement.deleteMany.mock.calls.map(([call]) => call),
    ).toEqual([
      {
        where: {
          eventId: "event-test",
          dataMode: "TEST",
          type: "CANCELLATION",
        },
      },
      {
        where: {
          eventId: "event-test",
          dataMode: "TEST",
          type: { in: ["SALE", "CORRECTION"] },
        },
      },
    ]);
    const callOrder = (mock: jest.Mock, index = 0) =>
      mock.mock.invocationCallOrder[index];
    expect(callOrder(tx.inventoryMovement.deleteMany, 1)).toBeLessThan(
      callOrder(tx.orderItem.deleteMany),
    );
    // Die Ausnahme umschließt ausschließlich die beiden Löschungen.
    const flagCalls = tx.$executeRaw.mock.invocationCallOrder;
    expect(flagCalls).toHaveLength(2);
    expect(flagCalls[0]).toBeLessThan(
      callOrder(tx.inventoryMovement.deleteMany, 0),
    );
    expect(flagCalls[1]).toBeGreaterThan(
      callOrder(tx.inventoryMovement.deleteMany, 1),
    );
    expect(
      tx.$executeRaw.mock.calls.map(
        ([query]) =>
          (query as { strings?: string[]; sql?: string }).sql ?? String(query),
      ),
    ).toEqual([
      expect.stringContaining("'on'"),
      expect.stringContaining("'off'"),
    ]);

    // Nur die tatsächlich abweichende Bestandszeile wird geschrieben, und
    // zwar auf den Wert, den das verbliebene Ledger erklärt.
    expect(tx.inventoryStock.update).toHaveBeenCalledTimes(1);
    expect(tx.inventoryStock.update).toHaveBeenCalledWith({
      where: {
        productId_eventId_dataMode: {
          productId: "product-1",
          eventId: "event-test",
          dataMode: "TEST",
        },
      },
      data: { stockQuantity: 10, version: { increment: 1 } },
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "INVENTORY_TEST_DATA_RESET",
        entityType: "Product",
        entityId: "product-1",
        userId: "admin-1",
        details: expect.objectContaining({
          eventId: "event-test",
          dataMode: "TEST",
          previousStockQuantity: 6,
          stockQuantity: 10,
          movementsDeleted: 3,
        }),
      }),
    });
    expect(result).toEqual(
      expect.objectContaining({
        inventory: { movementsDeleted: 4, stocksReset: 1 },
      }),
    );
    expect(tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "EVENT_TEST_DATA_CLEANED",
          details: expect.objectContaining({
            inventoryMovementsDeleted: 4,
            inventoryStocksReset: 1,
          }),
        }),
      }),
    );
  });

  it("lässt Bestand und Ledger unberührt, wenn im Testbetrieb nichts verkauft wurde", async () => {
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
    tx.order.findMany.mockResolvedValue([]);
    tx.productVoucher.deleteMany.mockResolvedValue({ count: 0 });
    tx.cashierSession.deleteMany.mockResolvedValue({ count: 0 });
    tx.eventPickupCounter.deleteMany.mockResolvedValue({ count: 0 });
    tx.auditLog.create.mockResolvedValue({ id: "audit-1" });
    tx.event.update.mockResolvedValue({
      id: "event-test",
      status: "PREPARED",
      testMode: false,
    });

    const result = await service.cleanTestData(
      "event-test",
      "admin-1",
      "Testfest",
      "cleanup-key-1",
    );

    expect(tx.inventoryMovement.deleteMany).not.toHaveBeenCalled();
    expect(tx.inventoryStock.update).not.toHaveBeenCalled();
    // Ohne zu löschende Bewegung wird die Ausnahme gar nicht erst gesetzt.
    expect(tx.$executeRaw).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        inventory: { movementsDeleted: 0, stocksReset: 0 },
      }),
    );
  });

  it("rührt den Abholnummernzähler nicht an, wenn die Bereinigung vorher abbricht", async () => {
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
    expect(tx.eventPickupCounter.deleteMany).not.toHaveBeenCalled();
  });

  it("weist eine zu tief verschachtelte Konfiguration vor Hash und Transaktion ab", async () => {
    let payload: unknown = "Ende";
    for (let depth = 0; depth < 22; depth += 1) payload = { next: payload };

    await expect(
      contract.importConfig("admin-1", "import-depth-key", payload),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  // Issue #158: Der Weg IN den Echtbetrieb lehnt vorhandene TEST-Bestellungen
  // und TEST-Kassensitzungen ab. Fuer den Rueckweg auf TEST_MODE fehlte die
  // spiegelbildliche Pruefung gegen LIVE-Bestellungen/-Kassensitzungen -
  // ohne sie koennten in einer Veranstaltung ueberhaupt erst gemischte Daten
  // entstehen, die z.B. die Zusteller-Warteschlange nicht mehr trennen kann.
  describe("changeStatus – symmetrische Betriebsartensperre (Issue #158)", () => {
    it("lehnt den Rückweg auf TEST_MODE ab, wenn für die Veranstaltung bereits LIVE-Bestellungen existieren", async () => {
      tx.$queryRaw.mockResolvedValueOnce([
        { id: "event-live", name: "Fest", status: "ACTIVE", testMode: false },
      ]);
      tx.order.count.mockImplementation(({ where }: any) =>
        Promise.resolve(where?.dataMode === "LIVE" ? 1 : 0),
      );
      tx.cashierSession.count.mockResolvedValue(0);
      tx.event.update.mockResolvedValue({
        id: "event-live",
        status: "TEST_MODE",
        testMode: true,
      });

      await expect(
        service.changeStatus(
          "event-live",
          "TEST_MODE" as EventStatus,
          "admin-1",
        ),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(tx.event.update).not.toHaveBeenCalled();
    });

    it("lehnt den Rückweg auf TEST_MODE ab, wenn für die Veranstaltung bereits eine LIVE-Kassensitzung existiert", async () => {
      tx.$queryRaw.mockResolvedValueOnce([
        { id: "event-live", name: "Fest", status: "ACTIVE", testMode: false },
      ]);
      tx.order.count.mockResolvedValue(0);
      tx.cashierSession.count.mockImplementation(({ where }: any) =>
        Promise.resolve(where?.dataMode === "LIVE" ? 1 : 0),
      );
      tx.event.update.mockResolvedValue({
        id: "event-live",
        status: "TEST_MODE",
        testMode: true,
      });

      await expect(
        service.changeStatus(
          "event-live",
          "TEST_MODE" as EventStatus,
          "admin-1",
        ),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(tx.event.update).not.toHaveBeenCalled();
    });

    it("erlaubt den Rückweg auf TEST_MODE, wenn keine LIVE-Bestellungen oder -Kassensitzungen existieren", async () => {
      tx.$queryRaw.mockResolvedValueOnce([
        { id: "event-live", name: "Fest", status: "ACTIVE", testMode: false },
      ]);
      tx.order.count.mockResolvedValue(0);
      tx.cashierSession.count.mockResolvedValue(0);
      tx.event.update.mockResolvedValue({
        id: "event-live",
        status: "TEST_MODE",
        testMode: true,
      });

      await expect(
        service.changeStatus(
          "event-live",
          "TEST_MODE" as EventStatus,
          "admin-1",
        ),
      ).resolves.toEqual(
        expect.objectContaining({ status: "TEST_MODE", testMode: true }),
      );
      expect(tx.event.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "event-live" },
          data: expect.objectContaining({
            status: "TEST_MODE",
            testMode: true,
          }),
        }),
      );
    });
  });
});
