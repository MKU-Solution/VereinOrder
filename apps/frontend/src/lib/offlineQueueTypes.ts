// Datentypen der Offline-Warteschlange (Issue #65).
// Verbindliche Quelle ist docs/development/offline-warteschlange.md, Abschnitt 5.
// Diese Datei enthält ausschließlich Typen und reine Hilfsfunktionen ohne
// Nebenwirkungen (kein IndexedDB-Zugriff, kein Netzwerk).

/** Die fünf Zustände aus Abschnitt 2. Dauerhaft gespeichert, kein sechster Zustand. */
export type OfflineOrderState =
  | "LOCAL_PENDING"
  | "SENDING"
  | "CONFIRMED"
  | "CONFLICT"
  | "FAILED";

/**
 * Ursachen eines Konflikts (Abschnitt 3 und 5). Steuert nur den Anzeigetext
 * und den Lösungsvorschlag, nie das Zustandsmodell selbst — das hängt
 * ausschließlich an der HTTP-Statusklasse (siehe offlineQueueClassify.ts).
 */
export type ConflictKind =
  | "AUTH_EXPIRED"
  | "FORBIDDEN"
  | "CONTEXT_UNKNOWN"
  | "EVENT_MODE"
  | "SESSION_CLOSED"
  | "PRODUCT_UNAVAILABLE"
  | "PRICE_OR_OPTION"
  | "VALIDATION"
  | "DUPLICATE_KEY_MISMATCH"
  | "UNKNOWN_4XX";

export type OfflineDataMode = "TEST" | "LIVE" | "UNKNOWN";

export type OfflinePaymentMethod = "CASH" | "CARD" | "VOUCHER";

export interface OfflinePayment {
  amount: number;
  method: OfflinePaymentMethod;
}

/** Eine Bestellposition. `optionIds` steht ausdrücklich im Typ (Antwort auf B3). */
export interface OfflineItem {
  productId: string;
  quantity: number;
  /** Nie `undefined`, darf leer sein. */
  optionIds: string[];
  productName: string | null;
  unitPriceAtCapture: number | null;
}

/**
 * Fehlertext ohne Token und ohne Stacktrace (Akzeptanzkriterium des Issues).
 * Es werden ausschließlich `httpStatus` und ein auf 300 Zeichen gekürzter,
 * bereinigter Text gespeichert — niemals `error.stack` oder `error.config`.
 */
export interface OfflineError {
  at: number;
  kind: "NETWORK" | "HTTP";
  httpStatus: number | null;
  messageForOperator: string;
}

/** Der Kontext, in dem eine Vormerkung entstanden ist (Abschnitt 4). */
export interface OfflineCaptureContext {
  userId: string;
  username: string;
  userRole: string | null;
  eventId: string;
  eventName: string | null;
  dataMode: "TEST" | "LIVE";
  cashierSessionId: string | null;
}

/** Der vollständige Datensatz, Feld für Feld wie in Abschnitt 5 beschrieben. */
export interface OfflineOrderRecord {
  idempotencyKey: string;
  schemaVersion: 2;
  state: OfflineOrderState;
  createdAt: number;
  updatedAt: number;

  userId: string | null;
  username: string | null;
  userRole: string | null;
  eventId: string;
  eventName: string | null;
  dataMode: OfflineDataMode;
  cashierSessionId: string | null;

  items: OfflineItem[];
  payments: OfflinePayment[];

  tableName: string | null;
  areaId: string | null;
  areaName: string | null;
  totalAtCapture: number | null;

  attempt: number;
  lastAttemptAt: number | null;
  nextAttemptAt: number | null;
  sendingSince: number | null;
  interruptedAt: number | null;
  lastError: OfflineError | null;
  conflictKind: ConflictKind | null;

  serverOrderId: string | null;
  serverOrderNumber: string | null;
  confirmedAt: number | null;

  legacy: boolean;
  adoptedByUserId: string | null;
  adoptedAt: number | null;
}

/** Eingabe zum Anlegen einer Positionszeile, siehe {@link enqueueOfflineOrder}. */
export interface OfflineOrderItemInput {
  productId: string;
  quantity: number;
  optionIds?: string[];
  productName?: string | null;
  unitPriceAtCapture?: number | null;
}

/** Eingabe zum Anlegen einer neuen Vormerkung, siehe offlineSync.ts. */
export interface EnqueueOfflineOrderInput {
  idempotencyKey: string;
  context: OfflineCaptureContext;
  items: OfflineOrderItemInput[];
  payments: OfflinePayment[];
  tableName?: string | null;
  areaId?: string | null;
  areaName?: string | null;
  totalAtCapture?: number | null;
}

/** Der heute geltende Kontext einer laufenden Veranstaltung (Abschnitt 4). */
export interface CurrentEventContext {
  eventId: string;
  eventName: string;
  dataMode: "TEST" | "LIVE";
  activeSessionId: string | null;
}
