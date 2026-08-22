import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import {
  cleanupConfirmedOfflineOrderRecords,
  countOpenOfflineOrderRecords,
  getAllOfflineOrderRecordsByCreatedAt,
  getLocalPendingOrderedByCreatedAt,
  getOfflineOrderRecord,
  getOfflineQueueDB,
  migrateLegacyV1Record,
  putOfflineOrderRecord,
  recoverInterruptedSendingRecords,
  resetOfflineQueueDBForTests,
} from "./offlineQueueDb";
import type { OfflineOrderRecord } from "./offlineQueueTypes";

const DB_NAME = "vereinorder-db";
const STORE_NAME = "offline-orders";

function freshRecord(
  overrides: Partial<OfflineOrderRecord> = {},
): OfflineOrderRecord {
  return {
    idempotencyKey: "key-1",
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
        productId: "product-1",
        quantity: 2,
        optionIds: [],
        productName: "Bier",
        unitPriceAtCapture: 350,
      },
    ],
    payments: [],
    tableName: "Tisch 3",
    areaId: null,
    areaName: null,
    totalAtCapture: 700,
    attempt: 0,
    lastAttemptAt: null,
    nextAttemptAt: 1_000,
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

beforeEach(() => {
  // Jede Testfall bekommt eine eigene, leere IndexedDB-Welt, sonst würden
  // Datensätze und der gecachte DB-Handle zwischen Tests durchsickern.
  (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB =
    new IDBFactory();
  resetOfflineQueueDBForTests();
});

describe("Migration von Version 1 (Abschnitt 6)", () => {
  it("übernimmt einen Altbestand einschließlich optionIds ohne Verlust", () => {
    const legacy = {
      idempotencyKey: "legacy-key",
      eventId: "event-9",
      items: [
        { productId: "product-a", quantity: 1, optionIds: ["opt-1", "opt-2"] },
        { productId: "product-b", quantity: 3 },
      ],
      payments: [{ amount: 500, method: "CASH" as const }],
      tableName: "Stehtisch",
      areaId: "area-1",
      createdAt: 4_200,
    };

    const migrated = migrateLegacyV1Record(legacy);

    expect(migrated.schemaVersion).toBe(2);
    expect(migrated.state).toBe("CONFLICT");
    expect(migrated.conflictKind).toBe("CONTEXT_UNKNOWN");
    expect(migrated.legacy).toBe(true);
    expect(migrated.dataMode).toBe("UNKNOWN");
    expect(migrated.userId).toBeNull();
    expect(migrated.username).toBeNull();
    expect(migrated.cashierSessionId).toBeNull();
    expect(migrated.createdAt).toBe(4_200);
    expect(migrated.updatedAt).toBe(4_200);
    expect(migrated.eventId).toBe("event-9");
    expect(migrated.tableName).toBe("Stehtisch");
    expect(migrated.areaId).toBe("area-1");
    expect(migrated.payments).toEqual([{ amount: 500, method: "CASH" }]);

    // Kernpunkt aus B3: optionIds darf beim Wiederholungsversand nicht
    // stillschweigend verschwinden.
    expect(migrated.items).toEqual([
      {
        productId: "product-a",
        quantity: 1,
        optionIds: ["opt-1", "opt-2"],
        productName: null,
        unitPriceAtCapture: null,
      },
      {
        productId: "product-b",
        quantity: 3,
        optionIds: [],
        productName: null,
        unitPriceAtCapture: null,
      },
    ]);
  });

  it("führt die Migration innerhalb der IndexedDB-Aufwertung durch, wenn ein alter Speicher vorhanden ist", async () => {
    // Schritt 1: eine Version-1-Datenbank mit einem alten, kontextlosen
    // Datensatz anlegen — genau wie es das heutige offlineSync.ts täte.
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore(STORE_NAME, {
          keyPath: "idempotencyKey",
        });
      };
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction(STORE_NAME, "readwrite");
        tx.objectStore(STORE_NAME).put({
          idempotencyKey: "carried-over",
          eventId: "event-live",
          items: [{ productId: "p1", quantity: 1, optionIds: ["opt-x"] }],
          payments: [{ amount: 1200, method: "CASH" }],
          tableName: "Bar",
          areaId: undefined,
          createdAt: 500,
        });
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
      request.onerror = () => reject(request.error);
    });

    // Schritt 2: die Bibliothek öffnet dieselbe Datenbank und wertet sie auf.
    const db = await getOfflineQueueDB();
    const migrated = await getOfflineOrderRecord(db, "carried-over");

    expect(migrated).toBeDefined();
    expect(migrated?.state).toBe("CONFLICT");
    expect(migrated?.conflictKind).toBe("CONTEXT_UNKNOWN");
    expect(migrated?.legacy).toBe(true);
    expect(migrated?.areaId).toBeNull();
    expect(migrated?.items[0].optionIds).toEqual(["opt-x"]);
    expect(migrated?.payments).toEqual([{ amount: 1200, method: "CASH" }]);

    // Die neuen Indizes müssen nach der Aufwertung existieren.
    const byCreatedAt = await getAllOfflineOrderRecordsByCreatedAt(db);
    expect(byCreatedAt.map((r) => r.idempotencyKey)).toEqual(["carried-over"]);
  });
});

