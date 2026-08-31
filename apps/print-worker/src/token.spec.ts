import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  MIN_TOKEN_LENGTH,
  PRINT_WORKER_TOKEN_FILE,
  resolveWorkerToken,
} from "./token";

describe("Herkunft des Worker-Tokens (Issue #175)", () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "vereinorder-worker-"));
  });

  afterEach(() => {
    fs.rmSync(stateDir, { recursive: true, force: true });
  });

  function writeToken(value: string) {
    fs.writeFileSync(
      path.join(stateDir, PRINT_WORKER_TOKEN_FILE),
      value,
      "utf-8",
    );
  }

  it("gibt der gesetzten Umgebungsvariablen den Vorrang", () => {
    writeToken("aus-der-datei");

    expect(
      resolveWorkerToken({
        PRINT_WORKER_TOKEN: "aus-der-umgebung",
        STATE_DIR: stateDir,
      }),
    ).toBe("aus-der-umgebung");
  });

  it("liest das vom Backend erzeugte Token aus STATE_DIR", () => {
    const token = "a".repeat(64);
    writeToken(`${token}\n`);

    expect(resolveWorkerToken({ STATE_DIR: stateDir })).toBe(token);
  });

  it("behandelt eine leere Umgebungsvariable wie eine fehlende", () => {
    // docker-compose.yml reicht `${PRINT_WORKER_TOKEN:-}` leer durch.
    const token = "b".repeat(64);
    writeToken(token);

    expect(
      resolveWorkerToken({ PRINT_WORKER_TOKEN: "", STATE_DIR: stateDir }),
    ).toBe(token);
  });

  it("liefert null, wenn die Datei noch fehlt", () => {
    // Der Regelfall, wenn der Worker vor dem Backend startet. index.ts
    // beendet den Prozess dann mit Fehlerstatus, statt tokenlos
    // weiterzulaufen.
    expect(resolveWorkerToken({ STATE_DIR: stateDir })).toBeNull();
  });

  it("liefert null bei leerer Datei", () => {
    writeToken("   \n");

    expect(resolveWorkerToken({ STATE_DIR: stateDir })).toBeNull();
  });

  it("verlangt dieselbe Mindestlänge wie der Guard im Backend", () => {
    // apps/backend/src/print-jobs/print-worker.guard.ts:14
    expect(MIN_TOKEN_LENGTH).toBe(32);
  });
});
