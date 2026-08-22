// Offline-Warteschlange (Issue #65) — Datenhaltung und Ablauflogik.
//
// Verbindlicher Entwurf: docs/development/offline-warteschlange.md.
// Diese Datei ist die öffentliche Schnittstelle der Bibliothek. Die
// Oberfläche (Dashboard.tsx, ein eigener Auftrag) baut ausschließlich auf
// den hier exportierten Funktionen und Typen auf.
//
// Kein Teil dieses Moduls importiert `../lib/api` oder `../pages/Dashboard`.
// Der aufrufende Code übergibt seinen HTTP-Client selbst (siehe
// `OfflineSyncHttpClient`) — das hält diese Bibliothek unabhängig von der
// Verdrahtung der 401-Behandlung in `api.ts`, die ein separater Eingriff
// bleibt (siehe Abschlussbericht, Abschnitt "Risiken").

import {
  cleanupConfirmedOfflineOrderRecords,
  countOpenOfflineOrderRecords,
  deleteOfflineOrderRecord,
  getAllOfflineOrderRecordsByCreatedAt,
  getLocalPendingOrderedByCreatedAt,
  getOfflineOrderRecord,
  getOfflineQueueDB,
  MAX_OPEN_QUEUE_ENTRIES,
  putOfflineOrderRecord,
  recoverInterruptedSendingRecords,
  type OfflineQueueDB,
} from "./offlineQueueDb";
import {
  checkOfflineOrderContext,
  fetchCurrentEventContexts,
  OFFLINE_SYNC_HEADER,
  OFFLINE_SYNC_REQUEST_TIMEOUT_MS,
  type OfflineSyncHttpClient,
  type OfflineSyncRequestConfig,
} from "./offlineQueueContext";
import {
  classifySubmissionOutcome,
  computeNextAttemptDelayMs,
  MAX_AUTOMATIC_ATTEMPTS,
  type SubmissionOutcome,
} from "./offlineQueueClassify";
import type {
  ConflictKind,
  CurrentEventContext,
  EnqueueOfflineOrderInput,
  OfflineCaptureContext,
  OfflineDataMode,
  OfflineError,
  OfflineItem,
  OfflineOrderItemInput,
  OfflineOrderRecord,
  OfflineOrderState,
  OfflinePayment,
  OfflinePaymentMethod,
} from "./offlineQueueTypes";

export type {
  ConflictKind,
  CurrentEventContext,
  EnqueueOfflineOrderInput,
  OfflineCaptureContext,
  OfflineDataMode,
  OfflineError,
  OfflineItem,
  OfflineOrderItemInput,
  OfflineOrderRecord,
  OfflineOrderState,
  OfflinePayment,
  OfflinePaymentMethod,
  OfflineSyncHttpClient,
  OfflineSyncRequestConfig,
};
export { MAX_OPEN_QUEUE_ENTRIES, OFFLINE_SYNC_HEADER };

// ---------------------------------------------------------------------------
// Anlegen einer Vormerkung
// ---------------------------------------------------------------------------

export class OfflineQueueUnavailableError extends Error {}
export class OfflineQueueFullError extends Error {}

/**
 * Legt eine neue Vormerkung mit vollständigem Kontext an (Abschnitt 2,
 * Übergang "— → LOCAL_PENDING"). Wirft, statt eine Bestellung
 * stillschweigend zu verlieren (Entscheidung 11.7): `OfflineQueueFullError`
 * bei 200 offenen Einträgen, `OfflineQueueUnavailableError`, wenn
 * IndexedDB nicht verfügbar ist (privates Fenster, kein Speicherplatz).
 */