describe("Sendereihenfolge nach Erfassungszeitpunkt (Antwort auf B8)", () => {
  it("liefert LOCAL_PENDING-Einträge aufsteigend nach createdAt, unabhängig von der Einfügereihenfolge", async () => {
    const db = await getOfflineQueueDB();
    await putOfflineOrderRecord(
      db,
      freshRecord({ idempotencyKey: "zzz-later", createdAt: 3_000 }),
    );
    await putOfflineOrderRecord(
      db,
      freshRecord({ idempotencyKey: "aaa-earliest", createdAt: 1_000 }),
    );
    await putOfflineOrderRecord(
      db,
      freshRecord({ idempotencyKey: "mmm-middle", createdAt: 2_000 }),
    );

    const pending = await getLocalPendingOrderedByCreatedAt(db);
    expect(pending.map((r) => r.idempotencyKey)).toEqual([
      "aaa-earliest",
      "mmm-middle",
      "zzz-later",
    ]);
  });

  it("blendet nicht-offene (CONFIRMED) Einträge aus der Sendereihenfolge aus", async () => {
    const db = await getOfflineQueueDB();
    await putOfflineOrderRecord(
      db,
      freshRecord({
        idempotencyKey: "confirmed-1",
        createdAt: 500,
        state: "CONFIRMED",
      }),
    );
    await putOfflineOrderRecord(
      db,
      freshRecord({ idempotencyKey: "pending-1", createdAt: 900 }),
    );

    const pending = await getLocalPendingOrderedByCreatedAt(db);
    expect(pending.map((r) => r.idempotencyKey)).toEqual(["pending-1"]);
  });
});

describe("Absturz während SENDING (Abschnitt 2)", () => {
  it("setzt einen unterbrochenen SENDING-Eintrag nach LOCAL_PENDING zurück und markiert interruptedAt", async () => {
    const db = await getOfflineQueueDB();
    await putOfflineOrderRecord(
      db,
      freshRecord({
        idempotencyKey: "crashed",
        state: "SENDING",
        sendingSince: 1_000,
        attempt: 2,
      }),
    );

    const now = 1_000 + 90_001; // eine Millisekunde über der Schwelle
    const recovered = await recoverInterruptedSendingRecords(db, now);
    expect(recovered).toBe(1);

    const record = await getOfflineOrderRecord(db, "crashed");
    expect(record?.state).toBe("LOCAL_PENDING");
    expect(record?.sendingSince).toBeNull();
    expect(record?.interruptedAt).toBe(now);
    // attempt bleibt erhalten, damit die Zählung automatischer Versuche stimmt.
    expect(record?.attempt).toBe(2);
  });

  it("lässt einen frischen SENDING-Eintrag unterhalb der Schwelle unangetastet", async () => {
    const db = await getOfflineQueueDB();
    await putOfflineOrderRecord(
      db,
      freshRecord({
        idempotencyKey: "just-started",
        state: "SENDING",
        sendingSince: 1_000,
      }),
    );

    const recovered = await recoverInterruptedSendingRecords(db, 1_000 + 1_000);
    expect(recovered).toBe(0);
    const record = await getOfflineOrderRecord(db, "just-started");
    expect(record?.state).toBe("SENDING");
  });
});

describe("Aufräumen bestätigter Einträge (Entscheidung 11.1)", () => {
  it("entfernt CONFIRMED-Einträge, die älter als 24 Stunden sind", async () => {
    const db = await getOfflineQueueDB();
    const dayMs = 24 * 60 * 60 * 1000;
    await putOfflineOrderRecord(
      db,
      freshRecord({
        idempotencyKey: "old-confirmed",
        state: "CONFIRMED",
        confirmedAt: 0,
      }),
    );
    await putOfflineOrderRecord(
      db,
      freshRecord({
        idempotencyKey: "recent-confirmed",
        state: "CONFIRMED",
        confirmedAt: dayMs - 1,
      }),
    );

    const removed = await cleanupConfirmedOfflineOrderRecords(db, dayMs + 1);
    expect(removed).toBe(1);
    expect(await getOfflineOrderRecord(db, "old-confirmed")).toBeUndefined();
    expect(await getOfflineOrderRecord(db, "recent-confirmed")).toBeDefined();
  });
});

describe("Obergrenze der Warteschlange (Entscheidung 11.7)", () => {
  it("zählt alle Zustände außer CONFIRMED als offen", async () => {
    const db = await getOfflineQueueDB();
    const states: OfflineOrderRecord["state"][] = [
      "LOCAL_PENDING",
      "SENDING",
      "CONFLICT",
      "FAILED",
      "CONFIRMED",
    ];
    for (const [index, state] of states.entries()) {
      await putOfflineOrderRecord(
        db,
        freshRecord({
          idempotencyKey: `k-${index}`,
          state,
          confirmedAt: state === "CONFIRMED" ? 1 : null,
        }),
      );
    }

    expect(await countOpenOfflineOrderRecords(db)).toBe(4);
  });
});
