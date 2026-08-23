import { Injectable } from "@nestjs/common";
import { spawn } from "node:child_process";

const MAX_TOOL_OUTPUT_BYTES = 1024 * 1024;
const VERSION_TIMEOUT_MS = 30_000;
const VERIFY_TIMEOUT_MS = 60_000;
const DUMP_TIMEOUT_MS = 15 * 60_000;

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
