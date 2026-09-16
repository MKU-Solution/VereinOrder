import { hasUnrecoveredPrinterError } from "@vereinorder/shared";
import {
  AlertOctagon,
  CheckCircle2,
  CircleDashed,
  PowerOff,
  type LucideIcon,
} from "lucide-react";

// Issue #265: Klartexte fuer `Printer.lastErrorCode`. Dort landen seit #261
// nur Kennungen aus Zustellversuchen mit Ausgang NOT_PRINTED - also die
// Codes, die `classifyOutcome` (apps/print-worker/src/adapters/types.ts) als
// NOT_PRINTED einstuft (TIMEOUT und CONNECTION_LOST nur ohne uebertragene
// Bytes), plus die Konfigurationsmeldung des Workers. Reine UNCLEAR-Codes
// (LEASE_EXPIRED, REPORT_LOST, CUPS_JOB_ABORTED) werden nie an den Drucker
// geschrieben und stehen deshalb nicht in dieser Liste; die Texte fuer
// unklare Auftraege liefert describeUnresolvedReason.
//
// PRINTER_CONFIGURATION meldet der Worker (gemeinsame Liste in
// @vereinorder/shared, Issue #268). PRINTER_CONFIG_ERROR wurde nie
// erzeugt; der Eintrag bleibt nur als harmlose Rueckfallebene uebersetzt.
const PRINTER_ERROR_LABELS: Record<string, string> = {
  CONNECTION_REFUSED: "Drucker nimmt keine Verbindung an",
  UNREACHABLE: "Drucker ist im Netzwerk nicht erreichbar",
  TIMEOUT: "Drucker antwortet nicht",
  CONNECTION_LOST: "Verbindung abgebrochen, bevor gedruckt wurde",
  DNS_ERROR: "Druckeradresse wurde nicht gefunden",
  CUPS_UNREACHABLE: "Druckserver (CUPS) ist nicht erreichbar",
  CUPS_QUEUE_NOT_FOUND: "Warteschlange am Druckserver nicht gefunden",
  CUPS_QUEUE_NOT_ACCEPTING:
    "Warteschlange am Druckserver nimmt keine Aufträge an",
  CUPS_JOB_CANCELED_PENDING:
    "Druckserver hat den Auftrag vor dem Druck abgebrochen",
  OUTPUT_FAILED: "Ausgabe des Simulators fehlgeschlagen",
  PRINTER_CONFIGURATION:
    "Druckereinstellungen sind unvollständig oder ungültig",
  PRINTER_CONFIG_ERROR: "Druckereinstellungen sind unvollständig oder ungültig",
};

const describePrinterError = (code?: string | null): string =>
  code
    ? (PRINTER_ERROR_LABELS[code] ?? "Unbekannter Fehler")
    : "Ursache nicht gemeldet";

// Anzeigename des Geräteprofils (Issue #260): wählt, welche Befehlsnummer
// "ESC t n" für die gewählte Codepage erhält. Herstellerabhängig - an
// echter Hardware fährt ein MUNBYN-Netzwerkdrucker CP858 auf 14, Epson und
// daran ausgerichtete Geräte auf 19. Ein falsches Profil scheitert lautlos
// (kein Fehler, keine Rückmeldung), deshalb ist der Name hier bewusst
// verständlich statt einer rohen Zahl.
export const CODEPAGE_PROFILE_LABELS: Record<string, string> = {
  EPSON_STANDARD: "Epson-Standard",
  MUNBYN_CLONE: "MUNBYN / Nachbau",
};

export const describeCodepageProfile = (value?: string | null): string =>
  CODEPAGE_PROFILE_LABELS[value ?? ""] ??
  CODEPAGE_PROFILE_LABELS.EPSON_STANDARD;

export const formatMinutesAgoLong = (
  value?: string | number | Date | null,
): string => {
  if (!value) return "unbekannter Zeit";
  const ms =
    typeof value === "number" || typeof value === "string"
      ? new Date(value).getTime()
      : value instanceof Date
        ? value.getTime()
        : 0;
  const minutes = Math.max(0, Math.floor((Date.now() - ms) / 60000));
  if (minutes < 1) return "weniger als einer Minute";
  return `${minutes} ${minutes === 1 ? "Minute" : "Minuten"}`;
};