export async function enqueueOfflineOrder(
  input: EnqueueOfflineOrderInput,
): Promise<OfflineOrderRecord> {
  if (input.items.length === 0) {
    throw new Error("Eine Vormerkung braucht mindestens eine Position.");
  }

  let db: OfflineQueueDB;
  try {
    db = await getOfflineQueueDB();
  } catch {
    throw new OfflineQueueUnavailableError(
      "Die Vormerkung kann nicht gespeichert werden: lokaler Speicher ist nicht verfügbar.",
    );
  }

  let openCount: number;
  try {
    openCount = await countOpenOfflineOrderRecords(db);
  } catch {
    throw new OfflineQueueUnavailableError(
      "Die Vormerkung kann nicht gespeichert werden: lokaler Speicher ist nicht verfügbar.",
    );
  }
  if (openCount >= MAX_OPEN_QUEUE_ENTRIES) {
    throw new OfflineQueueFullError(
      `Die Warteschlange ist voll (${MAX_OPEN_QUEUE_ENTRIES} offene Vormerkungen). Bitte zuerst bestehende Einträge klären.`,
    );
  }

  const now = Date.now();
  const record: OfflineOrderRecord = {
    idempotencyKey: input.idempotencyKey,
    schemaVersion: 2,
    state: "LOCAL_PENDING",
    createdAt: now,
    updatedAt: now,

    userId: input.context.userId,
    username: input.context.username,
    userRole: input.context.userRole ?? null,
    eventId: input.context.eventId,
    eventName: input.context.eventName ?? null,
    dataMode: input.context.dataMode,
    cashierSessionId: input.context.cashierSessionId,

    items: input.items.map((item) => ({
      productId: item.productId,
      quantity: item.quantity,
      optionIds: item.optionIds ?? [],
      productName: item.productName ?? null,
      unitPriceAtCapture: item.unitPriceAtCapture ?? null,
    })),
    payments: input.payments,

    tableName: input.tableName ?? null,
    areaId: input.areaId ?? null,
    areaName: input.areaName ?? null,
    totalAtCapture: input.totalAtCapture ?? null,

    attempt: 0,
    lastAttemptAt: null,
    nextAttemptAt: now,
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
  };

  try {
    await putOfflineOrderRecord(db, record);
  } catch {
    throw new OfflineQueueUnavailableError(
      "Die Vormerkung kann nicht gespeichert werden: lokaler Speicher ist nicht verfügbar.",
    );
  }
  return record;
}

// ---------------------------------------------------------------------------
// Lesen für die Anzeige
// ---------------------------------------------------------------------------

/** Alle Einträge, sortiert nach Erfassungszeitpunkt aufsteigend (Antwort auf B8). */
export async function listOfflineOrders(): Promise<OfflineOrderRecord[]> {
  const db = await getOfflineQueueDB();
  return getAllOfflineOrderRecordsByCreatedAt(db);
}

/** Alle Einträge außer den bestätigten — die offene Warteschlange. */
export async function listOpenOfflineOrders(): Promise<OfflineOrderRecord[]> {
  const all = await listOfflineOrders();
  return all.filter((record) => record.state !== "CONFIRMED");
}

/** Die getrennte Liste "Erledigt" (Entscheidung 11.1). */
export async function listConfirmedOfflineOrders(): Promise<
  OfflineOrderRecord[]
> {
  const all = await listOfflineOrders();
  return all.filter((record) => record.state === "CONFIRMED");
}

export async function countOpenOfflineOrders(): Promise<number> {
  const db = await getOfflineQueueDB();
  return countOpenOfflineOrderRecords(db);
}

// ---------------------------------------------------------------------------
// Wiederherstellung und Aufräumen
// ---------------------------------------------------------------------------

/**
 * Wiederherstellungslauf beim Start (Abschnitt 2). Setzt unterbrochene
 * `SENDING`-Einträge nach `LOCAL_PENDING` zurück. Sollte einmal beim
 * Anwendungsstart aufgerufen werden, bevor die erste Sendeschleife läuft;
 * `runOfflineQueueSync` ruft ihn zusätzlich bei jedem Lauf auf, das ist
 * ungefährlich, weil die Funktion nur wirklich unterbrochene Einträge
 * anfasst.
 */
export async function recoverInterruptedOfflineSends(
  now: number = Date.now(),
): Promise<number> {
  const db = await getOfflineQueueDB();
  return recoverInterruptedSendingRecords(db, now);
}

/** Entfernt bestätigte Einträge, die die Aufbewahrungsfrist überschritten haben. */
export async function cleanupConfirmedOfflineOrders(
  now: number = Date.now(),
): Promise<number> {
  const db = await getOfflineQueueDB();
  return cleanupConfirmedOfflineOrderRecords(db, now);
}

// ---------------------------------------------------------------------------
// Sendeschleife (Abschnitt 7, "Wiederholung")
// ---------------------------------------------------------------------------

export interface OfflineSyncDeps {
  httpClient: OfflineSyncHttpClient;
  /** `null`, wenn niemand angemeldet ist. */
  currentUserId: string | null;
  now?: () => number;
}

