// Einordnung der Serverantworten (Issue #65).
// Verbindliche Quelle: docs/development/offline-warteschlange.md, Abschnitt 3.
//
// Leitregel: Ein fachliches 4xx wird nie automatisch wiederholt. Netzfehler,
// 408, 425, 429 und 5xx werden wiederholt, höchstens sechsmal je Eintrag.
// Die Zuordnung zu einem Zustand hängt ausschließlich von der Statusklasse
// ab. Bei fachlichen 4xx steuert primaer der stabile Servercode den
// Anzeigetext (`conflictKind`); Meldungstexte bleiben Fallback fuer alte
// Serverfassungen.

import type { ConflictKind, OfflineError } from "./offlineQueueTypes";
import type { OrderRejectionCode } from "@vereinorder/shared";

/** Höchstens so viele automatische Versuche, danach `FAILED` (Abschnitt 2). */
export const MAX_AUTOMATIC_ATTEMPTS = 6;

const BASE_RETRY_DELAY_MS = 5_000;
const MAX_RETRY_DELAY_MS = 5 * 60 * 1000;
const RETRY_JITTER_RATIO = 0.2;

const MAX_OPERATOR_MESSAGE_LENGTH = 300;

const SERVER_CODE_TO_CONFLICT_KIND: Record<OrderRejectionCode, ConflictKind> = {
  AUTH_EXPIRED: "AUTH_EXPIRED",
  FORBIDDEN: "FORBIDDEN",
  EVENT_MODE: "EVENT_MODE",
  SESSION_CLOSED: "SESSION_CLOSED",
  PRODUCT_UNAVAILABLE: "PRODUCT_UNAVAILABLE",
  PRICE_OR_OPTION: "PRICE_OR_OPTION",
  DUPLICATE_KEY_MISMATCH: "DUPLICATE_KEY_MISMATCH",
  VALIDATION: "VALIDATION",
};

function isOrderRejectionCode(value: unknown): value is OrderRejectionCode {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(SERVER_CODE_TO_CONFLICT_KIND, value)
  );
}

/** Form eines minimalen, axios-ähnlichen Fehlers — es wird nie mehr gelesen als das hier. */
export interface HttpLikeError {
  code?: string;
  message?: string;
  response?: {
    status?: number;
    headers?: Record<string, unknown> | unknown;
    data?: { code?: unknown; message?: unknown } | unknown;
  };
}

export type SubmissionResult =
  | { success: true; data: unknown }
  | { success: false; error: unknown };

export type SubmissionOutcome =
  | {
      nextState: "CONFIRMED";
      serverOrderId: string;
      serverOrderNumber: string | null;
    }
  | {
      nextState: "CONFLICT";
      conflictKind: ConflictKind;
      error: OfflineError;
    }
  | {
      nextState: "RETRY";
      error: OfflineError;
      retryAfterMs?: number;
    };

/**
 * Entfernt Anmeldeinformationen und Stacktraces aus einem Servertext und
 * kürzt auf 300 Zeichen (Abschnitt 3, "Fehlertexte"; Akzeptanzkriterium des
 * Issues). Diese Funktion ist die einzige Stelle, die einen Servertext in
 * einen gespeicherten Fehler überführt — es werden nie `error.stack` oder
 * `error.config` gelesen, dieser Text ist alles, was gespeichert wird.
 */
export function sanitizeOperatorMessage(
  rawMessage: string | null | undefined,
  httpStatus: number | null,
): string {
  if (!rawMessage) return genericMessageForStatus(httpStatus);

  let message = rawMessage;

  // JWT-artige Tokens: drei durch Punkt getrennte Base64url-Abschnitte.
  message = message.replace(
    /[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
    "[entfernt]",
  );
  // Authorization/Bearer-Header, falls versehentlich im Text enthalten.
  message = message.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "[entfernt]");
  // Generische, lange, tokenartige Zeichenketten (z. B. API-Schlüssel).
  message = message.replace(/[A-Za-z0-9_-]{32,}/g, "[entfernt]");

  // Stacktrace: sobald eine Zeile mit "at " beginnt (Node/Browser-Stacks),
  // wird alles ab dort verworfen.
  const stackIndex = message.search(/(^|\n)\s*at\s+\S/);
  if (stackIndex >= 0) {
    message = message.slice(0, stackIndex);
  }
  // Nur die erste verbleibende Zeile wird angezeigt.
  message = message.split("\n")[0].trim();

  if (message.length > MAX_OPERATOR_MESSAGE_LENGTH) {
    message = message.slice(0, MAX_OPERATOR_MESSAGE_LENGTH);
  }

  return message || genericMessageForStatus(httpStatus);
}

