import { randomUUID } from "node:crypto";
import { PrismaClient } from "@vereinorder/database";
import { assertTestDatabaseUrl } from "./test-database";
import { OrdersService } from "../src/orders/orders.service";
import { createAuditServiceStub } from "../src/orders/test-support/audit-service.stub";
import { resolveTargetStationId } from "../src/common/target-station";

/**
 * Wächtertest für einen Befund der Oberflächenstufe (Issue #66,
 * Stationskasse): getQuickSaleContext/getStationSaleContext haben ihr
 * `select` für `products` ohne `targetStationId` gebaut, weder am Produkt
 * noch an `category`. Der Stationsmodus filtert das angezeigte Sortiment
 * aber genau nach diesen beiden Feldern (StationSaleDashboard.tsx,
 * resolveTargetStationId, wörtlich wie apps/backend/src/common/
 * target-station.ts). Ohne die Felder löst jedes Produkt clientseitig auf
 * "keine Station" auf, und jede Station zeigt ein leeres Kachelraster - der
 * Modus wäre unbenutzbar, ohne dass ein einziger Servertest das anzeigt.
 *
 * Ein gemockter Test kann eine fehlende Spalte im `select` strukturell nicht
 * sehen - ein Prisma-Mock liefert immer exakt das zurück, was die Attrappe
 * vorgibt, unabhängig davon, was der echte `select` tatsächlich anfordert.
 * Deshalb hier gegen echtes PostgreSQL: dieser Test prüft, was aus der
 * Datenbank tatsächlich ankommt, nicht was der Code zu lesen behauptet.
 */
describe("getStationSaleContext – Zielstation im Produktkontext gegen echtes PostgreSQL (Issue #66)", () => {
  assertTestDatabaseUrl();

  const prisma = new PrismaClient();
  const service = new OrdersService(prisma, createAuditServiceStub() as any);

  const eventIds: string[] = [];

  afterAll(async () => {
    // Löscht über die Kaskadenregeln (onDelete: Cascade auf eventId) auch
    // Warengruppen, Produkte und Stationen mit.
    if (eventIds.length) {
      await prisma.event.deleteMany({ where: { id: { in: eventIds } } });
    }
    await prisma.$disconnect();
  });

  it("liefert targetStationId an Produkt und Warengruppe, sodass resolveTargetStationId korrekt auflöst", async () => {
    const event = await prisma.event.create({
      data: {
        name: `Wächtertest Stationskontext ${randomUUID()}`,
        status: "TEST_MODE",
        testMode: true,
      },
    });
    eventIds.push(event.id);

    const stationEigen = await prisma.station.create({
      data: { name: "Grillstand", eventId: event.id },
    });
    const stationKategorie = await prisma.station.create({
      data: { name: "Getränkestand", eventId: event.id },
    });

    // Warengruppe mit eigener Vorgabe-Zielstation.
    const kategorie = await prisma.productCategory.create({
      data: {
        name: "Getränke",
        eventId: event.id,
        targetStationId: stationKategorie.id,
      },
    });
    // Zweite Warengruppe ohne Zielstation (zentrale Ausgabe).
    const kategorieZentral = await prisma.productCategory.create({
      data: { name: "Sonstiges", eventId: event.id },
    });

    // Produkt mit eigener Ausnahme: überstimmt die Kategorie.
    const produktEigeneStation = await prisma.product.create({
      data: {
        name: "Grillhendl",
        price: 800,
        eventId: event.id,
        categoryId: kategorie.id,
        targetStationId: stationEigen.id,
      },
    });
    // Produkt ohne eigene Ausnahme: erbt die Zielstation der Kategorie.
    const produktErbtKategorie = await prisma.product.create({
      data: {
        name: "Cola",
        price: 300,
        eventId: event.id,
        categoryId: kategorie.id,
      },
    });
    // Produkt ohne Ausnahme in einer Kategorie ohne Vorgabe: zentrale Ausgabe.
    const produktZentral = await prisma.product.create({
      data: {
        name: "Programmheft",
        price: 200,
        eventId: event.id,
        categoryId: kategorieZentral.id,
      },
    });

    const context = await service.getStationSaleContext(randomUUID());
    const eventContext = context.find((e) => e.id === event.id);
    expect(eventContext).toBeDefined();

    // Die Stationsliste selbst muss ankommen.
    const stationIds = eventContext!.stations.map((s) => s.id);
    expect(stationIds).toEqual(
      expect.arrayContaining([stationEigen.id, stationKategorie.id]),
    );

    const products = eventContext!.products as any[];
    const findProduct = (id: string) => products.find((p) => p.id === id);

    const geladenEigeneStation = findProduct(produktEigeneStation.id);
    const geladenErbtKategorie = findProduct(produktErbtKategorie.id);
    const geladenZentral = findProduct(produktZentral.id);

    expect(geladenEigeneStation).toBeDefined();
    expect(geladenErbtKategorie).toBeDefined();
    expect(geladenZentral).toBeDefined();

    // Die Felder selbst müssen ankommen - das ist der eigentliche Befund:
    // ohne sie sind beide Zeilen unten undefined statt der echten Werte.
    expect(geladenEigeneStation.targetStationId).toBe(stationEigen.id);
    expect(geladenEigeneStation.category.targetStationId).toBe(
      stationKategorie.id,
    );
    expect(geladenErbtKategorie.targetStationId).toBeNull();
    expect(geladenErbtKategorie.category.targetStationId).toBe(
      stationKategorie.id,
    );
    expect(geladenZentral.targetStationId).toBeNull();
    expect(geladenZentral.category.targetStationId).toBeNull();

    // Und der eigentliche Vertrag: dieselbe Auflösung wie
    // apps/backend/src/common/target-station.ts (die einzige Regel im
    // Projekt) muss auf die erwartete Station bzw. auf "keine Station"
    // kommen. Das ist exakt die Berechnung, die die Stationskasse
    // clientseitig zur Anzeige nachbildet.
    expect(resolveTargetStationId(geladenEigeneStation)).toBe(stationEigen.id);
    expect(resolveTargetStationId(geladenErbtKategorie)).toBe(
      stationKategorie.id,
    );
    expect(resolveTargetStationId(geladenZentral)).toBeNull();
  });
});
