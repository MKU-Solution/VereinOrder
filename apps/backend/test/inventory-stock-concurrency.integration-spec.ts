import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { Prisma, PrismaClient } from "@vereinorder/database";
import { AuditService } from "../src/audit/audit.service";
import { buildPostgreSqlConnectionEnvironment } from "../src/backup/postgresql-backup.tools";
import { InventoryService } from "../src/inventory/inventory.service";
import { OrdersService } from "../src/orders/orders.service";
import { assertTestDatabaseUrl } from "./test-database";

const DATABASE = "vereinorder_ci_test_inventory_concurrency";
const TEST_CONFIRMATION = "VEREINORDER_TEST_ONLY";
const REPOSITORY_ROOT = path.resolve(__dirname, "..", "..", "..");

type Fixture = {
  eventId: string;
  userId: string;
  categoryId: string;
};

type Settled<T> =
  | { status: "fulfilled"; value: T }
  | { status: "rejected"; reason: any };

/**
 * Rollback-Signal der Lock-Schleuse. Die Schleuse haelt ausschliesslich den
 * Zeilenlock; sie darf den Bestand nicht veraendern, deshalb wird ihre
 * Transaktion bewusst mit einem Fehler beendet.
 */
class GateRollback extends Error {}

/** Wandelt eine laufende Zusage in ihr Ergebnis, ohne sie zu verschlucken. */
function settle<T>(promise: Promise<T>): Promise<Settled<T>> {
  return promise.then(
    (value) => ({ status: "fulfilled" as const, value }),
    (reason) => ({ status: "rejected" as const, reason }),
  );
}

/**
 * PostgreSQL-Waechtertest fuer Issue #141. Jede parallele Bestellung bekommt
 * einen eigenen Prisma-Client, damit Locks nicht nur innerhalb einer einzigen
 * Verbindung simuliert werden. Die Datenbank wird ausschliesslich unter dem
 * exakt guard-geprueften Namen angelegt und im Anschluss entfernt.
 */
