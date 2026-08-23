import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@vereinorder/database";
import { assertTestDatabaseUrl } from "./test-database";
import {
  MAX_PICKUP_NUMBER,
  drawPickupNumber,
} from "../src/common/pickup-number";

/**
 * Wächtertests der Abholnummernvergabe (Issue #66) gegen eine echte
 * PostgreSQL-Instanz.
 *
 * Diese Tests prüfen bewusst nicht dasselbe wie die gemockten Prüfungen in
 * apps/backend/src/common/pickup-number.spec.ts. Ihr Zweck ist, genau die
 * Zusagen zu fangen, die ein gemocktes Prisma-Objekt strukturell nicht sehen
 * kann:
 *  - echte Nebenläufigkeit über zwei getrennte Verbindungen: zwei gleichzeitige
 *    Kassen derselben Veranstaltung ziehen nie dieselbe Nummer
 *  - Lückenfreiheit nach einem Rollback — das ist der ganze Grund, warum eine
 *    eigene Zählertabelle statt einer SERIAL benutzt wird
 *  - der Unique-Index über ("eventId", "dataMode", "pickupNumber") existiert
 *    tatsächlich im Systemkatalog und greift, und mehrere NULL-Nummern stören
 *    einander nicht
 *
 * Die Stelle ist es wert: ein Fehler hier gibt zwei Personen dieselbe
 * Abholnummer.
 */
