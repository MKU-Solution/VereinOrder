import axios from "axios";

import {
  buildCancelJobRequest,
  buildGetJobAttributesRequest,
  buildPrintJobRequest,
  IPP_JOB_STATE,
  isSuccessfulStatus,
  IPP_STATUS,
  parseCancelJobResponse,
  parseGetJobAttributesResponse,
  parsePrintJobResponse,
} from "../ipp/protocol";
import { PreparedDocument } from "../printing/prepare";
import { PrintTarget } from "../target";
import {
  DeliveryContext,
  DeliveryResult,
  PrintErrorCode,
  PrinterAdapter,
  PrintTransportError,
} from "./types";

export interface CupsAdapterOptions {
  /** Vorgabe `CUPS_BASE_URL`, sonst `http://host.docker.internal:631`. */
  baseUrl?: string;
  /** Vorgabe `PRINT_CUPS_POLL_MS`, sonst 1000 ms. */
  pollMs?: number;
  /** Vorgabe `PRINT_CUPS_WAIT_MS`, sonst 120000 ms. */
  waitMs?: number;
  /** Nur für Tests. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Nur für Tests: eigener IPP-über-HTTP-Transport statt axios. */
  post?: (url: string, body: Buffer, timeoutMs: number) => Promise<Buffer>;
}

const DEFAULT_BASE_URL = "http://host.docker.internal:631";
const PAPER_OUT_REASONS = new Set(["media-empty", "media-needed"]);

function positiveNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let requestCounter = 0;
/** IPP verlangt request-id im Bereich 1..2^31-1 (RFC 8010 §3.1.1). */
function nextRequestId(): number {
  requestCounter = (requestCounter + 1) % 0x7fffffff;
  return requestCounter || 1;
}

function trimTrailingSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

/** HTTP-Endpunkt der Warteschlange, an den alle drei Operationen gehen. */
function httpUrlFor(base: string, queueName: string): string {
  return `${trimTrailingSlash(base)}/printers/${encodeURIComponent(queueName)}`;
}

/** `printer-uri` im IPP-Anfragekörper – dieselbe Adresse mit `ipp://`-Schema. */
function printerUriFor(base: string, queueName: string): string {
  return httpUrlFor(base, queueName).replace(/^https?:/, "ipp:");
}

/**
 * Verbindungsfehler des HTTP-Transports. `neverConnected = true` ist der
 * Beweis, dass die Anfrage nie beim Gegenüber ankam (Verbindung wurde nie
 * aufgebaut); jeder andere Ausgang bleibt bewusst mehrdeutig, weil axios auf
 * Node-Ebene kein verlässliches "Body vollständig gesendet" liefert
 * (siehe Abschlussbericht, Abschnitt zu Grenzen ohne echten CUPS-Server).
 */
class CupsConnectError extends Error {
  readonly neverConnected: boolean;
  constructor(message: string, neverConnected: boolean) {
    super(message);
    this.name = "CupsConnectError";
    this.neverConnected = neverConnected;
  }
}

const NEVER_CONNECTED_CODES = new Set([
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ENETDOWN",
  "EHOSTDOWN",
]);

async function defaultPost(
  url: string,
  body: Buffer,
  timeoutMs: number,
): Promise<Buffer> {
  try {
    const response = await axios.post(url, body, {
      timeout: timeoutMs,
      responseType: "arraybuffer",
      headers: { "Content-Type": "application/ipp" },
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      // Statuscodes wertet die IPP-Ebene selbst aus (RFC 8011 §13.1.4); ein
      // HTTP-Fehlerstatus ist hier ein eigener, mehrdeutiger Ausgang.
      validateStatus: () => true,
    });
    if (response.status < 200 || response.status >= 300) {
      throw new CupsConnectError(`HTTP ${response.status}`, false);
    }
    return Buffer.from(response.data as ArrayBuffer);
  } catch (error) {
    if (error instanceof CupsConnectError) throw error;
    const code = axios.isAxiosError(error) ? String(error.code) : undefined;
    throw new CupsConnectError(
      (error as Error).message,
      code !== undefined && NEVER_CONNECTED_CODES.has(code),
    );
  }
}

function classifyPrintJobRejection(statusCode: number): PrintErrorCode {
  if (statusCode === IPP_STATUS.CLIENT_ERROR_NOT_FOUND) {
    return "CUPS_QUEUE_NOT_FOUND";
  }
  if (statusCode === IPP_STATUS.SERVER_ERROR_NOT_ACCEPTING_JOBS) {
    return "CUPS_QUEUE_NOT_ACCEPTING";
  }
  // Jeder andere abgelehnte, aber vollständig geparste IPP-Status ist ein
  // klarer Gegenbeweis: cupsd hat den Auftrag nachweislich nicht angenommen.
  return "CUPS_QUEUE_NOT_ACCEPTING";
}