describe("Bestandsfuehrung – PostgreSQL-Nebenläufigkeit (#141)", () => {
  const controlUrl = process.env.DATABASE_URL;
  const targetUrl = createTargetUrl(controlUrl);
  const target = assertTestDatabaseUrl(targetUrl, TEST_CONFIRMATION);
  let prisma: PrismaClient;
  let fixture: Fixture;
  const realtimeEvents: { eventId: string; type: string; data: any }[] = [];
  const realtime = {
    broadcast(eventId: string, type: string, data: any) {
      realtimeEvents.push({ eventId, type, data });
    },
  };

  beforeAll(async () => {
    expect(target.database).toBe(DATABASE);
    await dropTargetDatabase();
    await runPsql("postgres", [
      `CREATE DATABASE "${DATABASE}" TEMPLATE template0`,
    ]);
    await runPrismaMigrateDeploy();
    prisma = new PrismaClient({ datasources: { db: { url: targetUrl } } });
    await prisma.$connect();

    const suffix = randomUUID();
    const user = await prisma.user.create({
      data: {
        username: `inventory-concurrency-${suffix}`,
        pinHash: "test",
        role: "CASHIER",
      },
    });
    const event = await prisma.event.create({
      data: {
        name: `Inventory concurrency ${suffix}`,
        status: "TEST_MODE",
        testMode: true,
      },
    });
    const category = await prisma.productCategory.create({
      data: { name: `Inventory category ${suffix}`, eventId: event.id },
    });
    fixture = { eventId: event.id, userId: user.id, categoryId: category.id };
  }, 120_000);

  afterAll(async () => {
    await prisma?.$disconnect().catch(() => undefined);
    await dropTargetDatabase();
    const leftovers = await runPsql("postgres", [
      "SELECT datname FROM pg_database WHERE datname LIKE 'vereinorder_ci_test_%' ORDER BY datname",
    ]);
    expect(leftovers.split(/\r?\n/).filter(Boolean)).toEqual([]);
  }, 120_000);

  it("laesst bei Bestand 1 genau eine parallele Bestellung zu und erzeugt genau ein SALE-Ledger", async () => {
    const product = await productWithStock("single", 1);
    // Ab hier zaehlen nur noch Meldungen des Verkaufs: die Initialisierung
    // aus der Testvorbereitung sendet selbst ein PRODUCT_INVENTORY_CHANGED.
    const broadcastsBefore = realtimeEvents.length;
    const results = await Promise.allSettled(
      ["first", "second"].map((suffix) =>
        createOrderOnSeparateConnection(
          product.id,
          [{ productId: product.id, quantity: 1 }],
          `stock-one-${suffix}-${randomUUID()}`,
        ),
      ),
    );

    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    await expectStockAndLedger(product.id, 0, 1);
    expect(
      await prisma.order.count({
        where: {
          eventId: fixture.eventId,
          items: { some: { productId: product.id } },
        },
      }),
    ).toBe(1);
    const broadcasts = inventoryBroadcasts(product.id, broadcastsBefore);
    expect(broadcasts).toHaveLength(1);
    expect(broadcasts[0]).toEqual(
      expect.objectContaining({
        eventId: fixture.eventId,
        dataMode: "TEST",
        productId: product.id,
        stockQuantity: 0,
        availability: "OUT_OF_STOCK",
      }),
    );
  }, 60_000);

  it("begrenzt 20 parallele Einzelverkaeufe bei Bestand 5 auf genau fuenf SALEs", async () => {
    const product = await productWithStock("twenty", 5);
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, (_, index) =>
        createOrderOnSeparateConnection(
          product.id,
          [{ productId: product.id, quantity: 1 }],
          `stock-twenty-${index}-${randomUUID()}`,
        ),
      ),
    );

    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(5);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(15);
    await expectStockAndLedger(product.id, 0, 5);
    expect(
      await prisma.orderItem.count({ where: { productId: product.id } }),
    ).toBe(5);
  }, 60_000);

  it("sperrt mehrere Produkte global sortiert und vermeidet bei A,B gegen B,A PostgreSQL-Deadlocks", async () => {
    const productA = await productWithStock("lock-a", 20);
    const productB = await productWithStock("lock-b", 20);
    const attempts = await Promise.allSettled(
      Array.from({ length: 20 }, (_, index) =>
        createOrderOnSeparateConnection(
          productA.id,
          index % 2 === 0
            ? [
                { productId: productA.id, quantity: 1 },
                { productId: productB.id, quantity: 1 },
              ]
            : [
                { productId: productB.id, quantity: 1 },
                { productId: productA.id, quantity: 1 },
              ],
          `ordered-lock-${index}-${randomUUID()}`,
        ),
      ),
    );

    expect(attempts.filter((result) => result.status === "rejected")).toEqual(
      [],
    );
    await expectStockAndLedger(productA.id, 0, 20);
    await expectStockAndLedger(productB.id, 0, 20);
  }, 60_000);

  it("macht denselben parallelen Idempotenzschluessel zu genau einer Bestellung und einem Abgang", async () => {
    const product = await productWithStock("idempotency", 2);
    const key = `same-key-${randomUUID()}`;
    const [first, second] = await Promise.all([
      createOrderOnSeparateConnection(
        product.id,
        [{ productId: product.id, quantity: 1 }],
        key,
      ),
      createOrderOnSeparateConnection(
        product.id,
        [{ productId: product.id, quantity: 1 }],
        key,
      ),
    ]);

    expect(first.id).toBe(second.id);
    await expectStockAndLedger(product.id, 1, 1);
    expect(await prisma.order.count({ where: { idempotencyKey: key } })).toBe(
      1,
    );
  }, 60_000);

  it("rollt Reservierung, Bestellung und SALE-Ledger bei einem Fehler nach dem Ledger-Write vollstaendig zurueck", async () => {
    const product = await productWithStock("rollback", 1);
    const failingInventory = new InventoryService(prisma, realtime as any);
    const originalRecordSales =
      failingInventory.recordSales.bind(failingInventory);
    jest
      .spyOn(failingInventory, "recordSales")
      .mockImplementation(async (...args: any[]) => {
        await originalRecordSales(...args);
        throw new Error("injected-after-inventory-ledger");
      });
    const service = new OrdersService(
      prisma,
      new AuditService(prisma),
      failingInventory,
    );

    await expect(
      service.createOrder(
        fixture.userId,
        orderDto(
          [{ productId: product.id, quantity: 1 }],
          `rollback-${randomUUID()}`,
        ),
      ),
    ).rejects.toThrow("injected-after-inventory-ledger");
    await expectStockAndLedger(product.id, 1, 0);
    expect(
      await prisma.orderItem.count({ where: { productId: product.id } }),
    ).toBe(0);
    expect(
      await prisma.auditLog.count({
        where: { entityId: product.id, action: "INVENTORY_INITIALIZATION" },
      }),
    ).toBe(1);
  }, 60_000);

  it("verhindert bei Vollstorno parallel zu Positionsstorno Doppelgutschriften", async () => {
    const productA = await productWithStock("cancel-a", 1);
    const productB = await productWithStock("cancel-b", 1);
    const order = await createOrderOnSeparateConnection(
      productA.id,
      [
        { productId: productA.id, quantity: 1 },
        { productId: productB.id, quantity: 1 },
      ],
      `cancel-race-${randomUUID()}`,
    );
    const itemA = await prisma.orderItem.findFirstOrThrow({
      where: { orderId: order.id, productId: productA.id },
    });
    const orders = new OrdersService(
      prisma,
      new AuditService(prisma),
      new InventoryService(prisma, realtime as any),
    );
    const results = await Promise.allSettled([
      orders.cancelOrder(order.id, "Vollstorno Paralleltest", fixture.userId),
      orders.cancelOrderItem(
        itemA.id,
        "Positionsstorno Paralleltest",
        fixture.userId,
      ),
    ]);

    expect(results.some((result) => result.status === "fulfilled")).toBe(true);
    const sales = await prisma.inventoryMovement.findMany({
      where: { orderId: order.id, type: "SALE" },
      include: { reversals: true },
    });
    expect(sales).toHaveLength(2);
    expect(sales.flatMap((sale) => sale.reversals)).toHaveLength(2);
    expect(
      await prisma.inventoryMovement.count({
        where: { orderId: order.id, type: "CANCELLATION" },
      }),
    ).toBe(2);
    await expectStockAndLedger(productA.id, 1, 1);
    await expectStockAndLedger(productB.id, 1, 1);
    expect(
      await prisma.auditLog.count({
        where: { action: { in: ["CANCEL_ORDER", "CANCEL_ORDER_ITEM"] } },
      }),
    ).toBeGreaterThanOrEqual(1);
  }, 60_000);

  it("bucht eine Altposition ohne SALE auch nach spaeterer Initialisierung nie zurueck", async () => {
    const product = await prisma.product.create({
      data: {
        name: `legacy-${randomUUID()}`,
        price: 100,
        eventId: fixture.eventId,
        categoryId: fixture.categoryId,
      },
    });
    const legacyOrder = await prisma.order.create({
      data: {
        eventId: fixture.eventId,
        dataMode: "TEST",
        userId: fixture.userId,
        totalAmount: 100,
        items: {
          create: {
            productId: product.id,
            quantity: 1,
            paidQuantity: 0,
            priceAtTime: 100,
          },
        },
      },
      include: { items: true },
    });
    const inventory = new InventoryService(prisma, realtime as any);
    await inventory.initialize(
      product.id,
      {
        eventId: fixture.eventId,
        dataMode: "TEST",
        quantity: 3,
        lowStockThreshold: 0,
        idempotencyKey: `late-initialization-${randomUUID()}`,
      },
      fixture.userId,
    );

    const orders = new OrdersService(
      prisma,
      new AuditService(prisma),
      inventory,
    );
    await orders.cancelOrder(
      legacyOrder.id,
      "Altposition ohne Verkauf",
      fixture.userId,
    );
    await expectStockAndLedger(product.id, 3, 0);
    expect(
      await prisma.inventoryMovement.count({
        where: { orderItemId: legacyOrder.items[0].id, type: "CANCELLATION" },
      }),
    ).toBe(0);
  }, 60_000);

  it("veraendert beim TEST-Verkauf niemals den getrennten LIVE-Bestand", async () => {
    const product = await productWithStock("modes", 2);
    await prisma.inventoryStock.create({
      data: {
        productId: product.id,
        eventId: fixture.eventId,
        dataMode: "LIVE",
        trackingEnabled: true,
        initialQuantity: 9,
        stockQuantity: 9,
        lowStockThreshold: 1,
        version: 1,
      },
    });

    await createOrderOnSeparateConnection(
      product.id,
      [{ productId: product.id, quantity: 1 }],
      `modes-${randomUUID()}`,
    );
    const [testStock, liveStock] = await Promise.all([
      prisma.inventoryStock.findUniqueOrThrow({
        where: {
          productId_eventId_dataMode: {
            productId: product.id,
            eventId: fixture.eventId,
            dataMode: "TEST",
          },
        },
      }),
      prisma.inventoryStock.findUniqueOrThrow({
        where: {
          productId_eventId_dataMode: {
            productId: product.id,
            eventId: fixture.eventId,
            dataMode: "LIVE",
          },
        },
      }),
    ]);
    expect(testStock.stockQuantity).toBe(1);
    expect(liveStock.stockQuantity).toBe(9);
    expect(
      await prisma.inventoryMovement.count({
        where: { productId: product.id, dataMode: "LIVE", type: "SALE" },
      }),
    ).toBe(0);
  }, 60_000);

  /**
   * Der einzige Pfad, auf dem die Sperre in InventoryService allein steht:
   * OrdersService.createOrder nimmt zu Beginn seiner Transaktion
   * `SELECT ... FROM "Event" ... FOR UPDATE` und serialisiert damit alle
   * Verkaeufe derselben Veranstaltung. InventoryService.mutate (Korrektur)
   * nimmt diese Veranstaltungssperre nicht - zwischen Korrektur und Verkauf
   * schuetzt ausschliesslich der Zeilenlock auf "InventoryStock".
   *
   * Der Wettlauf wird erzwungen statt erhofft: eine dritte Verbindung haelt
   * den Zeilenlock, Korrektur und Verkauf laufen nachweislich beide in die
   * Wartschlange (pg_stat_activity), erst danach wird die Schleuse
   * zurueckgerollt. Die Korrektur reiht sich zuerst ein und gewinnt daher den
   * Lock; der Verkauf muss anschliessend auf dem korrigierten Bestand rechnen.
   */
  it("laesst eine Bestandskorrektur ohne Veranstaltungssperre nicht am parallelen Verkauf vorbeirechnen", async () => {
    const product = await productWithStock("correction-race", 1);
    const broadcastsBefore = realtimeEvents.length;
    const gate = await holdInventoryRowLock(product.id);

    const correction = settle(
      correctStockOnSeparateConnection(
        product.id,
        5,
        "Nachlieferung waehrend des Verkaufs",
      ),
    );
    const blockedAfterCorrection = await waitForBlockedBackends(
      1,
      "Korrektur wartet auf die Bestandszeile",
    );
    const sale = settle(
      createOrderOnSeparateConnection(
        product.id,
        [{ productId: product.id, quantity: 1 }],
        `correction-race-${randomUUID()}`,
      ),
    );
    const blockedDuringRace = await waitForBlockedBackends(
      2,
      "Korrektur und Verkauf warten gleichzeitig auf dieselbe Bestandszeile",
    );
    await gate.release();
    const [correctionResult, saleResult] = await Promise.all([
      correction,
      sale,
    ]);

    // Beweis, dass wirklich nebenlaeufig gearbeitet wurde: beide Vorgaenge
    // standen gleichzeitig in der Sperrenwarteschlange derselben Zeile.
    expect(blockedAfterCorrection).toBeGreaterThanOrEqual(1);
    expect(blockedDuringRace).toBeGreaterThanOrEqual(2);
    // Erwarteter Ausgang dieser Reihenfolge: kein Serialisierungskonflikt.
    // Die Korrektur haelt den Lock zuerst, der Verkauf liest danach neu.
    // Ein 40001 waere hier ein Testfehler und kein akzeptables Ergebnis.
    expect(correctionResult.status).toBe("fulfilled");
    expect(saleResult.status).toBe("fulfilled");

    const movements = await prisma.inventoryMovement.findMany({
      where: {
        productId: product.id,
        eventId: fixture.eventId,
        dataMode: "TEST",
      },
    });
    for (const movement of movements)
      expect(movement.quantityBefore + movement.quantityDelta).toBe(
        movement.quantityAfter,
      );
    expect(
      movements.filter((movement) => movement.type === "CORRECTION"),
    ).toEqual([
      expect.objectContaining({
        quantityBefore: 1,
        quantityDelta: 4,
        quantityAfter: 5,
      }),
    ]);
    // Der Verkauf darf nicht auf dem Stand vor der Korrektur rechnen: sonst
    // geht die Korrekturbewegung im Bestand verloren und die Ledgerkette
    // reisst zwischen 5 und 1 auseinander.
    expect(movements.filter((movement) => movement.type === "SALE")).toEqual([
      expect.objectContaining({
        quantityBefore: 5,
        quantityDelta: -1,
        quantityAfter: 4,
      }),
    ]);
    await expectStockAndLedger(product.id, 4, 1);
    expect(
      inventoryBroadcasts(product.id, broadcastsBefore).map(
        (data) => data.stockQuantity,
      ),
    ).toEqual(expect.arrayContaining([5, 4]));
  }, 60_000);

  /**
   * Gegenrichtung desselben ungeschuetzten Pfads: die Korrektur senkt den
   * Bestand. Der parallele Verkauf darf danach nicht mehr auf dem Stand von
   * vor der Korrektur rechnen, sonst gibt die Kasse Ware aus, die die
   * Verwaltung bereits abgeschrieben hat.
   */
  it("gibt nach einer parallel gebuchten Abwaertskorrektur keine Ware mehr aus", async () => {
    const product = await productWithStock("correction-shrink", 1);
    const gate = await holdInventoryRowLock(product.id);

    const correction = settle(
      correctStockOnSeparateConnection(product.id, 0, "Schwund erfasst"),
    );
    const blockedAfterCorrection = await waitForBlockedBackends(
      1,
      "Abwaertskorrektur wartet auf die Bestandszeile",
    );
    const sale = settle(
      createOrderOnSeparateConnection(
        product.id,
        [{ productId: product.id, quantity: 1 }],
        `correction-shrink-${randomUUID()}`,
      ),
    );
    const blockedDuringRace = await waitForBlockedBackends(
      2,
      "Abwaertskorrektur und Verkauf warten gleichzeitig auf dieselbe Bestandszeile",
    );
    await gate.release();
    const [correctionResult, saleResult] = await Promise.all([
      correction,
      sale,
    ]);

    expect(blockedAfterCorrection).toBeGreaterThanOrEqual(1);
    expect(blockedDuringRace).toBeGreaterThanOrEqual(2);
    expect(correctionResult.status).toBe("fulfilled");
    // Erwarteter Ausgang: der Verkauf scheitert fachlich am korrigierten
    // Bestand - nicht an einem Serialisierungskonflikt.
    expect(saleResult.status).toBe("rejected");
    expect(
      saleResult.status === "rejected"
        ? saleResult.reason?.getResponse?.()?.code
        : null,
    ).toBe("INVENTORY_INSUFFICIENT");
    await expectStockAndLedger(product.id, 0, 0);
    expect(
      await prisma.orderItem.count({ where: { productId: product.id } }),
    ).toBe(0);
    expect(
      await prisma.inventoryMovement.findMany({
        where: {
          productId: product.id,
          eventId: fixture.eventId,
          dataMode: "TEST",
          type: "CORRECTION",
        },
      }),
    ).toEqual([
      expect.objectContaining({
        quantityBefore: 1,
        quantityDelta: -1,
        quantityAfter: 0,
      }),
    ]);
  }, 60_000);

  it("meldet beim parallelen Abverkauf sowohl die Warnschwelle als auch den ausverkauften Bestand an alle Clients", async () => {
    const product = await productWithStock("threshold", 3, 1);
    const broadcastsBefore = realtimeEvents.length;
    const results = await Promise.allSettled(
      Array.from({ length: 3 }, (_, index) =>
        createOrderOnSeparateConnection(
          product.id,
          [{ productId: product.id, quantity: 1 }],
          `threshold-${index}-${randomUUID()}`,
        ),
      ),
    );

    expect(results.filter((result) => result.status === "rejected")).toEqual(
      [],
    );
    const broadcasts = inventoryBroadcasts(product.id, broadcastsBefore);
    // Akzeptanzkriterium 3 aus #141: jeder Verkauf meldet den erreichten
    // Bestand; beide Uebergaenge muessen dabei tatsaechlich vorkommen.
    expect(
      [...broadcasts]
        .sort((left, right) => right.stockQuantity - left.stockQuantity)
        .map((data) => ({
          stockQuantity: data.stockQuantity,
          lowStockThreshold: data.lowStockThreshold,
          availability: data.availability,
        })),
    ).toEqual([
      { stockQuantity: 2, lowStockThreshold: 1, availability: "AVAILABLE" },
      { stockQuantity: 1, lowStockThreshold: 1, availability: "LOW_STOCK" },
      { stockQuantity: 0, lowStockThreshold: 1, availability: "OUT_OF_STOCK" },
    ]);
    await expectStockAndLedger(product.id, 0, 3);
  }, 60_000);

  function inventoryBroadcasts(productId: string, fromIndex = 0) {
    return realtimeEvents
      .slice(fromIndex)
      .filter(
        (entry) =>
          entry.type === "PRODUCT_INVENTORY_CHANGED" &&
          entry.data.productId === productId,
      )
      .map((entry) => entry.data);
  }

  /**
   * Haelt den Zeilenlock der Bestandszeile auf einer eigenen Verbindung, damit
   * Korrektur und Verkauf gezielt in dieselbe Warteschlange laufen. Die
   * Transaktion wird beim Freigeben zurueckgerollt und veraendert nichts.
   */
  async function holdInventoryRowLock(productId: string) {
    const gate = new PrismaClient({
      datasources: { db: { url: targetUrl } },
    });
    await gate.$connect();
    let markLocked!: () => void;
    const locked = new Promise<void>((resolve) => {
      markLocked = resolve;
    });
    let markReleased!: () => void;
    const released = new Promise<void>((resolve) => {
      markReleased = resolve;
    });
    const finished = gate
      .$transaction(
        async (tx) => {
          await tx.$queryRaw(Prisma.sql`
            SELECT "productId"
            FROM "InventoryStock"
            WHERE "productId" = ${productId}
              AND "eventId" = ${fixture.eventId}
              AND "dataMode" = ${"TEST"}::"OperationalDataMode"
            FOR UPDATE
          `);
          markLocked();
          await released;
          throw new GateRollback();
        },
        { timeout: 30_000, maxWait: 30_000 },
      )
      .catch((error) => {
        if (!(error instanceof GateRollback)) throw error;
      })
      .finally(() => gate.$disconnect().catch(() => undefined));
    await locked;
    return {
      async release() {
        markReleased();
        await finished;
      },
    };
  }

  /** Wartet aktiv darauf, dass die erwartete Anzahl Verbindungen blockiert. */
  async function waitForBlockedBackends(expected: number, hint: string) {
    const deadline = Date.now() + 15_000;
    let waiting = 0;
    while (Date.now() < deadline) {
      const rows = await prisma.$queryRaw<{ waiting: number }[]>(Prisma.sql`
        SELECT count(*)::int AS waiting
        FROM pg_stat_activity
        WHERE datname = ${DATABASE}
          AND wait_event_type = 'Lock'
      `);
      waiting = rows[0]?.waiting ?? 0;
      if (waiting >= expected) return waiting;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(
      `Erwartete ${expected} blockierte Verbindungen (${hint}), beobachtet: ${waiting}`,
    );
  }

  async function correctStockOnSeparateConnection(
    productId: string,
    quantity: number,
    reason: string,
  ) {
    const connection = new PrismaClient({
      datasources: { db: { url: targetUrl } },
    });
    try {
      await connection.$connect();
      const inventory = new InventoryService(connection, realtime as any);
      return await inventory.correction(
        productId,
        {
          eventId: fixture.eventId,
          dataMode: "TEST",
          quantity,
          reason,
          idempotencyKey: `correction-${randomUUID()}`,
        },
        fixture.userId,
      );
    } finally {
      await connection.$disconnect();
    }
  }

  async function productWithStock(
    name: string,
    quantity: number,
    lowStockThreshold = 0,
  ) {
    const product = await prisma.product.create({
      data: {
        name: `${name}-${randomUUID()}`,
        price: 100,
        eventId: fixture.eventId,
        categoryId: fixture.categoryId,
      },
    });
    const inventory = new InventoryService(prisma, realtime as any);
    await inventory.initialize(
      product.id,
      {
        eventId: fixture.eventId,
        dataMode: "TEST",
        quantity,
        lowStockThreshold,
        idempotencyKey: `initialize-${name}-${randomUUID()}`,
      },
      fixture.userId,
    );
    return product;
  }

  async function createOrderOnSeparateConnection(
    _primaryProductId: string,
    items: { productId: string; quantity: number }[],
    idempotencyKey: string,
  ) {
    const connection = new PrismaClient({
      datasources: { db: { url: targetUrl } },
    });
    try {
      await connection.$connect();
      // Die Verkaufsmeldung muss dort landen, wo der Test sie auch prueft.
      // Ein verbindungseigenes Wegwerf-Array wuerde jede Realtime-Aussage
      // dieses Tests wertlos machen.
      const inventory = new InventoryService(connection, realtime as any);
      const service = new OrdersService(
        connection,
        new AuditService(connection),
        inventory,
      );
      return await service.createOrder(
        fixture.userId,
        orderDto(items, idempotencyKey),
      );
    } finally {
      await connection.$disconnect();
    }
  }

  function orderDto(
    items: { productId: string; quantity: number }[],
    idempotencyKey: string,
  ) {
    return {
      eventId: fixture.eventId,
      items,
      payments: [],
      idempotencyKey,
    } as any;
  }

  async function expectStockAndLedger(
    productId: string,
    expectedStock: number,
    expectedSales: number,
  ) {
    const [stock, sales, negative] = await Promise.all([
      prisma.inventoryStock.findUniqueOrThrow({
        where: {
          productId_eventId_dataMode: {
            productId,
            eventId: fixture.eventId,
            dataMode: "TEST",
          },
        },
      }),
      prisma.inventoryMovement.count({
        where: {
          productId,
          eventId: fixture.eventId,
          dataMode: "TEST",
          type: "SALE",
        },
      }),
      prisma.inventoryStock.count({
        where: {
          eventId: fixture.eventId,
          dataMode: "TEST",
          stockQuantity: { lt: 0 },
        },
      }),
    ]);
    expect(stock.stockQuantity).toBe(expectedStock);
    expect(sales).toBe(expectedSales);
    expect(negative).toBe(0);
  }

  async function dropTargetDatabase() {
    await runPsql("postgres", [
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${DATABASE}' AND pid <> pg_backend_pid()`,
      `DROP DATABASE IF EXISTS "${DATABASE}"`,
    ]);
  }

  async function runPrismaMigrateDeploy() {
    const executable = path.join(
      REPOSITORY_ROOT,
      "node_modules",
      ".pnpm",
      "prisma@5.22.0",
      "node_modules",
      "prisma",
      "build",
      "index.js",
    );
    if (!fs.existsSync(executable))
      throw new Error(
        "Lokales Prisma-Binary fuer den Bestands-Waechtertest fehlt.",
      );
    await run(
      process.execPath,
      [
        executable,
        "migrate",
        "deploy",
        "--schema",
        path.join(
          REPOSITORY_ROOT,
          "packages",
          "database",
          "prisma",
          "schema.prisma",
        ),
      ],
      { ...process.env, DATABASE_URL: targetUrl },
    );
  }

  async function runPsql(database: string, commands: string[]) {
    const connection = buildPostgreSqlConnectionEnvironment(controlUrl!);
    const executable =
      process.platform === "win32" &&
      fs.existsSync("C:\\Program Files\\PostgreSQL\\18\\bin\\psql.exe")
        ? "C:\\Program Files\\PostgreSQL\\18\\bin\\psql.exe"
        : "psql";
    return run(
      executable,
      [
        "--no-psqlrc",
        "--set=ON_ERROR_STOP=1",
        "--tuples-only",
        "--no-align",
        ...commands.map((command) => `--command=${command}`),
      ],
      { ...connection.environment, PGDATABASE: database },
    );
  }
});

function createTargetUrl(controlUrl: string | undefined): string {
  if (!controlUrl)
    throw new Error("DATABASE_URL fehlt fuer den PostgreSQL-Waechtertest.");
  const target = new URL(controlUrl);
  target.pathname = `/${DATABASE}`;
  return target.toString();
}

function run(
  executable: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: REPOSITORY_ROOT,
      env,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.once("error", reject);
    child.once("close", (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `${path.basename(executable)} endete mit ${code}: ${Buffer.concat(stderr).toString("utf8").trim()}`,
          ),
        );
        return;
      }
      resolve(Buffer.concat(stdout).toString("utf8").trim());
    });
  });
}