export interface OfflineSyncRunSummary {
  /** `true`, wenn `GET /sessions/context` fehlgeschlagen ist — der Lauf wurde dann sofort beendet. */
  contextFetchFailed: boolean;
  recoveredInterrupted: number;
  processed: number;
  confirmed: number;
  conflicted: number;
  retried: number;
  failed: number;
  skippedWaitingForUser: number;
}

function emptySummary(): OfflineSyncRunSummary {
  return {
    contextFetchFailed: false,
    recoveredInterrupted: 0,
    processed: 0,
    confirmed: 0,
    conflicted: 0,
    retried: 0,
    failed: 0,
    skippedWaitingForUser: 0,
  };
}

function buildOrderPayload(
  record: OfflineOrderRecord,
): Record<string, unknown> {
  return {
    eventId: record.eventId,
    idempotencyKey: record.idempotencyKey,
    items: record.items.map((item) => ({
      productId: item.productId,
      quantity: item.quantity,
      // "optionIds wird nur beim Senden weggelassen, wenn das Array leer
      // ist" (Abschnitt 5) — kein Unterschied zum heutigen Verhalten.
      ...(item.optionIds.length > 0 ? { optionIds: item.optionIds } : {}),
    })),
    payments: record.payments,
    tableName: record.tableName,
    areaId: record.areaId,
    cashierSessionId: record.cashierSessionId,
  };
}

/**
 * Sendet genau einen Eintrag: schreibt `SENDING` vor dem Absenden
 * (Abschnitt 2, Absturzfall), sendet, ordnet die Antwort ein und schreibt
 * den neuen Zustand. Wird sowohl von der automatischen Sendeschleife als
 * auch von der manuellen Wiederholung (`retryOfflineOrder`) verwendet.
 */
async function attemptSendEntry(
  db: OfflineQueueDB,
  httpClient: OfflineSyncHttpClient,
  record: OfflineOrderRecord,
  now: () => number,
): Promise<"CONFIRMED" | "CONFLICT" | "RETRY" | "FAILED"> {
  const sendingRecord: OfflineOrderRecord = {
    ...record,
    state: "SENDING",
    sendingSince: now(),
    attempt: record.attempt + 1,
    lastAttemptAt: now(),
    // interruptedAt bleibt unverändert: gesetzt wird es ausschließlich vom
    // Wiederherstellungslauf (Abschnitt 2). Es hier zu löschen würde die
    // Anzeige "Übertragung unterbrochen, Ergebnis wird geprüft" genau
    // während der erneuten Prüfung verstecken.
    updatedAt: now(),
  };
  await putOfflineOrderRecord(db, sendingRecord);

  let outcome: SubmissionOutcome;
  try {
    const response = await httpClient.post(
      "/orders",
      buildOrderPayload(sendingRecord),
      {
        timeout: OFFLINE_SYNC_REQUEST_TIMEOUT_MS,
        headers: { [OFFLINE_SYNC_HEADER]: "1" },
      },
    );
    outcome = classifySubmissionOutcome(
      sendingRecord,
      { success: true, data: response.data },
      now(),
    );
  } catch (error) {
    outcome = classifySubmissionOutcome(
      sendingRecord,
      { success: false, error },
      now(),
    );
  }

  if (outcome.nextState === "CONFIRMED") {
    await putOfflineOrderRecord(db, {
      ...sendingRecord,
      state: "CONFIRMED",
      serverOrderId: outcome.serverOrderId,
      serverOrderNumber: outcome.serverOrderNumber,
      confirmedAt: now(),
      lastError: null,
      conflictKind: null,
      sendingSince: null,
      updatedAt: now(),
    });
    return "CONFIRMED";
  }

  if (outcome.nextState === "CONFLICT") {
    await putOfflineOrderRecord(db, {
      ...sendingRecord,
      state: "CONFLICT",
      conflictKind: outcome.conflictKind,
      lastError: outcome.error,
      sendingSince: null,
      updatedAt: now(),
    });
    return "CONFLICT";
  }

  // RETRY: fachlich nicht abgelehnt, sondern Netzfehler/Zeitüberlauf/5xx/429.
  const isFinal = sendingRecord.attempt >= MAX_AUTOMATIC_ATTEMPTS;
  const delayMs = computeNextAttemptDelayMs(
    sendingRecord.attempt,
    outcome.retryAfterMs,
  );
  await putOfflineOrderRecord(db, {
    ...sendingRecord,
    state: isFinal ? "FAILED" : "LOCAL_PENDING",
    nextAttemptAt: isFinal ? null : now() + delayMs,
    lastError: outcome.error,
    sendingSince: null,
    updatedAt: now(),
  });
  return isFinal ? "FAILED" : "RETRY";
}

