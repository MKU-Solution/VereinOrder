import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  MIN_TOKEN_LENGTH,
  PRINT_WORKER_TOKEN_FILE,
  resolveWorkerToken,
  waitForWorkerToken,
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

  describe("begrenztes Warten auf die Tokendatei", () => {
    /** Vergehende Zeit ohne echtes Warten. */
    function uhr(schrittMs: number) {
      let jetzt = 0;
      return {
        now: () => jetzt,
        sleep: async (ms: number) => {
          jetzt += ms === 0 ? schrittMs : ms;
        },
      };
    }

    it("liefert das Token sofort, sobald es da ist", async () => {
      const token = "c".repeat(64);
      writeToken(token);

      await expect(
        waitForWorkerToken({ env: { STATE_DIR: stateDir }, ...uhr(1000) }),
      ).resolves.toBe(token);
    });

    it("wartet, bis das Backend die Datei geschrieben hat", async () => {
      // Der Regelfall: Backend und Worker starten gleichzeitig, erzeugt wird
      // das Token vom Backend. Ohne dieses Warten beendet sich der Worker
      // unter "pnpm dev" endgueltig, weil dort kein "restart: always" ihn
      // erneut anlaufen laesst.
      const token = "d".repeat(64);
      let versuche = 0;
      const ergebnis = await waitForWorkerToken({
        env: { STATE_DIR: stateDir },
        timeoutMs: 10_000,
        intervalMs: 1_000,
        now: () => versuche * 1_000,
        sleep: async () => {
          versuche += 1;
          if (versuche === 3) writeToken(token);
        },
      });

      expect(ergebnis).toBe(token);
      expect(versuche).toBe(3);
    });

    it("meldet das Warten genau einmal", async () => {
      const token = "e".repeat(64);
      let gemeldet = 0;
      let versuche = 0;
      await waitForWorkerToken({
        env: { STATE_DIR: stateDir },
        timeoutMs: 10_000,
        now: () => versuche * 1_000,
        sleep: async () => {
          versuche += 1;
          if (versuche === 4) writeToken(token);
        },
        onWait: () => {
          gemeldet += 1;
        },
      });

      expect(gemeldet).toBe(1);
    });

    it("gibt nach Ablauf auf, statt still endlos zu warten", async () => {
      let versuche = 0;
      const ergebnis = await waitForWorkerToken({
        env: { STATE_DIR: stateDir },
        timeoutMs: 5_000,
        now: () => versuche * 1_000,
        sleep: async () => {
          versuche += 1;
        },
      });

      expect(ergebnis).toBeNull();
      // Aufgegeben, nicht ewig weitergelaufen.
      expect(versuche).toBe(5);
    });

    it("wartet nicht auf einen Wert aus der Umgebung", async () => {
      // Auch ein zu kurzer Wert kommt sofort zurueck: Warten wuerde daran
      // nichts aendern, der Aufrufer soll den Fehler unverzueglich melden.
      let geschlafen = 0;
      await expect(
        waitForWorkerToken({
          env: { PRINT_WORKER_TOKEN: "zu-kurz", STATE_DIR: stateDir },
          sleep: async () => {
            geschlafen += 1;
          },
        }),
      ).resolves.toBe("zu-kurz");
      expect(geschlafen).toBe(0);
    });
  });
});
