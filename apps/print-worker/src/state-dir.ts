import * as fs from "fs";
import * as path from "path";

/**
 * Wo der Zustand ausserhalb der Datenbank liegt — Sicht des Print-Workers
 * (#175).
 *
 * WORTGLEICH zu `apps/backend/src/common/state-dir.ts`. Die ausführliche
 * Begründung steht dort; hier das Wesentliche:
 *
 * `STATE_DIR` gewinnt und ist im Festbetrieb gesetzt (`docker-compose.yml`,
 * `/app/state`, nur lesend eingehängt). Fehlt die Variable — jeder Start
 * ausserhalb von Docker, insbesondere `pnpm dev` —, gilt die Wurzel des
 * Arbeitsbereichs, gesucht vom Ort DIESER DATEI aus aufwärts.
 *
 * Die frühere Vorgabe `<cwd>/state` war der Fehler: `pnpm -r run dev` startet
 * jedes Paket mit seinem eigenen Verzeichnis, das Backend schrieb also nach
 * `apps/backend/state/` und dieser Prozess suchte in `apps/print-worker/state/`.
 * Eine Regel, die einen festen Punkt sucht statt des Arbeitsverzeichnisses,
 * kann diese zwei Ergebnisse nicht mehr liefern.
 *
 * `state-dir.spec.ts` nagelt beide Seiten auf denselben absoluten Pfad fest;
 * der Test leitet die Erwartung unabhängig von dieser Datei her, damit eine
 * einseitige Änderung auffliegt.
 */

/** Kennzeichen der Arbeitsbereichswurzel, identisch im Backend. */
const WORKSPACE_MARKER = "pnpm-workspace.yaml";

/** Verzeichnisname unterhalb der Wurzel, identisch im Backend. */
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
