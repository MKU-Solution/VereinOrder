import { randomUUID } from "node:crypto";
import { PrismaClient } from "@vereinorder/database";
import { assertTestDatabaseUrl } from "./test-database";

/**
 * Wächtertest für Issue #96: Die einzelnen Fremdschlüssel von Produkt,
 * Warengruppe und Station sichern nur die Existenz ihrer Ziele. Sie verhindern
 * nicht, dass ein Produkt oder eine Warengruppe auf Daten einer anderen
 * Veranstaltung verweist. Diese Tests schreiben absichtlich ohne Service- oder
 * API-Schicht, damit die Datenbankregel selbst geschützt ist.
 */
describe("Eventbezogene Referenzintegrität gegen echtes PostgreSQL (Issue #96)", () => {
  assertTestDatabaseUrl();

  const prisma = new PrismaClient();
  const eventIds: string[] = [];

  afterAll(async () => {
    // Alle Fixtures gehören eigenen Veranstaltungen. Die Event-Kaskade entfernt
    // damit Kategorien, Produkte und Stationen vollständig aus der geprüften
    // Wegwerfdatenbank.
    if (eventIds.length) {
      await prisma.event.deleteMany({ where: { id: { in: eventIds } } });
    }
    await prisma.$disconnect();
  });

  async function createEvent(name: string) {
    const event = await prisma.event.create({
      data: {
        name: `${name} ${randomUUID()}`,
        status: "TEST_MODE",
        testMode: true,
      },
    });
    eventIds.push(event.id);
    return event;
  }

  it.each([
    ["Produktkategorie", "categoryId"],
    ["Produkt-Zielstation", "targetStationId"],
  ] as const)(
    "akzeptiert %s aus derselben Veranstaltung",
    async (_label, relation) => {
      const event = await createEvent("Gültige Produktreferenz");
      const category = await prisma.productCategory.create({
        data: { name: "Speisen", eventId: event.id },
      });
      const station = await prisma.station.create({
        data: { name: "Küche", eventId: event.id },
      });

      const product = await prisma.product.create({
        data: {
          name: `Gültiges Produkt ${relation}`,
          price: 500,
          eventId: event.id,
          categoryId: category.id,
          targetStationId: relation === "targetStationId" ? station.id : null,
        },
      });

      expect(product.eventId).toBe(event.id);
      expect(product.categoryId).toBe(category.id);
      expect(product.targetStationId).toBe(
        relation === "targetStationId" ? station.id : null,
      );
    },
  );

  it("akzeptiert die nullable Zielstationen", async () => {
    const event = await createEvent("Nullable Zielstationen");
    const category = await prisma.productCategory.create({
      data: { name: "Zentrale Ausgabe", eventId: event.id },
    });
    const product = await prisma.product.create({
      data: {
        name: "Produkt ohne Zielstation",
        price: 250,
        eventId: event.id,
        categoryId: category.id,
      },
    });

    expect(category.targetStationId).toBeNull();
    expect(product.targetStationId).toBeNull();
  });

  it("akzeptiert eine Warengruppe mit Zielstation derselben Veranstaltung", async () => {
    const event = await createEvent("Gültige Warengruppenreferenz");
    const station = await prisma.station.create({
      data: { name: "Ausgabe", eventId: event.id },
    });
    const category = await prisma.productCategory.create({
      data: {
        name: "Warengruppe mit lokaler Station",
        eventId: event.id,
        targetStationId: station.id,
      },
    });

    expect(category.targetStationId).toBe(station.id);
  });

  it("verwirft ein Produkt mit Kategorie einer fremden Veranstaltung", async () => {
    const event = await createEvent("Produkt Veranstaltung A");
    const foreignEvent = await createEvent("Kategorie Veranstaltung B");
    const foreignCategory = await prisma.productCategory.create({
      data: { name: "Fremde Kategorie", eventId: foreignEvent.id },
    });

    await expect(
      prisma.product.create({
        data: {
          name: "Unzulässige Fremdkategorie",
          price: 500,
          eventId: event.id,
          categoryId: foreignCategory.id,
        },
      }),
    ).rejects.toMatchObject({ code: "P2003" });
  });

  it("verwirft eine Warengruppe mit Zielstation einer fremden Veranstaltung", async () => {
    const event = await createEvent("Warengruppe Veranstaltung A");
    const foreignEvent = await createEvent("Station Veranstaltung B");
    const foreignStation = await prisma.station.create({
      data: { name: "Fremde Station", eventId: foreignEvent.id },
    });

    await expect(
      prisma.productCategory.create({
        data: {
          name: "Warengruppe mit fremder Station",
          eventId: event.id,
          targetStationId: foreignStation.id,
        },
      }),
    ).rejects.toMatchObject({ code: "P2003" });
  });

  it("verwirft ein Produkt mit Zielstation einer fremden Veranstaltung", async () => {
    const event = await createEvent("Produktziel Veranstaltung A");
    const foreignEvent = await createEvent("Produktstation Veranstaltung B");
    const category = await prisma.productCategory.create({
      data: { name: "Lokale Kategorie", eventId: event.id },
    });
    const foreignStation = await prisma.station.create({
      data: { name: "Fremde Produktstation", eventId: foreignEvent.id },
    });

    await expect(
      prisma.product.create({
        data: {
          name: "Produkt mit fremder Zielstation",
          price: 500,
          eventId: event.id,
          categoryId: category.id,
          targetStationId: foreignStation.id,
        },
      }),
    ).rejects.toMatchObject({ code: "P2003" });
  });
});
