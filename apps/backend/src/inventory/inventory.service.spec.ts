import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { OperationalDataMode, PrismaClient } from "@vereinorder/database";
import { effectiveAvailability, InventoryService } from "./inventory.service";

const eventId = "11111111-1111-4111-8111-111111111111";
const productId = "22222222-2222-4222-8222-222222222222";
const userId = "33333333-3333-4333-8333-333333333333";

const activeEvent = { status: "ACTIVE", testMode: false };
const product = {
  id: productId,
  eventId,
  name: "Limo",
  manualAvailability: "AVAILABLE",
};
const stock = {
  productId,
  eventId,
  dataMode: "LIVE",
  trackingEnabled: true,
  stockQuantity: 7,
  initialQuantity: 7,
  lowStockThreshold: 2,
  manualBlocked: false,
  version: 1,
};

function createService(
  options: { event?: unknown; existing?: unknown; stock?: unknown } = {},
) {
  const tx = {
    $queryRaw: jest.fn(),
    event: {
      findUnique: jest.fn().mockResolvedValue(options.event ?? activeEvent),
    },
    product: {
      findUnique: jest.fn().mockResolvedValue(product),
      findMany: jest.fn().mockResolvedValue([product]),
    },
    inventoryStock: {
      findUnique: jest.fn().mockResolvedValue(options.stock ?? null),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue(stock),
      update: jest.fn().mockResolvedValue({ ...stock, version: 2 }),
    },
    inventoryMovement: {
      findUnique: jest.fn().mockResolvedValue(options.existing ?? null),
      create: jest.fn().mockResolvedValue({ id: "movement" }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    auditLog: { create: jest.fn().mockResolvedValue({ id: "audit" }) },
  };
  const prisma = {
    ...tx,
    $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
      callback(tx),
    ),
  };
  const realtime = { broadcast: jest.fn() };
  return {
    service: new InventoryService(
      prisma as unknown as PrismaClient,
      realtime as never,
    ),
    prisma,
    tx,
    realtime,
  };
}

function init(overrides: Record<string, unknown> = {}) {
  return {
    eventId,
    dataMode: OperationalDataMode.LIVE,
    quantity: 7,
    lowStockThreshold: 2,
    idempotencyKey: "init-key",
    ...overrides,
  };
}

describe("effectiveAvailability – vollständige Prioritätsmatrix", () => {
  const enabled = { ...stock };
  it.each([
    [
      "DISABLED übersteuert alles",
      "DISABLED",
      { ...enabled, stockQuantity: 0, manualBlocked: true },
      "DISABLED",
    ],
    ["manuelles AUS", "OUT_OF_STOCK", enabled, "OUT_OF_STOCK"],
    [
      "manuelle Sperre",
      "AVAILABLE",
      { ...enabled, manualBlocked: true },
      "OUT_OF_STOCK",
    ],
    [
      "Bestand Null",
      "AVAILABLE",
      { ...enabled, stockQuantity: 0 },
      "OUT_OF_STOCK",
    ],
    ["manuell niedrig", "LOW_STOCK", enabled, "LOW_STOCK"],
    [
      "Schwellenwert",
      "AVAILABLE",
      { ...enabled, stockQuantity: 2 },
      "LOW_STOCK",
    ],
    [
      "Tracking aus ignoriert Nullbestand",
      "AVAILABLE",
      { ...enabled, trackingEnabled: false, stockQuantity: 0 },
      "AVAILABLE",
    ],
    ["kein Bestand ist verfügbar", "AVAILABLE", null, "AVAILABLE"],
  ] as const)("%s", (_name, manual, value, expected) => {
    expect(effectiveAvailability(manual, value)).toBe(expected);
  });
});

describe("InventoryService – Wächterregeln", () => {
  it("initialisiert je Produkt/Event/Betriebsart genau einmal und sendet erst nach Commit", async () => {
    const { service, tx, realtime } = createService();
    await service.initialize(productId, init(), userId);
    expect(tx.inventoryStock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          dataMode: "LIVE",
          initialQuantity: 7,
          stockQuantity: 7,
        }),
      }),
    );
    expect(tx.inventoryMovement.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: "INITIALIZATION",
          quantityBefore: 0,
          quantityAfter: 7,
        }),
      }),
    );
    expect(tx.auditLog.create).toHaveBeenCalled();
    expect(realtime.broadcast).toHaveBeenCalledWith(
      eventId,
      "PRODUCT_INVENTORY_CHANGED",
      // Issue #141, Fehler B: ohne productName zeigte Dashboard.tsx den
      // Warnhinweis mit "undefined" statt dem Produktnamen an.
      expect.objectContaining({
        dataMode: "LIVE",
        productId,
        productName: "Limo",
      }),
    );

    const duplicate = createService({ stock });
    await expect(
      duplicate.service.initialize(productId, init(), userId),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(duplicate.tx.inventoryStock.create).not.toHaveBeenCalled();
    expect(duplicate.realtime.broadcast).not.toHaveBeenCalled();
  });

  it("grenzt Event, aktive Betriebsart und Test/LIVE strikt vor jedem Write ab", async () => {
    const inactive = createService({
      event: { status: "DRAFT", testMode: false },
    });
    await expect(
      inactive.service.initialize(productId, init(), userId),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(inactive.tx.inventoryStock.create).not.toHaveBeenCalled();

    const test = createService({
      event: { status: "TEST_MODE", testMode: true },
    });
    await expect(
      test.service.initialize(productId, init(), userId),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(test.tx.inventoryStock.findUnique).not.toHaveBeenCalled();

    const foreignProduct = createService();
    foreignProduct.tx.product.findUnique.mockResolvedValue({
      ...product,
      eventId: "foreign",
    });
    await expect(
      foreignProduct.service.initialize(productId, init(), userId),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(foreignProduct.tx.inventoryStock.create).not.toHaveBeenCalled();
  });

  it("replayed dieselbe Anfrage ohne zweiten Write und weist denselben Key mit anderem Fingerprint ab", async () => {
    const replay = {
      idempotencyKey: "init-key",
      requestFingerprint: expect.any(String),
    };
    const same = createService({ existing: replay, stock });
    // Der echte Hash wird aus der Nutzlast gebildet; das Testobjekt erhält ihn nach dem ersten Aufruf.
    const first = createService();
    await first.service.initialize(productId, init(), userId);
    const fingerprint =
      first.tx.inventoryMovement.create.mock.calls[0][0].data
        .requestFingerprint;
    same.tx.inventoryMovement.findUnique.mockResolvedValue({
      idempotencyKey: "init-key",
      requestFingerprint: fingerprint,
    });
    await same.service.initialize(productId, init(), userId);
    expect(same.tx.inventoryStock.create).not.toHaveBeenCalled();
    expect(same.tx.inventoryMovement.create).not.toHaveBeenCalled();
    expect(same.realtime.broadcast).not.toHaveBeenCalled();

    const conflict = createService({
      existing: { idempotencyKey: "init-key", requestFingerprint: "other" },
      stock,
    });
    await expect(
      conflict.service.initialize(productId, init(), userId),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(conflict.tx.inventoryStock.create).not.toHaveBeenCalled();
  });

  it("korrigiert als absoluter Istbestand, protokolliert Delta/Grund/Audit atomar und sendet nicht bei Rollback", async () => {
    const existingStock = { ...stock, stockQuantity: 9 };
    const { service, tx, realtime } = createService({ stock: existingStock });
    tx.inventoryStock.update.mockResolvedValue({
      ...existingStock,
      stockQuantity: 3,
      version: 2,
    });
    await service.correction(
      productId,
      {
        eventId,
        dataMode: "LIVE",
        quantity: 3,
        reason: "Inventur",
        idempotencyKey: "corr",
      },
      userId,
    );
    expect(tx.inventoryStock.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ stockQuantity: 3 }),
      }),
    );
    expect(tx.inventoryMovement.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: "CORRECTION",
          quantityBefore: 9,
          quantityAfter: 3,
          quantityDelta: -6,
          reason: "Inventur",
        }),
      }),
    );
    expect(tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "INVENTORY_CORRECTION" }),
      }),
    );
    expect(realtime.broadcast).toHaveBeenCalledTimes(1);
    // Issue #141, Fehler B: derselbe Ereignistyp wie bei der Initialisierung,
    // deshalb dieselbe Erwartung an den Produktnamen.
    expect(realtime.broadcast).toHaveBeenCalledWith(
      eventId,
      "PRODUCT_INVENTORY_CHANGED",
      expect.objectContaining({ productName: "Limo" }),
    );

    const failure = createService({ stock: existingStock });
    failure.tx.inventoryMovement.create.mockRejectedValue(
      new Error("Rollback"),
    );
    await expect(
      failure.service.correction(
        productId,
        {
          eventId,
          dataMode: "LIVE",
          quantity: 3,
          reason: "Inventur",
          idempotencyKey: "fail",
        },
        userId,
      ),
    ).rejects.toThrow("Rollback");
    expect(failure.realtime.broadcast).not.toHaveBeenCalled();
  });

  it("legt Einstellungen mit Schwelle und Sperre als idempotente Mutation ab", async () => {
    const { service, tx, realtime } = createService({ stock });
    await service.settings(
      productId,
      {
        eventId,
        dataMode: "LIVE",
        lowStockThreshold: 4,
        manualBlocked: true,
      },
      userId,
    );
    expect(tx.inventoryStock.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          lowStockThreshold: 4,
          manualBlocked: true,
        }),
      }),
    );
    expect(tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "INVENTORY_SETTINGS" }),
      }),
    );
    // Issue #141, Fehler B: derselbe Ereignistyp wie bei Initialisierung und
    // Korrektur, deshalb dieselbe Erwartung an den Produktnamen.
    expect(realtime.broadcast).toHaveBeenCalledWith(
      eventId,
      "PRODUCT_INVENTORY_CHANGED",
      expect.objectContaining({ productName: "Limo" }),
    );
  });

  it("aggregiert gleiche Produkte vor dem gesperrten, bedingten Abgang", async () => {
    const { service, tx } = createService();
    tx.$queryRaw = jest
      .fn()
      .mockResolvedValueOnce([{ ...stock }])
      .mockResolvedValueOnce([
        { stockQuantity: 4, lowStockThreshold: 2, version: 2 },
      ]);

    const reservations = await service.reserveSale(tx as any, {
      eventId,
      dataMode: OperationalDataMode.LIVE,
      lines: [
        {
          productId,
          quantity: 2,
          productName: "Limo",
          manualAvailability: "AVAILABLE",
        },
        {
          productId,
          quantity: 1,
          productName: "Limo",
          manualAvailability: "AVAILABLE",
        },
      ],
    });

    expect(reservations).toEqual([
      expect.objectContaining({
        quantity: 3,
        quantityBefore: 7,
        quantityAfter: 4,
        // Issue #141, Fehler B: reserveSale traegt den Produktnamen aus der
        // Verkaufszeile in die Reservierung weiter, damit recordSales und
        // publishChanges ihn spaeter in die Realtime-Nutzlast setzen können.
        productName: "Limo",
      }),
    ]);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it("lässt unverwaltete Produkte mengenmäßig durch, sperrt aber manuell blockierte Produkte", async () => {
    const { service, tx } = createService();
    tx.$queryRaw = jest.fn().mockResolvedValue([]);
    await expect(
      service.reserveSale(tx as any, {
        eventId,
        dataMode: OperationalDataMode.LIVE,
        lines: [
          {
            productId,
            quantity: 99,
            productName: "Unverwaltet",
            manualAvailability: "AVAILABLE",
          },
        ],
      }),
    ).resolves.toEqual([]);

    tx.$queryRaw.mockResolvedValueOnce([{ ...stock, manualBlocked: true }]);
    await expect(
      service.reserveSale(tx as any, {
        eventId,
        dataMode: OperationalDataMode.LIVE,
        lines: [
          {
            productId,
            quantity: 1,
            productName: "Gesperrt",
            manualAvailability: "AVAILABLE",
          },
        ],
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: "PRODUCT_UNAVAILABLE" }),
    });
  });

  // Issue #170: Warengruppe als Gruppenschalter. categoryActive: false ist
  // derselbe harte Ausschluss wie manualAvailability "DISABLED", unabhaengig
  // vom manuellen Override und ohne Bestandszeile.
  it("sperrt ein Produkt einer stillgelegten Warengruppe, obwohl der manuelle Override AVAILABLE bleibt", async () => {
    const { service, tx } = createService();
    tx.$queryRaw = jest.fn().mockResolvedValue([]);

    await expect(
      service.reserveSale(tx as any, {
        eventId,
        dataMode: OperationalDataMode.LIVE,
        lines: [
          {
            productId,
            quantity: 1,
            productName: "Stillgelegt",
            manualAvailability: "AVAILABLE",
            categoryActive: false,
          },
        ],
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: "PRODUCT_UNAVAILABLE" }),
    });
  });

  // Gegenprobe: fehlt categoryActive ganz (bestehende Aufrufer, die das Feld
  // noch nicht kennen), gilt die Warengruppe unveraendert als aktiv.
  it("laesst ein Produkt ohne categoryActive-Angabe unveraendert durch (Rueckwaertskompatibilitaet)", async () => {
    const { service, tx } = createService();
    tx.$queryRaw = jest.fn().mockResolvedValue([]);

    await expect(
      service.reserveSale(tx as any, {
        eventId,
        dataMode: OperationalDataMode.LIVE,
        lines: [
          {
            productId,
            quantity: 1,
            productName: "Ohne Angabe",
            manualAvailability: "AVAILABLE",
          },
        ],
      }),
    ).resolves.toEqual([]);
  });
});

