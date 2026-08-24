import { Injectable } from "@nestjs/common";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import * as path from "node:path";

const MAX_TOOL_OUTPUT_BYTES = 1024 * 1024;
const VERSION_TIMEOUT_MS = 30_000;
const VERIFY_TIMEOUT_MS = 60_000;
const DUMP_TIMEOUT_MS = 15 * 60_000;
const RESTORE_TIMEOUT_MS = 30 * 60_000;
const MIGRATION_TIMEOUT_MS = 30 * 60_000;
const DATABASE_ADMIN_TIMEOUT_MS = 60_000;
const SAFE_GENERATED_DATABASE_NAME = /^vereinorder_restorecheck_[a-f0-9]{16}$/;
const SAFE_RESTORE_SWAP_ARTIFACT_NAME =
  /^vereinorder_(?:restore|pre)(?:_test)?_[a-f0-9]{16}$/;
const SAFE_RESTORE_SWAP_DATABASE_NAME = /^vereinorder(?:_[a-z0-9]+)*$/;
const MAX_DATABASE_NAME_LENGTH = 63;

export class PostgreSqlToolError extends Error {
  constructor(
    public readonly code:
      | "DATABASE_URL_INVALID"
      | "TOOL_NOT_FOUND"
      | "TOOL_FAILED"
      | "TOOL_OUTPUT_LIMIT",
    message: string,
  ) {
    super(message);
  }
}

export interface PostgreSqlConnectionEnvironment {
  environment: NodeJS.ProcessEnv;
  databaseName: string;
}

export function buildPostgreSqlConnectionEnvironment(
  databaseUrl: string,
): PostgreSqlConnectionEnvironment {
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new PostgreSqlToolError(
      "DATABASE_URL_INVALID",
      "DATABASE_URL ist keine gültige PostgreSQL-Adresse.",
    );
  }
  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol) ||
    !parsed.hostname ||
    !parsed.pathname.slice(1)
  ) {
    throw new PostgreSqlToolError(
      "DATABASE_URL_INVALID",
      "DATABASE_URL ist keine vollständige PostgreSQL-Adresse.",
    );
  }

  const environment: NodeJS.ProcessEnv = {};
  for (const key of [
    "PATH",
    "Path",
    "PATHEXT",
    "SystemRoot",
    "WINDIR",
    "HOME",
    "USERPROFILE",
    "TEMP",
    "TMP",
    "LANG",
    "LC_ALL",
    "LD_LIBRARY_PATH",
  ]) {
    if (process.env[key] !== undefined) environment[key] = process.env[key];
  }
  environment.PGHOST = parsed.hostname;
  environment.PGPORT = parsed.port || "5432";
  environment.PGDATABASE = decodeURIComponent(parsed.pathname.slice(1));
  environment.PGUSER = decodeURIComponent(parsed.username);
  environment.PGPASSWORD = decodeURIComponent(parsed.password);
  environment.PGCONNECT_TIMEOUT = "15";
  environment.LC_ALL = "C";
  const sslMode = parsed.searchParams.get("sslmode");
  if (sslMode) environment.PGSSLMODE = sslMode;

  return { environment, databaseName: environment.PGDATABASE };
}

