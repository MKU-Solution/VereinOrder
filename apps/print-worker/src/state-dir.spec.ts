import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { findWorkspaceRoot, resolveStateDir } from "./state-dir";

/**
 * Gegenstück zu `apps/backend/src/common/state-dir.spec.ts` (#175).
 *
 * Beide Dateien leiten die Erwartung UNABHÄNGIG von der jeweiligen
 * Implementierung her — sie suchen selbst nach `pnpm-workspace.yaml` — und
 * prüfen damit denselben absoluten Pfad. Ändert jemand nur eine der beiden
 * Seiten, fällt deren Test um, und die Ablage kann nicht wieder
 * auseinanderlaufen.
 */
function erwarteteWurzel(): string {
  let current = __dirname;
  for (;;) {
    if (fs.existsSync(path.join(current, "pnpm-workspace.yaml")))
      return current;
    const parent = path.dirname(current);
    if (parent === current)
      throw new Error("Arbeitsbereichswurzel nicht gefunden");
    current = parent;
  }
}

describe("Zustandsverzeichnis des Print-Workers (Issue #175)", () => {
  it("gibt einer gesetzten Variablen STATE_DIR den Vorrang", () => {
    // Im Festbetrieb gesetzt (docker-compose.yml, /app/state, nur lesend).
    expect(resolveStateDir({ STATE_DIR: "/app/state" })).toBe("/app/state");
  });

  it("liegt ohne STATE_DIR in derselben Wurzel wie beim Backend", () => {
    expect(resolveStateDir({})).toBe(path.join(erwarteteWurzel(), "state"));
  });

  it("hängt NICHT vom Arbeitsverzeichnis ab", () => {
    // Der eigentliche Defekt: Unter "pnpm dev" lief dieser Prozess mit
    // apps/print-worker als Arbeitsverzeichnis, das Backend mit
    // apps/backend - die Tokendatei entstand nie dort, wo gesucht wurde.
    const original = process.cwd();
    const anderswo = fs.mkdtempSync(path.join(os.tmpdir(), "vereinorder-cwd-"));
    try {
      const ausRepo = resolveStateDir({});
      process.chdir(anderswo);
      expect(resolveStateDir({})).toBe(ausRepo);
    } finally {
      process.chdir(original);
      fs.rmSync(anderswo, { recursive: true, force: true });
    }
  });

  it("liefert null, wenn oberhalb keine Arbeitsbereichswurzel liegt", () => {
    const fremd = fs.mkdtempSync(path.join(os.tmpdir(), "vereinorder-fremd-"));
    try {
      expect(findWorkspaceRoot(fremd)).toBeNull();
    } finally {
      fs.rmSync(fremd, { recursive: true, force: true });
    }
  });
});
