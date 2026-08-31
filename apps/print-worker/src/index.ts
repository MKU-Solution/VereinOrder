import axios, { AxiosError } from "axios";

import {
  classifyOutcome,
  createAdapterRegistry,
  DeliveryContext,
  PrinterAdapter,
  PrintOutcomeClass,
  PrintTransportError,
  selectAdapter,
} from "./adapters";
import { LeaseLostError } from "./lease";
import { createLogger } from "./logging";
import { PrintJobLike } from "./printing/documents";
import { prepareDocument } from "./printing/prepare";
import { PrinterConfigurationError, PrinterRow, resolveTarget } from "./target";
import { MIN_TOKEN_LENGTH, resolveWorkerToken } from "./token";

interface PrintJob extends PrintJobLike {
  printer: PrinterRow;
  /** Fencing-Token der laufenden Reservierung (M2). */
  leaseId: string;
  leaseExpiresAt: string;
}

interface OutcomeReport {
  leaseId: string;
  outcome: PrintOutcomeClass;
  errorCode?: string;
  errorMessage?: string;
  bytesWritten?: number;
  cupsJobState?: string;
}

const BACKEND_URL = process.env.BACKEND_URL || "http://127.0.0.1:3000";
// #175: Faellt auf die Datei unter STATE_DIR zurueck, die das Backend beim
// ersten Start erzeugt. Weiterhin zur Modul-Ladezeit - der Abbruch bei
// fehlendem Token steht deshalb unten im "require.main"-Zweig und nicht
// hier, damit index.spec.ts das Modul weiterhin laden kann.
const PRINT_WORKER_TOKEN = resolveWorkerToken() ?? undefined;
const POLL_INTERVAL_MS = positiveNumber(
  process.env.PRINT_POLL_INTERVAL_MS,
  2500,
);
const DEFAULT_TIMEOUT_MS = positiveNumber(process.env.PRINT_TIMEOUT_MS, 5000);
const FORCE_SIMULATOR = ["1", "true", "yes", "ja"].includes(
  String(process.env.PRINT_FORCE_SIMULATOR ?? "").toLowerCase(),
);

/** Vorgabe aus Abschnitt 3.2 (M2): Herzschlag alle 20 Sekunden. */
const HEARTBEAT_INTERVAL_MS = 20000;
/** Rückstaffelung der beharrlichen Ergebnismeldung (M4). */
const REPORT_RETRY_INITIAL_DELAY_MS = 1000;
const REPORT_RETRY_MAX_DELAY_MS = 30000;

const logger = createLogger({ secrets: [PRINT_WORKER_TOKEN ?? ""] });

function positiveNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function workerHeaders() {
  if (!PRINT_WORKER_TOKEN || PRINT_WORKER_TOKEN.length < MIN_TOKEN_LENGTH) {
    throw new Error(
      "PRINT_WORKER_TOKEN muss gesetzt sein und mindestens 32 Zeichen enthalten.",
    );
  }
  return { "x-print-worker-token": PRINT_WORKER_TOKEN };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 409 Conflict: die Reservierung gehört diesem Worker nicht mehr. */
function isLeaseConflict(error: unknown): boolean {
  return (
    axios.isAxiosError(error) && (error as AxiosError).response?.status === 409
  );
}

/**
 * Holt den nächsten Druckauftrag. Fängt JEDEN Fehler ab und liefert `null`
 * statt zu werfen — das gilt ausdrücklich auch für ein `503` des Backends
 * (Issue #67, Wartungsmodus: `POST /print-jobs/claim` ist während der
 * Wartung gesperrt). `main()` unten wertet `null` als "gerade nichts zu tun"
 * und schläft einfach bis zum nächsten Versuch (`POLL_INTERVAL_MS`) — der
 * Arbeiter übersteht eine laufende Wartung dadurch von selbst, ohne
 * Sonderbehandlung, und erholt sich beim Ende der Wartung im nächsten
 * Umlauf, sobald das Backend wieder normal antwortet. Siehe
 * `index.spec.ts`, Abschnitt "Wartungsmodus", für den Nachweis.
 */
export async function claimNextJob(): Promise<PrintJob | null> {
  try {
    const response = await axios.post(
      `${BACKEND_URL}/print-jobs/claim`,
      {},
      { headers: workerHeaders() },
    );
    return response.data || null;
  } catch (error) {
    logger.warn("backend.claim_failed", {
      message: (error as Error).message,
    });
    return null;
  }
}

/**
 * Bestätigt einen Phasenwechsel beim Backend. Vor dem ersten gesendeten Byte
 * MUSS `CLAIMED -> DELIVERING` bestätigt sein (Pflicht 1 / M3) – das ist die
 * Sicherung gegen Doppeldruck. Ein `409` bedeutet, dass die Reservierung
 * nicht mehr gehört; das wird als {@link LeaseLostError} weitergereicht,
 * jeder andere Fehler (z. B. Backend nicht erreichbar) als gewöhnlicher
 * Fehler, der ebenfalls den Druckversuch verhindert.
 */
async function confirmPhase(
  jobId: string,
  leaseId: string,
  phase: "DELIVERING" | "SPOOLED",
  cupsJobId?: number,
): Promise<void> {
  try {
    await axios.patch(
      `${BACKEND_URL}/print-jobs/${jobId}/phase`,
      { leaseId, phase, cupsJobId },
      { headers: workerHeaders() },
    );
  } catch (error) {
    if (isLeaseConflict(error)) {
      throw new LeaseLostError(
        `Phasenwechsel nach ${phase} abgelehnt: Reservierung verloren.`,
      );
    }
    throw error;
  }
}

/**
 * Hält die Reservierung während eines laufenden Auftrags am Leben (M2).
 * Ein `409` beim Herzschlag bedeutet endgültigen Lease-Verlust; ab dann gilt
 * `held.value = false` und jede weitere Ergebnismeldung wird nicht mehr
 * versucht.
 */
function startHeartbeat(
  jobId: string,
  leaseId: string,
): { held: { value: boolean }; stop: () => void } {
  const held = { value: true };
  const timer = setInterval(() => {
    if (!held.value) return;
    axios
      .post(
        `${BACKEND_URL}/print-jobs/${jobId}/heartbeat`,
        { leaseId },
        { headers: workerHeaders() },
      )
      .catch((error) => {
        if (isLeaseConflict(error)) {
          held.value = false;
          logger.warn("lease.lost", { jobId, phase: "heartbeat" });
          return;
        }
        logger.warn("backend.heartbeat_failed", {
          jobId,
          message: (error as Error).message,
        });
      });
  }, HEARTBEAT_INTERVAL_MS);
  timer.unref?.();
  return { held, stop: () => clearInterval(timer) };
}

/**
 * Beharrliche, gefencte Ergebnismeldung (M4, Pflicht 7). Wiederholt mit
 * Rückstaffelung, solange die Lease gehalten wird (`held.value`). Die
 * Meldung ist über `leaseId` gefenct und damit idempotent – ein `409`
 * beendet die Wiederholung endgültig, jeder andere Fehler wird protokolliert
 * und erneut versucht.
 */
async function reportOutcomePersistent(
  jobId: string,
  held: { value: boolean },
  payload: OutcomeReport,
): Promise<void> {
  let attempt = 0;
  let delayMs = REPORT_RETRY_INITIAL_DELAY_MS;

  while (held.value) {
    attempt += 1;
    try {
      await axios.patch(`${BACKEND_URL}/print-jobs/${jobId}/status`, payload, {
        headers: workerHeaders(),
      });
      return;
    } catch (error) {
      if (isLeaseConflict(error)) {
        held.value = false;
        logger.warn("lease.lost", { jobId, phase: "status" });
        return;
      }
      logger.warn("report.retry", {
        jobId,
        attempt,
        delayMs,
        outcome: payload.outcome,
        message: (error as Error).message,
      });
      await sleep(delayMs);
      delayMs = Math.min(delayMs * 2, REPORT_RETRY_MAX_DELAY_MS);
    }
  }
}

/**
 * Druckt genau einen Auftrag. Der Phasenwechsel `CLAIMED -> DELIVERING`
 * muss vor dem ersten gesendeten Byte beim Backend bestätigt sein (Pflicht
 * 1); scheitert das, wird nicht gedruckt. Der Worker meldet dem Backend die
 * Fehlerklasse (`NOT_PRINTED` | `PRINTED` | `UNCLEAR`), nicht mehr
 * `PRINTED`/`FAILED` – das Backend entscheidet über Failover.
 */
export async function processJob(
  job: PrintJob,
  registry: Map<string, PrinterAdapter>,
): Promise<void> {
  const started = Date.now();

  let target;
  try {
    target = resolveTarget(job.printer ?? {}, {
      forceSimulator: FORCE_SIMULATOR,
      defaultTimeoutMs: DEFAULT_TIMEOUT_MS,
    });
  } catch (error) {
    const message =
      error instanceof PrinterConfigurationError
        ? error.message
        : "Druckerkonfiguration konnte nicht gelesen werden.";
    logger.error("job.configuration_invalid", {
      jobId: job.id,
      jobType: job.jobType,
      printerId: job.printer?.id,
      message,
    });
    const held = { value: true };
    await reportOutcomePersistent(job.id, held, {
      leaseId: job.leaseId,
      outcome: "NOT_PRINTED",
      errorCode: "PRINTER_CONFIGURATION",
      errorMessage: message,
    });
    return;
  }

  // Pflicht 1: Vor dem ersten gesendeten Byte muss der Phasenwechsel
  // CLAIMED -> DELIVERING beim Backend bestätigt sein. Scheitert das, wird
  // NICHT gedruckt – das ist die Sicherung gegen Doppeldruck.
  try {
    await confirmPhase(job.id, job.leaseId, "DELIVERING");
  } catch (error) {
    if (error instanceof LeaseLostError) {
      logger.warn("lease.lost", { jobId: job.id, phase: "DELIVERING" });
    } else {
      logger.error("job.phase_confirm_failed", {
        jobId: job.id,
        message: (error as Error).message,
      });
    }
    return;
  }
  logger.info("phase.confirmed", { jobId: job.id, phase: "DELIVERING" });

  const prepared = prepareDocument(job, target);
  logger.info("job.claimed", {
    jobId: job.id,
    jobType: job.jobType,
    printerId: target.id,
    transport: target.kind,
    paperWidth: target.profile.width,
    lines: prepared.lines.length,
    bytes: prepared.bytes.length,
    copies: target.copies,
  });

  const heartbeat = startHeartbeat(job.id, job.leaseId);
  try {
    const context: DeliveryContext = {
      onSpooled: async (cupsJobId: number) => {
        await confirmPhase(job.id, job.leaseId, "SPOOLED", cupsJobId);
        logger.info("cups.spooled", { jobId: job.id, cupsJobId });
      },
      onEvent: (event, fields) =>
        logger.info(event, { jobId: job.id, ...fields }),
    };

    let result;
    try {
      result = await selectAdapter(registry, target).deliver(
        prepared,
        target,
        context,
      );
    } catch (error) {
      if (error instanceof LeaseLostError) {
        logger.warn("lease.lost", { jobId: job.id, phase: "DELIVERY" });
        return;
      }
      const transportError =
        error instanceof PrintTransportError ? error : undefined;
      const outcome = transportError
        ? classifyOutcome(transportError)
        : "UNCLEAR";
      const message =
        transportError?.message ??
        `Unerwarteter Fehler beim Drucken: ${(error as Error).message}`;

      logger.error("job.failed", {
        jobId: job.id,
        jobType: job.jobType,
        printerId: target.id,
        transport: target.kind,
        code: transportError?.code ?? "UNEXPECTED",
        outcome,
        durationMs: Date.now() - started,
        message,
      });

      await reportOutcomePersistent(job.id, heartbeat.held, {
        leaseId: job.leaseId,
        outcome,
        errorCode: transportError?.code ?? "UNEXPECTED",
        errorMessage: message,
        bytesWritten: transportError?.bytesWritten,
        cupsJobState: transportError?.cupsJobState,
      });
      return;
    }

    logger.info("job.printed", {
      jobId: job.id,
      jobType: job.jobType,
      printerId: target.id,
      transport: result.transport,
      bytes: result.bytes,
      durationMs: Date.now() - started,
    });

    await reportOutcomePersistent(job.id, heartbeat.held, {
      leaseId: job.leaseId,
      outcome: "PRINTED",
      cupsJobState: result.cupsJobState,
    });
  } finally {
    heartbeat.stop();
  }
}

async function main(): Promise<void> {
  workerHeaders();

  const registry = createAdapterRegistry();
  let running = true;

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      if (!running) return;
      running = false;
      logger.info("worker.stopping", { signal });
    });
  }

  logger.info("worker.started", {
    backendUrl: BACKEND_URL,
    pollIntervalMs: POLL_INTERVAL_MS,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    forceSimulator: FORCE_SIMULATOR,
    heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
  });

  while (running) {
    const job = await claimNextJob();
    if (!job) {
      await sleep(POLL_INTERVAL_MS);
      continue;
    }
    await processJob(job, registry);
  }

  logger.info("worker.stopped", {});
}

if (require.main === module) {
  // #175: Ohne Token kann dieser Prozess nichts Sinnvolles tun. Frueher
  // liess "workerHeaders()" jeden Umlauf in claimNextJob() scheitern, das
  // den Fehler faengt - der Worker lief dann still und ewig in einer
  // "backend.claim_failed"-Schleife weiter. Stattdessen: Fehlerstatus.
  // "restart: always" (docker-compose.yml) laesst ihn mit wachsendem
  // Abstand erneut anlaufen; das ist der Normalfall, wenn der Worker vor
  // dem Backend startet und die Tokendatei noch nicht geschrieben ist.
  if (!PRINT_WORKER_TOKEN || PRINT_WORKER_TOKEN.length < MIN_TOKEN_LENGTH) {
    logger.error("worker.token_missing", {
      message:
        "PRINT_WORKER_TOKEN fehlt oder ist zu kurz. Erwartet: Umgebungsvariable " +
        "oder die vom Backend erzeugte Datei unter STATE_DIR. Beende mit " +
        "Fehlerstatus und starte ueber restart: always erneut.",
    });
    process.exit(1);
  }

  main().catch((error) => {
    logger.error("worker.crashed", { message: (error as Error).message });
    process.exitCode = 1;
  });
}
