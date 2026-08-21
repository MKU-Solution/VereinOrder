import { Codepage, resolveCodepage } from "./printing/charset";
import { CutMode, resolveCutMode } from "./printing/escpos";
import { PaperProfile, resolvePaperProfile } from "./printing/profiles";

/** Transportart, die sich aus dem konfigurierten Druckertyp ergibt. */
export type PrinterKind = "escpos-network" | "simulator" | "cups-ipp";

/**
 * Ein Drucker, wie ihn der Worker braucht: aufgelöste Transportart, geprüfte
 * Netzwerkdaten und die Ausgabeparameter des Papierprofils.
 */
export interface PrintTarget {
  id: string;
  name: string;
  kind: PrinterKind;
  type: string;
  host?: string;
  port: number;
  timeoutMs: number;
  profile: PaperProfile;
  codepage: Codepage;
  cutMode: CutMode;
  copies: number;
  /** Nur `cups-ipp`: Name der CUPS-Warteschlange (muss eine Raw-Queue sein). */
  queueName?: string;
}

export interface PrinterRow {
  id?: string;
  name?: string;
  type?: string;
  ipAddress?: string | null;
  port?: number | null;
  paperWidth?: number | null;
  codepage?: string | null;
  cutMode?: string | null;
  copies?: number | null;
  timeoutMs?: number | null;
  isActive?: boolean;
  /** Pflicht bei `CUPS_IPP`, sonst null. */
  queueName?: string | null;
}

/**
 * Fehler in der Druckerkonfiguration. Solche Aufträge scheitern dauerhaft und
 * werden nicht erneut versucht, bis die Konfiguration korrigiert ist.
 */
export class PrinterConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PrinterConfigurationError";
  }
}

const NETWORK_TYPES = new Set([
  "ESC_POS_NETWORK",
  "ESC_POS_LAN",
  "NETWORK",
  "LAN",
  "WLAN",
]);

const SIMULATOR_TYPES = new Set(["CONSOLE", "SIMULATOR", "VIRTUAL", "DUMMY"]);

const CUPS_TYPES = new Set(["CUPS_IPP"]);

export const DEFAULT_PORT = 9100;
export const DEFAULT_CUPS_PORT = 631;
export const DEFAULT_TIMEOUT_MS = 5000;

function clamp(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Math.trunc(Number(value));
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

/** Sehr grobe Prüfung: Hostname oder IP-Adresse ohne Schema und Pfad. */
function assertHost(printer: PrinterRow): string {
  const host = String(printer.ipAddress ?? "").trim();
  if (host.length === 0) {
    throw new PrinterConfigurationError(
      `Drucker "${printer.name}" hat keine IP-Adresse oder keinen Hostnamen.`,
    );
  }
  if (/[\s/\\]/.test(host) || host.includes("://")) {
    throw new PrinterConfigurationError(
      `Drucker "${printer.name}" hat eine ungültige Adresse: ${host}`,
    );
  }
  return host;
}

/**
 * `ipAddress` ist bei `CUPS_IPP` nur ein optionaler, abweichender
 * CUPS-Host (Vorgabe ist `CUPS_BASE_URL`) und darf deshalb leer sein –
 * anders als bei den Netzwerktypen, wo sie Pflicht ist.
 */
function optionalCupsHost(printer: PrinterRow): string | undefined {
  const host = String(printer.ipAddress ?? "").trim();
  if (host.length === 0) return undefined;
  if (/[\s/\\]/.test(host) || host.includes("://")) {
    throw new PrinterConfigurationError(
      `Drucker "${printer.name}" hat eine ungültige CUPS-Host-Adresse: ${host}`,
    );
  }
  return host;
}

/** `queueName` ist bei `CUPS_IPP` Pflicht: der Name der CUPS-Warteschlange. */
function assertQueueName(printer: PrinterRow): string {
  const queueName = String(printer.queueName ?? "").trim();
  if (queueName.length === 0) {
    throw new PrinterConfigurationError(
      `Drucker "${printer.name}" hat keinen CUPS-Warteschlangennamen (queueName).`,
    );
  }
  if (/[\s/\\]/.test(queueName)) {
    throw new PrinterConfigurationError(
      `Drucker "${printer.name}" hat einen ungültigen Warteschlangennamen: ${queueName}`,
    );
  }
  return queueName;
}

/**
 * Bildet eine Druckerzeile aus der Datenbank auf das Ziel des Workers ab.
 * Unbekannte Typen führen zu einem Konfigurationsfehler statt zu einem
 * stillen Konsolendruck, damit ein falsch angelegter Drucker auffällt.
 */
export function resolveTarget(
  printer: PrinterRow,
  options: { forceSimulator?: boolean; defaultTimeoutMs?: number } = {},
): PrintTarget {
  const type = String(printer.type ?? "").toUpperCase();
  const defaultPort = CUPS_TYPES.has(type) ? DEFAULT_CUPS_PORT : DEFAULT_PORT;
  const base = {
    id: String(printer.id ?? "unbekannt"),
    name: String(printer.name ?? "Unbenannter Drucker"),
    type: type || "UNBEKANNT",
    port: clamp(printer.port, defaultPort, 1, 65535),
    timeoutMs: clamp(
      printer.timeoutMs,
      options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS,
      250,
      120000,
    ),
    profile: resolvePaperProfile(printer.paperWidth),
    codepage: resolveCodepage(printer.codepage),
    cutMode: resolveCutMode(printer.cutMode),
    copies: clamp(printer.copies, 1, 1, 9),
  };

  if (options.forceSimulator || SIMULATOR_TYPES.has(type)) {
    return { ...base, kind: "simulator" };
  }

  if (NETWORK_TYPES.has(type)) {
    return { ...base, kind: "escpos-network", host: assertHost(printer) };
  }

  if (CUPS_TYPES.has(type)) {
    return {
      ...base,
      kind: "cups-ipp",
      host: optionalCupsHost(printer),
      queueName: assertQueueName(printer),
    };
  }

  throw new PrinterConfigurationError(
    `Druckertyp "${base.type}" wird vom Print-Worker nicht unterstützt.`,
  );
}
