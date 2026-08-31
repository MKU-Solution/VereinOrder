import * as fs from "fs";
import * as path from "path";
import { resolveStateDir } from "./state-dir";

/**
 * Herkunft des Worker-Tokens (#175).
 *
 * Der Worker läuft in einem EIGENEN Container. Das Backend erzeugt das
 * Token beim ersten Start unter `STATE_DIR` (siehe
 * `apps/backend/src/secrets/ensure-secrets.ts`); der Worker bekommt
 * dasselbe Volume lesend eingehängt (`docker-compose.yml`) und liest die
 * Datei hier. Es gibt bewusst keinen zweiten Erzeugungsweg: Zwei
 * unabhängig erzeugte Token wären zwei verschiedene Token, und
 * `apps/backend/src/print-jobs/print-worker.guard.ts` würde jede Anfrage
 * ablehnen.
 *
 * Rangfolge wie im Backend: eine gesetzte Umgebungsvariable gewinnt, sonst
 * die Datei unter dem Zustandsverzeichnis aus `state-dir.ts`.
 */

/** Dateiname unter `STATE_DIR`, identisch mit `PRINT_WORKER_TOKEN_FILE` im Backend. */
export const PRINT_WORKER_TOKEN_FILE = "print-worker-token";

/** Mindestlänge, die `print-worker.guard.ts` backendseitig ebenfalls verlangt. */
export const MIN_TOKEN_LENGTH = 32;

/**
 * Wie lange auf die Tokendatei gewartet wird, bevor der Prozess mit
 * Fehlerstatus endet. Siehe {@link waitForWorkerToken} für die Begründung
 * dieses Wertes.
 */
export const TOKEN_WAIT_TIMEOUT_MS = 60_000;

/** Abstand zwischen zwei Leseversuchen während des Wartens. */
export const TOKEN_WAIT_INTERVAL_MS = 1_000;

export function resolveWorkerToken(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const fromEnv = (env.PRINT_WORKER_TOKEN ?? "").trim();
  if (fromEnv.length > 0) return fromEnv;

  const stateDir = resolveStateDir(env);
  let raw: string;
  try {
    raw = fs.readFileSync(
      path.join(stateDir, PRINT_WORKER_TOKEN_FILE),
      "utf-8",
    );
  } catch {
    return null;
  }
  const value = raw.trim();
  return value.length > 0 ? value : null;
}

export interface WaitForWorkerTokenOptions {
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  intervalMs?: number;
  /** Wird genau einmal aufgerufen, wenn tatsächlich gewartet werden muss. */
  onWait?: () => void;
  /** Nur für Tests austauschbar. */
  sleep?: (ms: number) => Promise<void>;
  /** Nur für Tests austauschbar. */
  now?: () => number;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wartet begrenzt auf das Token und liefert `null`, wenn es bis zum Ablauf
 * nicht auftaucht. Der Aufrufer beendet den Prozess dann mit Fehlerstatus.
 *
 * ## Warum überhaupt gewartet wird
 *
 * Backend und Worker starten gleichzeitig; erzeugt wird das Token vom
 * Backend. Der Worker verliert dieses Rennen regelmässig. Im Container ist
 * das folgenlos, weil `restart: always` ihn erneut anlaufen lässt — aber
 * ausserhalb von Docker gibt es keinen Aufseher: Unter `pnpm dev`
 * (`pnpm -r run dev`, der in CONTRIBUTING.md dokumentierte
 * Entwicklungsbefehl) würde ein sofortiger Abbruch den Worker endgültig
 * beenden und den gesamten Aufruf scheitern lassen. Ein begrenztes Warten
 * überbrückt genau die Sekunden, die das Backend zum Übersetzen und
 * Schreiben braucht.
 *
 * ## Warum begrenzt und nicht endlos
 *
 * Die Vorgabe aus #175 lautet: kein tokenloses Weiterlaufen und kein
 * stilles Hängen. Beides ist eingehalten — es wird nie ohne Token
 * gearbeitet, das Warten wird protokolliert (`onWait`), und es endet nach
 * {@link TOKEN_WAIT_TIMEOUT_MS} mit Fehlerstatus. Eine Minute ist so
 * bemessen, dass sie einen langsamen Backend-Start überbrückt, ein
 * dauerhaft fehlendes Token aber innerhalb einer Minute sichtbar macht.
 *
 * Ein Wert aus der Umgebung wird SOFORT zurückgegeben, auch ein zu kurzer:
 * Warten würde daran nichts ändern, und der Aufrufer soll den Fehler
 * unverzüglich melden.
 */
export async function waitForWorkerToken(
  options: WaitForWorkerTokenOptions = {},
): Promise<string | null> {
  const env = options.env ?? process.env;
  const timeoutMs = options.timeoutMs ?? TOKEN_WAIT_TIMEOUT_MS;
  const intervalMs = options.intervalMs ?? TOKEN_WAIT_INTERVAL_MS;
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? (() => Date.now());

  const deadline = now() + timeoutMs;
  let announced = false;
  for (;;) {
    const token = resolveWorkerToken(env);
    if (token !== null) return token;
    if (now() >= deadline) return null;
    if (!announced) {
      announced = true;
      options.onWait?.();
    }
    await sleep(intervalMs);
  }
}
