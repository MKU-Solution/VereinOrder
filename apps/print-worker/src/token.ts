import * as fs from "fs";
import * as path from "path";

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
 * die Datei. Fehlt beides, liefert diese Funktion `null` — der Aufrufer in
 * `index.ts` beendet den Prozess dann mit Fehlerstatus. Genau dieser Fall
 * tritt regelmässig auf, wenn der Worker VOR dem Backend startet und die
 * Datei noch nicht existiert; `restart: always` lässt ihn erneut anlaufen.
 */

/** Dateiname unter `STATE_DIR`, identisch mit `PRINT_WORKER_TOKEN_FILE` im Backend. */
export const PRINT_WORKER_TOKEN_FILE = "print-worker-token";

/** Mindestlänge, die `print-worker.guard.ts` backendseitig ebenfalls verlangt. */
export const MIN_TOKEN_LENGTH = 32;

export function resolveWorkerToken(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const fromEnv = (env.PRINT_WORKER_TOKEN ?? "").trim();
  if (fromEnv.length > 0) return fromEnv;

  const stateDir = env.STATE_DIR || path.join(process.cwd(), "state");
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
