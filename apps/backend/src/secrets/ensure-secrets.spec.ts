import { JwtService } from "@nestjs/jwt";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { resolveStateDir } from "../common/state-dir";
import {
  ensureBackendSecrets,
  ensureSecret,
  JWT_SECRET_FILE,
  PRINT_WORKER_TOKEN_FILE,
  requireJwtSecret,
} from "./ensure-secrets";

/**
 * Vorgehen wie in `maintenance-state.service.spec.ts`: ein temporäres
 * `STATE_DIR` je Test. Ein zweiter Aufruf mit leerer Umgebung steht für
 * einen zweiten Start des Containers gegen dasselbe Volume.
 */
describe("Sicherheitsgeheimnisse beim ersten Start (Issue #175)", () => {
  let stateDir: string;
  let env: NodeJS.ProcessEnv;
  const logged: string[] = [];
  const log = (message: string) => {
    logged.push(message);
  };

  beforeEach(() => {
    stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "vereinorder-secrets-"));
    env = {};
    logged.length = 0;
  });

  afterEach(() => {
    fs.rmSync(stateDir, { recursive: true, force: true });
  });

  it("erzeugt einen Schlüssel, wenn weder Variable noch Datei vorhanden sind", () => {
    const result = ensureSecret("JWT_SECRET", JWT_SECRET_FILE, {
      stateDir,
      env,
      log,
    });

    expect(result.source).toBe("generated");
    // 32 Zufallsbytes, hexadezimal also 64 Zeichen.
    expect(result.value).toMatch(/^[0-9a-f]{64}$/);
    expect(fs.readFileSync(path.join(stateDir, JWT_SECRET_FILE), "utf-8")).toBe(
      result.value,
    );
  });

  it("hält im Protokoll fest, DASS erzeugt wurde, nicht welchen Wert", () => {
    const result = ensureSecret("JWT_SECRET", JWT_SECRET_FILE, {
      stateDir,
      env,
      log,
    });

    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain("JWT_SECRET");
    expect(logged[0]).toContain("erzeugt");
    expect(logged.join("\n")).not.toContain(result.value);
  });

  it("verwendet beim zweiten Start denselben Schlüssel wieder", () => {
    const first = ensureSecret("JWT_SECRET", JWT_SECRET_FILE, {
      stateDir,
      env,
      log,
    });
    // Zweiter Start: neuer Prozess, leere Umgebung, dasselbe Volume.
    const second = ensureSecret("JWT_SECRET", JWT_SECRET_FILE, {
      stateDir,
      env: {},
      log,
    });

    expect(second.source).toBe("file");
    expect(second.value).toBe(first.value);
    // Nur der erste Start meldet eine Erzeugung.
    expect(logged).toHaveLength(1);
  });

  it("hält ein vor dem Neustart ausgestelltes Token gültig — die eigentliche Zusage", async () => {
    const first = ensureSecret("JWT_SECRET", JWT_SECRET_FILE, {
      stateDir,
      env,
      log,
    });
    const token = await new JwtService({ secret: first.value }).signAsync({
      sub: "admin-1",
      username: "admin",
      role: "ADMINISTRATOR",
    });

    const second = ensureSecret("JWT_SECRET", JWT_SECRET_FILE, {
      stateDir,
      env: {},
      log,
    });
    const payload = await new JwtService({
      secret: second.value,
    }).verifyAsync(token);

    expect(payload.username).toBe("admin");
  });

  it("gibt einer gesetzten Umgebungsvariablen den Vorrang und legt keine Datei an", () => {
    const result = ensureSecret("JWT_SECRET", JWT_SECRET_FILE, {
      stateDir,
      env: { JWT_SECRET: "von-aussen-verwaltet" },
      log,
    });

    expect(result.source).toBe("env");
    expect(result.value).toBe("von-aussen-verwaltet");
    expect(fs.existsSync(path.join(stateDir, JWT_SECRET_FILE))).toBe(false);
    expect(logged).toHaveLength(0);
  });

  it("übergeht eine vorhandene Datei, wenn die Umgebungsvariable gesetzt ist", () => {
    const generated = ensureSecret("JWT_SECRET", JWT_SECRET_FILE, {
      stateDir,
      env,
      log,
    });
    const result = ensureSecret("JWT_SECRET", JWT_SECRET_FILE, {
      stateDir,
      env: { JWT_SECRET: "gewinnt" },
      log,
    });

    expect(result.value).toBe("gewinnt");
    expect(result.value).not.toBe(generated.value);
  });

  it("behandelt eine leere Umgebungsvariable wie eine fehlende", () => {
    // docker-compose.yml reicht `${JWT_SECRET:-}` als leere Zeichenkette in
    // den Container, wenn in der .env nichts steht.
    const result = ensureSecret("JWT_SECRET", JWT_SECRET_FILE, {
      stateDir,
      env: { JWT_SECRET: "   " },
      log,
    });

    expect(result.source).toBe("generated");
  });

  it("erzeugt neu, wenn die Datei leer ist", () => {
    fs.writeFileSync(path.join(stateDir, JWT_SECRET_FILE), "\n", "utf-8");
    const result = ensureSecret("JWT_SECRET", JWT_SECRET_FILE, {
      stateDir,
      env,
      log,
    });

    expect(result.source).toBe("generated");
    expect(result.value).toMatch(/^[0-9a-f]{64}$/);
  });

  const itPosix = process.platform === "win32" ? it.skip : it;
  itPosix("schreibt die Datei mit Dateirechten 0600", () => {
    // Unter Windows ist `chmod` wirkungslos; der Festbetrieb läuft unter
    // Linux im Container, dort greift die Prüfung.
    ensureSecret("JWT_SECRET", JWT_SECRET_FILE, { stateDir, env, log });
    const mode = fs.statSync(path.join(stateDir, JWT_SECRET_FILE)).mode;

    expect(mode & 0o777).toBe(0o600);
  });

  itPosix(
    "hinterlässt keine temporäre Datei aus dem atomaren Schreiben",
    () => {
      ensureSecret("JWT_SECRET", JWT_SECRET_FILE, { stateDir, env, log });

      expect(fs.readdirSync(stateDir)).toEqual([JWT_SECRET_FILE]);
    },
  );

  it("stellt beide Geheimnisse bereit und schreibt sie in die Prozessumgebung", () => {
    const secrets = ensureBackendSecrets({ stateDir, env, log });

    expect(secrets.map((s) => s.name)).toEqual([
      "JWT_SECRET",
      "PRINT_WORKER_TOKEN",
    ]);
    expect(env.JWT_SECRET).toBe(secrets[0].value);
    expect(env.PRINT_WORKER_TOKEN).toBe(secrets[1].value);
    expect(env.JWT_SECRET).not.toBe(env.PRINT_WORKER_TOKEN);
    expect(fs.existsSync(path.join(stateDir, PRINT_WORKER_TOKEN_FILE))).toBe(
      true,
    );
  });

  it("erzeugt ein Worker-Token, das die Mindestlänge des Guards erfüllt", () => {
    // apps/backend/src/print-jobs/print-worker.guard.ts:14 weist Werte unter
    // 32 Zeichen ab, apps/print-worker/src/index.ts ebenso.
    const [, token] = ensureBackendSecrets({ stateDir, env, log });

    expect(token.value.length).toBeGreaterThanOrEqual(32);
  });

  it("nimmt den Ablageort aus common/state-dir.ts", () => {
    // Die Vorgabe selbst ist dort geprueft (state-dir.spec.ts). Hier zaehlt
    // nur, dass diese Stelle sie tatsaechlich verwendet und nicht wieder
    // eine eigene bildet. Bewusst mit gesetzter Umgebungsvariablen: dann
    // gewinnt sie, es wird KEINE Datei geschrieben - der Test darf im
    // echten Zustandsverzeichnis des Arbeitsbereichs nichts hinterlassen -,
    // und `filePath` zeigt trotzdem den aufgeloesten Ablageort.
    const result = ensureSecret("JWT_SECRET", JWT_SECRET_FILE, {
      env: { JWT_SECRET: "von-aussen" },
      log,
    });

    expect(result.source).toBe("env");
    expect(path.dirname(result.filePath)).toBe(resolveStateDir({}));
    expect(fs.existsSync(result.filePath)).toBe(false);
  });
});

