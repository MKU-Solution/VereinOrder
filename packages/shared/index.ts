// Issue #93: stabiler, textunabhaengiger Vertrag fuer die fachlichen
// Ablehnungen von POST /orders. Die Werte entsprechen bewusst den
// ConflictKind-Ursachen der Offline-Warteschlange. Der Server sendet sie im
// Feld `code`; das Frontend prueft diese Allowlist, bevor es fuer alte
// Serverstaende auf die Meldungstexte zurueckfaellt.
export const ORDER_REJECTION_CODES = {
  AUTH_EXPIRED: "AUTH_EXPIRED",
  FORBIDDEN: "FORBIDDEN",
  EVENT_MODE: "EVENT_MODE",
  SESSION_CLOSED: "SESSION_CLOSED",
  PRODUCT_UNAVAILABLE: "PRODUCT_UNAVAILABLE",
  PRICE_OR_OPTION: "PRICE_OR_OPTION",
  DUPLICATE_KEY_MISMATCH: "DUPLICATE_KEY_MISMATCH",
  VALIDATION: "VALIDATION",
} as const;

export type OrderRejectionCode =
  (typeof ORDER_REJECTION_CODES)[keyof typeof ORDER_REJECTION_CODES];

// Issue #89: benannte Texte fuer die fachlichen Ablehnungen der
// Bestellannahme, die tatsaechlich beim Bedienpersonal ankommen (siehe
// apps/backend/src/orders/orders.service.ts fuer die vollstaendige
// Einordnung Gruppe 1 vs. Gruppe 2).
//
// Liegt in packages/shared statt im Backend, weil Backend und Frontend sich
// hier ueber einen gemeinsamen Vertrag einigen muessen:
// apps/frontend/src/lib/offlineQueueClassify.test.ts importiert diese
// Konstanten direkt, um zu pruefen, dass die Regex-Muster in
// offlineQueueClassify.ts noch zu den tatsaechlichen Backend-Texten passen.
// Aendert sich ein Text hier, ohne dass das zugehoerige Muster dort
// nachgezogen wird, schlaegt dieser Test fehl statt die Ursachenzeile der
// Konfliktansicht stillschweigend auf den UNKNOWN_4XX-Standardtext ("Der
// Server hat die Bestellung abgelehnt.") zurueckfallen zu lassen. Genau das
// ist beim ersten Anlauf von Issue #89 passiert (Texte wurden deutsch, die
// Muster blieben englisch) und wurde erst bei einer manuellen Abnahme der
// Konfliktansicht bemerkt.
//
// Ein direkter Import von apps/frontend nach apps/backend (oder umgekehrt)
// waere die falsche Loesung gewesen: das Frontend-Docker-Abbild kopiert nur
// apps/frontend, apps/backend liegt dort gar nicht vor, und der Build waere
// in der CI gescheitert, ohne dass das lokal auffaellt. Dieses Paket ist
// deshalb bewusst ohne Laufzeitabhaengigkeiten gehalten (kein NestJS, kein
// Prisma, kein React) - siehe Dockerfiles beider Anwendungen, die es analog
// zu packages/database kopieren und bauen.
//
// Seit Issue #93 sind diese Texte nicht mehr die primaere Schnittstelle.
// Sie bleiben geteilt, weil der Frontend-Fallback weiterhin Antworten alter
// Serverfassungen korrekt einordnen muss.
export const ORDER_REJECTION_MESSAGES = {
  EVENT_NOT_ACTIVE_FOR_ORDERS:
    "Diese Veranstaltung ist derzeit nicht aktiv. Bestellungen sind erst möglich, wenn sie gestartet wurde.",
  EVENT_NOT_ACTIVE_FOR_SALES:
    "Diese Veranstaltung ist derzeit nicht aktiv. Verkäufe sind erst möglich, wenn sie gestartet wurde.",
  PRODUCT_OUT_OF_STOCK: (productName: string) =>
    `Produkt „${productName}" ist derzeit nicht verfügbar. Bitte aus der Bestellung entfernen.`,
  PRODUCT_NOT_IN_EVENT: (productId: string) =>
    `Ein Produkt (${productId}) ist für diese Veranstaltung nicht hinterlegt. Bitte die Auswahl aktualisieren und erneut versuchen.`,
  PRODUCT_NOT_IN_EVENT_QUICK_SALE:
    "Ein Produkt gehört nicht zu dieser Veranstaltung. Bitte die Auswahl aktualisieren und erneut versuchen.",
  // Issue #66, Stationskasse: eigene Meldung fuer ein Produkt, das zwar zur
  // Veranstaltung gehoert, aber zu einer anderen Station als der gewaehlten
  // (orders.service.ts, createQuickSale). Ohne diese Unterscheidung landet
  // dieser Fall in PRODUCT_NOT_IN_EVENT_QUICK_SALE und schickt die Bedienung
  // an der Kasse in die falsche Richtung: sie prueft die Veranstaltung,
  // obwohl die stimmt, statt die Station zu wechseln. Bewusst ohne
  // Stationsnamen oder -kennung - der Text geht an ein Bediengeraet, nicht
  // in ein Protokoll.
  PRODUCT_NOT_AT_STATION_QUICK_SALE:
    "Dieses Produkt gehört zum Sortiment einer anderen Station. Bitte die Station wechseln oder das Produkt dort verkaufen.",
  AREA_NOT_IN_EVENT:
    "Der gewählte Bereich gehört nicht zu dieser Veranstaltung. Bitte einen anderen Bereich wählen.",
  ORDER_EMPTY:
    "Es wurde keine Position ausgewählt. Bitte mindestens ein Produkt zur Bestellung hinzufügen.",
  USER_NOT_ACTIVE:
    "Dieses Benutzerkonto ist nicht aktiv. Bitte bei der Administration melden.",
  IDEMPOTENCY_KEY_CONFLICT:
    "Für dieses Vorgangskennzeichen liegt bereits eine abweichende Bestellung vor. Bitte neu erfassen und erneut senden.",
  // Issue #66, Stationskasse: Reissleine gegen einen entlaufenen
  // Abholnummernzaehler. Der Verkauf wird abgewiesen, statt die Nummer
  // umbrechen zu lassen - ein Umbruch gaebe zwei Personen dieselbe Nummer.
  // Steht hier und nicht im Backend, weil es eine fachliche Ablehnung des
  // Verkaufs ist, die beim Bedienpersonal ankommt, wie
  // EVENT_NOT_ACTIVE_FOR_SALES und PRODUCT_NOT_IN_EVENT_QUICK_SALE. Wie
  // diese beiden hat der Text bewusst KEIN Muster in
  // apps/frontend/src/lib/offlineQueueClassify.ts: die Bonkassen senden nicht
  // ueber die Offline-Warteschlange, der Text erreicht sie also nie.
  PICKUP_NUMBER_EXHAUSTED:
    "Der Abholnummernbereich dieser Veranstaltung ist erschöpft. Bitte bei der Administration melden; der Verkauf wurde nicht gebucht.",
} as const;

