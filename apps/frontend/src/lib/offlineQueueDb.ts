// IndexedDB-Zugriff und Migration der Offline-Warteschlange (Issue #65).
// Verbindliche Quelle: docs/development/offline-warteschlange.md, Abschnitt 5 und 6.
//
// Der Objektspeicher wird bei einer Aufwertung von Version 1 auf Version 2
// nicht gelöscht und nicht neu angelegt (Abschnitt 6). Jeder vorhandene
// Datensatz wird innerhalb derselben Aufwertungstransaktion ersetzt, damit
// ein Absturz während der Migration keine halb umgestellten Daten
// hinterlässt.

import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type {
  OfflineOrderRecord,
  OfflineOrderState,
} from "./offlineQueueTypes";

const DB_NAME = "vereinorder-db";
const STORE_NAME = "offline-orders";
export const OFFLINE_QUEUE_DB_VERSION = 2;

const INDEX_CREATED_AT = "by-createdAt";
const INDEX_STATE = "by-state";

/** Schwelle, ab der ein `SENDING`-Eintrag als unterbrochen gilt (Abschnitt 2). */
export const INTERRUPTED_SENDING_THRESHOLD_MS = 90_000;

/** Nach dieser Zeit verschwindet eine bestätigte Vormerkung (Entscheidung 11.1). */
export const CONFIRMED_RETENTION_MS = 24 * 60 * 60 * 1000;

/** Obergrenze offener Einträge (Entscheidung 11.7). */
export const MAX_OPEN_QUEUE_ENTRIES = 200;

const OPEN_STATES: OfflineOrderState[] = [
  "LOCAL_PENDING",
  "SENDING",
  "CONFLICT",
  "FAILED",
];

interface OfflineQueueDBSchema extends DBSchema {
  [STORE_NAME]: {
    key: string;
    value: OfflineOrderRecord;
    indexes: {
      [INDEX_CREATED_AT]: number;
      [INDEX_STATE]: OfflineOrderState;
    };
  };
}

export type OfflineQueueDB = IDBPDatabase<OfflineQueueDBSchema>;

/** Datensatz aus Version 1, wie er heute in `offlineSync.ts` erzeugt wird. */
interface LegacyOfflineOrderV1 {
  idempotencyKey: string;
  eventId: string;
  items: { productId: string; quantity: number; optionIds?: string[] }[];
  payments?: { amount: number; method: "CASH" | "CARD" | "VOUCHER" }[];
  tableName?: string;
  areaId?: string;
  createdAt: number;
}

const isLegacyV1Record = (value: unknown): value is LegacyOfflineOrderV1 =>
  !!value &&
  typeof value === "object" &&
  !("schemaVersion" in (value as Record<string, unknown>));

/**
 * Abbildung Feld für Feld nach Abschnitt 6. Es geht kein Feld verloren, und
 * neue Felder ohne Quelle werden nicht geraten, sondern auf `null` gesetzt.
 *
 * Der Altbestand wird als `CONFLICT` / `CONTEXT_UNKNOWN` geführt, nicht als
 * `LOCAL_PENDING` — sonst würde er beim nächsten `online`-Ereignis unter
 * irgendeinem Kontext gesendet, genau der in B2 beschriebene Fehler.
 */
export function migrateLegacyV1Record(
  legacy: LegacyOfflineOrderV1,
): OfflineOrderRecord {
  const createdAt =
    typeof legacy.createdAt === "number" ? legacy.createdAt : Date.now();

  return {
    idempotencyKey: legacy.idempotencyKey,
    schemaVersion: 2,
    state: "CONFLICT",
    createdAt,
    updatedAt: createdAt,

    userId: null,
    username: null,
    userRole: null,
    eventId: legacy.eventId,
    eventName: null,
    dataMode: "UNKNOWN",
    cashierSessionId: null,

    items: (legacy.items ?? []).map((item) => ({
      productId: item.productId,
      quantity: item.quantity,
      optionIds: item.optionIds ?? [],
      productName: null,
      unitPriceAtCapture: null,
    })),
    payments: legacy.payments ?? [],

    tableName: legacy.tableName ?? null,
    areaId: legacy.areaId ?? null,
    areaName: null,
    totalAtCapture: null,

    attempt: 0,
    lastAttemptAt: null,
    nextAttemptAt: null,
    sendingSince: null,
    interruptedAt: null,
    lastError: null,
    conflictKind: "CONTEXT_UNKNOWN",

    serverOrderId: null,
    serverOrderNumber: null,
    confirmedAt: null,

    legacy: true,
    adoptedByUserId: null,
    adoptedAt: null,
  };
}

async function migrateStoreInPlace(
  store: import("idb").IDBPObjectStore<
    OfflineQueueDBSchema,
    (typeof STORE_NAME)[],
    typeof STORE_NAME,
    "versionchange"
  >,
): Promise<void> {
  let cursor = await store.openCursor();
  while (cursor) {
    const value: unknown = cursor.value;
    if (isLegacyV1Record(value)) {
      await cursor.update(migrateLegacyV1Record(value));
    }
    cursor = await cursor.continue();
  }
}

let dbPromise: Promise<OfflineQueueDB> | null = null;

/**
 * Öffnet (und bei Bedarf migriert) die Datenbank. Das Ergebnis wird für die
 * Laufzeit der Seite zwischengespeichert; ein Fehlschlag (privates Fenster,
 * kein Speicherplatz) wird nicht zwischengespeichert, ein erneuter Aufruf
 * versucht es erneut.
 */
