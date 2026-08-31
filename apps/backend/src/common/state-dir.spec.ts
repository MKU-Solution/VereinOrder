import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { findWorkspaceRoot, resolveStateDir } from "./state-dir";

/**
 * Diese Datei und ihr Gegenstück `apps/print-worker/src/state-dir.spec.ts`
 * nageln BEIDE Seiten auf denselben absoluten Pfad fest (#175).
 *
 * Die Erwartung wird hier unabhängig von `state-dir.ts` hergeleitet: Der
 * Test sucht selbst nach `pnpm-workspace.yaml`. Ändert jemand nur eine der
 * beiden Implementierungen, weicht sie von dieser unabhängig gebildeten
 * Erwartung ab und der Test der betroffenen Seite fällt um. Genau das ist
 * die Zusage — vorher lieferte `<cwd>/state` je nach Prozess ein anderes
 * Verzeichnis, und das Worker-Token landete unter `apps/backend/state/`,
 * während der Print-Worker es unter `apps/print-worker/state/` suchte.
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

describe("Zustandsverzeichnis (Issue #175)", () => {
  it("gibt einer gesetzten Variablen STATE_DIR den Vorrang", () => {
    // Im Festbetrieb gesetzt (docker-compose.yml, /app/state). Dieser Fall
    // darf sich durch die neue Vorgabe nicht ändern.
    expect(resolveStateDir({ STATE_DIR: "/app/state" })).toBe("/app/state");
  });

  it("behandelt eine leere Variable wie eine fehlende", () => {
    expect(resolveStateDir({ STATE_DIR: "  " })).toBe(
      path.join(erwarteteWurzel(), "state"),
    );
  });

  it("liegt ohne STATE_DIR in der Wurzel des Arbeitsbereichs", () => {
    expect(resolveStateDir({})).toBe(path.join(erwarteteWurzel(), "state"));
  });

  it("hängt NICHT vom Arbeitsverzeichnis ab", () => {
    // Der eigentliche Defekt: "pnpm -r run dev" startet jedes Paket mit
    // seinem eigenen Verzeichnis. Zwei Prozesse mit verschiedenen
    // Arbeitsverzeichnissen müssen dasselbe Zustandsverzeichnis sehen.
    const original = process.cwd();
    const anderswo = fs.mkdtempSync(path.join(os.tmpdir(), "vereinorder-cwd-"));
    try {
      const ausRepo = resolveStateDir({});
      process.chdir(anderswo);
      const ausTemp = resolveStateDir({});
      expect(ausTemp).toBe(ausRepo);
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