function genericMessageForStatus(httpStatus: number | null): string {
  if (httpStatus === null) return "Keine Verbindung zum Server.";
  if (httpStatus === 401) return "Anmeldung ist abgelaufen.";
  if (httpStatus === 403) return "Keine Berechtigung für diese Aktion.";
  return "Der Server hat die Anfrage abgelehnt.";
}

function networkMessage(code: string | undefined): string {
  if (code === "ECONNABORTED") return "Zeitüberschreitung beim Senden.";
  return "Keine Verbindung zum Server.";
}

/**
 * Ordnet eine 4xx-Antwort einer Konfliktursache zu. Der stabile Code aus
 * Issue #93 gewinnt vor dem Meldungstext. 401/403 bleiben statusgebunden,
 * damit ein widerspruechlicher Serverbody nie die erforderliche Anmeldung
 * oder Berechtigung verdeckt. Fehlt eine bekannte Kennung, greift fuer alte
 * Serverfassungen die bisherige Textzuordnung.
 */
export function classifyConflictKind(
  httpStatus: number,
  rawMessage: string,
  rawCode?: unknown,
): ConflictKind {
  if (httpStatus === 401) return "AUTH_EXPIRED";
  if (httpStatus === 403) return "FORBIDDEN";
  if (isOrderRejectionCode(rawCode)) {
    return SERVER_CODE_TO_CONFLICT_KIND[rawCode];
  }
  if (httpStatus === 404 || httpStatus === 405) return "VALIDATION";

  // Legacy-Fallback aus Issue #89: alte Server liefern noch keinen Code.
  // Spezifische Muster stehen vor allgemeinen, damit etwa der andere
  // Betriebsmodus nicht als bloss geschlossene Sitzung eingeordnet wird.
  const patterns: [RegExp, ConflictKind][] = [
    [/anderen Betriebsmodus/i, "EVENT_MODE"],
    [/Bestellungen sind erst möglich/i, "EVENT_MODE"],
    [/ist derzeit nicht verfügbar/i, "PRODUCT_UNAVAILABLE"],
    [/ist für diese Veranstaltung nicht hinterlegt/i, "PRODUCT_UNAVAILABLE"],
    [/gehört zu keiner aktiven Auswahlgruppe/i, "PRICE_OR_OPTION"],
    [/braucht mindestens/i, "PRICE_OR_OPTION"],
    [/erlaubt höchstens/i, "PRICE_OR_OPTION"],
    [/mehrfach angegeben/i, "PRICE_OR_OPTION"],
    [/Endpreis.*nicht negativ/i, "PRICE_OR_OPTION"],
    [/gewählte Bereich gehört nicht zu dieser Veranstaltung/i, "VALIDATION"],
    [/Es wurde keine Position ausgewählt/i, "VALIDATION"],
    [/Benutzerkonto ist nicht aktiv/i, "FORBIDDEN"],
    [/Sitzung/i, "SESSION_CLOSED"],
  ];

  for (const [pattern, kind] of patterns) {
    if (pattern.test(rawMessage)) return kind;
  }
  return "UNKNOWN_4XX";
}

function parseRetryAfterMs(
  headers: Record<string, unknown> | unknown,
): number | undefined {
  if (!headers || typeof headers !== "object") return undefined;
  const value = (headers as Record<string, unknown>)["retry-after"];
  if (typeof value !== "string" || value.length === 0) return undefined;

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;

  const dateMs = Date.parse(value);
  if (!Number.isNaN(dateMs)) return Math.max(0, dateMs - Date.now());
  return undefined;
}

/**
 * Wartezeit vor dem nächsten automatischen Versuch: 5 s, verdoppelnd,
 * gedeckelt bei 5 Minuten, mit ±20 % Streuung (Abschnitt 2). `attempt` ist
 * die Anzahl bereits abgeschlossener Versuche (1-basiert, also der Wert
 * unmittelbar nach dem gerade gescheiterten Versuch). Ein `Retry-After` aus
 * einer 429-Antwort hat Vorrang vor der berechneten Wartezeit.
 */
