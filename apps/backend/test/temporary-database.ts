import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { buildPostgreSqlConnectionEnvironment } from "../src/backup/postgresql-backup.tools";
import { assertTestDatabaseUrl } from "./test-database";

const TEST_CONFIRMATION = "VEREINORDER_TEST_ONLY";
const REPOSITORY_ROOT = path.resolve(__dirname, "..", "..", "..");

/**
 * Wegwerfdatenbank fuer Integrationstests, die eine LEERE Benutzertabelle
 * brauchen (Issue #173, Ersteinrichtung).
 *
 * Warum nicht die gemeinsame Integrationsdatenbank leeren: Die Ersteinrichtung
 * ist genau dann erreichbar, wenn `User` leer ist. Ein Test, der das im
 * gemeinsamen Bestand herstellt, muesste dort alle Benutzer loeschen - und
 * damit die Voraussetzungen jedes anderen Integrationstests, der einen
 * Benutzer angelegt hat. `value-voucher-concurrency.integration-spec.ts` und
 * `inventory-stock-concurrency.integration-spec.ts` loesen dasselbe Problem
 * seit Issue #139 bzw. #141 auf demselben Weg; dieser Baustein fasst die
 * dortigen Hilfsfunktionen zusammen, damit sie fuer #173 nicht ein drittes
 * und viertes Mal abgeschrieben werden.
 *
 * Der Name der Zieldatenbank wird VOR jedem Zugriff durch
 * `assertTestDatabaseUrl` gefuehrt: nur lokale Rechner, nur Namen, die sich
 * eindeutig als Testdatenbank lesen, und nur mit gesetztem
 * `TEST_DATABASE_CONFIRMATION`. Das ist die unverhandelbare Projektregel fuer
 * zerstoerende Datenbanktests, nicht eine Vorsichtsmassnahme dieses Moduls.
 */
export class TemporaryDatabase {
  readonly url: string;

  private constructor(
    readonly name: string,
    private readonly controlUrl: string,
  ) {
    const target = new URL(controlUrl);
    target.pathname = `/${name}`;
    this.url = target.toString();
  }

  static forName(name: string): TemporaryDatabase {
    const controlUrl = process.env.DATABASE_URL;
    if (!controlUrl) {
      throw new Error("DATABASE_URL fehlt fuer den Integrationstest.");
    }
    const database = new TemporaryDatabase(name, controlUrl);
    const guarded = assertTestDatabaseUrl(database.url, TEST_CONFIRMATION);
    if (guarded.database !== name) {
      throw new Error(
        `Der Waechter hat einen anderen Datenbanknamen gelesen: ${guarded.database}`,
      );
    }
    return database;
  }

  /** Legt die Datenbank neu an (vorhandene wird vorher entfernt) und migriert sie. */
  async create(): Promise<void> {
    await this.drop();
    await this.psql("postgres", [
      `CREATE DATABASE "${this.name}" TEMPLATE template0`,
    ]);
    await this.migrate();
  }

  async drop(): Promise<void> {
    await this.psql("postgres", [
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${this.name}' AND pid <> pg_backend_pid()`,
      `DROP DATABASE IF EXISTS "${this.name}"`,
    ]);
  }

  /** Namen aller uebrig gebliebenen Wegwerfdatenbanken - fuer die Endkontrolle. */
  async leftovers(): Promise<string[]> {
    const output = await this.psql("postgres", [
      "SELECT datname FROM pg_database WHERE datname LIKE 'vereinorder_ci_test_%' ORDER BY datname",
    ]);
    return output.split(/\r?\n/).filter(Boolean);
  }

  private async migrate(): Promise<void> {
    const executable = path.join(
      REPOSITORY_ROOT,
      "node_modules",
      ".pnpm",
      "prisma@5.22.0",
      "node_modules",
      "prisma",
      "build",
      "index.js",
    );
    if (!fs.existsSync(executable)) {
      throw new Error("Lokales Prisma-Binary fuer den Integrationstest fehlt.");
    }
    await run(
      process.execPath,
      [
        executable,
        "migrate",
        "deploy",
        "--schema",
        path.join(
          REPOSITORY_ROOT,
          "packages",
          "database",
          "prisma",
          "schema.prisma",
        ),
      ],
      { ...process.env, DATABASE_URL: this.url },
    );
  }

  private psql(database: string, commands: string[]): Promise<string> {
    const connection = buildPostgreSqlConnectionEnvironment(this.controlUrl);
    const executable =
      process.platform === "win32" &&
      fs.existsSync("C:\\Program Files\\PostgreSQL\\18\\bin\\psql.exe")
        ? "C:\\Program Files\\PostgreSQL\\18\\bin\\psql.exe"
        : "psql";
    return run(
      executable,
      [
        "--no-psqlrc",
        "--set=ON_ERROR_STOP=1",
        "--tuples-only",
        "--no-align",
        ...commands.map((command) => `--command=${command}`),
      ],
      { ...connection.environment, PGDATABASE: database },
    );
  }
}

function run(
  executable: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: REPOSITORY_ROOT,
      env,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.once("error", reject);
    child.once("close", (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `${path.basename(executable)} endete mit ${code}: ${Buffer.concat(
              stderr,
            )
              .toString("utf8")
              .trim()}`,
          ),
        );
        return;
      }
      resolve(Buffer.concat(stdout).toString("utf8").trim());
    });
  });
}