let syncInFlight: Promise<OfflineSyncRunSummary> | null = null;

/**
 * Ein vollständiger Sendeschleifen-Lauf (Abschnitt 7). Eine Sperre für die
 * ganze Anwendung: läuft bereits ein Durchgang, wird dessen Ergebnis
 * zurückgegeben, statt einen zweiten parallel zu starten (Antwort auf B5,
 * innerhalb einer Registerkarte).
 */
export async function runOfflineQueueSync(
  deps: OfflineSyncDeps,
): Promise<OfflineSyncRunSummary> {
  if (syncInFlight) return syncInFlight;
  syncInFlight = executeSyncRun(deps).finally(() => {
    syncInFlight = null;
  });
  return syncInFlight;
}

async function executeSyncRun(
  deps: OfflineSyncDeps,
): Promise<OfflineSyncRunSummary> {
  const now = deps.now ?? Date.now;
  const summary = emptySummary();

  let db: OfflineQueueDB;
  try {
    db = await getOfflineQueueDB();
  } catch {
    summary.contextFetchFailed = true;
    return summary;
  }

  summary.recoveredInterrupted = await recoverInterruptedSendingRecords(
    db,
    now(),
  );

  let currentEvents: CurrentEventContext[];
  try {
    currentEvents = await fetchCurrentEventContexts(deps.httpClient);
  } catch {
    summary.contextFetchFailed = true;
    return summary;
  }

  await cleanupConfirmedOfflineOrderRecords(db, now());

  const pending = await getLocalPendingOrderedByCreatedAt(db);
  const due = pending.filter(
    (record) => record.nextAttemptAt === null || record.nextAttemptAt <= now(),
  );

  for (const record of due) {
    summary.processed += 1;

    const check = checkOfflineOrderContext(record, {
      currentUserId: deps.currentUserId,
      currentEvents,
    });

    if (check.outcome === "WAIT_FOR_USER") {
      summary.skippedWaitingForUser += 1;
      continue;
    }

    if (check.outcome === "CONFLICT") {
      await putOfflineOrderRecord(db, {
        ...record,
        state: "CONFLICT",
        conflictKind: check.conflictKind,
        updatedAt: now(),
      });
      summary.conflicted += 1;
      continue;
    }

    const outcome = await attemptSendEntry(db, deps.httpClient, record, now);
    if (outcome === "CONFIRMED") summary.confirmed += 1;
    else if (outcome === "CONFLICT") summary.conflicted += 1;
    else if (outcome === "RETRY") summary.retried += 1;
    else summary.failed += 1;
  }

  return summary;
}

// ---------------------------------------------------------------------------
// Manuelle Bedienerhandlungen (Abschnitt 7, "Konflikt")
// ---------------------------------------------------------------------------

/**
 * "Erneut prüfen und senden" (aus `CONFLICT`) bzw. "Jetzt senden" (aus
 * `FAILED`). `attempt` wird auf 0 gesetzt, die Kontextprüfung läuft erneut
 * (Abschnitt 2, Übergangstabelle). Ändert nichts am Eintrag, wenn die
 * Prüfung erneut scheitert oder der Kontext nicht abfragbar ist — das
 * entspricht "Erneut prüfen und senden — ändert nichts am Eintrag" aus
 * Abschnitt 4.
 */