// Issue #141, Fehler B: Dashboard.tsx setzt den Warnhinweis bei LOW_STOCK/
// OUT_OF_STOCK aus payload.data.productName zusammen (siehe Dashboard.tsx ab
// Zeile 593). Alle drei Sendestellen von PRODUCT_INVENTORY_CHANGED mussten
// das Feld deshalb tragen - nicht nur publishChanges (automatischer
// Verkaufsabgang), sondern auch reverseSales (Storno) sowie die bereits oben
// mitgeprüften mutate()/settings()-Sendestellen (Initialisierung, Korrektur,
// Einstellungen).
describe("InventoryService – Produktname in PRODUCT_INVENTORY_CHANGED (Issue #141, Fehler B)", () => {
  it("publishChanges sendet den Produktnamen aus der übergebenen Änderung", () => {
    const { service, realtime } = createService();

    service.publishChanges(eventId, OperationalDataMode.LIVE, [
      {
        productId,
        stockQuantity: 0,
        lowStockThreshold: 2,
        version: 2,
        manualAvailability: "AVAILABLE",
        productName: "Limo",
      },
    ]);

    expect(realtime.broadcast).toHaveBeenCalledWith(
      eventId,
      "PRODUCT_INVENTORY_CHANGED",
      expect.objectContaining({
        productId,
        productName: "Limo",
        availability: "OUT_OF_STOCK",
      }),
    );
  });

  it("reverseSales ermittelt den Produktnamen über die Produktabfrage, nicht über einen Platzhalter", async () => {
    const { service, tx } = createService();
    const saleMovement = {
      id: "movement-sale-1",
      productId,
      orderItemId: "item-1",
      quantityDelta: -2,
    };
    tx.inventoryMovement.findMany = jest
      .fn()
      .mockResolvedValueOnce([{ productId }])
      .mockResolvedValueOnce([saleMovement]);
    tx.$queryRaw = jest.fn().mockResolvedValue([]);
    tx.inventoryStock.findMany = jest
      .fn()
      .mockResolvedValue([{ ...stock, stockQuantity: 5 }]);
    tx.inventoryStock.update = jest.fn().mockResolvedValue({
      ...stock,
      stockQuantity: 7,
      version: 2,
    });
    tx.product.findMany = jest
      .fn()
      .mockResolvedValue([
        { id: productId, name: "Limo", manualAvailability: "AVAILABLE" },
      ]);

    const changes = await service.reverseSales(tx as any, {
      eventId,
      dataMode: OperationalDataMode.LIVE,
      orderId: "order-1",
      orderItemIds: ["item-1"],
      actorUserId: userId,
      reason: "Storno",
    });

    expect(changes).toEqual([
      expect.objectContaining({
        productId,
        productName: "Limo",
        stockQuantity: 7,
      }),
    ]);
  });
});