export function getOfflineQueueDB(): Promise<OfflineQueueDB> {
  if (!dbPromise) {
    dbPromise = openDB<OfflineQueueDBSchema>(
      DB_NAME,
      OFFLINE_QUEUE_DB_VERSION,
      {
        upgrade(db, oldVersion, _newVersion, transaction) {
          const store = db.objectStoreNames.contains(STORE_NAME)
            ? transaction.objectStore(STORE_NAME)
            : db.createObjectStore(STORE_NAME, { keyPath: "idempotencyKey" });

          if (!store.indexNames.contains(INDEX_CREATED_AT)) {
            store.createIndex(INDEX_CREATED_AT, "createdAt");
          }
          if (!store.indexNames.contains(INDEX_STATE)) {
            store.createIndex(INDEX_STATE, "state");
          }

          if (oldVersion >= 1 && oldVersion < 2) {
            // Migration von Version 1, vollständig innerhalb dieser
            // Aufwertungstransaktion (Abschnitt 6, Schritt 3). idb reiht alle
            // Anfragen an dieselbe Transaktion an, solange nur auf
            // IndexedDB-Anfragen gewartet wird.
            void migrateStoreInPlace(store);
          }
        },
      },
    ).catch((error) => {
      dbPromise = null;
      throw error;
    });
  }
  return dbPromise;
}

/** Nur für Tests: erzwingt beim nächsten Aufruf ein erneutes Öffnen. */
export function resetOfflineQueueDBForTests(): void {
  dbPromise = null;
}

export async function putOfflineOrderRecord(
  db: OfflineQueueDB,
  record: OfflineOrderRecord,
): Promise<void> {
  await db.put(STORE_NAME, record);
}

export async function getOfflineOrderRecord(
  db: OfflineQueueDB,
  idempotencyKey: string,
): Promise<OfflineOrderRecord | undefined> {
  return db.get(STORE_NAME, idempotencyKey);
}

export async function deleteOfflineOrderRecord(
  db: OfflineQueueDB,
  idempotencyKey: string,
): Promise<void> {
  await db.delete(STORE_NAME, idempotencyKey);
}

/**
 * Alle Datensätze, sortiert nach `createdAt` aufsteigend, über den Index
 * `by-createdAt` — nicht über `getAll` mit anschließender Sortierung im
 * Speicher (Antwort auf B8).
 */
export async function getAllOfflineOrderRecordsByCreatedAt(
  db: OfflineQueueDB,
): Promise<OfflineOrderRecord[]> {
  return db.getAllFromIndex(STORE_NAME, INDEX_CREATED_AT);
}

/**
 * Einträge in `LOCAL_PENDING`, sortiert nach `createdAt` aufsteigend
 * (Sendereihenfolge, Abschnitt 7, Schritt 3).
 */
export async function getLocalPendingOrderedByCreatedAt(
  db: OfflineQueueDB,
): Promise<OfflineOrderRecord[]> {
  const all = await getAllOfflineOrderRecordsByCreatedAt(db);
  return all.filter((record) => record.state === "LOCAL_PENDING");
}

/** Anzahl offener Einträge (alle Zustände außer `CONFIRMED`), für Entscheidung 11.7. */
export async function countOpenOfflineOrderRecords(
  db: OfflineQueueDB,
): Promise<number> {
  let count = 0;
  for (const state of OPEN_STATES) {
    count += await db.countFromIndex(STORE_NAME, INDEX_STATE, state);
  }
  return count;
}

/**
 * Wiederherstellungslauf beim Start (Abschnitt 2, "Absturz während SENDING").
 * Jeder Eintrag in `SENDING`, dessen `sendingSince` älter als die Schwelle
 * ist, wird nach `LOCAL_PENDING` zurückgesetzt und mit `interruptedAt`
 * markiert. Er gilt nicht als gesendet und wird nicht verworfen; `attempt`
 * bleibt unverändert, damit die Zählung automatischer Versuche stimmt.
 *
 * Gibt die Anzahl der zurückgesetzten Einträge zurück.
 */
export async function recoverInterruptedSendingRecords(
  db: OfflineQueueDB,
  now: number,
  thresholdMs: number = INTERRUPTED_SENDING_THRESHOLD_MS,
): Promise<number> {
  const tx = db.transaction(STORE_NAME, "readwrite");
  const index = tx.store.index(INDEX_STATE);
  let cursor = await index.openCursor("SENDING");
  let recovered = 0;
  while (cursor) {
    const record = cursor.value;
    if (
      record.sendingSince !== null &&
      now - record.sendingSince > thresholdMs
    ) {
      await cursor.update({
        ...record,
        state: "LOCAL_PENDING",
        sendingSince: null,
        interruptedAt: now,
        nextAttemptAt: now,
        updatedAt: now,
      });
      recovered += 1;
    }
    cursor = await cursor.continue();
  }
  await tx.done;
  return recovered;
}

/**
 * Aufräumlauf: `CONFIRMED`-Einträge, deren `confirmedAt` älter als die
 * Aufbewahrungsfrist ist, werden entfernt (Entscheidung 11.1).
 */
export async function cleanupConfirmedOfflineOrderRecords(
  db: OfflineQueueDB,
  now: number,
  retentionMs: number = CONFIRMED_RETENTION_MS,
): Promise<number> {
  const tx = db.transaction(STORE_NAME, "readwrite");
  const index = tx.store.index(INDEX_STATE);
  let cursor = await index.openCursor("CONFIRMED");
  let removed = 0;
  while (cursor) {
    const record = cursor.value;
    if (record.confirmedAt !== null && now - record.confirmedAt > retentionMs) {
      await cursor.delete();
      removed += 1;
    }
    cursor = await cursor.continue();
  }
  await tx.done;
  return removed;
}
