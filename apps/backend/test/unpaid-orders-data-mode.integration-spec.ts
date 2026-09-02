import { randomUUID } from "node:crypto";
import { PrismaClient } from "@vereinorder/database";
import { assertTestDatabaseUrl } from "./test-database";
import { OrdersService } from "../src/orders/orders.service";
import { createAuditServiceStub } from "../src/orders/test-support/audit-service.stub";

/**
 * Wächtertest für Issue #162: getUnpaidOrders filterte bislang nur nach
 * Veranstaltung, Zahlungsstatus und Lebenszyklus - nicht nach `dataMode`.
 * Test- und Echtbestellungen derselben Veranstaltung erschienen deshalb
 * gemeinsam in der Liste der offenen Rechnungen.
 *
 * Die Aussage "eine Bestellung der anderen Betriebsart erscheint nicht"
 * kann ein gemockter Prisma-Client nicht beweisen: die Attrappe liefert
 * exakt das zurück, was der Testfall vorgibt, unabhängig davon, was das
 * tatsächlich übergebene `where` enthält (siehe dieselbe Begründung im
 * Kopfkommentar von quick-sale-context-inventory.integration-spec.ts). Ein
 * Test, der nur das an Prisma übergebene `where`-Objekt prüft, bewiese nur,
 * dass die Implementierung ein bestimmtes Objekt baut - nicht, dass dieses
 * Objekt in PostgreSQL tatsächlich die richtigen Zeilen ausschließt. Darum
 * hier gegen echtes PostgreSQL, mit Bestellungen beider Betriebsarten in
 * derselben Veranstaltung.
 *
 * Nach dem Riegel aus #158 kann eine LAUFENDE Veranstaltung im
 * Normalbetrieb keine zwei Betriebsarten mehr ansammeln; die beiden
 * Bestellungen unterschiedlicher dataMode in derselben Veranstaltung
 * werden hier deshalb bewusst direkt über Prisma angelegt (nicht über
 * createOrder), um denselben Altdatenfall nachzubilden, vor dem der
 * Filter schützen soll (siehe operational-data-mode.ts, Kopfkommentar).
 */
describe("getUnpaidOrders – Betriebsart-Trennung gegen echtes PostgreSQL (Issue #162)", () => {
  assertTestDatabaseUrl();

  const prisma = new PrismaClient();
  const service = new OrdersService(prisma, createAuditServiceStub() as any);

  const eventIds: string[] = [];
  let userId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        username: `waechtertest-offene-rechnungen-${randomUUID()}`,
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

  it("blendet bei laufender Veranstaltung offene Rechnungen der anderen Betriebsart aus, zeigt die eigenen aber vollständig", async () => {
    const event = await prisma.event.create({
      data: {
        name: `Wächtertest offene Rechnungen laufend ${randomUUID()}`,
        status: "ACTIVE",
        testMode: false,
      },
    });
    eventIds.push(event.id);

    const [ownOpen, ownPartiallyPaid, ownPaid, ownCancelled, otherModeOpen] =
      await Promise.all([
        prisma.order.create({
          data: {
            eventId: event.id,
            userId,
            dataMode: "LIVE",
            totalAmount: 500,
            paymentStatus: "OPEN",
            lifecycleStatus: "SUBMITTED",
          },
        }),
        prisma.order.create({
          data: {
            eventId: event.id,
            userId,
            dataMode: "LIVE",
            totalAmount: 800,
            paymentStatus: "PARTIALLY_PAID",
            lifecycleStatus: "ACCEPTED",
          },
        }),
        prisma.order.create({
          data: {
            eventId: event.id,
            userId,
            dataMode: "LIVE",
            totalAmount: 300,
            paymentStatus: "PAID",
            lifecycleStatus: "COMPLETED",
          },
        }),
        prisma.order.create({
          data: {
            eventId: event.id,
            userId,
            dataMode: "LIVE",
            totalAmount: 300,
            paymentStatus: "OPEN",
            lifecycleStatus: "CANCELLED",
          },
        }),
        // Altdaten-Fall: dieselbe Veranstaltung, aber Testbetrieb-Bestellung
        // (nach #158 im Normalbetrieb nicht mehr neu entstehend, siehe
        // Kopfkommentar). Genau diese darf bei laufendem Echtbetrieb nicht
        // in der Liste der offenen Rechnungen auftauchen.
        prisma.order.create({
          data: {
            eventId: event.id,
            userId,
            dataMode: "TEST",
            totalAmount: 999,
            paymentStatus: "OPEN",
            lifecycleStatus: "SUBMITTED",
          },
        }),
      ]);

    const result = await service.getUnpaidOrders(event.id);
    const resultIds = result.map((order) => order.id).sort();

    expect(resultIds).toEqual([ownOpen.id, ownPartiallyPaid.id].sort());
    expect(resultIds).not.toContain(otherModeOpen.id);
    expect(resultIds).not.toContain(ownPaid.id);
    expect(resultIds).not.toContain(ownCancelled.id);
  });

  it.each([["COMPLETED"], ["PAUSED"]] as const)(
    "zeigt bei einer nicht laufenden Veranstaltung (%s) offene Rechnungen beider Betriebsarten weiterhin - der naheliegende Fix hätte sie unsichtbar gemacht",
    async (status) => {
      const event = await prisma.event.create({
        data: {
          name: `Wächtertest offene Rechnungen ${status} ${randomUUID()}`,
          status,
          testMode: false,
        },
      });
      eventIds.push(event.id);

      const [liveOpen, testOpen, paid, cancelled] = await Promise.all([
        prisma.order.create({
          data: {
            eventId: event.id,
            userId,
            dataMode: "LIVE",
            totalAmount: 500,
            paymentStatus: "OPEN",
            lifecycleStatus: "SUBMITTED",
          },
        }),
        prisma.order.create({
          data: {
            eventId: event.id,
            userId,
            dataMode: "TEST",
            totalAmount: 700,
            paymentStatus: "PARTIALLY_PAID",
            lifecycleStatus: "ACCEPTED",
          },
        }),
        prisma.order.create({
          data: {
            eventId: event.id,
            userId,
            dataMode: "LIVE",
            totalAmount: 300,
            paymentStatus: "PAID",
            lifecycleStatus: "COMPLETED",
          },
        }),
        prisma.order.create({
          data: {
            eventId: event.id,
            userId,
            dataMode: "TEST",
            totalAmount: 300,
            paymentStatus: "OPEN",
            lifecycleStatus: "CANCELLED",
          },
        }),
      ]);

      const result = await service.getUnpaidOrders(event.id);
      const resultIds = result.map((order) => order.id).sort();

      expect(resultIds).toEqual([liveOpen.id, testOpen.id].sort());
      expect(resultIds).not.toContain(paid.id);
      expect(resultIds).not.toContain(cancelled.id);
    },
  );
});
