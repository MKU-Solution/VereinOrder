import {
  AlertOctagon,
  AlertTriangle,
  CheckCircle2,
  PowerOff,
} from "lucide-react";

const PRINTER_ERROR_LABELS: Record<string, string> = {
  DNS_ERROR: "Name konnte nicht aufgelöst werden",
  CONNECTION_LOST: "Verbindung während der Übertragung verloren",
  CONNECTION_REFUSED: "Verbindung abgelehnt",
  CUPS_JOB_ABORTED: "Druckwarteschlange hat den Auftrag abgebrochen",
  CUPS_QUEUE_NOT_FOUND: "Warteschlange nicht gefunden",
  LEASE_EXPIRED: "Keine Rückmeldung mehr erhalten",
  REPORT_LOST: "Rückmeldung ist nicht angekommen",
  PRINTER_CONFIG_ERROR: "Druckerkonfiguration ist fehlerhaft",
  OUTPUT_FAILED: "Ausgabe ist fehlgeschlagen",
};

const describePrinterError = (code?: string | null): string =>
  code ? (PRINTER_ERROR_LABELS[code] ?? code) : "unbekannter Fehler";

const formatMinutesAgoShort = (
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
  return minutes < 1 ? "< 1 Min." : `${minutes} Min.`;
};

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

type PrinterDiagRowState = {
  Icon: typeof CheckCircle2;
  colorClass: string;
  text: string;
};

export const getPrinterDiagState = (
  printer: any,
  printersById: Record<string, any>,
): PrinterDiagRowState => {
  if (!printer.isActive) {
    return {
      Icon: PowerOff,
      colorClass: "text-slate-400",
      text: "Manuell deaktiviert",
    };
  }
  if (printer.bypassed) {
    const errorLabel = describePrinterError(printer.lastErrorCode);
    if (printer.fallbackPrinterId) {
      const fallbackName =
        printersById[printer.fallbackPrinterId]?.name ?? "unbekannt";
      return {
        Icon: AlertTriangle,
        colorClass: "text-rose-400",
        text: `Automatisch umgangen – Fehler vor ${formatMinutesAgoShort(printer.lastErrorAt)}: ${errorLabel}. Aufträge gehen aktuell an „${fallbackName}".`,
      };
    }
    return {
      Icon: AlertOctagon,
      colorClass: "text-rose-400",
      text: `Fehler seit ${formatMinutesAgoShort(printer.lastErrorAt)}: ${errorLabel}. Kein Ersatzdrucker hinterlegt.`,
    };
  }
  return { Icon: CheckCircle2, colorClass: "text-emerald-400", text: "Bereit" };
};
