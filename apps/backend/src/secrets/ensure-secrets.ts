import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { resolveStateDir } from "../common/state-dir";

/**
 * Sicherheitsgeheimnisse beim ersten Start erzeugen (#175).
 *
 * Bis hierher gab `docker-compose.yml` dem `JWT_SECRET` einen Vorgabewert,
 * der im öffentlichen Repository steht, und der Quelltext fiel an drei
 * Stellen still auf `"changeme-in-production"` zurück. Wer den Wert kennt,
 * stellt sich selbst ein Token für jede Rolle aus. Ein Vorgabewert, der
 * still greift, wird nie bemerkt und deshalb nie geändert.
 *
 * Der Ablageort kommt aus `common/state-dir.ts` — derselben Stelle, aus der
 * ihn auch `MaintenanceStateService` bezieht, damit Schlüssel und
 * Wartungszustand nicht auseinanderlaufen.
 *
 * ABLAGE UNTER `STATE_DIR`, NICHT IN DER DATENBANK — dasselbe Argument wie
 * bei `maintenance-state.service.ts:6-24`: Eine Wiederherstellung ERSETZT
 * die Datenbank. Ein Schlüssel darin würde von der Wiederherstellung selbst
 * auf den Wert überschrieben, den die Sicherung zufällig trug — jedes
 * ausgegebene Token wäre im gefährlichsten Augenblick ungültig, und zwar
 * auf einen Wert hin, den niemand gesetzt hat. Das Verzeichnis liegt im
 * Festbetrieb auf einem eigenen Volume (`docker-compose.yml`), damit der
 * Schlüssel ein Neuanlegen des Containers überlebt.
 *
 * RANGFOLGE, in dieser Reihenfolge:
 *   1. Eine gesetzte Umgebungsvariable gewinnt IMMER. Wer den Wert selbst
 *      verwaltet (Geheimnisverwaltung, mehrere Instanzen, bewusst
 *      fortgeschriebener Altwert), behält die Hoheit; es wird dann auch
 *      keine Datei angelegt.
 *   2. Sonst die Datei unter `STATE_DIR`.
 *   3. Sonst 32 Zufallsbytes, atomar mit Dateirechten `0600` geschrieben.
 *
 * ZEITPUNKT — der eigentliche Grund, warum das hier und nicht in einem
 * `onModuleInit` steht: `JWT_SECRET` wird zur MODUL-LADEZEIT gelesen, nicht
 * beim Start der Anwendung. `auth.module.ts` und `maintenance.module.ts`
 * werten `process.env.JWT_SECRET` in ihren Decorator-Argumenten aus, also
 * bereits während `require("./app.module")`; `jwt.strategy.ts` folgt beim
 * Erzeugen der Instanz durch die Abhängigkeitsverwaltung. Gemessen mit
 * einem Proxy auf `process.env`: zwei Lesezugriffe fallen an, BEVOR die
 * erste Zeile von `bootstrap()` läuft. Aufgerufen wird
 * {@link ensureBackendSecrets} deshalb an genau zwei Stellen:
 *   - `apps/backend/docker-entrypoint.sh` über
 *     `ensure-secrets.cli.ts`, vor `exec "$@"` — im Festbetrieb also in
 *     einem eigenen Prozessschritt, noch bevor Node die Anwendung lädt.
 *     Dort kann keine Umsortierung von Importen etwas kippen.
 *   - `apps/backend/src/main.ts`, vor dem `require("./app.module")`, damit
 *     ein Start ausserhalb von Docker (Entwicklung, `start:prod`,
 *     Browsertests) sich genauso verhält. `main.ts` lädt `AppModule`
 *     bewusst per `require()` statt per `import` — ein statischer Import
 *     würde hochgezogen und liefe VOR dieser Funktion; eine spätere
 *     Umsortierung der Importe könnte die Zusage sonst still brechen.
 *     `ensure-secrets.spec.ts` bewacht das.
 */

/** Woher der Wert stammt. Nur `generated` wird protokolliert. */
export type SecretSource = "env" | "file" | "generated";

export interface EnsuredSecret {
  /** Name der Umgebungsvariablen, z. B. `JWT_SECRET`. */
  name: string;
  value: string;
  source: SecretSource;
  /** Pfad der Ablage unter `STATE_DIR` (auch wenn die Umgebung gewann). */
  filePath: string;
}

export interface EnsureSecretsOptions {
  /** Vorgabe: `STATE_DIR`, sonst `<cwd>/state` — wie `MaintenanceStateService`. */
  stateDir?: string;
  /** Vorgabe: eine Zeile auf stderr. */
  log?: (message: string) => void;
  /** Nur für Tests austauschbar. */
  env?: NodeJS.ProcessEnv;
}

/** 32 Zufallsbytes, hexadezimal also 64 Zeichen — deutlich über der
 * Mindestlänge von 32 Zeichen, die `print-worker.guard.ts` verlangt. */
const SECRET_BYTES = 32;

export const JWT_SECRET_FILE = "jwt-secret";
export const PRINT_WORKER_TOKEN_FILE = "print-worker-token";

/**
 * Bewusst auf stderr: `ensure-secrets.cli.ts` läuft im Entrypoint; dessen
 * Ausgabe landet im Containerprotokoll. Der WERT taucht dabei nirgends auf,
 * nur die Tatsache der Erzeugung — vergleiche die Maskierung in
 * `apps/print-worker/src/logging.ts`.
 */
function defaultLog(message: string): void {
  process.stderr.write(`${message}\n`);
}