// Issue #265: gemeinsame Ableitung "Drucker hat einen ungeloesten Fehler".
// Seit Issue #261 schreibt das Backend bei jedem Zustellversuch entweder
// `lastOkAt` (PRINTED) oder `lastErrorAt` (NOT_PRINTED) fort. Ein Fehler
// gilt als ungeloest, solange kein Erfolg juenger ist als er. Bewusst ohne
// Zeitfenster: ein selten benutzter defekter Drucker darf nicht als gesund
// erscheinen, nur weil sein Fehler alt ist. Gleichstand gilt als behoben.
//
// Liegt hier, weil Backend (DiagnosticsService.isBypassed) und Frontend
// (Druckerverwaltung) dieselbe Regel brauchen; das Frontend bekommt die
// Zeitpunkte als ISO-Zeichenketten, das Backend als Date. Ob der Drucker
// eingeschaltet ist, entscheidet der Aufrufer.
export type PrinterTimestamp = Date | string | null | undefined;

export interface PrinterOutcomeTimestamps {
  lastErrorAt?: PrinterTimestamp;
  lastOkAt?: PrinterTimestamp;
}

const toTime = (value: PrinterTimestamp): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const time = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isNaN(time) ? null : time;
};

export const hasUnrecoveredPrinterError = (
  printer: PrinterOutcomeTimestamps,
): boolean => {
  const errorAt = toTime(printer.lastErrorAt);
  if (errorAt === null) return false;
  const okAt = toTime(printer.lastOkAt);
  return okAt === null || errorAt > okAt;
};