describe("Abholnummer – Vergabe gegen echtes PostgreSQL (Issue #66)", () => {
  assertTestDatabaseUrl();

  // Zwei getrennte Clients, damit die Nebenläufigkeitsprüfung tatsächlich über
  // zwei Verbindungen läuft und nicht nur über zwei Aufrufe auf derselben.
  const prisma = new PrismaClient();
  const prismaZweiteKasse = new PrismaClient();

  const eventIds: string[] = [];
  let userId: string;

  function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => {
      resolve = r;
    });
    return { promise, resolve };
  }

  async function makeEvent(): Promise<string> {
    const event = await prisma.event.create({
      data: { name: `Wächtertest Abholnummer ${randomUUID()}` },
    });
    eventIds.push(event.id);
    return event.id;
  }

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        username: `waechtertest-abholnummer-${randomUUID()}`,
        pinHash: "x",
        role: "CASHIER",
      },
    });
    userId = user.id;
  });

  afterAll(async () => {
    // Das Löschen der Veranstaltung räumt Bestellungen und Zählerzeilen über
    // die Fremdschlüsselregeln mit weg.
    if (eventIds.length) {
      await prisma.event.deleteMany({ where: { id: { in: eventIds } } });
    }
    if (userId) await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
    await prismaZweiteKasse.$disconnect();
  });

  // -------------------------------------------------------------------
  // Aussage 1: Zwei echt gleichzeitige Vergaben erhalten verschiedene,
  // aufeinanderfolgende Nummern. Die zweite wartet auf die Zeilensperre.
  // -------------------------------------------------------------------
  it("gibt zwei gleichzeitigen Kassen derselben Veranstaltung verschiedene, aufeinanderfolgende Nummern", async () => {
    const eventId = await makeEvent();

    const ersteHatGezogen = deferred();
    const ersteDarfCommitten = deferred();

    const ersteKasse = prisma.$transaction(
      async (tx) => {
        const nummer = await drawPickupNumber(tx, eventId, "LIVE");
        ersteHatGezogen.resolve();
        // Transaktion bewusst offen halten, damit die Zeilensperre steht,
        // während die zweite Kasse zieht.
        await ersteDarfCommitten.promise;
        return nummer;
      },
      { timeout: 15_000 },
    );

    await ersteHatGezogen.promise;

    let zweiteIstFertig = false;
    const zweiteKasse = prismaZweiteKasse
      .$transaction(async (tx) => drawPickupNumber(tx, eventId, "LIVE"), {
        timeout: 15_000,
      })
      .then((nummer) => {
        zweiteIstFertig = true;
        return nummer;
      });

    // Die zweite Vergabe darf nicht durchlaufen, solange die erste offen ist.
    // Käme sie hier schon zurück, hielten zwei Kassen denselben Zählerstand.
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(zweiteIstFertig).toBe(false);

    ersteDarfCommitten.resolve();
    const [ersteNummer, zweiteNummer] = await Promise.all([
      ersteKasse,
      zweiteKasse,
    ]);

    expect(ersteNummer).toBe(1);
    expect(zweiteNummer).toBe(2);
    expect(zweiteNummer).not.toBe(ersteNummer);
  });

  // -------------------------------------------------------------------
  // Aussage 2: Ein zurückgerollter Verkauf hinterlässt keine Lücke. Genau das
  // kann eine SERIAL nicht, und genau das ist die Begründung für die eigene
  // Tabelle.
  // -------------------------------------------------------------------
  it("hinterlässt nach einem abgebrochenen Verkauf keine Lücke", async () => {
    const eventId = await makeEvent();

    const ersteNummer = await prisma.$transaction((tx) =>
      drawPickupNumber(tx, eventId, "LIVE"),
    );
    expect(ersteNummer).toBe(1);

    let imAbbruchGezogen = 0;
    await expect(
      prisma.$transaction(async (tx) => {
        imAbbruchGezogen = await drawPickupNumber(tx, eventId, "LIVE");
        throw new Error("Verkauf abgebrochen");
      }),
    ).rejects.toThrow("Verkauf abgebrochen");
    expect(imAbbruchGezogen).toBe(2);

    const naechsteNummer = await prisma.$transaction((tx) =>
      drawPickupNumber(tx, eventId, "LIVE"),
    );
    expect(naechsteNummer).toBe(2);

    const zaehler = await prisma.eventPickupCounter.findUnique({
      where: { eventId_dataMode: { eventId, dataMode: "LIVE" } },
    });
    expect(zaehler?.lastNumber).toBe(2);
  });

  // -------------------------------------------------------------------
  // Aussage 3: Test- und Echtzähler sind getrennt und beginnen jeweils bei 1.
  // -------------------------------------------------------------------
  it("führt Test- und Echtbetrieb getrennt, beide beginnend bei 1", async () => {
    const eventId = await makeEvent();

    expect(
      await prisma.$transaction((tx) => drawPickupNumber(tx, eventId, "TEST")),
    ).toBe(1);
    expect(
      await prisma.$transaction((tx) => drawPickupNumber(tx, eventId, "TEST")),
    ).toBe(2);

    // Der Echtbetrieb derselben Veranstaltung beginnt trotzdem bei 1.
    expect(
      await prisma.$transaction((tx) => drawPickupNumber(tx, eventId, "LIVE")),
    ).toBe(1);

    // Zwei getrennte Zeilen mit getrennten Ständen. Nach Betriebsart
    // nachgeschlagen statt sortiert verglichen: "orderBy" auf einem
    // PostgreSQL-Enum sortiert nach Deklarationsreihenfolge, nicht
    // alphabetisch, und diese Zusage hängt an keiner Reihenfolge.
    const zaehler = await prisma.eventPickupCounter.findMany({
      where: { eventId },
    });
    expect(zaehler).toHaveLength(2);
    expect(zaehler.find((z) => z.dataMode === "LIVE")?.lastNumber).toBe(1);
    expect(zaehler.find((z) => z.dataMode === "TEST")?.lastNumber).toBe(2);
  });

  // -------------------------------------------------------------------
  // Aussage 4: Die Überlaufreißleine lehnt ab, statt umzubrechen — und der
  // Zähler bleibt dabei stehen, weil die Transaktion abbricht.
  // -------------------------------------------------------------------
  it("lehnt oberhalb der Obergrenze ab und lässt den Zähler stehen", async () => {
    const eventId = await makeEvent();

    await prisma.eventPickupCounter.create({
      data: {
        eventId,
        dataMode: "LIVE",
        lastNumber: MAX_PICKUP_NUMBER,
      },
    });

    await expect(
      prisma.$transaction((tx) => drawPickupNumber(tx, eventId, "LIVE")),
    ).rejects.toThrow(/Abholnummernbereich/);

    const zaehler = await prisma.eventPickupCounter.findUnique({
      where: { eventId_dataMode: { eventId, dataMode: "LIVE" } },
    });
    expect(zaehler?.lastNumber).toBe(MAX_PICKUP_NUMBER);
  });

  // -------------------------------------------------------------------
  // Aussage 5: Der Unique-Index ist die Absicherung im Schema, nicht nur im
  // Code. Er existiert, greift bei einer doppelten Nummer und lässt mehrere
  // NULL-Nummern nebeneinander zu — sonst wäre kein Bestandsverkauf ohne
  // Abholnummer mehr möglich.
  // -------------------------------------------------------------------
  it("hält den Unique-Index über Veranstaltung, Betriebsart und Abholnummer im Systemkatalog", async () => {
    const rows = await prisma.$queryRaw<
      { indexdef: string; indnullsnotdistinct: boolean }[]
    >(Prisma.sql`
      SELECT pg_get_indexdef(i.indexrelid) AS "indexdef",
             i.indnullsnotdistinct AS "indnullsnotdistinct"
      FROM pg_index i
      WHERE i.indexrelid = '"Order_eventId_dataMode_pickupNumber_key"'::regclass
    `);

    expect(rows).toHaveLength(1);
    expect(rows[0].indexdef).toContain("UNIQUE");
    expect(rows[0].indexdef).toContain('"eventId"');
    expect(rows[0].indexdef).toContain('"dataMode"');
    expect(rows[0].indexdef).toContain('"pickupNumber"');
    // NULLS DISTINCT ist die Voraussetzung dafür, dass Bestandsbestellungen
    // ohne Abholnummer einander nicht ausschließen. Wird der Index einmal mit
    // NULLS NOT DISTINCT neu angelegt, bricht dieser Test, bevor es im
    // Festbetrieb auffällt.
    expect(rows[0].indnullsnotdistinct).toBe(false);
  });

  it("weist eine zweite Bestellung mit derselben Abholnummer ab, lässt aber beliebig viele ohne Nummer zu", async () => {
    const eventId = await makeEvent();

    await prisma.order.create({
      data: {
        eventId,
        userId,
        dataMode: "LIVE",
        totalAmount: 350,
        pickupNumber: 1,
      },
    });

    await expect(
      prisma.order.create({
        data: {
          eventId,
          userId,
          dataMode: "LIVE",
          totalAmount: 700,
          pickupNumber: 1,
        },
      }),
    ).rejects.toMatchObject({ code: "P2002" });

    // Dieselbe Nummer in der anderen Betriebsart ist erlaubt: die Zähler sind
    // getrennt, die Bons ebenso.
    await expect(
      prisma.order.create({
        data: {
          eventId,
          userId,
          dataMode: "TEST",
          totalAmount: 700,
          pickupNumber: 1,
        },
      }),
    ).resolves.toEqual(expect.objectContaining({ pickupNumber: 1 }));

    // Drei Bestellungen ohne Abholnummer in derselben Veranstaltung und
    // Betriebsart: das ist der Bestandsfall (Bedienmaske, zentrale Bonkasse).
    for (const betrag of [100, 200, 300]) {
      await prisma.order.create({
        data: { eventId, userId, dataMode: "LIVE", totalAmount: betrag },
      });
    }

    expect(
      await prisma.order.count({
        where: { eventId, dataMode: "LIVE", pickupNumber: null },
      }),
    ).toBe(3);
  });
});