function readSecretFile(filePath: string): string | null {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf-8");
  } catch {
    // Fehlt die Datei (erster Start) oder ist sie nicht lesbar: als
    // "nicht vorhanden" behandeln und weiter unten neu erzeugen.
    return null;
  }
  const value = raw.trim();
  // Eine leere Datei ist kein Schlüssel. Sie entsteht etwa, wenn ein
  // Schreibvorgang auf einem vollen Dateisystem abgebrochen wurde; ein
  // Start mit dem leeren Wert wäre schlimmer als eine Neuerzeugung.
  return value.length > 0 ? value : null;
}

/**
 * Atomares Schreiben, übernommen aus
 * `maintenance-state.service.ts:94-104`: erst in eine temporäre Datei im
 * SELBEN Verzeichnis, dann per `rename` an den endgültigen Platz. `rename`
 * ist auf demselben Dateisystem atomar — ein Absturz mitten im Schreiben
 * darf keinen halben Schlüssel hinterlassen, denn ein halber Schlüssel wäre
 * ein anderer Schlüssel, und alle ausgegebenen Token wären ungültig.
 *
 * Zusätzlich zum Wartungszustand: Dateirechte `0600`. Der Schlüssel geht
 * niemanden ausser dem Dienst etwas an. `chmod` unter Windows ist wirkungslos;
 * der Festbetrieb läuft unter Linux im Container.
 */
function writeSecretFile(
  stateDir: string,
  filePath: string,
  value: string,
): void {
  if (!fs.existsSync(stateDir)) {
    fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  }
  const tmpPath = path.join(
    stateDir,
    `.${path.basename(filePath)}.tmp-${process.pid}-${Date.now()}`,
  );
  fs.writeFileSync(tmpPath, value, { encoding: "utf-8", mode: 0o600 });
  // `mode` in `writeFileSync` greift nur beim Neuanlegen und wird von der
  // umask beschnitten - deshalb ausdruecklich nachziehen, bevor die Datei
  // unter ihren endgueltigen Namen wandert.
  fs.chmodSync(tmpPath, 0o600);
  fs.renameSync(tmpPath, filePath);
}

/**
 * Stellt ein einzelnes Geheimnis nach der oben beschriebenen Rangfolge
 * bereit. Verändert `process.env` NICHT — das tut {@link ensureBackendSecrets}.
 */
export function ensureSecret(
  name: string,
  fileName: string,
  options: EnsureSecretsOptions = {},
): EnsuredSecret {
  const env = options.env ?? process.env;
  const stateDir = options.stateDir ?? resolveStateDir(env);
  const log = options.log ?? defaultLog;
  const filePath = path.join(stateDir, fileName);

  // 1. Umgebungsvariable gewinnt immer. Ein leerer Wert zaehlt als nicht
  //    gesetzt: docker-compose.yml reicht `${JWT_SECRET:-}` als leere
  //    Zeichenkette in den Container, wenn in der `.env` nichts steht.
  const fromEnv = (env[name] ?? "").trim();
  if (fromEnv.length > 0) {
    return { name, value: fromEnv, source: "env", filePath };
  }

  // 2. Datei unter STATE_DIR.
  const fromFile = readSecretFile(filePath);
  if (fromFile !== null) {
    return { name, value: fromFile, source: "file", filePath };
  }

  // 3. Neu erzeugen.
  const value = crypto.randomBytes(SECRET_BYTES).toString("hex");
  writeSecretFile(stateDir, filePath, value);
  log(
    `secrets: ${name} wurde beim ersten Start neu erzeugt und unter ${filePath} abgelegt. ` +
      `Der Wert wird nicht protokolliert. Bereits ausgegebene Token aus einem frueheren ` +
      `Schluessel sind damit ungueltig.`,
  );
  return { name, value, source: "generated", filePath };
}

/**
 * Stellt alle Geheimnisse des Backends bereit und schreibt sie in die
 * Prozessumgebung. Idempotent: Ein zweiter Aufruf findet die Werte bereits
 * in der Umgebung und ändert nichts.
 */
export function ensureBackendSecrets(
  options: EnsureSecretsOptions = {},
): EnsuredSecret[] {
  const env = options.env ?? process.env;
  const secrets = [
    ensureSecret("JWT_SECRET", JWT_SECRET_FILE, options),
    // Der Print-Worker laeuft in einem eigenen Container ohne Zugriff auf
    // diese Prozessumgebung. Er liest dieselbe Datei ueber dasselbe Volume,
    // siehe `apps/print-worker/src/token.ts`.
    ensureSecret("PRINT_WORKER_TOKEN", PRINT_WORKER_TOKEN_FILE, options),
  ];
  for (const secret of secrets) {
    env[secret.name] = secret.value;
  }
  return secrets;
}

/**
 * Liefert den Signaturschlüssel oder bricht den Start ab. Es gibt bewusst
 * KEINEN Rückfallwert mehr (#175): Fehlt der Schlüssel hier noch, ist etwas
 * an der Inbetriebnahme falsch. Ein stiller Rückfall auf einen festen Wert
 * hätte genau die Lücke offen gehalten, die dieses Issue schliesst.
 */
export function requireJwtSecret(env: NodeJS.ProcessEnv = process.env): string {
  const value = (env.JWT_SECRET ?? "").trim();
  if (value.length === 0) {
    throw new Error(
      "JWT_SECRET ist nicht gesetzt. Der Schluessel wird beim ersten Start selbst erzeugt " +
        "(apps/backend/docker-entrypoint.sh bzw. ensureBackendSecrets() in main.ts, #175) und " +
        "unter STATE_DIR abgelegt. Ein Start ohne Schluessel ist ein Fehler und kein Rueckfall " +
        "auf einen Vorgabewert.",
    );
  }
  return value;
}