// Issue #268: Fehlerkennungen, die der Print-Worker an das Backend meldet
// (PATCH /print-jobs/:id/status, Feld `errorCode`) und die danach in
// `PrintJob.errorCode` und `Printer.lastErrorCode` stehen.
//
// Liegt hier, weil Print-Worker und Backend sich ueber diese Werte einigen
// muessen. Vorher fuehrte jede Seite ihre eigene Zeichenkette: Der Worker
// meldete PRINTER_CONFIGURATION, die Failover-Ausnahme des Backends pruefte
// auf PRINTER_CONFIG_ERROR, einen Wert, den nie jemand erzeugt hat. Beide
// Seiten waren fuer sich getestet und passten nicht zusammen; ein falsch
// eingerichteter Drucker loeste deshalb einen Wechsel auf den Ersatzdrucker
// aus. Mit einer gemeinsamen Liste weist die Typpruefung jeden Wert ab, den
// die andere Seite nicht kennt.
export const PRINT_WORKER_ERROR_CODES = {
  // --- TCP-Transport ---
  DNS_ERROR: "DNS_ERROR",
  CONNECTION_REFUSED: "CONNECTION_REFUSED",
  UNREACHABLE: "UNREACHABLE",
  TIMEOUT: "TIMEOUT",
  WRITE_FAILED: "WRITE_FAILED",
  CONNECTION_LOST: "CONNECTION_LOST",
  // --- Simulator ---
  OUTPUT_FAILED: "OUTPUT_FAILED",
  // --- CUPS/IPP-Transport ---
  CUPS_UNREACHABLE: "CUPS_UNREACHABLE",
  CUPS_QUEUE_NOT_FOUND: "CUPS_QUEUE_NOT_FOUND",
  CUPS_QUEUE_NOT_ACCEPTING: "CUPS_QUEUE_NOT_ACCEPTING",
  CUPS_RESPONSE_LOST: "CUPS_RESPONSE_LOST",
  CUPS_JOB_CANCELED_PENDING: "CUPS_JOB_CANCELED_PENDING",
  CUPS_JOB_CANCELED_PROCESSING: "CUPS_JOB_CANCELED_PROCESSING",
  CUPS_JOB_ABORTED: "CUPS_JOB_ABORTED",
  CUPS_DEVICE_DISCONNECTED: "CUPS_DEVICE_DISCONNECTED",
  CUPS_CANCEL_FAILED: "CUPS_CANCEL_FAILED",
  CUPS_STATUS_UNKNOWN: "CUPS_STATUS_UNKNOWN",
  // --- Worker selbst, ausserhalb eines Transports ---
  /** Druckerzeile laesst sich nicht in ein Druckziel aufloesen. */
  PRINTER_CONFIGURATION: "PRINTER_CONFIGURATION",
  /** Zustellung scheiterte ohne Transportfehler mit stabiler Kennung. */
  UNEXPECTED: "UNEXPECTED",
} as const;

export type PrintWorkerErrorCode =
  (typeof PRINT_WORKER_ERROR_CODES)[keyof typeof PRINT_WORKER_ERROR_CODES];

// Kennungen, bei denen ein Ersatzdrucker die Ursache nicht beheben wuerde:
// Eine ungueltige Konfiguration darf nicht stillschweigend umgangen werden,
// eine fehlende CUPS-Warteschlange ebenso wenig, und der Simulator hat nichts
// zu ersetzen (Architekturvorgabe Abschnitt 2.2). Das Backend wertet diese
// Liste beim Ausgang NOT_PRINTED aus (PrintJobsService.finalizeNotPrinted);
// der Print-Worker prueft in seinen Tests, dass seine Konfigurationsmeldung
// darin enthalten ist.
export const PRINT_ERROR_CODES_WITHOUT_FAILOVER: readonly PrintWorkerErrorCode[] =
  [
    PRINT_WORKER_ERROR_CODES.PRINTER_CONFIGURATION,
    PRINT_WORKER_ERROR_CODES.CUPS_QUEUE_NOT_FOUND,
    PRINT_WORKER_ERROR_CODES.OUTPUT_FAILED,
  ];
