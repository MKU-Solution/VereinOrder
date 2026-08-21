import axios from "axios";

import {
  createAdapterRegistry,
  PrinterAdapter,
  PrintTransportError,
  selectAdapter,
} from "./adapters";
import { createLogger } from "./logging";
import { PrintJobLike } from "./printing/documents";
import { prepareDocument } from "./printing/prepare";
import { PrinterConfigurationError, PrinterRow, resolveTarget } from "./target";

interface PrintJob extends PrintJobLike {
  printer: PrinterRow;
}

const BACKEND_URL = process.env.BACKEND_URL || "http://127.0.0.1:3000";
const PRINT_WORKER_TOKEN = process.env.PRINT_WORKER_TOKEN;
const POLL_INTERVAL_MS = positiveNumber(
  process.env.PRINT_POLL_INTERVAL_MS,
  2500,
);
const DEFAULT_TIMEOUT_MS = positiveNumber(process.env.PRINT_TIMEOUT_MS, 5000);
const FORCE_SIMULATOR = ["1", "true", "yes", "ja"].includes(
  String(process.env.PRINT_FORCE_SIMULATOR ?? "").toLowerCase(),
);

const logger = createLogger({ secrets: [PRINT_WORKER_TOKEN ?? ""] });

function positiveNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function workerHeaders() {
  if (!PRINT_WORKER_TOKEN || PRINT_WORKER_TOKEN.length < 32) {
    throw new Error(
      "PRINT_WORKER_TOKEN muss gesetzt sein und mindestens 32 Zeichen enthalten.",
    );
  }
  return { "x-print-worker-token": PRINT_WORKER_TOKEN };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function claimNextJob(): Promise<PrintJob | null> {
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

async function reportStatus(
  jobId: string,
  status: "PRINTED" | "FAILED",
  errorMessage?: string,
): Promise<boolean> {
  try {
    await axios.patch(
      `${BACKEND_URL}/print-jobs/${jobId}/status`,
      { status, errorMessage },
      { headers: workerHeaders() },
    );
    return true;
  } catch (error) {
    logger.error("backend.status_failed", {
      jobId,
      status,
      message: (error as Error).message,
    });
    return false;
  }
}

/**
 * Druckt genau einen Auftrag. Der Auftrag gilt erst nach erfolgreichem
 * Transportabschluss als gedruckt; jeder Fehler wird mit stabiler Kennung
 * und ohne Auftragsinhalte gemeldet.
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
    await reportStatus(job.id, "FAILED", message);
    return;
  }

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

  try {
    const result = await selectAdapter(registry, target).deliver(
      prepared,
      target,
    );
    const marked = await reportStatus(job.id, "PRINTED");
    logger.info("job.printed", {
      jobId: job.id,
      jobType: job.jobType,
      printerId: target.id,
      transport: result.transport,
      bytes: result.bytes,
      durationMs: Date.now() - started,
      statusReported: marked,
    });
  } catch (error) {
    const transportError =
      error instanceof PrintTransportError ? error : undefined;
    const message =
      transportError?.message ??
      `Unerwarteter Fehler beim Drucken: ${(error as Error).message}`;

    logger.error("job.failed", {
      jobId: job.id,
      jobType: job.jobType,
      printerId: target.id,
      transport: target.kind,
      code: transportError?.code ?? "UNEXPECTED",
      durationMs: Date.now() - started,
      message,
    });
    await reportStatus(job.id, "FAILED", message);
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
  main().catch((error) => {
    logger.error("worker.crashed", { message: (error as Error).message });
    process.exitCode = 1;
  });
}