export async function retryOfflineOrder(
  idempotencyKey: string,
  deps: OfflineSyncDeps,
): Promise<OfflineOrderRecord | null> {
  const now = deps.now ?? Date.now;
  const db = await getOfflineQueueDB();
  const record = await getOfflineOrderRecord(db, idempotencyKey);
  if (!record) return null;

  if (record.state !== "CONFLICT" && record.state !== "FAILED") {
    throw new Error(
      "Nur Einträge in Konflikt oder endgültig gescheitert können erneut gesendet werden.",
    );
  }

  let currentEvents: CurrentEventContext[];
  try {
    currentEvents = await fetchCurrentEventContexts(deps.httpClient);
  } catch {
    // Kontext nicht abfragbar: wiederholbar, kein Konflikt, kein Versand,
    // Eintrag bleibt unverändert (Abschnitt 4).
    return record;
  }

  const resetRecord: OfflineOrderRecord = {
    ...record,
    attempt: 0,
    nextAttemptAt: now(),
    updatedAt: now(),
  };

  const check = checkOfflineOrderContext(resetRecord, {
    currentUserId: deps.currentUserId,
    currentEvents,
  });

  if (check.outcome === "WAIT_FOR_USER") {
    return record;
  }

  if (check.outcome === "CONFLICT") {
    const updated: OfflineOrderRecord = {
      ...resetRecord,
      state: "CONFLICT",
      conflictKind: check.conflictKind,
    };
    await putOfflineOrderRecord(db, updated);
    return updated;
  }

  await putOfflineOrderRecord(db, resetRecord);
  await attemptSendEntry(db, deps.httpClient, resetRecord, now);
  return (await getOfflineOrderRecord(db, idempotencyKey)) ?? null;
}

// ---------------------------------------------------------------------------
// Verwerfen (Abschnitt 7, "Verwerfen")
// ---------------------------------------------------------------------------

export type DiscardReasonCategory =
  | "DUPLICATE"
  | "GUEST_CANCELLED"
  | "TEST_ENTRY"
  | "OTHER";

const DISCARD_REASON_LABELS: Record<DiscardReasonCategory, string> = {
  DUPLICATE: "Doppelerfassung",
  GUEST_CANCELLED: "Gast hat storniert",
  TEST_ENTRY: "Testeingabe",
  OTHER: "Sonstiges",
};

/** Höchstens so viele Zeichen nimmt `POST /orders/offline-queue/discard` für `reason` entgegen. */
const MAX_DISCARD_REASON_LENGTH = 500;

export interface DiscardOfflineOrderReason {
  category: DiscardReasonCategory;
  note?: string;
}

/**
 * Baut den einzelnen `reason`-Text, den `POST /orders/offline-queue/discard`
 * erwartet (`orders.service.ts`, `DiscardOfflineQueueDto.reason`: Pflicht,
 * 1 bis 500 Zeichen), aus der Kategorie aus der kurzen Liste (Abschnitt 7)
 * und dem optionalen Freitext bei "Sonstiges".
 */
function buildDiscardReasonText(reason: DiscardOfflineOrderReason): string {
  const label = DISCARD_REASON_LABELS[reason.category];
  const note = reason.note?.trim();
  const combined = note ? `${label}: ${note}` : label;
  return combined.slice(0, MAX_DISCARD_REASON_LENGTH);
}

export type DiscardOfflineOrderResult =
  | { outcome: "ALREADY_DELETED" }
  | { outcome: "DISCARDED" }
  | { outcome: "ALREADY_ON_SERVER"; serverOrderNumber: string | null }
  | {
      outcome: "REJECTED";
      reason: "AUTH_REQUIRED" | "SERVER_UNREACHABLE" | "CONFLICT";
    };

interface ByIdempotencyKeyLookup {
  id?: unknown;
  orderNumber?: unknown;
}

/**
 * Verwerfen ist die einzige Handlung, die Daten vernichtet, deshalb nur mit
 * Serververbindung möglich (Abschnitt 7). Reihenfolge ist verbindlich:
 * zuerst prüfen, ob der Server die Bestellung bereits kennt (dann wird
 * nichts gelöscht), dann das Audit-Ereignis, erst danach die lokale Löschung.
 *
 * Ruft `GET /orders/by-idempotency-key/:key` und
 * `POST /orders/offline-queue/discard` auf (Abschnitt 8, Punkte 1 und 2).
 * Das Anfrageformat von `discard` folgt genau `DiscardOfflineQueueDto` in
 * `apps/backend/src/orders/orders.service.ts`: `idempotencyKey`, `reason`
 * (Pflicht, 1–500 Zeichen), `capturedByUserId`, `legacy`, `eventId`,
 * `payments`, `totalAtCapture`. Die serverseitige Berechtigungsprüfung
 * dort entspricht `canDiscardOfflineOrder` unten.
 */
