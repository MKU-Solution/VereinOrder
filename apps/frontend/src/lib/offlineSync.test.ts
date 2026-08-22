import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  resetOfflineQueueDBForTests,
  getOfflineQueueDB,
  putOfflineOrderRecord,
  migrateLegacyV1Record,
} from "./offlineQueueDb";
import {
  adoptLegacyOfflineOrder,
  canAdoptLegacyOfflineOrder,
  canDiscardOfflineOrder,
  countOpenOfflineOrders,
  discardOfflineOrder,
  enqueueOfflineOrder,
  getOfflineOrders,
  MAX_OPEN_QUEUE_ENTRIES,
  OfflineQueueFullError,
  removeOfflineOrder,
  retryOfflineOrder,
  runOfflineQueueSync,
  saveOrderOffline,
  type OfflineOrderRecord,
  type OfflineSyncHttpClient,
} from "./offlineSync";

const LIVE_CONTEXT = [
  {
    id: "event-1",
    name: "Sommerfest",
    status: "ACTIVE",
    testMode: false,
    activeSession: null,
  },
];

function makeHttpClient(): OfflineSyncHttpClient & {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
} {
  return {
    get: vi.fn(),
    post: vi.fn(),
  };
}

const baseContext = {
  userId: "user-1",
  username: "kellner1",
  userRole: "WAITER",
  eventId: "event-1",
  eventName: "Sommerfest",
  dataMode: "LIVE" as const,
  cashierSessionId: null,
};

