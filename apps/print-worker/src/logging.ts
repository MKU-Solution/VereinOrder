export type LogLevel = "info" | "warn" | "error";

export interface LoggerOptions {
  /** Werte, die niemals im Protokoll erscheinen dürfen (z. B. Worker-Token). */
  secrets?: string[];
  write?: (line: string) => void;
  clock?: () => Date;
}

export interface Logger {
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
}

const MAX_TEXT_LENGTH = 300;

/**
 * Entfernt Geheimnisse und kürzt zu lange Texte.
 *
 * Druckaufträge enthalten Namen, Tischnummern und Beträge; davon wird nichts
 * protokolliert. Protokolliert werden nur Kennungen, Typen und Ergebnisse.
 */
export function redact(value: unknown, secrets: string[] = []): unknown {
  if (typeof value !== "string") return value;

  let text = value;
  for (const secret of secrets) {
    if (secret && secret.length >= 8) {
      text = text.split(secret).join("***");
    }
  }
  // Token- und PIN-ähnliche Zeichenfolgen aus Fremdmeldungen entschärfen.
  text = text.replace(/\b[A-Fa-f0-9]{32,}\b/g, "***");
  text = text.replace(
    /\b(pin|token|secret|password)\b\s*[:=]\s*\S+/gi,
    "$1=***",
  );

  return text.length > MAX_TEXT_LENGTH
    ? `${text.slice(0, MAX_TEXT_LENGTH)}…`
    : text;
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const secrets = (options.secrets ?? []).filter(Boolean);
  const write = options.write ?? ((line: string) => process.stdout.write(line));
  const clock = options.clock ?? (() => new Date());

  const emit = (
    level: LogLevel,
    event: string,
    fields: Record<string, unknown> = {},
  ) => {
    const entry: Record<string, unknown> = {
      ts: clock().toISOString(),
      level,
      event,
    };
    for (const [key, value] of Object.entries(fields)) {
      if (value === undefined) continue;
      entry[key] = redact(value, secrets);
    }
    write(`${JSON.stringify(entry)}\n`);
  };

  return {
    info: (event, fields) => emit("info", event, fields),
    warn: (event, fields) => emit("warn", event, fields),
    error: (event, fields) => emit("error", event, fields),
  };
}
