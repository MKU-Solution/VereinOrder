import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@vereinorder/database";
import { assertTestDatabaseUrl } from "./test-database";
import { OrdersService } from "../src/orders/orders.service";
import { createAuditServiceStub } from "../src/orders/test-support/audit-service.stub";

/**
 * Wächtertest für einen Befund der Browserabnahme (Issue #141, Fehler A):
 * getQuickSaleContext (und darüber getStationSaleContext, das den Kontext
 * unverändert übernimmt) selektierte am Produkt nur `manualAvailability`,
 * nie den tatsächlichen Bestand. Bon- und Stationskasse zeigten ein
 * bestandsgeführtes Produkt mit Menge 0 deshalb beim Laden oder Neuladen
 * ganz normal an - antippbar, in den Bon legbar - und erst das Kassieren
 * lehnte ab. Kein Test hatte das bemerkt, weil ein gemockter Prisma-Client
 * strukturell nicht sehen kann, dass ein `select` ein Feld nicht anfordert:
 * die Attrappe liefert exakt das zurück, was der Testfall vorgibt, egal was
 * der echte `select` tatsächlich enthält (siehe dieselbe Begründung in
 * test/station-sale-context.integration-spec.ts, das dieser Test als Vorbild
 * nimmt). Deshalb hier gegen echtes PostgreSQL.
 */
describe("getQuickSaleContext/getStationSaleContext – effektiver Bestand im Kassenkontext gegen echtes PostgreSQL (Issue #141)", () => {
  assertTestDatabaseUrl();

  const prisma = new PrismaClient();
  const service = new OrdersService(prisma, createAuditServiceStub() as any);

  const eventIds: string[] = [];

  afterAll(async () => {
    if (eventIds.length) {
      // InventoryStock haengt per RESTRICT (nicht CASCADE) an eventId, und
      // einmal initialisierte (trackingEnabled) Zeilen sind per DB-Trigger
      // (guard_initialized_inventory_stock, siehe Migration
      // 20260829100000_add_inventory_stock_and_movements) unloeschbar - das
      // ist im Produktivbetrieb gewollt. Die einzige vorgesehene Ausnahme
      // ist dieselbe transaktionslokale Einstellung, die auch
      // backup.service.ts fuer die Wiederherstellung nutzt; ausserhalb
      // dieser Transaktion gilt die Schranke unveraendert weiter.
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw(
          Prisma.sql`SET LOCAL "vereinorder.inventory_restore" = 'on'`,
        );
        await tx.inventoryStock.deleteMany({
          where: { eventId: { in: eventIds } },
        });
        // Der Rest (Kategorien, Produkte, Stationen) haengt per CASCADE.
        await tx.event.deleteMany({ where: { id: { in: eventIds } } });
      });
    }
    await prisma.$disconnect();
  });

  it("liefert für ein bestandsgeführtes Produkt mit Menge 0 OUT_OF_STOCK statt AVAILABLE, samt Bestandsfeldern", async () => {
    const event = await prisma.event.create({
      data: {
        name: `Wächtertest Bestandskontext ${randomUUID()}`,
        status: "TEST_MODE",
        testMode: true,
      },
    });
    eventIds.push(event.id);

    const category = await prisma.productCategory.create({
      data: { name: "Getränke", eventId: event.id },
    });

    const product = await prisma.product.create({
      data: {
        name: "Bier",
        price: 450,
        eventId: event.id,
        categoryId: category.id,
        manualAvailability: "AVAILABLE",
      },
    });

    // Bestand in der Betriebsart, in der die Veranstaltung GERADE läuft
    // (TEST_MODE + testMode:true => "TEST"): auf 0 gesetzt.
    await prisma.inventoryStock.create({
      data: {
        productId: product.id,
        eventId: event.id,
        dataMode: "TEST",
        trackingEnabled: true,
        initialQuantity: 10,
        stockQuantity: 0,
        lowStockThreshold: 2,
        version: 3,
      },
    });
    // Bestand der jeweils ANDEREN Betriebsart (LIVE): reichlich vorhanden.
    // Dieser Datensatz darf die Anzeige nicht beeinflussen - sonst würden
    // die Betriebsarten vermischt.
    await prisma.inventoryStock.create({
      data: {
        productId: product.id,
        eventId: event.id,
        dataMode: "LIVE",
        trackingEnabled: true,
        initialQuantity: 50,
        stockQuantity: 50,
        lowStockThreshold: 5,
        version: 1,
      },
    });

    const context = await service.getQuickSaleContext(randomUUID());
    const eventContext = context.find((e) => e.id === event.id);
    expect(eventContext).toBeDefined();

    const loaded = (eventContext!.products as any[]).find(
      (p) => p.id === product.id,
    );
    expect(loaded).toBeDefined();

    // Der eigentliche Befund: manualAvailability allein sagt "AVAILABLE",
    // aber der TEST-Bestand ist 0 - die effektive Verfügbarkeit muss das
    // widerspiegeln.
    expect(loaded.availability).toBe("OUT_OF_STOCK");
    expect(loaded.inventoryTracked).toBe(true);
    expect(loaded.stockQuantity).toBe(0);
    expect(loaded.lowStockThreshold).toBe(2);
    expect(loaded.inventoryVersion).toBe(3);

    // getStationSaleContext übernimmt denselben Kontext unverändert.
    const stationContext = await service.getStationSaleContext(randomUUID());
    const stationEventContext = stationContext.find((e) => e.id === event.id);
    const loadedViaStation = (stationEventContext!.products as any[]).find(
      (p) => p.id === product.id,
    );
    expect(loadedViaStation.availability).toBe("OUT_OF_STOCK");
    expect(loadedViaStation.stockQuantity).toBe(0);
  });

  it("meldet ein bestandsgeführtes Produkt mit ausreichendem Bestand weiterhin als AVAILABLE bzw. LOW_STOCK", async () => {
    const event = await prisma.event.create({
      data: {
        name: `Wächtertest Bestandskontext ausreichend ${randomUUID()}`,
        status: "TEST_MODE",
        testMode: true,
      },
    });
    eventIds.push(event.id);

    const category = await prisma.productCategory.create({
      data: { name: "Speisen", eventId: event.id },
    });

    const productAvailable = await prisma.product.create({
      data: {
        name: "Grillhendl",
        price: 800,
        eventId: event.id,
        categoryId: category.id,
        manualAvailability: "AVAILABLE",
      },
    });
    await prisma.inventoryStock.create({
      data: {
        productId: productAvailable.id,
        eventId: event.id,
        dataMode: "TEST",
        trackingEnabled: true,
        initialQuantity: 20,
        stockQuantity: 20,
        lowStockThreshold: 5,
        version: 1,
      },
    });

    const productLowStock = await prisma.product.create({
      data: {
        name: "Pommes",
        price: 350,
        eventId: event.id,
        categoryId: category.id,
        manualAvailability: "AVAILABLE",
      },
    });
    await prisma.inventoryStock.create({
      data: {
        productId: productLowStock.id,
        eventId: event.id,
        dataMode: "TEST",
        trackingEnabled: true,
        initialQuantity: 20,
        stockQuantity: 2,
        lowStockThreshold: 5,
        version: 1,
      },
    });

    const context = await service.getQuickSaleContext(randomUUID());
    const eventContext = context.find((e) => e.id === event.id);
    const products = eventContext!.products as any[];

    expect(
      products.find((p) => p.id === productAvailable.id)?.availability,
    ).toBe("AVAILABLE");
    expect(
      products.find((p) => p.id === productLowStock.id)?.availability,
    ).toBe("LOW_STOCK");
  });
});