export async function discardOfflineOrder(
  idempotencyKey: string,
  reason: DiscardOfflineOrderReason,
  deps: { httpClient: OfflineSyncHttpClient },
): Promise<DiscardOfflineOrderResult> {
  const db = await getOfflineQueueDB();
  const record = await getOfflineOrderRecord(db, idempotencyKey);
  if (!record) return { outcome: "ALREADY_DELETED" };

  let lookupStatus: number;
  let lookupData: ByIdempotencyKeyLookup = {};
  try {
    const lookup = await deps.httpClient.get<ByIdempotencyKeyLookup>(
      `/orders/by-idempotency-key/${encodeURIComponent(idempotencyKey)}`,
      {
        headers: { [OFFLINE_SYNC_HEADER]: "1" },
        timeout: OFFLINE_SYNC_REQUEST_TIMEOUT_MS,
        validateStatus: (status) => status === 200 || status === 404,
      },
    );
    lookupStatus = lookup.status;
    lookupData = lookup.data ?? {};
  } catch (error) {
    return rejectFromError(error);
  }

  if (lookupStatus === 200) {
    const serverOrderNumber =
      typeof lookupData.orderNumber === "string"
        ? lookupData.orderNumber
        : null;
    await putOfflineOrderRecord(db, {
      ...record,
      state: "CONFIRMED",
      serverOrderId:
        typeof lookupData.id === "string"
          ? lookupData.id
          : record.idempotencyKey,
      serverOrderNumber,
      confirmedAt: Date.now(),
      lastError: null,
      conflictKind: null,
      sendingSince: null,
      updatedAt: Date.now(),
    });
    return { outcome: "ALREADY_ON_SERVER", serverOrderNumber };
  }

  try {
    await deps.httpClient.post(
      "/orders/offline-queue/discard",
      {
        idempotencyKey,
        reason: buildDiscardReasonText(reason),
        capturedByUserId: record.userId,
        legacy: record.legacy,
        eventId: record.eventId,
        payments: record.payments,
        totalAtCapture: record.totalAtCapture ?? undefined,
      },
      {
        headers: { [OFFLINE_SYNC_HEADER]: "1" },
        timeout: OFFLINE_SYNC_REQUEST_TIMEOUT_MS,
      },
    );
  } catch (error) {
    return rejectFromError(error);
  }

  await deleteOfflineOrderRecord(db, idempotencyKey);
  return { outcome: "DISCARDED" };
}

function rejectFromError(error: unknown): DiscardOfflineOrderResult {
  const status = (error as { response?: { status?: number } })?.response
    ?.status;
  if (status === 401 || status === 403) {
    return { outcome: "REJECTED", reason: "AUTH_REQUIRED" };
  }
  if (status === 409) {
    return { outcome: "REJECTED", reason: "CONFLICT" };
  }
  return { outcome: "REJECTED", reason: "SERVER_UNREACHABLE" };
}

// ---------------------------------------------------------------------------
// Berechtigungen (Entscheidungen 11.2, 11.5, 11.6 — reine Entscheidungslogik;
// die verbindliche Durchsetzung bleibt beim Server)
// ---------------------------------------------------------------------------

export interface OfflineQueueActingUser {
  userId: string;
  role: string;
}

/**
 * Wer verwerfen darf (Entscheidungen 11.5 und 11.6):
 * - Enthält der Eintrag Zahlungen, darf ausschließlich `ADMINISTRATOR`
 *   verwerfen — unabhängig von allem anderen.
 * - Ein übernommener oder noch nicht übernommener Altbestand (`legacy`)
 *   darf nur von `ADMINISTRATOR` oder `EVENT_MANAGER` verworfen werden.
 * - Sonst darf der erfassende Benutzer oder `ADMINISTRATOR` verwerfen.
 */
export function canDiscardOfflineOrder(
  record: Pick<OfflineOrderRecord, "userId" | "legacy" | "payments">,
  user: OfflineQueueActingUser,
): boolean {
  if (user.role === "ADMINISTRATOR") return true;
  if (record.payments.length > 0) return false;
  if (record.legacy) return user.role === "EVENT_MANAGER";
  return record.userId === user.userId;
}

/**
 * Wer einen Altbestand übernehmen darf (Entscheidung 11.2): nur
 * `ADMINISTRATOR` oder `EVENT_MANAGER`, und nur wenn die Veranstaltung des
 * Eintrags heute läuft.
 */
export function canAdoptLegacyOfflineOrder(
  record: Pick<OfflineOrderRecord, "legacy">,
  user: OfflineQueueActingUser,
  isEventCurrentlyRunning: boolean,
): boolean {
  if (!record.legacy) return false;
  if (!isEventCurrentlyRunning) return false;
  return user.role === "ADMINISTRATOR" || user.role === "EVENT_MANAGER";
}