beforeEach(() => {
  (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB =
    new IDBFactory();
  resetOfflineQueueDBForTests();
});

describe("Anlegen einer Vormerkung", () => {
  it("legt einen LOCAL_PENDING-Eintrag mit vollständigem Kontext an", async () => {
    const record = await enqueueOfflineOrder({
      idempotencyKey: "order-a",
      context: baseContext,
      items: [{ productId: "product-1", quantity: 2, optionIds: ["opt-1"] }],
      payments: [{ amount: 500, method: "CASH" }],
      tableName: "Tisch 5",
      areaId: null,
    });

    expect(record.state).toBe("LOCAL_PENDING");
    expect(record.userId).toBe("user-1");
    expect(record.dataMode).toBe("LIVE");
    expect(record.items[0].optionIds).toEqual(["opt-1"]);
    expect(record.legacy).toBe(false);
  });

  it("lehnt eine leere Positionsliste ab", async () => {
    await expect(
      enqueueOfflineOrder({
        idempotencyKey: "order-empty",
        context: baseContext,
        items: [],
        payments: [],
      }),
    ).rejects.toThrow();
  });

  it("lehnt einen weiteren Kassiervorgang bei erreichter Obergrenze ab (Entscheidung 11.7)", async () => {
    for (let i = 0; i < MAX_OPEN_QUEUE_ENTRIES; i += 1) {
      await enqueueOfflineOrder({
        idempotencyKey: `bulk-${i}`,
        context: baseContext,
        items: [{ productId: "p", quantity: 1 }],
        payments: [],
      });
    }
    expect(await countOpenOfflineOrders()).toBe(MAX_OPEN_QUEUE_ENTRIES);

    await expect(
      enqueueOfflineOrder({
        idempotencyKey: "one-too-many",
        context: baseContext,
        items: [{ productId: "p", quantity: 1 }],
        payments: [],
      }),
    ).rejects.toThrow(OfflineQueueFullError);
  }, 20_000);
});

describe("Alte Exporte auf dem neuen Modell", () => {
  it("saveOrderOffline/getOfflineOrders/removeOfflineOrder bleiben nutzbar", async () => {
    await saveOrderOffline({
      idempotencyKey: "legacy-call",
      eventId: "event-1",
      items: [{ productId: "p1", quantity: 1, optionIds: ["opt-9"] }],
      payments: [],
      tableName: "Tisch 1",
      areaId: null,
      context: baseContext,
    });

    const all = await getOfflineOrders();
    expect(all).toHaveLength(1);
    expect(all[0].idempotencyKey).toBe("legacy-call");
    expect(all[0].items[0].optionIds).toEqual(["opt-9"]);

    await removeOfflineOrder("legacy-call");
    expect(await getOfflineOrders()).toHaveLength(0);
  });

  it("liefert getOfflineOrders sortiert nach Erfassungszeitpunkt (Antwort auf B8)", async () => {
    const db = await getOfflineQueueDB();
    await putOfflineOrderRecord(
      db,
      buildRecord({ idempotencyKey: "later", createdAt: 2_000 }),
    );
    await putOfflineOrderRecord(
      db,
      buildRecord({ idempotencyKey: "earlier", createdAt: 1_000 }),
    );

    const all = await getOfflineOrders();
    expect(all.map((r) => r.idempotencyKey)).toEqual(["earlier", "later"]);
  });
});

describe("Sendeschleife: Zustandsübergänge (Abschnitt 2 und 3)", () => {
  it("bestätigt einen Eintrag nach 2xx mit passendem idempotencyKey", async () => {
    await enqueueOfflineOrder({
      idempotencyKey: "will-confirm",
      context: baseContext,
      items: [{ productId: "p1", quantity: 1 }],
      payments: [],
    });

    const httpClient = makeHttpClient();
    httpClient.get.mockResolvedValue({ status: 200, data: LIVE_CONTEXT });
    httpClient.post.mockResolvedValue({
      status: 201,
      data: {
        id: "server-order-1",
        orderNumber: "R-1",
        idempotencyKey: "will-confirm",
        eventId: "event-1",
      },
    });

    const summary = await runOfflineQueueSync({
      httpClient,
      currentUserId: "user-1",
    });

    expect(summary.confirmed).toBe(1);
    expect(httpClient.post).toHaveBeenCalledTimes(1);
    const [, body] = httpClient.post.mock.calls[0];
    expect(body).toMatchObject({
      eventId: "event-1",
      idempotencyKey: "will-confirm",
    });

    const [record] = await getOfflineOrders();
    expect(record.state).toBe("CONFIRMED");
    expect(record.serverOrderId).toBe("server-order-1");
    expect(record.serverOrderNumber).toBe("R-1");
  });

  it("geht bei einem fachlichen 4xx in CONFLICT über und wiederholt nicht automatisch", async () => {
    await enqueueOfflineOrder({
      idempotencyKey: "will-conflict",
      context: baseContext,
      items: [{ productId: "sold-out-product", quantity: 1 }],
      payments: [],
    });

    const httpClient = makeHttpClient();
    httpClient.get.mockResolvedValue({ status: 200, data: LIVE_CONTEXT });
    httpClient.post.mockRejectedValue({
      response: {
        status: 400,
        data: { message: "Product sold-out-product is currently out of stock" },
      },
    });

    const firstRun = await runOfflineQueueSync({
      httpClient,
      currentUserId: "user-1",
    });
    expect(firstRun.conflicted).toBe(1);
    expect(httpClient.post).toHaveBeenCalledTimes(1);

    let [record] = await getOfflineOrders();
    expect(record.state).toBe("CONFLICT");
    expect(record.conflictKind).toBe("PRODUCT_UNAVAILABLE");
    expect(record.attempt).toBe(1);
    // Der gespeicherte Fehlertext darf keine Tokens oder Stacktraces enthalten.
    expect(record.lastError?.messageForOperator).toBe(
      "Product sold-out-product is currently out of stock",
    );

    // Zweiter Lauf: der Eintrag ist nicht mehr LOCAL_PENDING, also greift die
    // Sendeschleife ihn gar nicht mehr an — kein zweiter Aufruf von post().
    const secondRun = await runOfflineQueueSync({
      httpClient,
      currentUserId: "user-1",
    });
    expect(secondRun.processed).toBe(0);
    expect(httpClient.post).toHaveBeenCalledTimes(1);

    [record] = await getOfflineOrders();
    expect(record.state).toBe("CONFLICT");
    expect(record.attempt).toBe(1);
  });

  it("wiederholt einen Netzfehler bis zur Obergrenze und geht dann in FAILED über", async () => {
    await enqueueOfflineOrder({
      idempotencyKey: "flaky",
      context: baseContext,
      items: [{ productId: "p1", quantity: 1 }],
      payments: [],
    });

    const httpClient = makeHttpClient();
    httpClient.get.mockResolvedValue({ status: 200, data: LIVE_CONTEXT });
    httpClient.post.mockRejectedValue({ code: "ERR_NETWORK" });

    // enqueueOfflineOrder stempelt createdAt/nextAttemptAt mit der echten
    // Uhrzeit; die Testuhr muss auf derselben Skala starten, sonst gilt der
    // frisch angelegte Eintrag nie als "fällig".
    let clock = Date.now() + 1;
    const now = () => clock;

    for (let attempt = 1; attempt <= 6; attempt += 1) {
      const summary = await runOfflineQueueSync({
        httpClient,
        currentUserId: "user-1",
        now,
      });
      expect(summary.processed).toBe(1);
      const [record] = await getOfflineOrders();
      expect(record.attempt).toBe(attempt);
      if (attempt < 6) {
        expect(record.state).toBe("LOCAL_PENDING");
        expect(summary.retried).toBe(1);
        // Zeit bis knapp vor den nächsten Versuch vorspulen: die
        // Sendeschleife darf ihn dann noch nicht anfassen.
        const beforeDue = await runOfflineQueueSync({
          httpClient,
          currentUserId: "user-1",
          now: () => (record.nextAttemptAt ?? 0) - 1,
        });
        expect(beforeDue.processed).toBe(0);
        clock = (record.nextAttemptAt ?? clock) + 1;
      } else {
        expect(record.state).toBe("FAILED");
        expect(summary.failed).toBe(1);
      }
    }

    expect(httpClient.post).toHaveBeenCalledTimes(6);
  });

  it("sendet nicht, solange der erfassende Benutzer nicht angemeldet ist (Abschnitt 4)", async () => {
    await enqueueOfflineOrder({
      idempotencyKey: "waits-for-user",
      context: baseContext,
      items: [{ productId: "p1", quantity: 1 }],
      payments: [],
    });

    const httpClient = makeHttpClient();
    httpClient.get.mockResolvedValue({ status: 200, data: LIVE_CONTEXT });

    const summary = await runOfflineQueueSync({
      httpClient,
      currentUserId: "jemand-anders",
    });

    expect(summary.skippedWaitingForUser).toBe(1);
    expect(httpClient.post).not.toHaveBeenCalled();
    const [record] = await getOfflineOrders();
    expect(record.state).toBe("LOCAL_PENDING");
  });

  it("sendet Einträge in Erfassungsreihenfolge (Antwort auf B8)", async () => {
    const db = await getOfflineQueueDB();
    await putOfflineOrderRecord(
      db,
      buildRecord({ idempotencyKey: "second", createdAt: 2_000 }),
    );
    await putOfflineOrderRecord(
      db,
      buildRecord({ idempotencyKey: "first", createdAt: 1_000 }),
    );

    const httpClient = makeHttpClient();
    httpClient.get.mockResolvedValue({ status: 200, data: LIVE_CONTEXT });
    httpClient.post.mockImplementation(
      async (_url: string, body: { idempotencyKey: string }) => ({
        status: 201,
        data: {
          id: `srv-${body.idempotencyKey}`,
          idempotencyKey: body.idempotencyKey,
          eventId: "event-1",
        },
      }),
    );

    await runOfflineQueueSync({ httpClient, currentUserId: "user-1" });

    const order = httpClient.post.mock.calls.map(
      (call: unknown[]) =>
        (call[1] as { idempotencyKey: string }).idempotencyKey,
    );
    expect(order).toEqual(["first", "second"]);
  });

  it("setzt einen unterbrochenen SENDING-Eintrag zurück und schließt ihn im selben Lauf ab", async () => {
    const db = await getOfflineQueueDB();
    await putOfflineOrderRecord(
      db,
      buildRecord({
        idempotencyKey: "crashed-mid-send",
        state: "SENDING",
        sendingSince: 1_000,
        attempt: 1,
      }),
    );

    const httpClient = makeHttpClient();
    httpClient.get.mockResolvedValue({ status: 200, data: LIVE_CONTEXT });
    httpClient.post.mockResolvedValue({
      status: 200,
      data: {
        id: "srv-1",
        idempotencyKey: "crashed-mid-send",
        eventId: "event-1",
      },
    });

    const summary = await runOfflineQueueSync({
      httpClient,
      currentUserId: "user-1",
      now: () => 1_000 + 90_001,
    });

    expect(summary.recoveredInterrupted).toBe(1);
    expect(summary.confirmed).toBe(1);
    const [record] = await getOfflineOrders();
    expect(record.state).toBe("CONFIRMED");
    expect(record.interruptedAt).toBe(1_000 + 90_001);
  });

  it("bricht den Lauf ohne Zustandswechsel ab, wenn der Betriebskontext nicht abfragbar ist", async () => {
    await enqueueOfflineOrder({
      idempotencyKey: "no-context",
      context: baseContext,
      items: [{ productId: "p1", quantity: 1 }],
      payments: [],
    });

    const httpClient = makeHttpClient();
    httpClient.get.mockRejectedValue({ code: "ERR_NETWORK" });

    const summary = await runOfflineQueueSync({
      httpClient,
      currentUserId: "user-1",
    });

    expect(summary.contextFetchFailed).toBe(true);
    expect(httpClient.post).not.toHaveBeenCalled();
    const [record] = await getOfflineOrders();
    expect(record.state).toBe("LOCAL_PENDING");
  });
});

describe("Manuelle Wiederholung (Abschnitt 7, Konflikt)", () => {
  it("sendet einen CONFLICT-Eintrag nach 'Erneut senden' erneut, wenn der Kontext wieder passt", async () => {
    const db = await getOfflineQueueDB();
    await putOfflineOrderRecord(
      db,
      buildRecord({
        idempotencyKey: "retry-me",
        state: "CONFLICT",
        conflictKind: "PRODUCT_UNAVAILABLE",
        attempt: 1,
      }),
    );

    const httpClient = makeHttpClient();
    httpClient.get.mockResolvedValue({ status: 200, data: LIVE_CONTEXT });
    httpClient.post.mockResolvedValue({
      status: 201,
      data: { id: "srv-2", idempotencyKey: "retry-me", eventId: "event-1" },
    });

    const updated = await retryOfflineOrder("retry-me", {
      httpClient,
      currentUserId: "user-1",
    });

    expect(updated?.state).toBe("CONFIRMED");
  });
});

describe("Verwerfen (Abschnitt 7)", () => {
  it("löscht den Eintrag erst nach erfolgreichem Serverkontakt", async () => {
    await enqueueOfflineOrder({
      idempotencyKey: "discard-me",
      context: baseContext,
      items: [{ productId: "p1", quantity: 1 }],
      payments: [],
    });

    const httpClient = makeHttpClient();
    httpClient.get.mockResolvedValue({ status: 404, data: {} });
    httpClient.post.mockResolvedValue({ status: 201, data: {} });

    const result = await discardOfflineOrder(
      "discard-me",
      { category: "TEST_ENTRY" },
      { httpClient },
    );

    expect(result).toEqual({ outcome: "DISCARDED" });
    expect(await getOfflineOrders()).toHaveLength(0);

    // Muss exakt dem DiscardOfflineQueueDto aus orders.service.ts entsprechen
    // (reason als einzelnes Pflichtfeld, capturedByUserId, legacy) — sonst
    // lehnt das Backend jedes Verwerfen mit 400 ab.
    const [, body] = httpClient.post.mock.calls[0];
    expect(body).toMatchObject({
      idempotencyKey: "discard-me",
      reason: "Testeingabe",
      capturedByUserId: "user-1",
      legacy: false,
    });
  });

  it("löscht nichts, wenn der Server die Bestellung bereits kennt", async () => {
    await enqueueOfflineOrder({
      idempotencyKey: "already-there",
      context: baseContext,
      items: [{ productId: "p1", quantity: 1 }],
      payments: [],
    });

    const httpClient = makeHttpClient();
    httpClient.get.mockResolvedValue({
      status: 200,
      data: { id: "srv-9", orderNumber: "R-9" },
    });

    const result = await discardOfflineOrder(
      "already-there",
      { category: "OTHER", note: "Doppelt erfasst" },
      { httpClient },
    );

    expect(result).toEqual({
      outcome: "ALREADY_ON_SERVER",
      serverOrderNumber: "R-9",
    });
    const [record] = await getOfflineOrders();
    expect(record.state).toBe("CONFIRMED");
  });

  it("verweigert das Verwerfen ohne Serververbindung", async () => {
    await enqueueOfflineOrder({
      idempotencyKey: "cannot-discard",
      context: baseContext,
      items: [{ productId: "p1", quantity: 1 }],
      payments: [],
    });

    const httpClient = makeHttpClient();
    httpClient.get.mockRejectedValue({ code: "ERR_NETWORK" });

    const result = await discardOfflineOrder(
      "cannot-discard",
      { category: "OTHER" },
      { httpClient },
    );

    expect(result).toEqual({
      outcome: "REJECTED",
      reason: "SERVER_UNREACHABLE",
    });
    expect(await getOfflineOrders()).toHaveLength(1);
  });
});

describe("Berechtigungen (Entscheidungen 11.2, 11.5, 11.6)", () => {
  it("erlaubt Verwerfen nur ADMINISTRATOR bei vorhandenen Zahlungen", () => {
    const record = {
      userId: "user-1",
      legacy: false,
      payments: [{ amount: 100, method: "CASH" as const }],
    };
    expect(
      canDiscardOfflineOrder(record, { userId: "user-1", role: "WAITER" }),
    ).toBe(false);
    expect(
      canDiscardOfflineOrder(record, {
        userId: "user-1",
        role: "ADMINISTRATOR",
      }),
    ).toBe(true);
  });

  it("erlaubt Verwerfen von Altbeständen nur ADMINISTRATOR oder EVENT_MANAGER", () => {
    const record = { userId: "user-1", legacy: true, payments: [] };
    expect(
      canDiscardOfflineOrder(record, { userId: "user-1", role: "WAITER" }),
    ).toBe(false);
    expect(
      canDiscardOfflineOrder(record, {
        userId: "user-1",
        role: "EVENT_MANAGER",
      }),
    ).toBe(true);
  });

  it("erlaubt dem erfassenden Benutzer das Verwerfen normaler Einträge ohne Zahlungen", () => {
    const record = { userId: "user-1", legacy: false, payments: [] };
    expect(
      canDiscardOfflineOrder(record, { userId: "user-1", role: "WAITER" }),
    ).toBe(true);
    expect(
      canDiscardOfflineOrder(record, {
        userId: "andere-person",
        role: "WAITER",
      }),
    ).toBe(false);
  });

  it("erlaubt die Übernahme eines Altbestands nur, wenn die Veranstaltung heute läuft", () => {
    expect(
      canAdoptLegacyOfflineOrder(
        { legacy: true },
        { userId: "u", role: "ADMINISTRATOR" },
        false,
      ),
    ).toBe(false);
    expect(
      canAdoptLegacyOfflineOrder(
        { legacy: true },
        { userId: "u", role: "ADMINISTRATOR" },
        true,
      ),
    ).toBe(true);
    expect(
      canAdoptLegacyOfflineOrder(
        { legacy: false },
        { userId: "u", role: "ADMINISTRATOR" },
        true,
      ),
    ).toBe(false);
  });
});

describe("Übernahme von Altbeständen (Abschnitt 6)", () => {
  it("übernimmt einen Altbestand unter dem heutigen Kontext und setzt ihn auf LOCAL_PENDING", async () => {
    const db = await getOfflineQueueDB();
    const legacyRecord = migrateLegacyV1Record({
      idempotencyKey: "old-one",
      eventId: "event-1",
      items: [{ productId: "p1", quantity: 1 }],
      createdAt: 10,
    });
    await putOfflineOrderRecord(db, legacyRecord);

    const adopted = await adoptLegacyOfflineOrder(
      "old-one",
      {
        userId: "user-1",
        username: "kellner1",
        dataMode: "LIVE",
        cashierSessionId: null,
      },
      { isEventCurrentlyRunning: true },
    );

    expect(adopted.state).toBe("LOCAL_PENDING");
    expect(adopted.userId).toBe("user-1");
    expect(adopted.adoptedByUserId).toBe("user-1");
    expect(adopted.legacy).toBe(true);
  });

  it("verweigert die Übernahme, wenn die Veranstaltung heute nicht läuft", async () => {
    const db = await getOfflineQueueDB();
    const legacyRecord = migrateLegacyV1Record({
      idempotencyKey: "old-two",
      eventId: "event-1",
      items: [{ productId: "p1", quantity: 1 }],
      createdAt: 10,
    });
    await putOfflineOrderRecord(db, legacyRecord);

    await expect(
      adoptLegacyOfflineOrder(
        "old-two",
        {
          userId: "user-1",
          username: "kellner1",
          dataMode: "LIVE",
          cashierSessionId: null,
        },
        { isEventCurrentlyRunning: false },
      ),
    ).rejects.toThrow();
  });
});

function buildRecord(
  overrides: Partial<OfflineOrderRecord> = {},
): OfflineOrderRecord {
  return {
    idempotencyKey: "record",
    schemaVersion: 2,
    state: "LOCAL_PENDING",
    createdAt: 1_000,
    updatedAt: 1_000,
    userId: "user-1",
    username: "kellner1",
    userRole: "WAITER",
    eventId: "event-1",
    eventName: "Sommerfest",
    dataMode: "LIVE",
    cashierSessionId: null,
    items: [
      {
        productId: "p1",
        quantity: 1,
        optionIds: [],
        productName: null,
        unitPriceAtCapture: null,
      },
    ],
    payments: [],
    tableName: null,
    areaId: null,
    areaName: null,
    totalAtCapture: null,
    attempt: 0,
    lastAttemptAt: null,
    nextAttemptAt: 0,
    sendingSince: null,
    interruptedAt: null,
    lastError: null,
    conflictKind: null,
    serverOrderId: null,
    serverOrderNumber: null,
    confirmedAt: null,
    legacy: false,
    adoptedByUserId: null,
    adoptedAt: null,
    ...overrides,
  };
}
