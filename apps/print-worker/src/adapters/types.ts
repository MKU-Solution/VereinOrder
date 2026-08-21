import { PreparedDocument } from "../printing/prepare";
import { PrinterKind, PrintTarget } from "../target";

export type PrintErrorCode =
  // --- TCP-Transport ---
  | "DNS_ERROR"
  | "CONNECTION_REFUSED"
  | "UNREACHABLE"
  | "TIMEOUT"
  | "WRITE_FAILED"
  | "CONNECTION_LOST"
  // --- Simulator ---
  | "OUTPUT_FAILED"
  // --- CUPS/IPP-Transport ---
  | "CUPS_UNREACHABLE"
  | "CUPS_QUEUE_NOT_FOUND"
  | "CUPS_QUEUE_NOT_ACCEPTING"
  | "CUPS_RESPONSE_LOST"
  | "CUPS_JOB_CANCELED_PENDING"
  | "CUPS_JOB_CANCELED_PROCESSING"
  | "CUPS_JOB_ABORTED"
  | "CUPS_DEVICE_DISCONNECTED"
  | "CUPS_CANCEL_FAILED"
  | "CUPS_STATUS_UNKNOWN";

/**
 * Fehlerklasse eines abgeschlossenen Zustellversuchs, wie sie an das Backend
 * gemeldet wird (Abschnitt 2 der Architekturvorgabe). `NOT_PRINTED` gilt nur,
 * wenn nachweisbar kein einziges Byte den Druckerport erreicht hat. Alles
 * ohne positives Abschlusszeugnis ist `UNCLEAR`.
 */
export type PrintOutcomeClass = "NOT_PRINTED" | "PRINTED" | "UNCLEAR";

export interface PrintTransportErrorDetails {
  /**
   * socket.bytesWritten im Moment des Scheiterns (TCP) bzw. der
   * bestmögliche Beweiswert für andere Transporte. 0 ist ein Beweis, dass
   * kein Byte den Prozess verlassen hat; > 0 zerstört diesen Gegenbeweis.
   */
  bytesWritten?: number;
  /** Auftragsnummer im CUPS-Spooler, sofern bereits bekannt. */
  cupsJobId?: number;
  /** Zuletzt beobachteter job-state im CUPS-Spooler. */
  cupsJobState?: string;
}

/**
 * Transportfehler mit stabiler Kennung. Die Meldung ist bewusst kurz und
 * enthält keine Auftragsinhalte, weil sie im Backend gespeichert und der
 * Administration angezeigt wird.
 */
export class PrintTransportError extends Error {
  readonly code: PrintErrorCode;
  /** Beweisträger: siehe {@link PrintTransportErrorDetails.bytesWritten}. */
  readonly bytesWritten: number;
  readonly cupsJobId?: number;
  readonly cupsJobState?: string;

  constructor(
    code: PrintErrorCode,
    message: string,
    details: PrintTransportErrorDetails = {},
  ) {
    super(message);
    this.name = "PrintTransportError";
    this.code = code;
    this.bytesWritten = details.bytesWritten ?? 0;
    this.cupsJobId = details.cupsJobId;
    this.cupsJobState = details.cupsJobState;
  }
}

export interface DeliveryResult {
  /** Transportbezeichnung für das Protokoll. */
  transport: string;
  /** Tatsächlich übertragene Bytes. */
  bytes: number;
  /** Nur CUPS: Auftragsnummer im Spooler. */
  cupsJobId?: number;
  /** Nur CUPS: zuletzt beobachteter job-state. */
  cupsJobState?: string;
}

/**
 * Rückkanal zum Aufrufer während der Zustellung. Wird ausschließlich vom
 * CUPS-Adapter benutzt: `onSpooled` bestätigt den Phasenwechsel
 * `DELIVERING -> SPOOLED` beim Backend, sobald `Print-Job` angenommen wurde,
 * `onEvent` trägt Protokollereignisse (z. B. `cups.state`) nach außen.
 */
export interface DeliveryContext {
  onSpooled?: (cupsJobId: number) => Promise<void>;
  onEvent?: (event: string, fields?: Record<string, unknown>) => void;
}

export interface PrinterAdapter {
  readonly kind: PrinterKind;
  deliver(
    prepared: PreparedDocument,
    target: PrintTarget,
    context?: DeliveryContext,
  ): Promise<DeliveryResult>;
}

/**
 * Ordnet einen gescheiterten Zustellversuch der Fehlerklasse aus Abschnitt
 * 2.2 der Architekturvorgabe zu. Für `TIMEOUT` und `CONNECTION_LOST`
 * entscheidet allein `bytesWritten`; alle anderen Kennungen sind fest
 * zugeordnet.
 */
export function classifyOutcome(error: PrintTransportError): PrintOutcomeClass {
  switch (error.code) {
    case "DNS_ERROR":
    case "CONNECTION_REFUSED":
    case "UNREACHABLE":
    case "OUTPUT_FAILED":
    case "CUPS_QUEUE_NOT_FOUND":
    case "CUPS_QUEUE_NOT_ACCEPTING":
    case "CUPS_UNREACHABLE":
    case "CUPS_JOB_CANCELED_PENDING":
      return "NOT_PRINTED";
    case "TIMEOUT":
    case "CONNECTION_LOST":
      return error.bytesWritten > 0 ? "UNCLEAR" : "NOT_PRINTED";
    case "WRITE_FAILED":
    case "CUPS_RESPONSE_LOST":
    case "CUPS_JOB_CANCELED_PROCESSING":
    case "CUPS_JOB_ABORTED":
    case "CUPS_DEVICE_DISCONNECTED":
    case "CUPS_CANCEL_FAILED":
    case "CUPS_STATUS_UNKNOWN":
      return "UNCLEAR";
    default:
      return "UNCLEAR";
  }
}