/**
 * CUPS-Adapter: `Print-Job` über IPP/HTTP, danach Beobachtung per
 * `Get-Job-Attributes` bis zu einem Endzustand oder `PRINT_CUPS_WAIT_MS`.
 * Endzustände werden nach der Klassifikationstabelle aus Abschnitt 2.2
 * eingestuft. Papier aus (`media-empty`/`media-needed`) löst ausdrücklich
 * KEIN Failover aus: der Auftrag bleibt im Spooler und wird nicht
 * abgebrochen, solange die Wartezeit läuft.
 */
export function createCupsAdapter(
  options: CupsAdapterOptions = {},
): PrinterAdapter {
  const configuredBaseUrl =
    options.baseUrl ?? process.env.CUPS_BASE_URL ?? DEFAULT_BASE_URL;
  const pollMs =
    options.pollMs ?? positiveNumber(process.env.PRINT_CUPS_POLL_MS, 1000);
  const waitMs =
    options.waitMs ?? positiveNumber(process.env.PRINT_CUPS_WAIT_MS, 120000);
  const post = options.post ?? defaultPost;
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? (() => Date.now());

  return {
    kind: "cups-ipp",
    async deliver(
      prepared: PreparedDocument,
      target: PrintTarget,
      context: DeliveryContext = {},
    ): Promise<DeliveryResult> {
      if (!target.queueName) {
        throw new PrintTransportError(
          "CUPS_QUEUE_NOT_FOUND",
          `Drucker "${target.name}" hat keine CUPS-Warteschlange konfiguriert.`,
        );
      }

      const base = target.host
        ? `http://${target.host}:${target.port}`
        : configuredBaseUrl;
      const httpUrl = httpUrlFor(base, target.queueName);
      const printerUri = printerUriFor(base, target.queueName);

      // --- 1. Print-Job: Auftrag in einem Schritt an die Warteschlange ---
      let printResponse: Buffer;
      try {
        printResponse = await post(
          httpUrl,
          buildPrintJobRequest({
            requestId: nextRequestId(),
            printerUri,
            documentFormat: "application/octet-stream",
            data: prepared.bytes,
          }),
          target.timeoutMs,
        );
      } catch (error) {
        const connectError = error as CupsConnectError;
        throw new PrintTransportError(
          connectError.neverConnected
            ? "CUPS_UNREACHABLE"
            : "CUPS_RESPONSE_LOST",
          connectError.neverConnected
            ? `CUPS unter ${httpUrl} nicht erreichbar: ${connectError.message}`
            : `Keine Antwort von CUPS (${httpUrl}); der Auftrag kann bereits angenommen worden sein: ${connectError.message}`,
        );
      }

      const printResult = parsePrintJobResponse(printResponse);
      if (!isSuccessfulStatus(printResult.statusCode)) {
        throw new PrintTransportError(
          classifyPrintJobRejection(printResult.statusCode),
          `CUPS lehnte Print-Job ab (Status 0x${printResult.statusCode
            .toString(16)
            .padStart(4, "0")}).`,
        );
      }
      if (printResult.jobId === undefined) {
        throw new PrintTransportError(
          "CUPS_RESPONSE_LOST",
          "CUPS-Antwort auf Print-Job enthielt keine Auftragsnummer.",
        );
      }
      const cupsJobId = printResult.jobId;
      const jobUri = printResult.jobUri ?? `${printerUri}/${cupsJobId}`;

      // --- 2. Phase SPOOLED bestätigen (Übergang 3, M3) ---
      // Annahme ist kein Druck; der Aufrufer bestätigt beim Backend, dass der
      // Beweis jetzt an cupsJobId/cupsJobState hängt. Ein Lease-Verlust hier
      // (LeaseLostError) wird unverändert nach oben gereicht.
      if (context.onSpooled) {
        await context.onSpooled(cupsJobId);
      }

      // --- 3. Beobachtung per Get-Job-Attributes bis zu einem Endzustand ---
      const deadline = now() + waitMs;
      let sawProcessing = false;

      while (now() < deadline) {
        await sleep(pollMs);

        let attrs;
        try {
          const buffer = await post(
            httpUrl,
            buildGetJobAttributesRequest({
              requestId: nextRequestId(),
              jobUri,
            }),
            target.timeoutMs,
          );
          attrs = parseGetJobAttributesResponse(buffer);
        } catch {
          // Transiente Abfrage: der Auftrag ist bereits im Spooler, ein
          // einzelner Verbindungsfehler beim Nachfragen ändert daran nichts.
          continue;
        }
        if (!isSuccessfulStatus(attrs.statusCode)) continue;

        context.onEvent?.("cups.state", {
          jobId: target.id,
          cupsJobId,
          jobState: attrs.jobState,
          jobStateReasons: attrs.jobStateReasons,
          printerStateReasons: attrs.printerStateReasons,
        });

        if (attrs.jobState === IPP_JOB_STATE.COMPLETED) {
          return {
            transport: "cups-ipp",
            bytes: prepared.bytes.length,
            cupsJobId,
            cupsJobState: "completed",
          };
        }

        if (attrs.jobState === IPP_JOB_STATE.CANCELED) {
          throw new PrintTransportError(
            sawProcessing
              ? "CUPS_JOB_CANCELED_PROCESSING"
              : "CUPS_JOB_CANCELED_PENDING",
            "Auftrag wurde im Spooler abgebrochen.",
            { cupsJobId, cupsJobState: "canceled" },
          );
        }

        if (attrs.jobState === IPP_JOB_STATE.ABORTED) {
          throw new PrintTransportError(
            "CUPS_JOB_ABORTED",
            "CUPS hat den Auftrag abgebrochen (aborted).",
            { cupsJobId, cupsJobState: "aborted" },
          );
        }

        if (attrs.jobState === IPP_JOB_STATE.PROCESSING) {
          sawProcessing = true;
        }

        if (attrs.jobState === IPP_JOB_STATE.PROCESSING_STOPPED) {
          const paperOut =
            attrs.jobStateReasons.some((r) => PAPER_OUT_REASONS.has(r)) ||
            attrs.printerStateReasons.some((r) => PAPER_OUT_REASONS.has(r));
          if (!paperOut && sawProcessing) {
            // Gerät während der Verarbeitung getrennt: Teildruck möglich.
            throw new PrintTransportError(
              "CUPS_DEVICE_DISCONNECTED",
              "Drucker während der Verarbeitung gestoppt (Gerät getrennt?).",
              { cupsJobId, cupsJobState: "stopped" },
            );
          }
          // Papier aus, oder Drucker offline vor Verarbeitungsbeginn: der
          // Auftrag bleibt im Spooler und wird NICHT abgebrochen – ein
          // Failover hier erzeugt garantiert einen Doppeldruck.
        }
        // PENDING / PENDING_HELD: unverändert weiter warten.
      }

      // --- 4. Wartezeit abgelaufen: Cancel-Job ist der letzte Beweisversuch ---
      let cancelStatus: number;
      try {
        const cancelBuffer = await post(
          httpUrl,
          buildCancelJobRequest({ requestId: nextRequestId(), jobUri }),
          target.timeoutMs,
        );
        cancelStatus = parseCancelJobResponse(cancelBuffer).statusCode;
      } catch (error) {
        throw new PrintTransportError(
          "CUPS_CANCEL_FAILED",
          `Cancel-Job nach Ablauf der Wartezeit fehlgeschlagen: ${(error as Error).message}`,
          { cupsJobId },
        );
      }
      if (!isSuccessfulStatus(cancelStatus)) {
        throw new PrintTransportError(
          "CUPS_CANCEL_FAILED",
          `CUPS lehnte Cancel-Job ab (Status 0x${cancelStatus
            .toString(16)
            .padStart(4, "0")}).`,
          { cupsJobId },
        );
      }

      // Nur ein Abbruch aus pending/held ist der Beweis für "sicher nicht
      // gedruckt"; war der Auftrag zwischenzeitlich in Verarbeitung, bleibt
      // das Ergebnis unklar (Teildruck möglich).
      throw new PrintTransportError(
        sawProcessing
          ? "CUPS_JOB_CANCELED_PROCESSING"
          : "CUPS_JOB_CANCELED_PENDING",
        sawProcessing
          ? `Auftrag nach ${waitMs} ms abgebrochen, war zwischenzeitlich in Verarbeitung.`
          : `Auftrag nach ${waitMs} ms ohne Fortschritt abgebrochen (z. B. Papier aus oder Drucker offline).`,
        { cupsJobId, cupsJobState: "canceled" },
      );
    },
  };
}