describe("requireJwtSecret (Issue #175)", () => {
  it("liefert den gesetzten Schlüssel", () => {
    expect(requireJwtSecret({ JWT_SECRET: "abc" })).toBe("abc");
  });

  it("wirft statt still auf einen Vorgabewert zurückzufallen", () => {
    // Der Rueckfall auf "changeme-in-production" ist ersatzlos entfallen.
    expect(() => requireJwtSecret({})).toThrow(/JWT_SECRET ist nicht gesetzt/);
    expect(() => requireJwtSecret({ JWT_SECRET: "" })).toThrow();
  });
});

/**
 * Diese Prüfung ist der Grund, warum `main.ts` `AppModule` per `require()`
 * lädt. Ein statischer `import` würde hochgezogen und liefe VOR
 * `ensureBackendSecrets()`; `auth.module.ts` und `maintenance.module.ts`
 * lesen `JWT_SECRET` beim Laden des Moduls, der Start bräche dann mit
 * "JWT_SECRET ist nicht gesetzt" ab — und zwar nur ohne gesetzte Variable,
 * also genau im Fall, den #175 reparieren soll. Eine Umsortierung der
 * Importe durch einen Menschen oder eine Lint-Regel darf das nicht still
 * kippen.
 */
describe("Ladereihenfolge in main.ts (Issue #175)", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "main.ts"),
    "utf-8",
  );

  it("importiert app.module nicht statisch", () => {
    expect(source).not.toMatch(/^\s*import\s[^;]*["']\.\/app\.module["']/m);
  });

  it("ruft ensureBackendSecrets vor dem Laden von app.module auf", () => {
    const ensureAt = source.indexOf("ensureBackendSecrets()");
    const requireAt = source.indexOf('require("./app.module")');

    expect(ensureAt).toBeGreaterThan(-1);
    expect(requireAt).toBeGreaterThan(-1);
    expect(ensureAt).toBeLessThan(requireAt);
  });
});
