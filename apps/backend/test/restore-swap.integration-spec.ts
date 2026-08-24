import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawn } from "node:child_process";
import {
  PostgreSqlBackupTools,
  buildPostgreSqlConnectionEnvironment,
} from "../src/backup/postgresql-backup.tools";
import {
  FileRestoreSwapStateStore,
  RestoreSwapCoordinator,
  createRestoreSwapState,
} from "../src/backup/restore-swap";
import { assertTestDatabaseUrl } from "./test-database";

const SAFE_TEST_SWAP_DATABASE =
  /^vereinorder_(?:swap_test_[a-f0-9]{8}|restore_test_[a-f0-9]{16}|pre_test_[a-f0-9]{16})$/;

describe("Restore-Tausch gegen echte PostgreSQL-Testdatenbanken (Issue #67)", () => {
  assertTestDatabaseUrl();

  const controlUrl = process.env.DATABASE_URL!;
  const swapId = randomBytes(8).toString("hex");
  const liveDatabase = `vereinorder_swap_test_${swapId.slice(0, 8)}`;
  const state = createRestoreSwapState(
    liveDatabase,
    "2026-08-24T08:00:00.000Z",
    swapId,
  );
  const targetedDatabases = [
    state.liveDatabase,
    state.stagedDatabase,
    state.previousDatabase,
  ];
  let stateDirectory: string;
  let previousPsqlBin: string | undefined;

  beforeAll(async () => {
    for (const databaseName of targetedDatabases) {
      assertSafeTestSwapDatabase(databaseName);
    }
    previousPsqlBin = process.env.PSQL_BIN;
    if (process.platform === "win32") {
      const psql = "C:\\Program Files\\PostgreSQL\\18\\bin\\psql.exe";
      try {
        await fs.access(psql);
        process.env.PSQL_BIN = psql;
      } catch {
        // Der normale PATH bleibt der verbindliche Fallback.
      }
    }
    stateDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), "vereinorder-restore-swap-integration-"),
    );
    await cleanupDatabases();
    await runPsql("postgres", [
      `CREATE DATABASE "${state.liveDatabase}" TEMPLATE template0`,
      `CREATE DATABASE "${state.stagedDatabase}" TEMPLATE template0`,
    ]);
    await runPsql(state.liveDatabase, [
      "CREATE TABLE restore_swap_marker (value text NOT NULL)",
      "INSERT INTO restore_swap_marker(value) VALUES ('ORIGINAL')",
    ]);
    await runPsql(state.stagedDatabase, [
      "CREATE TABLE restore_swap_marker (value text NOT NULL)",
      "INSERT INTO restore_swap_marker(value) VALUES ('RESTORED')",
    ]);
  }, 60_000);

  afterAll(async () => {
    await cleanupDatabases();
    await fs.rm(stateDirectory, { recursive: true, force: true });
    if (previousPsqlBin === undefined) delete process.env.PSQL_BIN;
    else process.env.PSQL_BIN = previousPsqlBin;
  }, 60_000);

  it("setzt echten Tausch und Rücknahme nach Abbrüchen zwischen Umbenennung und Zustands-Sync fort", async () => {
    const store = new FileRestoreSwapStateStore(stateDirectory);
    const tools = new PostgreSqlBackupTools();
    await store.write(state);

    await tools.terminateDatabaseConnections(controlUrl, state.liveDatabase);
    await tools.renameDatabase(
      controlUrl,
      state.liveDatabase,
      state.previousDatabase,
    );
    expect((await store.read())?.phase).toBe("REQUESTED");

    const restartedCoordinator = new RestoreSwapCoordinator(
      controlUrl,
      new FileRestoreSwapStateStore(stateDirectory),
      new PostgreSqlBackupTools(),
    );
    await expect(restartedCoordinator.resume()).resolves.toMatchObject({
      phase: "SWAPPED",
    });

    await expect(readMarker(state.liveDatabase)).resolves.toBe("RESTORED");
    await expect(readMarker(state.previousDatabase)).resolves.toBe("ORIGINAL");
    await expect(
      new PostgreSqlBackupTools().listDatabaseNames(controlUrl),
    ).resolves.toEqual(expect.not.arrayContaining([state.stagedDatabase]));

    await restartedCoordinator.markCompleted();
    await tools.terminateDatabaseConnections(controlUrl, state.liveDatabase);
    await tools.renameDatabase(
      controlUrl,
      state.liveDatabase,
      state.stagedDatabase,
    );
    expect((await store.read())?.phase).toBe("COMPLETED");

    const rollbackAfterRestart = new RestoreSwapCoordinator(
      controlUrl,
      new FileRestoreSwapStateStore(stateDirectory),
      new PostgreSqlBackupTools(),
    );
    await expect(rollbackAfterRestart.rollback()).resolves.toMatchObject({
      phase: "ROLLED_BACK",
    });
    await expect(readMarker(state.liveDatabase)).resolves.toBe("ORIGINAL");
    await expect(readMarker(state.stagedDatabase)).resolves.toBe("RESTORED");
    await expect(
      new PostgreSqlBackupTools().listDatabaseNames(controlUrl),
    ).resolves.toEqual(expect.not.arrayContaining([state.previousDatabase]));
  }, 60_000);

  async function cleanupDatabases(): Promise<void> {
    for (const databaseName of targetedDatabases) {
      assertSafeTestSwapDatabase(databaseName);
      await runPsql("postgres", [
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${databaseName}' AND pid <> pg_backend_pid()`,
        `DROP DATABASE IF EXISTS "${databaseName}"`,
      ]);
    }
  }

  async function readMarker(databaseName: string): Promise<string> {
    assertSafeTestSwapDatabase(databaseName);
    return runPsql(databaseName, [
      "SELECT value FROM restore_swap_marker LIMIT 1",
    ]);
  }

  async function runPsql(
    databaseName: string,
    commands: string[],
  ): Promise<string> {
    if (databaseName !== "postgres") assertSafeTestSwapDatabase(databaseName);
    const connection = buildPostgreSqlConnectionEnvironment(controlUrl);
    const executable = process.env.PSQL_BIN || "psql";
    const args = [
      "--no-psqlrc",
      "--set=ON_ERROR_STOP=1",
      "--tuples-only",
      "--no-align",
      ...commands.map((command) => `--command=${command}`),
    ];
    return new Promise((resolve, reject) => {
      const child = spawn(executable, args, {
        env: { ...connection.environment, PGDATABASE: databaseName },
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
      child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
      child.once("error", reject);
      child.once("close", (exitCode) => {
        if (exitCode !== 0) {
          reject(
            new Error(
              `psql-Testwerkzeug endete mit ${exitCode}: ${Buffer.concat(stderr).toString("utf8").trim()}`,
            ),
          );
          return;
        }
        resolve(Buffer.concat(stdout).toString("utf8").trim());
      });
    });
  }
});

function assertSafeTestSwapDatabase(databaseName: string): void {
  if (!SAFE_TEST_SWAP_DATABASE.test(databaseName)) {
    throw new Error(
      `Destruktiver Test verweigert nicht eindeutig geprüfte Datenbank: ${databaseName}`,
    );
  }
}
