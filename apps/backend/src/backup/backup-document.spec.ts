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
  inventoryStocks: [],
  inventoryMovements: [],
};

function document(
  data: Record<string, unknown[]> = emptyTables,
  version = "0.3.0",
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
    [
      "Veranstaltung ACTIVE mit testMode true (Issue #157)",
      {
        data: {
          ...emptyTables,
          events: [
            { id: "event-1", name: "Fest", status: "ACTIVE", testMode: true },
          ],
        },
      },
    ],
    [
      "Veranstaltung TEST_MODE mit testMode false (Issue #157)",
      {
        data: {
          ...emptyTables,
          events: [
            {
              id: "event-1",
              name: "Fest",
              status: "TEST_MODE",
              testMode: false,
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
      inventoryStocks: _inventoryStocks,
      inventoryMovements: _inventoryMovements,
      ...legacyTables
    } = emptyTables;
    const parsed = parseBackupDocument(document(legacyTables, "0.1.0"));
    expect(parsed.data.valueVouchers).toEqual([]);
    expect(parsed.data.valueVoucherMovements).toEqual([]);
    expect(parsed.data.valueVoucherAllocations).toEqual([]);
    expect(parsed.data.inventoryStocks).toEqual([]);
    expect(parsed.data.inventoryMovements).toEqual([]);
  });

  it("akzeptiert PAUSED mit gesetztem testMode - kein Defekt, sondern ein Statuswechsel aus TEST_MODE (Issue #157)", () => {
    const parsed = parseBackupDocument(
      document({
        ...emptyTables,
        events: [
          { id: "event-1", name: "Fest", status: "PAUSED", testMode: true },
        ],
      }),
    );
    expect(parsed.data.events).toEqual([
      { id: "event-1", name: "Fest", status: "PAUSED", testMode: true },
    ]);
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

  function inventoryData() {
    const timestamp = "2026-08-29T10:00:00.000Z";
    return {
      ...emptyTables,
      events: [{ id: "event-1", name: "Fest" }],
      users: [{ id: "user-1", username: "admin" }],
      categories: [{ id: "category-1", name: "Speisen", eventId: "event-1" }],
      products: [
        {
          id: "product-1",
          name: "Grillhendl",
          price: 1200,
          categoryId: "category-1",
          eventId: "event-1",
          manualAvailability: "LOW_STOCK",
        },
      ],
      orders: [
        {
          id: "order-1",
          eventId: "event-1",
          dataMode: "TEST",
          userId: "user-1",
        },
      ],
      orderItems: [
        {
          id: "item-1",
          quantity: 2,
          priceAtTime: 1200,
          orderId: "order-1",
          productId: "product-1",
        },
      ],
      inventoryStocks: [
        {
          productId: "product-1",
          eventId: "event-1",
          dataMode: "TEST",
          trackingEnabled: true,
          initialQuantity: 5,
          stockQuantity: 3,
          lowStockThreshold: 2,
          manualBlocked: false,
          version: 2,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ],
      inventoryMovements: [
        {
          id: "inventory-init-1",
          type: "INITIALIZATION",
          quantityDelta: 5,
          quantityBefore: 0,
          quantityAfter: 5,
          productId: "product-1",
          eventId: "event-1",
          dataMode: "TEST",
          orderId: null,
          orderItemId: null,
          reversesMovementId: null,
          actorUserId: "user-1",
          reason: null,
          idempotencyKey: "inventory:init:1",
          requestFingerprint: "a".repeat(64),
          createdAt: timestamp,
        },
        {
          id: "inventory-sale-1",
          type: "SALE",
          quantityDelta: -2,
          quantityBefore: 5,
          quantityAfter: 3,
          productId: "product-1",
          eventId: "event-1",
          dataMode: "TEST",
          orderId: "order-1",
          orderItemId: "item-1",
          reversesMovementId: null,
          actorUserId: "user-1",
          reason: null,
          idempotencyKey: "inventory:sale:item-1",
          requestFingerprint: "b".repeat(64),
          createdAt: "2026-08-29T10:01:00.000Z",
        },
      ],
    };
  }

  it("akzeptiert einen vollständigen TEST-Bestand samt lückenlosem Ledger", () => {
    const parsed = parseBackupDocument(document(inventoryData()));
    expect(parsed.data.inventoryStocks).toHaveLength(1);
    expect(parsed.data.inventoryMovements).toHaveLength(2);
    expect(parsed.data.products[0].manualAvailability).toBe("LOW_STOCK");
  });

  it("akzeptiert 0.2.0 ohne Inventartabellen und behält den alten Availability-Override", () => {
    const data = inventoryData();
    const oldProduct: any = { ...data.products[0] };
    delete oldProduct.manualAvailability;
    oldProduct.availability = "OUT_OF_STOCK";
    data.products[0] = oldProduct;
    const {
      inventoryStocks: _stocks,
      inventoryMovements: _movements,
      ...old
    } = data;
    const parsed = parseBackupDocument(document(old, "0.2.0"));
    expect(parsed.data.inventoryStocks).toEqual([]);
    expect(parsed.data.products[0].availability).toBe("OUT_OF_STOCK");
  });

  it("verwirft eine event- oder modusfremde Bestandsbewegung", () => {
    const data = inventoryData();
    data.inventoryMovements[1].dataMode = "LIVE";
    expect(() => parseBackupDocument(document(data))).toThrow(
      BadRequestException,
    );
  });

  it("verwirft eine unterbrochene Bestandskette vor jedem Restore-Schreibzugriff", () => {
    const data = inventoryData();
    data.inventoryMovements[1].quantityBefore = 4;
    data.inventoryMovements[1].quantityAfter = 2;
    expect(() => parseBackupDocument(document(data))).toThrow(
      BadRequestException,
    );
  });

  it("verwirft eine Stornobewegung ohne betragsgleiche SALE-Umkehrung", () => {
    const data = inventoryData();
    data.inventoryStocks[0].stockQuantity = 4;
    data.inventoryMovements.push({
      ...data.inventoryMovements[1],
      id: "inventory-cancel-1",
      type: "CANCELLATION",
      quantityDelta: 1,
      quantityBefore: 3,
      quantityAfter: 4,
      reversesMovementId: "inventory-sale-1",
      idempotencyKey: "inventory:cancel:item-1",
      requestFingerprint: "c".repeat(64),
      createdAt: "2026-08-29T10:02:00.000Z",
    });
    expect(() => parseBackupDocument(document(data))).toThrow(
      BadRequestException,
    );
  });

  // Issue #165: CashierSession.status gegen closingBalance/endTime.
  describe("CashierSession: status gegen Abschlussfelder (Issue #165)", () => {
    function sessionRow(overrides: Record<string, unknown>) {
      return {
        id: "session-1",
        userId: "user-1",
        eventId: "event-1",
        dataMode: "LIVE",
        status: "ACTIVE",
        ...overrides,
      };
    }
    function withSession(session: Record<string, unknown>) {
      return {
        ...emptyTables,
        events: [{ id: "event-1", name: "Fest" }],
        users: [{ id: "user-1", username: "kassa" }],
        sessions: [session],
      };
    }

    it("verwirft ACTIVE mit bereits gesetztem closingBalance (zweite Schließung würde die erste überschreiben)", () => {
      expect(() =>
        parseBackupDocument(
          document(
            withSession(
              sessionRow({
                status: "ACTIVE",
                closingBalance: 5000,
                endTime: "2026-08-29T20:00:00.000Z",
              }),
            ),
          ),
        ),
      ).toThrow(BadRequestException);
    });

    it("verwirft ACTIVE mit gesetztem endTime, aber ohne closingBalance", () => {
      expect(() =>
        parseBackupDocument(
          document(
            withSession(
              sessionRow({
                status: "ACTIVE",
                endTime: "2026-08-29T20:00:00.000Z",
              }),
            ),
          ),
        ),
      ).toThrow(BadRequestException);
    });

    it("verwirft CLOSED ohne endTime", () => {
      expect(() =>
        parseBackupDocument(
          document(
            withSession(sessionRow({ status: "CLOSED", closingBalance: 5000 })),
          ),
        ),
      ).toThrow(BadRequestException);
    });

    it("verwirft CLOSED ohne closingBalance", () => {
      expect(() =>
        parseBackupDocument(
          document(
            withSession(
              sessionRow({
                status: "CLOSED",
                endTime: "2026-08-29T20:00:00.000Z",
              }),
            ),
          ),
        ),
      ).toThrow(BadRequestException);
    });

    it("akzeptiert ACTIVE ohne jeden Abschluss (offene Sitzung)", () => {
      const parsed = parseBackupDocument(
        document(withSession(sessionRow({ status: "ACTIVE" }))),
      );
      expect(parsed.data.sessions[0]).toMatchObject({ status: "ACTIVE" });
    });

    it("akzeptiert CLOSED mit vollständigem Abschluss", () => {
      const parsed = parseBackupDocument(
        document(
          withSession(
            sessionRow({
              status: "CLOSED",
              closingBalance: 0,
              endTime: "2026-08-29T20:00:00.000Z",
            }),
          ),
        ),
      );
      expect(parsed.data.sessions[0]).toMatchObject({ status: "CLOSED" });
    });

    it("akzeptiert eine alte Sicherung ohne das Statusfeld überhaupt", () => {
      const parsed = parseBackupDocument(
        document(
          withSession({
            id: "session-1",
            userId: "user-1",
            eventId: "event-1",
          }),
        ),
      );
      expect(parsed.data.sessions).toHaveLength(1);
    });
  });

  // Issue #165: Payment.method gegen tenderedAmount/changeAmount.
  describe("Payment: Zahlungsart gegen Bargeldfelder (Issue #165)", () => {
    function withPayment(payment: Record<string, unknown>) {
      return {
        ...emptyTables,
        events: [{ id: "event-1", name: "Fest" }],
        orders: [{ id: "order-1", eventId: "event-1" }],
        payments: [{ id: "payment-1", orderId: "order-1", ...payment }],
      };
    }

    it("verwirft CASH mit tenderedAmount unter dem Betrag", () => {
      expect(() =>
        parseBackupDocument(
          document(
            withPayment({
              amount: 700,
              method: "CASH",
              tenderedAmount: 500,
              changeAmount: 0,
            }),
          ),
        ),
      ).toThrow(BadRequestException);
    });

    it("verwirft CASH mit falschem Wechselgeld", () => {
      expect(() =>
        parseBackupDocument(
          document(
            withPayment({
              amount: 700,
              method: "CASH",
              tenderedAmount: 1000,
              changeAmount: 999,
            }),
          ),
        ),
      ).toThrow(BadRequestException);
    });

    it("verwirft CASH ohne tenderedAmount, aber mit changeAmount ungleich 0", () => {
      expect(() =>
        parseBackupDocument(
          document(
            withPayment({
              amount: 700,
              method: "CASH",
              tenderedAmount: null,
              changeAmount: 50,
            }),
          ),
        ),
      ).toThrow(BadRequestException);
    });

    it.each(["CARD", "VOUCHER", "REFUND"])(
      "verwirft %s mit gesetztem tenderedAmount",
      (method) => {
        expect(() =>
          parseBackupDocument(
            document(
              withPayment({
                amount: 700,
                method,
                tenderedAmount: 700,
                changeAmount: 0,
              }),
            ),
          ),
        ).toThrow(BadRequestException);
      },
    );

    it.each(["CARD", "VOUCHER", "REFUND"])(
      "verwirft %s mit changeAmount ungleich 0",
      (method) => {
        expect(() =>
          parseBackupDocument(
            document(
              withPayment({
                amount: 700,
                method,
                tenderedAmount: null,
                changeAmount: 1,
              }),
            ),
          ),
        ).toThrow(BadRequestException);
      },
    );

    it("akzeptiert CASH ohne Bargeldbeleg (Tischbestellung über addPaymentsToOrder/splitPaymentOrder)", () => {
      const parsed = parseBackupDocument(
        document(
          withPayment({
            amount: 700,
            method: "CASH",
            tenderedAmount: null,
            changeAmount: 0,
          }),
        ),
      );
      expect(parsed.data.payments[0]).toMatchObject({ method: "CASH" });
    });

    it("akzeptiert CASH mit vollständigem Bargeldbeleg (Bon-/Stationskasse) inklusive Wechselgeld", () => {
      const parsed = parseBackupDocument(
        document(
          withPayment({
            amount: 700,
            method: "CASH",
            tenderedAmount: 1000,
            changeAmount: 300,
          }),
        ),
      );
      expect(parsed.data.payments[0]).toMatchObject({ tenderedAmount: 1000 });
    });

    it("akzeptiert CASH mit passgenauem Bargeldbeleg ohne Wechselgeld", () => {
      const parsed = parseBackupDocument(
        document(
          withPayment({
            amount: 350,
            method: "CASH",
            tenderedAmount: 350,
            changeAmount: 0,
          }),
        ),
      );
      expect(parsed.data.payments[0]).toMatchObject({ changeAmount: 0 });
    });

    it("akzeptiert CARD ohne Bargeldfelder", () => {
      const parsed = parseBackupDocument(
        document(withPayment({ amount: 700, method: "CARD" })),
      );
      expect(parsed.data.payments[0]).toMatchObject({ method: "CARD" });
    });

    it("akzeptiert VOUCHER ohne Bargeldfelder (Wertgutschein-Einlösung)", () => {
      const parsed = parseBackupDocument(
        document(withPayment({ amount: 700, method: "VOUCHER" })),
      );
      expect(parsed.data.payments[0]).toMatchObject({ method: "VOUCHER" });
    });

    it("akzeptiert REFUND ohne Bargeldfelder (Pfandauszahlung über dem Bestellwert)", () => {
      const parsed = parseBackupDocument(
        document(
          withPayment({ amount: 200, method: "REFUND", changeAmount: 0 }),
        ),
      );
      expect(parsed.data.payments[0]).toMatchObject({ method: "REFUND" });
    });
  });

  // Issue #165: Order.paymentStatus gegen die Summe abgeschlossener Zahlungen.
  describe("Order: paymentStatus gegen Zahlungssumme (Issue #165)", () => {
    function order(overrides: Record<string, unknown>) {
      return { id: "order-1", eventId: "event-1", ...overrides };
    }
    function payment(overrides: Record<string, unknown>) {
      return {
        id: "payment-1",
        orderId: "order-1",
        method: "CARD",
        status: "COMPLETED",
        ...overrides,
      };
    }
    function withOrder(
      orderRow: Record<string, unknown>,
      payments: Record<string, unknown>[] = [],
    ) {
      return {
        ...emptyTables,
        events: [{ id: "event-1", name: "Fest" }],
        orders: [order(orderRow)],
        payments,
      };
    }

    it("verwirft PAID ohne jede Zahlung (der Kernfall aus Issue #165)", () => {
      expect(() =>
        parseBackupDocument(
          document(withOrder({ totalAmount: 700, paymentStatus: "PAID" })),
        ),
      ).toThrow(BadRequestException);
    });

    it("verwirft OPEN trotz vollständig deckender Zahlung", () => {
      expect(() =>
        parseBackupDocument(
          document(
            withOrder({ totalAmount: 700, paymentStatus: "OPEN" }, [
              payment({ amount: 700 }),
            ]),
          ),
        ),
      ).toThrow(BadRequestException);
    });

    it("verwirft PARTIALLY_PAID, obwohl die Zahlungen den Betrag bereits voll decken", () => {
      expect(() =>
        parseBackupDocument(
          document(
            withOrder({ totalAmount: 700, paymentStatus: "PARTIALLY_PAID" }, [
              payment({ amount: 700 }),
            ]),
          ),
        ),
      ).toThrow(BadRequestException);
    });

    it("akzeptiert OPEN ohne jede Zahlung", () => {
      const parsed = parseBackupDocument(
        document(withOrder({ totalAmount: 700, paymentStatus: "OPEN" })),
      );
      expect(parsed.data.orders[0]).toMatchObject({ paymentStatus: "OPEN" });
    });

    it("akzeptiert PARTIALLY_PAID mit einer Teilzahlung (Splitzahlung)", () => {
      const parsed = parseBackupDocument(
        document(
          withOrder({ totalAmount: 700, paymentStatus: "PARTIALLY_PAID" }, [
            payment({ amount: 300 }),
          ]),
        ),
      );
      expect(parsed.data.orders[0]).toMatchObject({
        paymentStatus: "PARTIALLY_PAID",
      });
    });

    it("akzeptiert PAID mit exakt deckender Zahlung", () => {
      const parsed = parseBackupDocument(
        document(
          withOrder({ totalAmount: 700, paymentStatus: "PAID" }, [
            payment({ amount: 700 }),
          ]),
        ),
      );
      expect(parsed.data.orders[0]).toMatchObject({ paymentStatus: "PAID" });
    });

    it("akzeptiert PAID mit CASH- und REFUND-Zeile zusammen (Pfandauszahlung über dem Bestellwert)", () => {
      const parsed = parseBackupDocument(
        document(
          withOrder({ totalAmount: 500, paymentStatus: "PAID" }, [
            payment({ id: "payment-1", method: "CASH", amount: 500 }),
            payment({
              id: "payment-2",
              method: "REFUND",
              amount: 200,
            }),
          ]),
        ),
      );
      expect(parsed.data.orders[0]).toMatchObject({ paymentStatus: "PAID" });
    });

    it("akzeptiert eine stornierte Bestellung, deren paymentStatus vom Storno unberührt bleibt (PAID bleibt PAID)", () => {
      const parsed = parseBackupDocument(
        document(
          withOrder(
            {
              totalAmount: 700,
              paymentStatus: "PAID",
              lifecycleStatus: "CANCELLED",
            },
            [payment({ amount: 700 })],
          ),
        ),
      );
      expect(parsed.data.orders[0]).toMatchObject({
        lifecycleStatus: "CANCELLED",
        paymentStatus: "PAID",
      });
    });

    it("akzeptiert PAID mit mehreren Zahlungen (Bar- und Kartenanteil), deren Summe exakt trifft", () => {
      const parsed = parseBackupDocument(
        document(
          withOrder({ totalAmount: 1000, paymentStatus: "PAID" }, [
            payment({
              id: "payment-1",
              method: "CASH",
              amount: 400,
              tenderedAmount: 400,
              changeAmount: 0,
            }),
            payment({ id: "payment-2", method: "CARD", amount: 600 }),
          ]),
        ),
      );
      expect(parsed.data.orders[0]).toMatchObject({ paymentStatus: "PAID" });
    });

    it("akzeptiert paymentStatus REFUNDED unabhängig von der Zahlungssumme (kein Schreibpfad bekannt, bleibt ungeprüft)", () => {
      const parsed = parseBackupDocument(
        document(withOrder({ totalAmount: 700, paymentStatus: "REFUNDED" })),
      );
      expect(parsed.data.orders[0]).toMatchObject({
        paymentStatus: "REFUNDED",
      });
    });

    it("akzeptiert eine alte Bestellung ohne paymentStatus-Feld überhaupt", () => {
      const parsed = parseBackupDocument(
        document(withOrder({ totalAmount: 700 })),
      );
      expect(parsed.data.orders[0]).not.toHaveProperty("paymentStatus");
    });
  });
});
