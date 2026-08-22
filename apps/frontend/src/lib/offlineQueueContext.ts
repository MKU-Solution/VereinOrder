// Kontextbindung der Offline-Warteschlange (Issue #65).
// Verbindliche Quelle: docs/development/offline-warteschlange.md, Abschnitt 4.
//
// Ein Eintrag hält den Kontext seiner Entstehung fest und wird ausschließlich
// in genau diesem Kontext gesendet. Der Kontext wird nie automatisch
// angepasst. Dieses Modul enthält die reine Prüflogik; das Nachladen des
// heutigen Kontexts (`GET /sessions/context`) ist die einzige Stelle, die
// Netzwerk berührt.

import type {
  ConflictKind,
  CurrentEventContext,
  OfflineOrderRecord,
} from "./offlineQueueTypes";

/** Minimale HTTP-Schnittstelle, siehe offlineSync.ts für die Begründung. */
export interface OfflineSyncHttpClient {
  get<T = unknown>(
    url: string,
    config?: OfflineSyncRequestConfig,
  ): Promise<{ status: number; data: T }>;
  post<T = unknown>(
    url: string,
    data?: unknown,
    config?: OfflineSyncRequestConfig,
  ): Promise<{ status: number; data: T }>;
}

export interface OfflineSyncRequestConfig {
  timeout?: number;
  headers?: Record<string, string>;
  validateStatus?: (status: number) => boolean;
}

/**
 * Markiert Anfragen der Sendeschleife, damit ein künftiger Eingriff in
 * `api.ts` deren 401-Antworten vom globalen Abmelde-Verhalten ausnehmen kann
 * (Antwort auf B4). Diese Bibliothek ändert `api.ts` nicht selbst — siehe
 * Abschlussbericht, Abschnitt "Risiken".
 */
export const OFFLINE_SYNC_HEADER = "X-Offline-Queue-Sync";

/** Jede Anfrage der Sendeschleife bekommt einen Timeout (Abschnitt 2). */
export const OFFLINE_SYNC_REQUEST_TIMEOUT_MS = 15_000;

const SESSIONS_CONTEXT_PATH = "/sessions/context";

interface RawSessionsContextEntry {
  id?: unknown;
  name?: unknown;
  status?: unknown;
  testMode?: unknown;
  activeSession?: { id?: unknown } | null;
}

/**
 * Bildet Veranstaltungsstatus und Testmodus exakt so auf `dataMode` ab wie
 * der Server es in `orders.service.ts` beim Anlegen einer Bestellung tut:
 * `ACTIVE` ohne Testmodus wird `LIVE`, `TEST_MODE` mit Testmodus wird
 * `TEST`. Jede andere Kombination bedeutet, dass die Veranstaltung heute
 * nicht sendefähig ist.
 */
export function deriveDataModeFromEventStatus(
  status: unknown,
  testMode: unknown,
): "TEST" | "LIVE" | null {
  if (status === "ACTIVE" && !testMode) return "LIVE";
  if (status === "TEST_MODE" && testMode) return "TEST";
  return null;
}

/**
 * Lädt den heutigen Betriebskontext über `GET /sessions/context`
 * (`sessions.controller.ts:24-27`). Wirft bei Netzwerk- oder Serverfehlern
 * unverändert weiter — der Aufrufer behandelt das als "Kontext nicht
 * abfragbar" (Abschnitt 4, letzter Absatz): wiederholbar, kein Konflikt,
 * kein Versand.
 */
export async function fetchCurrentEventContexts(
  httpClient: OfflineSyncHttpClient,
): Promise<CurrentEventContext[]> {
  const response = await httpClient.get<RawSessionsContextEntry[]>(
    SESSIONS_CONTEXT_PATH,
    {
      headers: { [OFFLINE_SYNC_HEADER]: "1" },
      timeout: OFFLINE_SYNC_REQUEST_TIMEOUT_MS,
    },
  );

  const raw = Array.isArray(response.data) ? response.data : [];
  const result: CurrentEventContext[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry.id !== "string") continue;
    const dataMode = deriveDataModeFromEventStatus(
      entry.status,
      entry.testMode,
    );
    if (!dataMode) continue;
    const activeSessionId =
      entry.activeSession && typeof entry.activeSession.id === "string"
        ? entry.activeSession.id
        : null;
    result.push({
      eventId: entry.id,
      eventName: typeof entry.name === "string" ? entry.name : "",
      dataMode,
      activeSessionId,
    });
  }
  return result;
}

export type ContextCheckResult =
  | { outcome: "OK" }
  | { outcome: "WAIT_FOR_USER" }
  | { outcome: "CONFLICT"; conflictKind: ConflictKind };

/**
 * Prüfung vor jedem Sendeversuch (Abschnitt 4), in der dort vorgeschriebenen
 * Reihenfolge:
 *
 * 1. Kontextlose Altbestände (`dataMode === "UNKNOWN"` oder `userId === null`)
 *    werden nie gesendet — `CONTEXT_UNKNOWN`. Das muss vor der
 *    Benutzerprüfung stehen, sonst würde ein Altbestand ohne Benutzer als
 *    "wartet auf Anmeldung" statt als Konflikt geführt.
 * 2. Benutzer: nur der erfassende Benutzer darf senden, sonst wartet der
 *    Eintrag unauffällig (kein Konflikt).
 * 3. Betriebsart: weicht sie vom erfassten Wert ab oder läuft die
 *    Veranstaltung heute gar nicht, ist das ein Konflikt.
 * 4. Kassensitzung: war bei der Erfassung keine gesetzt, ist das nie ein
 *    Konflikt (galt schon damals keine Sitzung).
 */
export function checkOfflineOrderContext(
  record: Pick<
    OfflineOrderRecord,
    "userId" | "eventId" | "dataMode" | "cashierSessionId"
  >,
  params: {
    currentUserId: string | null;
    currentEvents: CurrentEventContext[];
  },
): ContextCheckResult {
  if (record.dataMode === "UNKNOWN" || record.userId === null) {
    return { outcome: "CONFLICT", conflictKind: "CONTEXT_UNKNOWN" };
  }

  if (!params.currentUserId || params.currentUserId !== record.userId) {
    return { outcome: "WAIT_FOR_USER" };
  }

  const currentEvent = params.currentEvents.find(
    (event) => event.eventId === record.eventId,
  );
  if (!currentEvent || currentEvent.dataMode !== record.dataMode) {
    return { outcome: "CONFLICT", conflictKind: "EVENT_MODE" };
  }

  if (
    record.cashierSessionId !== null &&
    record.cashierSessionId !== currentEvent.activeSessionId
  ) {
    return { outcome: "CONFLICT", conflictKind: "SESSION_CLOSED" };
  }

  return { outcome: "OK" };
}
