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
  valueVouchers: [],
  valueVoucherMovements: [],
  valueVoucherAllocations: [],
};

function document(
  data: Record<string, unknown[]> = emptyTables,
  version = "0.2.0",
) {
  return JSON.stringify({
    version,
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
    const {
      valueVouchers: _valueVouchers,
      valueVoucherMovements: _valueVoucherMovements,
      valueVoucherAllocations: _valueVoucherAllocations,
      ...legacyTables
    } = emptyTables;
    const parsed = parseBackupDocument(document(legacyTables, "0.1.0"));
    expect(parsed.data.valueVouchers).toEqual([]);
    expect(parsed.data.valueVoucherMovements).toEqual([]);
    expect(parsed.data.valueVoucherAllocations).toEqual([]);
  });

  it("akzeptiert frisch exportierte Bestellungen mit allen persistenten Feldern", () => {
    const parsed = parseBackupDocument(
      document({
        ...emptyTables,
        events: [{ id: "event-1", name: "Fest" }],
        users: [{ id: "user-1", username: "kassa" }],
        areas: [{ id: "area-1", name: "Zelt", eventId: "event-1" }],
        stations: [{ id: "station-1", name: "Schank", eventId: "event-1" }],
        sessions: [
          {
            id: "session-1",
            userId: "user-1",
            eventId: "event-1",
            dataMode: "TEST",
          },
        ],
        orders: [
          {
            id: "order-1",
            orderNumber: 42,
            totalAmount: 700,
            depositRefundTotal: 50,
            lifecycleStatus: "SUBMITTED",
            paymentStatus: "OPEN",
            fulfillmentStatus: "PENDING",
            isPriority: false,
            idempotencyKey: "order-key",
            tableName: "A1",
            areaId: "area-1",
            userId: "user-1",
            claimedByUserId: null,
            claimedAt: null,
            eventId: "event-1",
            dataMode: "TEST",
            createdAt: "2026-08-28T10:00:00.000Z",
            updatedAt: "2026-08-28T10:00:00.000Z",
            cashierSessionId: "session-1",
            pickupNumber: 7,
            stationId: "station-1",
          },
        ],
        categories: [
          {
            id: "category-1",
            name: "Getränke",
            sortOrder: 1,
            deposit: 25,
            eventId: "event-1",
            targetStationId: null,
            createdAt: "2026-08-28T10:00:00.000Z",
            updatedAt: "2026-08-28T10:00:00.000Z",
          },
        ],
        products: [
          {
            id: "product-1",
            name: "Bier",
            price: 500,
            deposit: 25,
            taxRate: 2000,
            availability: "AVAILABLE",
            categoryId: "category-1",
            eventId: "event-1",
            createdAt: "2026-08-28T10:00:00.000Z",
            updatedAt: "2026-08-28T10:00:00.000Z",
          },
        ],
        orderItems: [
          {
            id: "item-1",
            quantity: 2,
            paidQuantity: 1,
            priceAtTime: 500,
            depositAtTime: 25,
            status: "PENDING",
            variantId: null,
            variantName: null,
            extras: [],
            orderId: "order-1",
            productId: "product-1",
            createdAt: "2026-08-28T10:00:00.000Z",
            updatedAt: "2026-08-28T10:00:00.000Z",
          },
        ],
      }),
    );

    expect(parsed.data.orders[0]).toMatchObject({ depositRefundTotal: 50 });
    expect(parsed.data.orderItems[0]).toMatchObject({
      paidQuantity: 1,
      depositAtTime: 25,
    });
    expect(parsed.data.categories[0]).toMatchObject({ deposit: 25 });
    expect(parsed.data.products[0]).toMatchObject({ deposit: 25 });
  });

  it("akzeptiert alte Bestell- und Positionsdaten ohne neue Defaultfelder weiterhin", () => {
    const parsed = parseBackupDocument(
      document({
        ...emptyTables,
        events: [{ id: "event-1", name: "Fest" }],
        orders: [{ id: "order-1", eventId: "event-1" }],
        products: [{ id: "product-1", eventId: "event-1" }],
        orderItems: [
          {
            id: "item-1",
            quantity: 2,
            priceAtTime: 500,
            orderId: "order-1",
            productId: "product-1",
          },
        ],
      }),
    );

    expect(parsed.data.orders[0]).not.toHaveProperty("depositRefundTotal");
    expect(parsed.data.orderItems[0]).not.toHaveProperty("paidQuantity");
    expect(parsed.data.orderItems[0]).not.toHaveProperty("depositAtTime");
  });

  it("verwirft unbekannte Bestellfelder weiterhin", () => {
    expect(() =>
      parseBackupDocument(
        document({
          ...emptyTables,
          events: [{ id: "event-1", name: "Fest" }],
          orders: [
            {
              id: "order-1",
              eventId: "event-1",
              nichtErlaubtesFeld: "manipuliert",
            },
          ],
        }),
      ),
    ).toThrow(BadRequestException);
  });

  function valueVoucherData() {
    return {
      ...emptyTables,
      events: [{ id: "event-1", name: "Fest" }],
      users: [{ id: "user-1", username: "admin" }],
      sessions: [
        {
          id: "session-1",
          userId: "user-1",
          eventId: "event-1",
          dataMode: "TEST",
        },
      ],
      valueVouchers: [
        {
          id: "value-voucher-1",
          code: "T-TESTCODE",
          status: "ACTIVE",
          initialBalance: 2000,
          currentBalance: 2000,
          version: 0,
          eventId: "event-1",
          dataMode: "TEST",
          issuedByUserId: "user-1",
          issuedCashierSessionId: "session-1",
          issuedAt: "2026-08-28T10:00:00.000Z",
          updatedAt: "2026-08-28T10:00:00.000Z",
        },
      ],
      valueVoucherMovements: [
        {
          id: "movement-1",
          type: "ISSUE",
          balanceDelta: 2000,
          balanceBefore: 0,
          balanceAfter: 2000,
          voucherId: "value-voucher-1",
          eventId: "event-1",
          dataMode: "TEST",
          orderId: null,
          paymentId: null,
          reversesMovementId: null,
          actorUserId: "user-1",
          cashierSessionId: "session-1",
          fundingMethod: "CARD",
          tenderedAmount: null,
          changeAmount: null,
          reason: null,
          idempotencyKey: "issue-1",
          requestFingerprint: "a".repeat(64),
          createdAt: "2026-08-28T10:00:00.000Z",
        },
      ],
    };
  }

  it("akzeptiert eine lückenlose Wertgutschein-Ausgabe in TEST", () => {
    const parsed = parseBackupDocument(document(valueVoucherData()));
    expect(parsed.data.valueVouchers).toHaveLength(1);
    expect(parsed.data.valueVoucherMovements).toHaveLength(1);
  });

  it("verwirft eine TEST/LIVE-übergreifende Kassensitzungsreferenz", () => {
    const data = valueVoucherData();
    data.sessions[0].dataMode = "LIVE";
    expect(() => parseBackupDocument(document(data))).toThrow(
      BadRequestException,
    );
  });

  it("verwirft eine unterbrochene oder manipulierte Bewegungskette", () => {
    const data = valueVoucherData();
    data.valueVoucherMovements[0].balanceAfter = 1900;
    expect(() => parseBackupDocument(document(data))).toThrow(
      BadRequestException,
    );
  });
});
