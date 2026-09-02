import { randomUUID } from "node:crypto";
import { PrismaClient } from "@vereinorder/database";
import { assertTestDatabaseUrl } from "./test-database";
import { OrdersService } from "../src/orders/orders.service";
import { createAuditServiceStub } from "../src/orders/test-support/audit-service.stub";
import { ProductsService } from "../src/products/products.service";
import { ReportsService } from "../src/reports/reports.service";

/**
 * Wächtertest für Issue #170 (Warengruppen lassen sich nicht deaktivieren):
 * ProductCategory.isActive wirkt als Gruppenschalter für ihre Produkte, aber
 * NUR im Kassenkontext und in der Bestellaufnahme (GET /products). Verwaltung
 * (findAllProductsAdmin/findAllCategoriesAdmin) und Berichte/Revision
 * (getInventoryReport) müssen die Gruppe und ihre Produkte weiterhin
 * vollständig zeigen - sonst ließe sich eine stillgelegte Gruppe nie wieder
 * aktivieren und ihre Historie verschwände aus den Auswertungen.
 *
 * Wie in quick-sale-context-inventory.integration-spec.ts und
 * station-sale-context.integration-spec.ts begründet: ein gemockter
 * Prisma-Client kann eine fehlende WHERE-Bedingung strukturell nicht sehen -
 * eine Attrappe liefert immer exakt das zurück, was der Testfall vorgibt.
 * Deshalb hier gegen echtes PostgreSQL.
 */
describe("Warengruppen-Gruppenschalter (ProductCategory.isActive) gegen echtes PostgreSQL (Issue #170)", () => {
  assertTestDatabaseUrl();

  const prisma = new PrismaClient();
  const orders = new OrdersService(prisma, createAuditServiceStub() as any);
  const products = new ProductsService(prisma, { broadcast: jest.fn() } as any);
  const reports = new ReportsService(prisma);

  const eventIds: string[] = [];

  afterAll(async () => {
    if (eventIds.length) {
      // Kategorien, Produkte und Stationen hängen per CASCADE an eventId.
      await prisma.event.deleteMany({ where: { id: { in: eventIds } } });
    }
    await prisma.$disconnect();
  });

  async function seedScenario() {
    const suffix = randomUUID();
    const event = await prisma.event.create({
      data: {
        name: `Wächtertest Gruppenschalter ${suffix}`,
        status: "TEST_MODE",
        testMode: true,
      },
    });
    eventIds.push(event.id);

    const station = await prisma.station.create({
      data: { name: "Schank", eventId: event.id },
    });

    const activeCategory = await prisma.productCategory.create({
      data: {
        name: "Getränke (aktiv)",
        eventId: event.id,
        targetStationId: station.id,
      },
    });
    const disabledCategory = await prisma.productCategory.create({
      data: {
        name: "Auslaufsortiment (wird stillgelegt)",
        eventId: event.id,
        targetStationId: station.id,
      },
    });
    // Erst NACH dem Anlegen deaktivieren, damit der Standardwert (aktiv)
    // beim Anlegen selbst mitgeprüft wird.
    await prisma.productCategory.update({
      where: { id: disabledCategory.id },
      data: { isActive: false },
    });

    const activeProduct = await prisma.product.create({
      data: {
        name: "Bier",
        price: 450,
        eventId: event.id,
        categoryId: activeCategory.id,
        manualAvailability: "AVAILABLE",
      },
    });
    // Der Gruppenschalter schränkt nur ein: dieses Produkt trägt selbst
    // AVAILABLE und hat keinen eigenen Override, der es abschalten würde -
    // einzig die stillgelegte Warengruppe darf es aus dem Kassenkontext
    // nehmen.
    const disabledCategoryProduct = await prisma.product.create({
      data: {
        name: "Radler (Auslaufartikel)",
        price: 400,
        eventId: event.id,
        categoryId: disabledCategory.id,
        manualAvailability: "AVAILABLE",
      },
    });

    return {
      event,
      station,
      activeCategory,
      disabledCategory,
      activeProduct,
      disabledCategoryProduct,
    };
  }

  it("blendet Produkte einer stillgelegten Warengruppe aus Bon- und Stationskasse aus, das aktive Produkt bleibt", async () => {
    const scenario = await seedScenario();

    const quickSaleContext = await orders.getQuickSaleContext(randomUUID());
    const quickSaleProducts = quickSaleContext.find(
      (e) => e.id === scenario.event.id,
    )!.products as any[];
    expect(quickSaleProducts.map((p) => p.id)).toEqual(
      expect.arrayContaining([scenario.activeProduct.id]),
    );
    expect(quickSaleProducts.map((p) => p.id)).not.toEqual(
      expect.arrayContaining([scenario.disabledCategoryProduct.id]),
    );

    // getStationSaleContext übernimmt denselben Produktkontext unverändert.
    const stationSaleContext = await orders.getStationSaleContext(randomUUID());
    const stationSaleProducts = stationSaleContext.find(
      (e) => e.id === scenario.event.id,
    )!.products as any[];
    expect(stationSaleProducts.map((p) => p.id)).toEqual(
      expect.arrayContaining([scenario.activeProduct.id]),
    );
    expect(stationSaleProducts.map((p) => p.id)).not.toEqual(
      expect.arrayContaining([scenario.disabledCategoryProduct.id]),
    );
  });

  it("blendet Produkte einer stillgelegten Warengruppe aus der Bestellaufnahme (GET /products) aus", async () => {
    const scenario = await seedScenario();

    const active = await products.findAllActive();
    const ids = active.map((p) => p.id);
    expect(ids).toEqual(expect.arrayContaining([scenario.activeProduct.id]));
    expect(ids).not.toEqual(
      expect.arrayContaining([scenario.disabledCategoryProduct.id]),
    );
  });

  it("zeigt eine stillgelegte Warengruppe samt Produkten in der Verwaltung weiterhin vollständig und reaktivierbar", async () => {
    const scenario = await seedScenario();

    const categoriesAdmin = await products.findAllCategoriesAdmin(
      scenario.event.id,
    );
    const disabledEntry = categoriesAdmin.find(
      (c) => c.id === scenario.disabledCategory.id,
    );
    expect(disabledEntry).toBeDefined();
    expect(disabledEntry!.isActive).toBe(false);

    const productsAdmin = await products.findAllProductsAdmin(
      scenario.event.id,
    );
    const productIds = productsAdmin.map((p) => p.id);
    expect(productIds).toEqual(
      expect.arrayContaining([
        scenario.activeProduct.id,
        scenario.disabledCategoryProduct.id,
      ]),
    );

    // Reaktivierbar: dieselbe Route wie jede andere Kategorieänderung.
    const reactivated = await products.updateCategory(
      scenario.disabledCategory.id,
      { isActive: true } as any,
    );
    expect(reactivated.isActive).toBe(true);
  });

  it("zeigt eine stillgelegte Warengruppe samt Produkten im Bestandsbericht (Revision) weiterhin vollständig", async () => {
    const scenario = await seedScenario();

    const report = await reports.getInventoryReport(scenario.event.id, "TEST");
    const reportedIds = report.map((row: any) => row.productId);
    expect(reportedIds).toEqual(
      expect.arrayContaining([
        scenario.activeProduct.id,
        scenario.disabledCategoryProduct.id,
      ]),
    );
  });
});