export const formatClockTime = (
  value?: string | number | Date | null,
): string =>
  value
    ? new Date(value).toLocaleTimeString("de-AT", {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "unbekannt";

const JOB_TYPE_FALLBACK_LABELS: Record<string, string> = {
  STATION_TICKET: "Abhol-/Küchenbon",
  PRODUCT_VOUCHER: "Produktbon",
  RECEIPT: "Kassenbeleg",
};

const KNOWN_JOB_TITLES: Record<string, string> = {
  "ABHOL-/KÜCHENBON": "Abhol-/Küchenbon",
  PRODUKTBON: "Produktbon",
  KASSENBELEG: "Kassenbeleg",
};

export const describeJobType = (job: any): string => {
  const title =
    typeof job?.content?.title === "string" ? job.content.title.trim() : "";
  if (title) return KNOWN_JOB_TITLES[title.toUpperCase()] ?? title;
  return JOB_TYPE_FALLBACK_LABELS[job?.jobType] ?? "Druckauftrag";
};

export const describeUnresolvedReason = (job: any): string => {
  const bytes = typeof job?.bytesWritten === "number" ? job.bytesWritten : null;
  switch (job?.unresolvedReason) {
    case "TRANSPORT":
      return bytes && bytes > 0
        ? `Verbindung nach ${bytes} Byte abgebrochen — auf dem Papier kann ein Teilbon liegen.`
        : "Verbindung während der Übertragung abgebrochen — ob und wie viel gedruckt wurde, ist nicht bekannt.";
    case "LEASE_EXPIRED":
      return "Der Druck-Dienst hat sich seit Beginn der Übertragung nicht mehr gemeldet — ob gedruckt wurde, ist nicht bekannt.";
    case "REPORT_LOST":
      return "Der Bon wurde vermutlich gedruckt, aber die Bestätigung ist nicht beim Server angekommen.";
    case "CUPS_ABORTED":
      return "Die Druckwarteschlange hat den Auftrag abgebrochen, möglicherweise während er schon lief.";
    case "CUPS_CANCELED":
      return "Der Auftrag wurde in der Warteschlange abgebrochen, während er möglicherweise schon lief.";
    default:
      return "Das Ergebnis dieses Druckauftrags ist unklar.";
  }
};

type PrinterTimeValue = string | number | Date | null | undefined;

const toTimestamp = (value: PrinterTimeValue): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
};

const pad2 = (value: number): string => String(value).padStart(2, "0");

const startOfDay = (time: number): number => {
  const date = new Date(time);
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  ).getTime();
};

/**
 * Zeitangabe der Druckerkarten (Issue #265), im Vorbeigehen lesbar: unter
 * einer Minute "gerade eben", unter einer Stunde "vor N Min.", danach mit
 * Tagesbezug und Uhrzeit. Kein Wert heißt "noch nie".
 */
export const formatPrinterTime = (
  value: PrinterTimeValue,
  now: number | Date = Date.now(),
): string => {
  const time = toTimestamp(value);
  if (time === null) return "noch nie";
  const nowTime = now instanceof Date ? now.getTime() : now;
  const diffMs = nowTime - time;
  if (diffMs < 60_000) return "gerade eben";
  if (diffMs < 60 * 60_000) return `vor ${Math.floor(diffMs / 60_000)} Min.`;

  const date = new Date(time);
  const clock = `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  const today = startOfDay(nowTime);
  const day = startOfDay(time);
  if (day === today) return `heute, ${clock}`;
  // Mittag des Vortags statt "minus 24 Stunden": bleibt auch am Tag der
  // Zeitumstellung im richtigen Kalendertag.
  if (day === startOfDay(today - 12 * 60 * 60_000)) return `gestern, ${clock}`;
  return `${pad2(date.getDate())}.${pad2(date.getMonth() + 1)}., ${clock}`;
};

export type PrinterStateKind = "OFF" | "FAILING" | "UNCONFIRMED" | "READY";
export type PrinterStateTone = "off" | "failing" | "unconfirmed" | "ready";

export interface PrinterDiagState {
  kind: PrinterStateKind;
  Icon: LucideIcon;
  /** Kurztext der Statuszeile. */
  label: string;
  /** Zeitangabe rechts in der Statuszeile; leer, wenn es keine gibt. */
  timeText: string;
  /**
   * Erläuterungszeilen unter der Statuszeile. Bei FAILING ist die erste
   * Zeile die Überschrift des Hinweisfelds.
   */
  details: string[];
  /** Nur OFF: Zusatzzeile, wenn der letzte Druckversuch fehlschlug. */
  hint?: string;
  /** Nur FAILING: gemeldeter Rohcode, klein angezeigt. */
  errorCode?: string;
  tone: PrinterStateTone;
}

const describeFallback = (
  printer: any,
  printersById: Record<string, any>,
): string => {
  if (!printer.fallbackPrinterId) return "Kein Ersatzdrucker hinterlegt.";
  const fallback = printersById[printer.fallbackPrinterId];
  if (!fallback) return "Ersatzdrucker: unbekannt";
  if (fallback.isActive === false)
    return `Ersatzdrucker „${fallback.name}" ist ausgeschaltet.`;
  return `Ersatzdrucker: „${fallback.name}"`;
};

