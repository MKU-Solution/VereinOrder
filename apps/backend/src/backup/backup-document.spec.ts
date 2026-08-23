import { BadRequestException } from "@nestjs/common";
import { parseBackupDocument } from "./backup-document";

const emptyTables = {
  events: [],
  areas: [],
  stations: [],
  categories: [],
  products: [],
  optionGroups: [],
  options: [],
  users: [],
  orders: [],
  orderItems: [],
  payments: [],
  sessions: [],
  printers: [],
  printJobs: [],
  auditLogs: [],
  vouchers: [],
};

function document(data: Record<string, unknown[]> = emptyTables) {
  return JSON.stringify({
    version: "0.1.0",
    timestamp: "2026-08-23T10:00:00.000Z",
    database: "postgresql",
    createdBy: "SYSTEM_CRON",
    counts: {},
    data,
  });
}

describe("Backup-Dokumentgrenze (Issue #69)", () => {
  it("akzeptiert den dokumentierten leeren Vertrag", () => {
    expect(parseBackupDocument(document()).data.vouchers).toEqual([]);
  });

  it.each([
    ["unbekanntes Wurzelfeld", { extra: "DROP TABLE" }],
    [
      "unbekanntes Tabellenfeld",
      { data: { ...emptyTables, users: [{ id: "u1", pin: "1234" }] } },
    ],
    [
      "gebrochener Centbetrag",
      { data: { ...emptyTables, payments: [{ id: "p1", amount: 1.5 }] } },
    ],
    [
      "eventfremde Stationsreferenz",
      {
        data: {
          ...emptyTables,
          events: [
            { id: "event-a", name: "A" },
            { id: "event-b", name: "B" },
          ],
          stations: [{ id: "station-b", name: "B", eventId: "event-b" }],
          categories: [
            {
              id: "category-a",
              name: "A",
              eventId: "event-a",
              targetStationId: "station-b",
            },
          ],
        },
      },
    ],
    [
      "Bestellposition mit fremder Bestellung",
      {
        data: {
          ...emptyTables,
          orderItems: [
            {
              id: "item-1",
              quantity: 1,
              priceAtTime: 500,
              orderId: "order-fehlt",
              productId: "product-fehlt",
            },
          ],
        },
      },
    ],
  ])("verwirft %s vor der Wiederherstellung", (_label, mutation) => {
    const base = JSON.parse(document()) as Record<string, unknown>;
    const input = JSON.stringify({ ...base, ...mutation });
    expect(() => parseBackupDocument(input)).toThrow(BadRequestException);
  });

  it("akzeptiert alte Sicherungen ohne den später ergänzten Gutscheinblock", () => {
    const { vouchers: _vouchers, ...legacyTables } = emptyTables;
    expect(parseBackupDocument(document(legacyTables)).data.vouchers).toEqual(
      [],
    );
  });
});