export function computeNextAttemptDelayMs(
  attempt: number,
  retryAfterMs?: number,
  random: () => number = Math.random,
): number {
  if (typeof retryAfterMs === "number" && retryAfterMs >= 0) {
    return Math.round(retryAfterMs);
  }
  const exponentialDelay =
    BASE_RETRY_DELAY_MS * Math.pow(2, Math.max(0, attempt - 1));
  const cappedDelay = Math.min(exponentialDelay, MAX_RETRY_DELAY_MS);
  const jitterFactor = 1 + (random() * 2 - 1) * RETRY_JITTER_RATIO;
  return Math.round(cappedDelay * jitterFactor);
}

/**
 * Einordnung einer einzelnen Serverantwort (Abschnitt 3). `record` liefert
 * nur die zur Prüfung nötigen Felder — ob wiederholt wird oder nicht,
 * entscheidet der Aufrufer anhand von `attempt`, weil das den aktuellen
 * Versuchszähler des Datensatzes kennt.
 */
export function classifySubmissionOutcome(
  record: { idempotencyKey: string; eventId: string },
  result: SubmissionResult,
  now: number = Date.now(),
): SubmissionOutcome {
  if (result.success) {
    return classifySuccess(record, result.data, now);
  }
  return classifyError(result.error, now);
}

function classifySuccess(
  record: { idempotencyKey: string; eventId: string },
  data: unknown,
  now: number,
): SubmissionOutcome {
  const payload = (data ?? {}) as Record<string, unknown>;
  const returnedKey =
    typeof payload.idempotencyKey === "string"
      ? payload.idempotencyKey
      : undefined;
  const returnedEventId =
    typeof payload.eventId === "string" ? payload.eventId : undefined;

  const keyMismatch =
    returnedKey !== undefined && returnedKey !== record.idempotencyKey;
  const eventMismatch =
    returnedEventId !== undefined && returnedEventId !== record.eventId;

  if (keyMismatch || eventMismatch) {
    return {
      nextState: "CONFLICT",
      conflictKind: "DUPLICATE_KEY_MISMATCH",
      error: {
        at: now,
        kind: "HTTP",
        httpStatus: null,
        messageForOperator:
          "Die Antwort des Servers gehört zu einer anderen Bestellung.",
      },
    };
  }

  return {
    nextState: "CONFIRMED",
    serverOrderId:
      typeof payload.id === "string" ? payload.id : record.idempotencyKey,
    serverOrderNumber:
      typeof payload.orderNumber === "string" ? payload.orderNumber : null,
  };
}

function classifyError(error: unknown, now: number): SubmissionOutcome {
  const httpError = (error ?? {}) as HttpLikeError;
  const status = httpError.response?.status;

  if (typeof status !== "number") {
    return {
      nextState: "RETRY",
      error: {
        at: now,
        kind: "NETWORK",
        httpStatus: null,
        messageForOperator: networkMessage(httpError.code),
      },
    };
  }

  const rawData = httpError.response?.data as
    | { code?: unknown; message?: unknown }
    | undefined;
  const rawMessage =
    typeof rawData?.message === "string" ? rawData.message : null;
  const operatorMessage = sanitizeOperatorMessage(rawMessage, status);

  const isRetryableStatus =
    status === 408 || status === 425 || status === 429 || status >= 500;

  if (isRetryableStatus) {
    const retryAfterMs =
      status === 429
        ? parseRetryAfterMs(httpError.response?.headers)
        : undefined;
    return {
      nextState: "RETRY",
      error: {
        at: now,
        kind: "HTTP",
        httpStatus: status,
        messageForOperator: operatorMessage,
      },
      retryAfterMs,
    };
  }

  const conflictKind = classifyConflictKind(
    status,
    rawMessage ?? "",
    rawData?.code,
  );
  return {
    nextState: "CONFLICT",
    conflictKind,
    error: {
      at: now,
      kind: "HTTP",
      httpStatus: status,
      messageForOperator: operatorMessage,
    },
  };
}
