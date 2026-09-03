import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { Prisma, PrismaClient } from "@vereinorder/database";
import { AuditService } from "../src/audit/audit.service";
import { buildPostgreSqlConnectionEnvironment } from "../src/backup/postgresql-backup.tools";
import { EventsService } from "../src/events/events.service";
import { InventoryService } from "../src/inventory/inventory.service";
import { OrdersService } from "../src/orders/orders.service";
import { ReportsService } from "../src/reports/reports.service";
import { assertTestDatabaseUrl } from "./test-database";

const DATABASE = "vereinorder_ci_test_event_cleanup_inventory";
const TEST_CONFIRMATION = "VEREINORDER_TEST_ONLY";
const REPOSITORY_ROOT = path.resolve(__dirname, "..", "..", "..");
const FINGERPRINT = "f".repeat(64);

/**
 * Die beiden Sperren, die eine Testbestellung mit Bestandsbewegung am Loeschen
 * hindern. Sie werden namentlich festgehalten, weil der SQLSTATE allein nicht
 * zeigt, welcher Fremdschluessel verweigert hat - und auf der unterstuetzten
 * PostgreSQL-Fassung 16 auch nicht, ob es ueberhaupt eine RESTRICT-Sperre war
 * (siehe Kommentar am Testfall).
 */
const ITEM_LOCK = "InventoryMovement_orderItemId_orderId_productId_fkey";
const ORDER_LOCK = "InventoryMovement_orderId_eventId_dataMode_fkey";

type Scene = {
  eventId: string;
  eventName: string;
  userId: string;
  categoryId: string;
  soldProductId: string;
  untouchedProductId: string;
};

/** Rollback-Signal fuer Pruefungen, die nichts hinterlassen duerfen. */
class Rollback extends Error {}

/**
 * Waechtertest fuer die Testdatenbereinigung einer bestandsgefuehrten
 * Veranstaltung (#141, Abnahmefehler B1).
 *
 * Fremdschluessel und Trigger dieses Themas existieren ausschliesslich in
 * PostgreSQL: "InventoryMovement" haengt per ON DELETE RESTRICT an "Order"
 * und "OrderItem", und der Append-only-Trigger verbietet jedes DELETE auf dem
 * Ledger. Ein Test mit Mocks kann darueber nichts aussagen, deshalb laeuft
 * dieser Test gegen eine eigene, hinterher wieder entfernte Datenbank.
 */
