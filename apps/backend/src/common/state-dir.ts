import * as fs from "fs";
import * as path from "path";

/**
 * Wo der Zustand ausserhalb der Datenbank liegt (#67, #175).
 *
 * `STATE_DIR` gewinnt immer und ist im Festbetrieb gesetzt
 * (`docker-compose.yml`, `/app/state` auf einem eigenen Volume). Diese Datei
 * regelt nur den Fall, dass die Variable FEHLT — also jeden Start ausserhalb
 * von Docker.
 *
 * ## Warum nicht `process.cwd()`
 *
 * Die frühere Vorgabe `<cwd>/state` war ein Fehler mit Folgen: `pnpm dev`
 * ruft `pnpm -r run dev` auf, und jedes Paket startet mit seinem EIGENEN
 * Verzeichnis als Arbeitsverzeichnis. Das Backend legte das Worker-Token
 * damit unter `apps/backend/state/` ab, während der Print-Worker es unter
 * `apps/print-worker/state/` suchte — eine Datei, die dort nie entsteht. Ein
 * und dieselbe Regel lieferte je nach Prozess ein anderes Ergebnis.
 *
 * ## Die Regel stattdessen: die Wurzel des Arbeitsbereichs
 *
 * Gesucht wird vom Ort DIESER DATEI aus aufwärts das erste Verzeichnis mit
 * `pnpm-workspace.yaml`. Der Ort dieser Datei hängt nicht davon ab, wer den
 * Prozess mit welchem Arbeitsverzeichnis gestartet hat — dieselbe Regel
 * liefert deshalb in jedem Prozess dasselbe Verzeichnis. Der Print-Worker
 * wendet in `apps/print-worker/src/state-dir.ts` wortgleich dieselbe Regel
 * an; beide Seiten sind über je einen Test auf denselben absoluten Pfad
 * festgenagelt (siehe `state-dir.spec.ts` hier und dort).
 *
 * Bewusst KEIN gemeinsames Paket für diese zehn Zeilen: Der Print-Worker
 * hängt heute von nichts aus `packages/` ab. Eine Abhängigkeit auf
 * `@vereinorder/shared` zöge eine Änderung an seinem Dockerfile und an
 * `pnpm-lock.yaml` nach sich — beides Fläche, die in einer Sicherheitsbehebung
 * nichts zu suchen hat. Der Grund für den ursprünglichen Fehler war nicht die
 * Doppelung, sondern die Abhängigkeit vom Arbeitsverzeichnis: Eine Regel, die
 * denselben festen Punkt sucht, kann nicht zwei Ergebnisse liefern.
 *
 * Wird die Wurzel nicht gefunden (ausgepacktes Abbild ohne
 * `pnpm-workspace.yaml`, Einzeldatei-Ausführung), bleibt es beim alten
 * `<cwd>/state`. Das ist der letzte Notnagel und im Betrieb nie der Fall,
 * weil dort `STATE_DIR` gesetzt ist.
 */

/** Kennzeichen der Arbeitsbereichswurzel, identisch im Print-Worker. */
const WORKSPACE_MARKER = "pnpm-workspace.yaml";

/** Verzeichnisname unterhalb der Wurzel, identisch im Print-Worker. */
const STATE_DIR_NAME = "state";

export function findWorkspaceRoot(startDir: string = __dirname): string | null {
  let current = path.resolve(startDir);
  for (;;) {
    if (fs.existsSync(path.join(current, WORKSPACE_MARKER))) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

export function resolveStateDir(env: NodeJS.ProcessEnv = process.env): string {
  const configured = (env.STATE_DIR ?? "").trim();
  if (configured.length > 0) return configured;

  const root = findWorkspaceRoot();
  return root === null
    ? path.join(process.cwd(), STATE_DIR_NAME)
    : path.join(root, STATE_DIR_NAME);
}
