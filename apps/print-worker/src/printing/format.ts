/**
 * Formatierungshilfen für Bons. Alle Funktionen arbeiten bewusst ohne
 * Intl-Abhängigkeit, damit die Ausgabe unabhängig von der Laufzeitumgebung
 * des Druckrechners deterministisch bleibt.
 */

/** Wandelt ganzzahlige Cent in "1.234,50" um. */
export function formatAmount(cents: unknown): string {
  const value = Math.trunc(Number(cents) || 0);
  const negative = value < 0;
  const absolute = Math.abs(value);
  const euro = Math.floor(absolute / 100);
  const rest = absolute % 100;

  const grouped = String(euro).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${negative ? "-" : ""}${grouped},${String(rest).padStart(2, "0")}`;
}

/** Betrag mit Währungszeichen, z. B. "12,50 EUR" als "12,50 €". */
export function formatCurrency(cents: unknown): string {
  return `${formatAmount(cents)} €`;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** Datum und Uhrzeit in österreichischer Schreibweise, Ortszeit des Druckers. */
export function formatDateTime(value: unknown): string {
  if (!value) return "-";
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return "-";
  return (
    `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}` +
    ` ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

/** Nimmt den ersten nicht leeren Wert; sonst den Ersatztext. */
export function firstText(...values: unknown[]): string {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const text = String(value).trim();
    if (text.length > 0) return text;
  }
  return "";
}

/** Extras kommen als Zeichenkette oder als Objekt mit Namen an. */
export function extraLabel(extra: unknown): string {
  if (extra === null || extra === undefined) return "";
  if (typeof extra === "string") return extra.trim();
  if (typeof extra === "object") {
    const record = extra as Record<string, unknown>;
    return firstText(record.name, record.label, record.title);
  }
  return String(extra);
}

export function toQuantity(value: unknown): number {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}