export class OfflineQueueAdoptionError extends Error {}

/**
 * "Übernehmen und senden" (Abschnitt 6). Der angemeldete Benutzer erklärt
 * ausdrücklich, den Eintrag zu verantworten: `userId`, `username`,
 * `dataMode`, `cashierSessionId` werden aus dem heutigen Kontext gesetzt,
 * `adoptedByUserId`/`adoptedAt` festgeschrieben, `legacy` bleibt `true`, der
 * Eintrag geht nach `LOCAL_PENDING`. Voraussetzung: die `eventId` des
 * Eintrags gehört zu einer heute laufenden Veranstaltung — das prüft der
 * Aufrufer und übergibt das Ergebnis, weil er die aktuelle Veranstaltungs-
 * liste bereits kennt (siehe `canAdoptLegacyOfflineOrder`).
 */
export async function adoptLegacyOfflineOrder(
  idempotencyKey: string,
  adopter: {
    userId: string;
    username: string;
    dataMode: "TEST" | "LIVE";
    cashierSessionId: string | null;
  },
  options: { isEventCurrentlyRunning: boolean },
): Promise<OfflineOrderRecord> {
  const db = await getOfflineQueueDB();
  const record = await getOfflineOrderRecord(db, idempotencyKey);
  if (!record) {
    throw new OfflineQueueAdoptionError("Eintrag nicht gefunden.");
  }
  if (!record.legacy) {
    throw new OfflineQueueAdoptionError(
      "Nur Altbestände aus Version 1 können übernommen werden.",
    );
  }
  if (!options.isEventCurrentlyRunning) {
    throw new OfflineQueueAdoptionError(
      "Die Veranstaltung dieses Eintrags läuft heute nicht.",
    );
  }

  const now = Date.now();
  const updated: OfflineOrderRecord = {
    ...record,
    userId: adopter.userId,
    username: adopter.username,
    dataMode: adopter.dataMode,
    cashierSessionId: adopter.cashierSessionId,
    adoptedByUserId: adopter.userId,
    adoptedAt: now,
    state: "LOCAL_PENDING",
    conflictKind: null,
    lastError: null,
    attempt: 0,
    nextAttemptAt: now,
    updatedAt: now,
  };
  await putOfflineOrderRecord(db, updated);
  return updated;
}

// ---------------------------------------------------------------------------
// Alte Exporte, auf das neue Modell abgebildet
// ---------------------------------------------------------------------------
//
// `removeOfflineOrder` bleibt unverändert. `getOfflineOrders` bleibt in
// Name und grober Form erhalten, liefert aber die neuen, vollständigen
// Datensätze (Obermenge der alten Felder) statt roher, ungeprüfter
// Einträge. `saveOrderOffline` bekommt zwingend ein `context`-Feld dazu —
// das bildet B2 nicht weg, sondern behebt es: eine Vormerkung ohne
// Benutzer-, Veranstaltungs- und Betriebsartkontext ist genau der Fehler,
// den dieses Issue beseitigt. Dashboard.tsx ruft `saveOrderOffline` heute
// ohne Kontext auf und wird deshalb nicht mehr übersetzen — das ist laut
// Auftrag erwartet und Aufgabe des Folgeauftrags.

export interface LegacyOfflineOrderInput {
  idempotencyKey: string;
  eventId: string;
  items: OfflineOrderItemInput[];
  payments: OfflinePayment[];
  tableName?: string | null;
  areaId?: string | null;
  createdAt?: number;
  /** Neu und zwingend — siehe Erläuterung oben (Antwort auf B2). */
  context: OfflineCaptureContext;
}

export async function saveOrderOffline(
  order: LegacyOfflineOrderInput,
): Promise<void> {
  await enqueueOfflineOrder({
    idempotencyKey: order.idempotencyKey,
    context: order.context,
    items: order.items,
    payments: order.payments,
    tableName: order.tableName ?? null,
    areaId: order.areaId ?? null,
  });
}

export async function getOfflineOrders(): Promise<OfflineOrderRecord[]> {
  return listOfflineOrders();
}

export async function removeOfflineOrder(
  idempotencyKey: string,
): Promise<void> {
  const db = await getOfflineQueueDB();
  await deleteOfflineOrderRecord(db, idempotencyKey);
}
