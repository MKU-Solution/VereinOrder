import { randomUUID } from "node:crypto";
import { PrismaClient } from "@vereinorder/database";
import { assertTestDatabaseUrl } from "./test-database";

/**
 * Wächtertest für Issue #102 gegen PostgreSQL, nicht gegen ein Prisma-Mock.
 *
 * Bestellnummern werden an einer Veranstaltung angezeigt und auf Bons sowie
 * Belegen verwendet. Darum ist die fachliche Grenze dieselbe wie bei den
 * Abholnummern: Veranstaltung und Betriebsart. Eine Nummer darf in einer
 * anderen Veranstaltung oder im Testbetrieb erneut vorkommen, nicht aber
 * zweimal innerhalb derselben Kombination.
 */
describe("Bestellnummer – Datenbankgrenze gegen echtes PostgreSQL (Issue #102)", () => {
  assertTestDatabaseUrl();

  const prisma = new PrismaClient();
  const eventIds: string[] = [];
  let userId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        username: `waechtertest-bestellnummer-${randomUUID()}`,
        pinHash: "x",
        role: "CASHIER",
      },
    });
    userId = user.id;
  });

  afterAll(async () => {
    if (eventIds.length) {
      await prisma.event.deleteMany({ where: { id: { in: eventIds } } });
    }
    if (userId) await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("weist dieselbe Nummer in derselben Veranstaltung und Betriebsart ab", async () => {
    const [event, otherEvent] = await Promise.all([
      prisma.event.create({
        data: { name: `Wächtertest Bestellnummer ${randomUUID()}` },
      }),
      prisma.event.create({
        data: {
          name: `Wächtertest Bestellnummer andere Veranstaltung ${randomUUID()}`,
        },
      }),
    ]);
    eventIds.push(event.id, otherEvent.id);

    // Die Nummer wird bewusst ausdrücklich gesetzt. Genau das macht der
    // Wiederherstellungsweg und genau dann darf PostgreSQL keinen stillen
    // Doppelwert annehmen.
    await prisma.order.create({
      data: {
        eventId: event.id,
        userId,
        dataMode: "LIVE",
        totalAmount: 350,
        orderNumber: 424_242,
      },
    });

    await expect(
      prisma.order.create({
        data: {
          eventId: event.id,
          userId,
          dataMode: "LIVE",
          totalAmount: 700,
          orderNumber: 424_242,
        },
      }),
    ).rejects.toMatchObject({ code: "P2002" });

    // Die fachliche Grenze ist nicht global: dieselbe Nummer darf für eine
    // andere Veranstaltung und für Testdaten derselben Veranstaltung existieren.
    await expect(
      prisma.order.create({
        data: {
          eventId: otherEvent.id,
          userId,
          dataMode: "LIVE",
          totalAmount: 350,
          orderNumber: 424_242,
        },
      }),
    ).resolves.toEqual(expect.objectContaining({ orderNumber: 424_242 }));

    await expect(
      prisma.order.create({
        data: {
          eventId: event.id,
          userId,
          dataMode: "TEST",
          totalAmount: 350,
          orderNumber: 424_242,
        },
      }),
    ).resolves.toEqual(expect.objectContaining({ orderNumber: 424_242 }));
  });
});