/**
 * Zustand eines Druckers in der Druckerverwaltung (Issue #265). Die erste
 * zutreffende Regel gilt: ausgeschaltet, druckt nicht, noch nicht getestet,
 * bereit. Ein unklarer Ausgang (UNCLEAR) ändert den Zustand nicht, weil das
 * Backend dafür weder `lastOkAt` noch `lastErrorAt` schreibt.
 *
 * Bewusst KEINE Aussage, wohin Aufträge "gerade gehen": Jeder Bon versucht
 * zuerst den eigenen Drucker; ein Failover gibt es nur einmal je Bon und nur
 * unter Bedingungen, die diese Ansicht nicht kennt (Ersatz aktiv, kein
 * Simulator, Fehlercode ohne Failover-Sperre).
 *
 * `printersById` muss aus der ungefilterten Liste stammen, sonst wird ein
 * ausgefilterter Ersatzdrucker als "unbekannt" gemeldet.
 */
export const getPrinterDiagState = (
  printer: any,
  printersById: Record<string, any>,
  now: number = Date.now(),
): PrinterDiagState => {
  const failing = hasUnrecoveredPrinterError(printer);
  const errorText = describePrinterError(printer.lastErrorCode);

  if (printer.isActive === false) {
    const details = ["Von Hand ausgeschaltet."];
    if (!failing && printer.lastOkAt) {
      details.push(
        `Zuletzt gedruckt: ${formatPrinterTime(printer.lastOkAt, now)}`,
      );
    }
    let timeText = "";
    if (failing) timeText = formatPrinterTime(printer.lastErrorAt, now);
    else if (printer.lastOkAt)
      timeText = formatPrinterTime(printer.lastOkAt, now);
    return {
      kind: "OFF",
      Icon: PowerOff,
      label: "Ausgeschaltet",
      timeText,
      details,
      hint: failing
        ? `Letzter Druckversuch fehlgeschlagen (${formatPrinterTime(printer.lastErrorAt, now)}): ${errorText}`
        : undefined,
      tone: "off",
    };
  }

  if (failing) {
    return {
      kind: "FAILING",
      Icon: AlertOctagon,
      label: "Druckt nicht",
      timeText: formatPrinterTime(printer.lastErrorAt, now),
      details: [
        `Letzter Druckversuch fehlgeschlagen: ${errorText}`,
        `Fehlversuch: ${formatPrinterTime(printer.lastErrorAt, now)} · Zuletzt erfolgreich: ${formatPrinterTime(printer.lastOkAt, now)}`,
        describeFallback(printer, printersById),
        'Bitte prüfen: Strom, Netzwerk/WLAN, Adresse. Danach „Testbon drucken". Klappt er, verschwindet diese Meldung.',
      ],
      errorCode: printer.lastErrorCode || undefined,
      tone: "failing",
    };
  }

  if (!printer.lastOkAt && !printer.lastErrorAt) {
    return {
      kind: "UNCONFIRMED",
      Icon: CircleDashed,
      label: "Noch nicht getestet",
      timeText: "",
      details: ["Noch kein Bon gedruckt. Vor dem Fest einen Testbon drucken."],
      tone: "unconfirmed",
    };
  }

  return {
    kind: "READY",
    Icon: CheckCircle2,
    label: "Bereit",
    timeText: formatPrinterTime(printer.lastOkAt, now),
    details: [`Zuletzt gedruckt: ${formatPrinterTime(printer.lastOkAt, now)}`],
    tone: "ready",
  };
};

/**
 * Eingeschaltete Drucker, deren letzter Druckversuch fehlschlug (Issue #265).
 * Grundlage des Sammelhinweises; bewusst über die ungefilterte Liste.
 */
export const getFailingActivePrinters = <
  T extends {
    isActive?: boolean;
    lastErrorAt?: Date | string | null;
    lastOkAt?: Date | string | null;
  },
>(
  printers: T[],
): T[] =>
  printers.filter(
    (printer) =>
      printer.isActive !== false && hasUnrecoveredPrinterError(printer),
  );