export function buildPostgreSqlDatabaseUrl(
  databaseUrl: string,
  databaseName: string,
): string {
  if (
    !SAFE_GENERATED_DATABASE_NAME.test(databaseName) &&
    !SAFE_RESTORE_SWAP_ARTIFACT_NAME.test(databaseName)
  ) {
    throw new PostgreSqlToolError(
      "DATABASE_URL_INVALID",
      "Der interne Name der Prüf-Datenbank ist ungültig.",
    );
  }
  const parsed = new URL(databaseUrl);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

@Injectable()
export class PostgreSqlBackupTools {
  async getDumpVersion(): Promise<string> {
    const result = await this.run(
      process.env.PG_DUMP_BIN || "pg_dump",
      ["--version"],
      this.baseEnvironment(),
      VERSION_TIMEOUT_MS,
    );
    return result.stdout.trim();
  }

  async getRestoreVersion(): Promise<string> {
    const result = await this.run(
      process.env.PG_RESTORE_BIN || "pg_restore",
      ["--version"],
      this.baseEnvironment(),
      VERSION_TIMEOUT_MS,
    );
    return result.stdout.trim();
  }

  async createDump(databaseUrl: string, destination: string): Promise<void> {
    const connection = buildPostgreSqlConnectionEnvironment(databaseUrl);
    await this.run(
      process.env.PG_DUMP_BIN || "pg_dump",
      [
        "--format=custom",
        "--compress=6",
        "--no-owner",
        "--no-privileges",
        `--file=${destination}`,
      ],
      connection.environment,
      DUMP_TIMEOUT_MS,
    );
  }

  async verifyDump(dumpPath: string): Promise<void> {
    await this.run(
      process.env.PG_RESTORE_BIN || "pg_restore",
      ["--list", dumpPath],
      this.baseEnvironment(),
      VERIFY_TIMEOUT_MS,
    );
  }

  async createVerificationDatabase(
    databaseUrl: string,
    databaseName: string,
  ): Promise<void> {
    this.assertGeneratedDatabaseName(databaseName);
    const connection = buildPostgreSqlConnectionEnvironment(databaseUrl);
    await this.run(
      process.env.PSQL_BIN || "psql",
      [
        "--no-psqlrc",
        "--set=ON_ERROR_STOP=1",
        `--command=CREATE DATABASE "${databaseName}" TEMPLATE template0`,
      ],
      { ...connection.environment, PGDATABASE: "postgres" },
      DATABASE_ADMIN_TIMEOUT_MS,
    );
  }

  async restoreDump(
    databaseUrl: string,
    databaseName: string,
    dumpPath: string,
  ): Promise<void> {
    this.assertRestorableDatabaseName(databaseName);
    const connection = buildPostgreSqlConnectionEnvironment(databaseUrl);
    await this.run(
      process.env.PG_RESTORE_BIN || "pg_restore",
      [
        `--dbname=${databaseName}`,
        "--single-transaction",
        "--exit-on-error",
        "--no-owner",
        "--no-privileges",
        dumpPath,
      ],
      { ...connection.environment, PGDATABASE: databaseName },
      RESTORE_TIMEOUT_MS,
    );
  }

  async dropVerificationDatabase(
    databaseUrl: string,
    databaseName: string,
  ): Promise<void> {
    this.assertGeneratedDatabaseName(databaseName);
    const connection = buildPostgreSqlConnectionEnvironment(databaseUrl);
    const quotedLiteral = `'${databaseName}'`;
    await this.run(
      process.env.PSQL_BIN || "psql",
      [
        "--no-psqlrc",
        "--set=ON_ERROR_STOP=1",
        `--command=SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = ${quotedLiteral} AND pid <> pg_backend_pid()`,
        `--command=DROP DATABASE IF EXISTS "${databaseName}"`,
      ],
      { ...connection.environment, PGDATABASE: "postgres" },
      DATABASE_ADMIN_TIMEOUT_MS,
    );
  }

  async createRestoreSwapDatabase(
    databaseUrl: string,
    databaseName: string,
  ): Promise<void> {
    this.assertRestoreSwapArtifactName(databaseName);
    const connection = buildPostgreSqlConnectionEnvironment(databaseUrl);
    await this.run(
      process.env.PSQL_BIN || "psql",
      [
        "--no-psqlrc",
        "--set=ON_ERROR_STOP=1",
        `--command=CREATE DATABASE "${databaseName}" TEMPLATE template0`,
      ],
      { ...connection.environment, PGDATABASE: "postgres" },
      DATABASE_ADMIN_TIMEOUT_MS,
    );
  }

  async dropRestoreSwapDatabase(
    databaseUrl: string,
    databaseName: string,
  ): Promise<void> {
    this.assertRestoreSwapArtifactName(databaseName);
    const connection = buildPostgreSqlConnectionEnvironment(databaseUrl);
    await this.run(
      process.env.PSQL_BIN || "psql",
      [
        "--no-psqlrc",
        "--set=ON_ERROR_STOP=1",
        `--command=SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${databaseName}' AND pid <> pg_backend_pid()`,
        `--command=DROP DATABASE IF EXISTS "${databaseName}"`,
      ],
      { ...connection.environment, PGDATABASE: "postgres" },
      DATABASE_ADMIN_TIMEOUT_MS,
    );
  }

  async migrateRestoreSwapDatabase(
    databaseUrl: string,
    databaseName: string,
  ): Promise<void> {
    this.assertRestoreSwapArtifactName(databaseName);
    const targetUrl = buildPostgreSqlDatabaseUrl(databaseUrl, databaseName);
    const { cliPath, schemaPath } = this.resolvePrismaMigrationTools();
    const environment = {
      ...this.baseEnvironment(),
      DATABASE_URL: targetUrl,
      PRISMA_HIDE_UPDATE_MESSAGE: "1",
    };
    await this.run(
      process.execPath,
      [cliPath, "migrate", "deploy", `--schema=${schemaPath}`],
      environment,
      MIGRATION_TIMEOUT_MS,
    );
    await this.run(
      process.execPath,
      [cliPath, "migrate", "status", `--schema=${schemaPath}`],
      environment,
      MIGRATION_TIMEOUT_MS,
    );
  }

  async listDatabaseNames(databaseUrl: string): Promise<string[]> {
    const connection = buildPostgreSqlConnectionEnvironment(databaseUrl);
    const result = await this.run(
      process.env.PSQL_BIN || "psql",
      [
        "--no-psqlrc",
        "--set=ON_ERROR_STOP=1",
        "--tuples-only",
        "--no-align",
        "--command=SELECT datname FROM pg_catalog.pg_database ORDER BY datname",
      ],
      { ...connection.environment, PGDATABASE: "postgres" },
      DATABASE_ADMIN_TIMEOUT_MS,
    );
    return result.stdout
      .split(/\r?\n/)
      .map((name) => name.trim())
      .filter(Boolean);
  }

  async terminateDatabaseConnections(
    databaseUrl: string,
    databaseName: string,
  ): Promise<void> {
    this.assertRestoreSwapDatabaseName(databaseName);
    const connection = buildPostgreSqlConnectionEnvironment(databaseUrl);
    await this.run(
      process.env.PSQL_BIN || "psql",
      [
        "--no-psqlrc",
        "--set=ON_ERROR_STOP=1",
        `--command=SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${databaseName}' AND pid <> pg_backend_pid()`,
      ],
      { ...connection.environment, PGDATABASE: "postgres" },
      DATABASE_ADMIN_TIMEOUT_MS,
    );
  }

  async renameDatabase(
    databaseUrl: string,
    sourceDatabase: string,
    targetDatabase: string,
  ): Promise<void> {
    this.assertRestoreSwapDatabaseName(sourceDatabase);
    this.assertRestoreSwapDatabaseName(targetDatabase);
    if (sourceDatabase === targetDatabase) {
      throw new PostgreSqlToolError(
        "DATABASE_URL_INVALID",
        "Quell- und Zieldatenbank der Umbenennung müssen verschieden sein.",
      );
    }
    const connection = buildPostgreSqlConnectionEnvironment(databaseUrl);
    await this.run(
      process.env.PSQL_BIN || "psql",
      [
        "--no-psqlrc",
        "--set=ON_ERROR_STOP=1",
        `--command=ALTER DATABASE "${sourceDatabase}" RENAME TO "${targetDatabase}"`,
      ],
      { ...connection.environment, PGDATABASE: "postgres" },
      DATABASE_ADMIN_TIMEOUT_MS,
    );
  }

  private assertGeneratedDatabaseName(databaseName: string): void {
    if (!SAFE_GENERATED_DATABASE_NAME.test(databaseName)) {
      throw new PostgreSqlToolError(
        "DATABASE_URL_INVALID",
        "Der interne Name der Prüf-Datenbank ist ungültig.",
      );
    }
  }

  private assertRestorableDatabaseName(databaseName: string): void {
    if (
      !SAFE_GENERATED_DATABASE_NAME.test(databaseName) &&
      !SAFE_RESTORE_SWAP_ARTIFACT_NAME.test(databaseName)
    ) {
      throw new PostgreSqlToolError(
        "DATABASE_URL_INVALID",
        "Der interne Name der Restore-Datenbank ist ungültig.",
      );
    }
  }

  private assertRestoreSwapArtifactName(databaseName: string): void {
    if (!SAFE_RESTORE_SWAP_ARTIFACT_NAME.test(databaseName)) {
      throw new PostgreSqlToolError(
        "DATABASE_URL_INVALID",
        "Der interne Name der Restore-Umschaltdatenbank ist ungültig.",
      );
    }
  }

  private assertRestoreSwapDatabaseName(databaseName: string): void {
    if (
      databaseName.length > MAX_DATABASE_NAME_LENGTH ||
      !SAFE_RESTORE_SWAP_DATABASE_NAME.test(databaseName)
    ) {
      throw new PostgreSqlToolError(
        "DATABASE_URL_INVALID",
        "Der interne Name der Restore-Datenbank ist ungültig.",
      );
    }
  }

  private resolvePrismaMigrationTools(): {
    cliPath: string;
    schemaPath: string;
  } {
    const candidates = [
      path.resolve(process.cwd(), "packages/database"),
      path.resolve(process.cwd(), "../../packages/database"),
      path.resolve(__dirname, "../../../packages/database"),
    ];
    const packageDirectory = candidates.find((candidate) =>
      existsSync(path.join(candidate, "prisma/schema.prisma")),
    );
    if (!packageDirectory) {
      throw new PostgreSqlToolError(
        "TOOL_NOT_FOUND",
        "Das Prisma-Migrationsschema ist nicht installiert.",
      );
    }
    let cliPath: string;
    try {
      cliPath = require.resolve("prisma/build/index.js", {
        paths: [packageDirectory],
      });
    } catch {
      throw new PostgreSqlToolError(
        "TOOL_NOT_FOUND",
        "Das Prisma-Migrationswerkzeug ist nicht installiert.",
      );
    }
    return {
      cliPath,
      schemaPath: path.join(packageDirectory, "prisma/schema.prisma"),
    };
  }

  private baseEnvironment(): NodeJS.ProcessEnv {
    const environment: NodeJS.ProcessEnv = {};
    for (const key of [
      "PATH",
      "Path",
      "PATHEXT",
      "SystemRoot",
      "WINDIR",
      "HOME",
      "USERPROFILE",
      "TEMP",
      "TMP",
      "LANG",
      "LC_ALL",
      "LD_LIBRARY_PATH",
    ]) {
      if (process.env[key] !== undefined) environment[key] = process.env[key];
    }
    return environment;
  }

  private run(
    executable: string,
    args: string[],
    environment: NodeJS.ProcessEnv,
    timeoutMs: number,
  ): Promise<{ stdout: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn(executable, args, {
        env: environment,
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let outputBytes = 0;
      let settled = false;
      const timeout = setTimeout(() => {
        fail(
          new PostgreSqlToolError(
            "TOOL_FAILED",
            "Das PostgreSQL-Werkzeug hat das feste Zeitlimit überschritten.",
          ),
        );
      }, timeoutMs);
      timeout.unref();

      const fail = (error: PostgreSqlToolError) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        child.kill();
        reject(error);
      };
      const append = (target: Buffer[], chunk: Buffer) => {
        outputBytes += chunk.length;
        if (outputBytes > MAX_TOOL_OUTPUT_BYTES) {
          fail(
            new PostgreSqlToolError(
              "TOOL_OUTPUT_LIMIT",
              "Das PostgreSQL-Werkzeug hat unerwartet viele Diagnosedaten ausgegeben.",
            ),
          );
          return;
        }
        target.push(chunk);
      };

      child.stdout.on("data", (chunk: Buffer) => append(stdout, chunk));
      child.stderr.on("data", (chunk: Buffer) => append(stderr, chunk));
      child.once("error", (error: NodeJS.ErrnoException) => {
        fail(
          new PostgreSqlToolError(
            error.code === "ENOENT" ? "TOOL_NOT_FOUND" : "TOOL_FAILED",
            error.code === "ENOENT"
              ? "Das benötigte PostgreSQL-Werkzeug ist nicht installiert."
              : "Das PostgreSQL-Werkzeug konnte nicht gestartet werden.",
          ),
        );
      });
      child.once("close", (exitCode) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (exitCode !== 0) {
          reject(
            new PostgreSqlToolError(
              "TOOL_FAILED",
              `Das PostgreSQL-Werkzeug wurde mit Status ${exitCode ?? "unbekannt"} beendet.`,
            ),
          );
          return;
        }
        resolve({ stdout: Buffer.concat(stdout).toString("utf8") });
      });
    });
  }
}
