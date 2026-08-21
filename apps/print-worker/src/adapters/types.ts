import { PreparedDocument } from "../printing/prepare";
import { PrinterKind, PrintTarget } from "../target";

export type PrintErrorCode =
  | "DNS_ERROR"
  | "CONNECTION_REFUSED"
  | "UNREACHABLE"
  | "TIMEOUT"
  | "WRITE_FAILED"
  | "CONNECTION_LOST"
  | "OUTPUT_FAILED";

/**
 * Transportfehler mit stabiler Kennung. Die Meldung ist bewusst kurz und
 * enthält keine Auftragsinhalte, weil sie im Backend gespeichert und der
 * Administration angezeigt wird.
 */
export class PrintTransportError extends Error {
  readonly code: PrintErrorCode;

  constructor(code: PrintErrorCode, message: string) {
    super(message);
    this.name = "PrintTransportError";
    this.code = code;
  }
}

export interface DeliveryResult {
  /** Transportbezeichnung für das Protokoll. */
  transport: string;
  /** Tatsächlich übertragene Bytes. */
  bytes: number;
}

export interface PrinterAdapter {
  readonly kind: PrinterKind;
  deliver(
    prepared: PreparedDocument,
    target: PrintTarget,
  ): Promise<DeliveryResult>;
}
