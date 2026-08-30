import { randomUUID } from "node:crypto";
import { PrismaClient } from "@vereinorder/database";
import { assertTestDatabaseUrl } from "./test-database";

/**
 * Wächtertest für Issue #157 gegen echtes PostgreSQL.
 *
 * apps/backend/src/common/operational-data-mode.ts vereinheitlicht (Issue
 * #152) die Ableitung der Betriebsart einer Veranstaltung aus status und
 * testMode und wirft, sobald eine unmögliche Kombination auftritt. Alle
 * regulären Anwendungspfade erzwingen stimmige Kombinationen; nach der
 * Untersuchung zu #152 ist das Einspielen einer alten JSON-Sicherung der
 * einzige nachgewiesene Weg, auf dem trotzdem eine unmögliche Kombination in
 * die Datenbank gelangen konnte. Die Dokumentprüfung in backup-document.ts
 * (Ebene 1) fängt genau diesen Weg ab; dieser Test prüft die zweite Ebene:
 * den CHECK-Constraint "Event_status_testMode_check" aus der Migration
 * 20260830090000_add_event_status_testmode_check, der dieselbe Regel direkt
 * an der Datenhaltung bindend macht. Ein gemocktes Prisma-Objekt kennt keinen
 * Datenbank-Constraint, deshalb muss dieser Nachweis gegen eine echte
 * PostgreSQL-Instanz laufen.
 */
describe("Event.status/testMode-Konsistenz gegen echtes PostgreSQL (Issue #157)", () => {
  assertTestDatabaseUrl();

  const prisma = new PrismaClient();
  const eventIds: string[] = [];

  afterAll(async () => {
    if (eventIds.length) {
      await prisma.event.deleteMany({ where: { id: { in: eventIds } } });
    }
    await prisma.$disconnect();
  });

  async function trackEvent(id: string) {
    eventIds.push(id);
  }

  // -------------------------------------------------------------------
  // Aussage 1: Die Prüfbedingung existiert im Systemkatalog.
  // -------------------------------------------------------------------
  it("der Constraint aus der Migration existiert tatsächlich in pg_constraint (Aussage 1)", async () => {
    const rows = await prisma.$queryRaw<{ conname: string }[]>`
      SELECT conname FROM pg_constraint
      WHERE conname = 'Event_status_testMode_check'
    `;
    expect(rows.map((r) => r.conname)).toEqual(["Event_status_testMode_check"]);
  });

  // -------------------------------------------------------------------
  // Aussage 2: Der Constraint greift tatsächlich, für beide unmöglichen
  // Kombinationen - sowohl beim Anlegen als auch bei einer nachträglichen
  // Änderung.
  // -------------------------------------------------------------------
  describe("Der Constraint greift tatsächlich (Aussage 2)", () => {
    it("weist ACTIVE mit testMode=true beim Anlegen zurück", async () => {
      await expect(
        prisma.event.create({
          data: {
            name: `Wächtertest ACTIVE/testMode ${randomUUID()}`,
            status: "ACTIVE",
            testMode: true,
          },
        }),
      ).rejects.toThrow();
    });

    it("weist TEST_MODE mit testMode=false beim Anlegen zurück", async () => {
      await expect(
        prisma.event.create({
          data: {
            name: `Wächtertest TEST_MODE/testMode ${randomUUID()}`,
            status: "TEST_MODE",
            testMode: false,
          },
        }),
      ).rejects.toThrow();
    });

    it("weist einen nachträglichen Wechsel auf ACTIVE mit testMode=true zurück", async () => {
      const event = await prisma.event.create({
        data: {
          name: `Wächtertest Update ACTIVE ${randomUUID()}`,
          status: "TEST_MODE",
          testMode: true,
        },
      });
      await trackEvent(event.id);

      await expect(
        prisma.event.update({
          where: { id: event.id },
          data: { status: "ACTIVE" },
        }),
      ).rejects.toThrow();
    });

    it("weist ein nachträglich auf false gesetztes testMode bei TEST_MODE zurück", async () => {
      const event = await prisma.event.create({
        data: {
          name: `Wächtertest Update TEST_MODE ${randomUUID()}`,
          status: "TEST_MODE",
          testMode: true,
        },
      });
      await trackEvent(event.id);

      await expect(
        prisma.event.update({
          where: { id: event.id },
          data: { testMode: false },
        }),
      ).rejects.toThrow();
    });
  });

  // -------------------------------------------------------------------
  // Aussage 3: Der Constraint ist nicht zu streng. PAUSED mit gesetztem
  // testMode ist ein völlig normaler Zustand (Wechsel aus TEST_MODE) und
  // darf nicht abgewiesen werden - ohne diesen Gegenbeweis wäre nicht
  // erkennbar, ob der Constraint versehentlich jede Kombination mit
  // testMode=true blockiert.
  // -------------------------------------------------------------------
  it("akzeptiert PAUSED mit testMode=true (Aussage 3)", async () => {
    const event = await prisma.event.create({
      data: {
        name: `Wächtertest PAUSED/testMode ${randomUUID()}`,
        status: "PAUSED",
        testMode: true,
      },
    });
    await trackEvent(event.id);

    expect(event.status).toBe("PAUSED");
    expect(event.testMode).toBe(true);
  });

  it.each(["ACTIVE", "TEST_MODE"] as const)(
    "akzeptiert %s in seiner jeweils einzigen zulässigen Kombination",
    async (status) => {
      const event = await prisma.event.create({
        data: {
          name: `Wächtertest gültige Kombination ${status} ${randomUUID()}`,
          status,
          testMode: status === "TEST_MODE",
        },
      });
      await trackEvent(event.id);

      expect(event.status).toBe(status);
      expect(event.testMode).toBe(status === "TEST_MODE");
    },
  );
});