describe("Testdatenbereinigung mit Bestandsfuehrung (#141)", () => {
  const controlUrl = process.env.DATABASE_URL;
  const targetUrl = createTargetUrl(controlUrl);
  const target = assertTestDatabaseUrl(targetUrl, TEST_CONFIRMATION);
  let prisma: PrismaClient;
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
  }, 180_000);

  afterAll(async () => {
    await prisma?.$disconnect().catch(() => undefined);
    await dropTargetDatabase();
    const leftovers = await runPsql("postgres", [
      "SELECT datname FROM pg_database WHERE datname LIKE 'vereinorder_ci_test_%' ORDER BY datname",
    ]);
    expect(leftovers.split(/\r?\n/).filter(Boolean)).toEqual([]);
  }, 180_000);

  /**
   * Der eigentliche Abnahmefall: im Testbetrieb wurde ein bestandsgefuehrtes
   * Produkt verkauft, storniert und korrigiert. Die Bereinigung muss danach
   * durchlaufen, den Bestand wieder auf den Ausgangswert stellen und den
   * Bestand des Echtbetriebs derselben Veranstaltung unangetastet lassen.
   */
  it("bereinigt eine bestandsgefuehrte Testveranstaltung und stellt Bestand und Ledger auf den Ausgangsstand", async () => {
    const scene = await createScene("abnahme");
    const orders = ordersService();
    const inventory = new InventoryService(prisma, realtime as any);

    const kept = await orders.createOrder(
      scene.userId,
      orderDto(scene.eventId, [
        { productId: scene.soldProductId, quantity: 3 },
      ]),
    );
    const cancelled = await orders.createOrder(
      scene.userId,
      orderDto(scene.eventId, [
        { productId: scene.soldProductId, quantity: 1 },
      ]),
    );
    await orders.cancelOrder(cancelled.id, "Fehlbuchung im Test", scene.userId);
    await inventory.correction(
      scene.soldProductId,
      {
        eventId: scene.eventId,
        dataMode: "TEST",
        quantity: 5,
        reason: "Schwund waehrend des Testbetriebs",
        idempotencyKey: `test-correction-${randomUUID()}`,
      },
      scene.userId,
    );

    // Ausgangslage vor der Bereinigung: der Testbetrieb hat den Bestand
    // nachweislich veraendert, und der Echtbestand steht daneben.
    expect(await stock(scene.soldProductId, scene.eventId, "TEST")).toEqual(
      expect.objectContaining({ stockQuantity: 5, initialQuantity: 10 }),
    );
    const liveBefore = await stock(scene.soldProductId, scene.eventId, "LIVE");
    const untouchedBefore = await stock(
      scene.untouchedProductId,
      scene.eventId,
      "TEST",
    );
    expect(
      await prisma.inventoryMovement.count({
        where: { eventId: scene.eventId, dataMode: "TEST" },
      }),
    ).toBe(6);

    const events = new EventsService(prisma);
    const outcome = await settle(
      events.cleanTestData(
        scene.eventId,
        scene.userId,
        scene.eventName,
        `cleanup-${randomUUID()}`,
      ),
    );
    if (outcome.status === "rejected")
      throw new Error(
        `cleanTestData scheiterte mit SQLSTATE ${postgresErrorCode(outcome.reason) ?? "unbekannt"}: ${describeError(outcome.reason)}`,
      );
    expect(outcome.value).toEqual(
      expect.objectContaining({
        success: true,
        event: expect.objectContaining({ status: "PREPARED", testMode: false }),
        inventory: { movementsDeleted: 4, stocksReset: 1 },
      }),
    );

    // 1. Operative Testdaten sind fort.
    expect(
      await prisma.order.count({ where: { eventId: scene.eventId } }),
    ).toBe(0);
    expect(await prisma.orderItem.count({ where: { orderId: kept.id } })).toBe(
      0,
    );

    // 2. Vom Ledger bleibt genau die Initialisierung stehen. Sie erklaert den
    //    Bestand; Verkauf, Storno und Korrektur des Testbetriebs sind fort.
    const remaining = await prisma.inventoryMovement.findMany({
      where: { eventId: scene.eventId, dataMode: "TEST" },
      orderBy: { productId: "asc" },
    });
    expect(remaining.map((movement) => movement.type)).toEqual([
      "INITIALIZATION",
      "INITIALIZATION",
    ]);
    expect(
      remaining.find((movement) => movement.productId === scene.soldProductId),
    ).toEqual(
      expect.objectContaining({
        quantityBefore: 0,
        quantityDelta: 10,
        quantityAfter: 10,
      }),
    );

    // 3. Die konfigurierte Bestandsfuehrung ueberlebt, die Menge steht wieder
    //    auf dem Ausgangswert.
    const testAfter = await stock(scene.soldProductId, scene.eventId, "TEST");
    expect(testAfter).toEqual(
      expect.objectContaining({
        trackingEnabled: true,
        initialQuantity: 10,
        stockQuantity: 10,
        lowStockThreshold: 2,
        manualBlocked: false,
      }),
    );
    expect(testAfter.version).toBeGreaterThan(1);

    // 4. Eine unbenutzte Bestandszeile wird gar nicht erst angefasst.
    expect(
      await stock(scene.untouchedProductId, scene.eventId, "TEST"),
    ).toEqual(untouchedBefore);

    // 5. Der Echtbestand derselben Veranstaltung bleibt Zeile fuer Zeile
    //    unveraendert - einschliesslich Version und Zeitstempel.
    expect(await stock(scene.soldProductId, scene.eventId, "LIVE")).toEqual(
      liveBefore,
    );
    expect(
      await prisma.inventoryMovement.findMany({
        where: { eventId: scene.eventId, dataMode: "LIVE" },
      }),
    ).toEqual([
      expect.objectContaining({
        type: "INITIALIZATION",
        quantityAfter: 7,
        dataMode: "LIVE",
      }),
    ]);

    // 6. Der Soll-Ist-Vergleich der Revision zeigt danach keine Differenz,
    //    die niemand verursacht hat. Die bereinigte Veranstaltung steht auf
    //    PREPARED und hat damit keine Betriebsart, unter der die Revision
    //    berichten koennte - geprueft wird deshalb der Zustand, den der
    //    naechste Testlauf vorfindet.
    await prisma.event.update({
      where: { id: scene.eventId },
      data: { status: "TEST_MODE", testMode: true },
    });
    const report = await new ReportsService(prisma).getInventoryReport(
      scene.eventId,
      "TEST",
    );
    expect(
      report.map((row) => ({
        productId: row.productId,
        expectedQuantity: row.expectedQuantity,
        actualQuantity: row.actualQuantity,
        difference: row.difference,
      })),
    ).toEqual(
      expect.arrayContaining([
        {
          productId: scene.soldProductId,
          expectedQuantity: 10,
          actualQuantity: 10,
          difference: 0,
        },
        {
          productId: scene.untouchedProductId,
          expectedQuantity: 4,
          actualQuantity: 4,
          difference: 0,
        },
      ]),
    );

    // 7. Der Eingriff ist auditierbar: die verschwundenen Ledgerzeilen sind
    //    im Protokoll benannt, sowohl gesamt als auch je Bestandszeile.
    const cleaned = await prisma.auditLog.findFirstOrThrow({
      where: { action: "EVENT_TEST_DATA_CLEANED", entityId: scene.eventId },
    });
    expect(cleaned.details).toEqual(
      expect.objectContaining({
        inventoryMovementsDeleted: 4,
        inventoryStocksReset: 1,
      }),
    );
    const resetLog = await prisma.auditLog.findMany({
      where: { action: "INVENTORY_TEST_DATA_RESET" },
    });
    expect(resetLog).toHaveLength(1);
    expect(resetLog[0]).toEqual(
      expect.objectContaining({
        entityType: "Product",
        entityId: scene.soldProductId,
        userId: scene.userId,
      }),
    );
    expect(resetLog[0].details).toEqual(
      expect.objectContaining({
        eventId: scene.eventId,
        dataMode: "TEST",
        previousStockQuantity: 5,
        stockQuantity: 10,
        movementsDeleted: 4,
      }),
    );

    // 8. Die Ausnahme war transaktionslokal: nach der Bereinigung ist das
    //    Ledger wieder unveraenderlich.
    expect(
      postgresErrorCode(
        await rejection(
          prisma.$executeRaw(
            Prisma.sql`DELETE FROM "InventoryMovement" WHERE "id" = ${remaining[0].id}`,
          ),
        ),
      ),
    ).toBe("55000");
    expect(
      await prisma.$queryRaw<{ value: string | null }[]>(
        Prisma.sql`SELECT current_setting('vereinorder.inventory_test_reset', true) AS "value"`,
      ),
    ).toEqual([{ value: null }]);
  }, 180_000);

  /**
   * Beleg fuer die Ursache des Abnahmefehlers und zugleich fuer die Grenze,
   * die bestehen bleibt: eine Testbestellung mit Bestandsbewegung kann nie
   * einfach geloescht werden.
   *
   * Zugesichert ist nicht bloss ein Fehlschlag, sondern dass genau die dafuer
   * vorgesehene Bestandssperre verweigert. Ein fest verdrahteter SQLSTATE
   * taugt dafuer nicht: bis einschliesslich PostgreSQL 17 meldet der Server
   * fuer ON DELETE RESTRICT denselben Code 23503 (foreign_key_violation) wie
   * fuer ON DELETE NO ACTION, erst PostgreSQL 18 unterscheidet und meldet
   * 23001 (restrict_violation). Der urspruengliche Test erwartete 23001 und
   * war damit gegen die Entwicklungsfassung 18 gruen und gegen die
   * unterstuetzte Fassung 16 der CI rot (Issue #204). Nachgewiesen wird die
   * Zusage deshalb an dem, was sie tatsaechlich ausmacht:
   *
   *  1. Es gibt ueberhaupt etwas zu sperren - der Verkauf hat eine Bewegung
   *     erzeugt, die an Bestellung und Position haengt.
   *  2. Beide Sperren sind in der migrierten Datenbank als RESTRICT
   *     deklariert, nicht als NO ACTION oder CASCADE.
   *  3. Das Loeschen scheitert namentlich an ihnen und nicht zufaellig an
   *     einem anderen Fremdschluessel; der erwartete SQLSTATE wird aus der
   *     Serverfassung abgeleitet statt festgeschrieben.
   *  4. Sie verbieten nicht alles: ohne die Bewegung ist dieselbe Bestellung
   *     loeschbar - genau darauf beruht die erlaubte Bereinigung.
   */
  it("verweigert das Loeschen einer Testbestellung an der Bestandssperre", async () => {
    const scene = await createScene("restrict");
    const order = await ordersService().createOrder(
      scene.userId,
      orderDto(scene.eventId, [
        { productId: scene.soldProductId, quantity: 1 },
      ]),
    );

    // 1. Die Sperre hat etwas zu sperren.
    const movement = await prisma.inventoryMovement.findFirstOrThrow({
      where: { orderId: order.id },
    });
    expect(movement).toEqual(
      expect.objectContaining({
        type: "SALE",
        dataMode: "TEST",
        quantityDelta: -1,
      }),
    );
    expect(movement.orderItemId).not.toBeNull();

    // 2. Beide Sperren sind sofort pruefende RESTRICT-Beziehungen.
    expect([await deleteRule(ITEM_LOCK), await deleteRule(ORDER_LOCK)]).toEqual(
      ["RESTRICT", "RESTRICT"],
    );

    // 3. Und genau sie verweigern das Loeschen.
    const expectedCode = await restrictViolationCode();
    const itemRejection = await rejection(
      prisma.$executeRaw(
        Prisma.sql`DELETE FROM "OrderItem" WHERE "orderId" = ${order.id}`,
      ),
    );
    expect([
      postgresErrorCode(itemRejection),
      postgresConstraintName(itemRejection),
    ]).toEqual([expectedCode, ITEM_LOCK]);
    const orderRejection = await rejection(
      prisma.$executeRaw(
        Prisma.sql`DELETE FROM "Order" WHERE "id" = ${order.id}`,
      ),
    );
    expect([
      postgresErrorCode(orderRejection),
      postgresConstraintName(orderRejection),
    ]).toEqual([expectedCode, ORDER_LOCK]);

    // 4. Faellt die Bewegung ueber die Bereinigungsausnahme weg, laesst sich
    //    dieselbe Bestellung loeschen. Die Sperre verbietet also die
    //    Bestandsbewegung, nicht das Loeschen an sich.
    await expect(
      withTestResetFlag(async (tx) => {
        expect(await deleteMovement(tx, movement.id)).toBe(1);
        expect(
          await tx.$executeRaw(
            Prisma.sql`DELETE FROM "OrderItem" WHERE "orderId" = ${order.id}`,
          ),
        ).toBe(1);
        expect(
          await tx.$executeRaw(
            Prisma.sql`DELETE FROM "Order" WHERE "id" = ${order.id}`,
          ),
        ).toBe(1);
        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);

    // Der Gegenbeweis hat nichts hinterlassen.
    expect(await prisma.order.count({ where: { id: order.id } })).toBe(1);
    expect(
      await prisma.inventoryMovement.count({ where: { id: movement.id } }),
    ).toBe(1);
  }, 180_000);

  /**
   * Die Ausnahme der Bereinigung darf nur genau eines koennen: TEST-Zeilen
   * loeschen. Weder LIVE-Zeilen noch nachtraegliche Aenderungen sind damit
   * erreichbar - und ohne sie bleibt das Ledger vollstaendig unveraenderlich.
   */
  it("oeffnet die Bereinigungsausnahme weder fuer LIVE-Bewegungen noch fuer Aenderungen", async () => {
    const scene = await createScene("guard");
    const testMovement = await prisma.inventoryMovement.findFirstOrThrow({
      where: {
        eventId: scene.eventId,
        dataMode: "TEST",
        productId: scene.soldProductId,
      },
    });
    const liveMovement = await prisma.inventoryMovement.findFirstOrThrow({
      where: { eventId: scene.eventId, dataMode: "LIVE" },
    });

    // Ohne Ausnahme: unveraenderlich.
    expect(
      postgresErrorCode(
        await rejection(
          prisma.$executeRaw(
            Prisma.sql`DELETE FROM "InventoryMovement" WHERE "id" = ${testMovement.id}`,
          ),
        ),
      ),
    ).toBe("55000");

    // Mit Ausnahme: LIVE bleibt gesperrt.
    expect(
      postgresErrorCode(
        await rejection(
          withTestResetFlag((tx) => deleteMovement(tx, liveMovement.id)),
        ),
      ),
    ).toBe("55000");

    // Mit Ausnahme: Aenderungen bleiben gesperrt, auch an TEST-Zeilen.
    expect(
      postgresErrorCode(
        await rejection(
          withTestResetFlag((tx) =>
            tx.$executeRaw(
              Prisma.sql`UPDATE "InventoryMovement" SET "reason" = 'manipuliert' WHERE "id" = ${testMovement.id}`,
            ),
          ),
        ),
      ),
    ).toBe("55000");

    // Mit Ausnahme: genau ein Loeschen einer TEST-Zeile ist erlaubt.
    await expect(
      withTestResetFlag(async (tx) => {
        expect(await deleteMovement(tx, testMovement.id)).toBe(1);
        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);

    // Nichts davon hat etwas hinterlassen.
    expect(
      await prisma.inventoryMovement.count({
        where: { id: { in: [testMovement.id, liveMovement.id] } },
      }),
    ).toBe(2);
    expect(
      (
        await prisma.inventoryMovement.findUniqueOrThrow({
          where: { id: testMovement.id },
        })
      ).reason,
    ).toBeNull();
  }, 180_000);

  function ordersService() {
    return new OrdersService(
      prisma,
      new AuditService(prisma),
      new InventoryService(prisma, realtime as any),
    );
  }

  function orderDto(
    eventId: string,
    items: { productId: string; quantity: number }[],
  ) {
    return {
      eventId,
      items,
      payments: [],
      idempotencyKey: `order-${randomUUID()}`,
    } as any;
  }

  function deleteMovement(tx: Prisma.TransactionClient, id: string) {
    return tx.$executeRaw(
      Prisma.sql`DELETE FROM "InventoryMovement" WHERE "id" = ${id}`,
    );
  }

  /**
   * Fuehrt eine Anweisung mit gesetzter Bereinigungsausnahme aus. SET LOCAL
   * gilt ausschliesslich innerhalb dieser Transaktion.
   */
  function withTestResetFlag<T>(
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ) {
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw(
        Prisma.sql`SET LOCAL "vereinorder.inventory_test_reset" = 'on'`,
      );
      return work(tx);
    });
  }

  /**
   * Der SQLSTATE, mit dem die laufende Serverfassung eine
   * RESTRICT-Verweigerung meldet. Bis PostgreSQL 17 ist das 23503 wie bei
   * jeder anderen Fremdschluesselverletzung, ab PostgreSQL 18 der eigene
   * Code 23001. Unterstuetzt ist Fassung 16 (docs/development/testing.md);
   * die Ableitung haelt den Test auch auf neueren Entwicklungsstaenden
   * scharf, statt ihn dort gruen oder hier rot zu machen.
   */
  async function restrictViolationCode() {
    const [row] = await prisma.$queryRaw<{ major: number }[]>(
      Prisma.sql`SELECT current_setting('server_version_num')::int / 10000 AS "major"`,
    );
    return Number(row.major) >= 18 ? "23001" : "23503";
  }

  /**
   * Liest die Loeschregel einer Fremdschluesselbedingung aus dem migrierten
   * Katalog. Auf der unterstuetzten Fassung 16 ist das die einzige Stelle,
   * an der sich RESTRICT von NO ACTION unterscheiden laesst - der Fehlercode
   * ist dort fuer beide derselbe.
   */
  async function deleteRule(constraint: string) {
    const [row] = await prisma.$queryRaw<{ rule: string }[]>(
      Prisma.sql`SELECT "delete_rule" AS "rule"
        FROM information_schema.referential_constraints
        WHERE "constraint_name" = ${constraint}
          AND "constraint_schema" = current_schema()`,
    );
    return row?.rule ?? null;
  }

  function stock(
    productId: string,
    eventId: string,
    dataMode: "TEST" | "LIVE",
  ) {
    return prisma.inventoryStock.findUniqueOrThrow({
      where: {
        productId_eventId_dataMode: { productId, eventId, dataMode },
      },
    });
  }

  /**
   * Legt eine Veranstaltung im Testbetrieb an: ein bestandsgefuehrtes Produkt
   * mit zusaetzlichem Echtbestand derselben Veranstaltung und ein zweites,
   * bestandsgefuehrtes, aber unbenutztes Produkt.
   */
  async function createScene(name: string): Promise<Scene> {
    const suffix = randomUUID();
    const user = await prisma.user.create({
      data: {
        username: `cleanup-${name}-${suffix}`,
        pinHash: "test",
        role: "ADMINISTRATOR",
      },
    });
    const eventName = `Bereinigung ${name} ${suffix}`;
    const event = await prisma.event.create({
      data: { name: eventName, status: "TEST_MODE", testMode: true },
    });
    const category = await prisma.productCategory.create({
      data: { name: `Kategorie ${suffix}`, eventId: event.id },
    });
    const inventory = new InventoryService(prisma, realtime as any);
    const sold = await prisma.product.create({
      data: {
        name: `bestandsgefuehrt-${suffix}`,
        price: 100,
        eventId: event.id,
        categoryId: category.id,
      },
    });
    const untouched = await prisma.product.create({
      data: {
        name: `unbenutzt-${suffix}`,
        price: 150,
        eventId: event.id,
        categoryId: category.id,
      },
    });
    for (const [product, quantity, threshold] of [
      [sold, 10, 2],
      [untouched, 4, 0],
    ] as const)
      await inventory.initialize(
        product.id,
        {
          eventId: event.id,
          dataMode: "TEST",
          quantity,
          lowStockThreshold: threshold,
          idempotencyKey: `initialize-${product.id}`,
        },
        user.id,
      );

    // Echtbestand derselben Veranstaltung. Ueber den Dienst ist er im
    // Testbetrieb nicht erreichbar, fuer den Nachweis der Trennung muss er
    // aber existieren - deshalb wird er hier direkt angelegt.
    await prisma.inventoryStock.create({
      data: {
        productId: sold.id,
        eventId: event.id,
        dataMode: "LIVE",
        trackingEnabled: true,
        initialQuantity: 7,
        stockQuantity: 7,
        lowStockThreshold: 1,
        version: 1,
      },
    });
    await prisma.inventoryMovement.create({
      data: {
        type: "INITIALIZATION",
        productId: sold.id,
        eventId: event.id,
        dataMode: "LIVE",
        quantityDelta: 7,
        quantityBefore: 0,
        quantityAfter: 7,
        actorUserId: user.id,
        idempotencyKey: `live-initialize-${sold.id}`,
        requestFingerprint: FINGERPRINT,
      },
    });

    return {
      eventId: event.id,
      eventName,
      userId: user.id,
      categoryId: category.id,
      soldProductId: sold.id,
      untouchedProductId: untouched.id,
    };
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
      throw new Error("Lokales Prisma-Binary fuer den Bereinigungstest fehlt.");
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

type Settled<T> =
  | { status: "fulfilled"; value: T }
  | { status: "rejected"; reason: any };

function settle<T>(promise: Promise<T>): Promise<Settled<T>> {
  return promise.then(
    (value) => ({ status: "fulfilled" as const, value }),
    (reason) => ({ status: "rejected" as const, reason }),
  );
}

/** Erzwingt eine Ablehnung und liefert deren Grund fuer die Codepruefung. */
async function rejection(promise: Promise<unknown>) {
  const settled = await settle(promise);
  if (settled.status === "fulfilled")
    throw new Error(
      `Erwartet wurde eine Ablehnung, erhalten wurde ${JSON.stringify(settled.value)}.`,
    );
  return settled.reason;
}

/**
 * Liest den SQLSTATE aus einem Prisma-Fehler. Rohabfragen melden ihn in
 * `meta.code`, uebersetzte Fehler tragen ihn im Meldungstext.
 */
function postgresErrorCode(error: unknown): string | null {
  const candidate = error as { meta?: { code?: unknown } } | null;
  const metaCode = candidate?.meta?.code;
  if (typeof metaCode === "string") return metaCode;
  const message = describeError(error);
  return /(?:code|sqlstate)[^0-9]{0,12}(\d{5})/i.exec(message)?.[1] ?? null;
}

/**
 * Liest den Namen der verletzten Fremdschluesselbedingung aus einem
 * Prisma-Fehler. PostgreSQL nennt ihn im Meldungstext; er ist das einzige
 * Merkmal, an dem sich die Bestandssperre von jedem anderen Fremdschluessel
 * unterscheiden laesst.
 *
 * Der umgebende Satz ist NICHT sprachunabhaengig: ein englischer Server
 * schreibt `violates foreign key constraint "..."` (ab Fassung 18 mit
 * eingeschobenem "RESTRICT setting of"), ein deutscher dagegen
 * `verletzt die RESTRICT-Einstellung des Fremdschluessel-Constraints
 * »...«` - andere Woerter UND andere Anfuehrungszeichen (» «, nicht " ").
 * Nachgewiesen an diesem Rechner: `SHOW lc_messages` liefert hier
 * `German_Germany.1252`, CI meldet dagegen englisch - beide Faelle muessen
 * tragen (#219). Ein rein englischer Ausdruck faende den Namen deshalb nur
 * in CI und liefe hier still leer, ohne dass sich das im SQLSTATE zeigen
 * wuerde.
 *
 * Was in beiden Sprachfassungen gleich bleibt, ist das unuebersetzte Wort
 * "constraint" selbst (PostgreSQL uebernimmt es auch in der deutschen
 * Uebersetzung woertlich, siehe "Fremdschluessel-Constraints" oben) sowie
 * die Tatsache, dass ihm der in Anfuehrungszeichen gesetzte Bezeichner
 * unmittelbar folgt - nur eben in " " oder in » «. Genau darauf stuetzt
 * sich dieser Ausdruck, NICHT auf eine der beiden vollen Formulierungen.
 * Wer ihn "vereinfacht", indem er eine der beiden Sprachfassungen
 * herausnimmt, macht den Test wieder von der Serversprache abhaengig.
 */
function postgresConstraintName(error: unknown): string | null {
  const match = /constraint[^"»]*(?:"([^"]+)"|»([^«]+)«)/i.exec(
    describeError(error),
  );
  return match?.[1] ?? match?.[2] ?? null;
}

function describeError(error: unknown): string {
  const parts = [String((error as Error)?.message ?? error)];
  const meta = (error as { meta?: unknown })?.meta;
  if (meta) parts.push(`meta=${JSON.stringify(meta)}`);
  const code = (error as { code?: unknown })?.code;
  if (code) parts.push(`prismaCode=${String(code)}`);
  return parts.join(" ");
}

function createTargetUrl(controlUrl: string | undefined): string {
  if (!controlUrl)
    throw new Error("DATABASE_URL fehlt fuer den Bereinigungstest.");
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
