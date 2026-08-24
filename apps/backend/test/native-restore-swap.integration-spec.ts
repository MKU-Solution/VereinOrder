import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { PrismaClient } from "@vereinorder/database";
import { NativeBackupService } from "../src/backup/native-backup.service";
import { NativeRestoreService } from "../src/backup/native-restore.service";
import { PostgreSqlBackupTools } from "../src/backup/postgresql-backup.tools";
import { assertTestDatabaseUrl } from "./test-database";

describe("vollständige native Umschaltung und Rücknahme (Issue #67)", () => {
  const target = assertTestDatabaseUrl();
  if (target.database !== target.database.toLowerCase()) {
    throw new Error(
      "Der Restore-Swap-Test verlangt einen kleingeschriebenen Testdatenbanknamen.",
    );
  }

  const prisma = new PrismaClient();
  const tools = new PostgreSqlBackupTools();
  const lockedState = {
    read: () => ({ phase: "LOCKED" }),
    clear: jest.fn(),
  };
  const maintenance = { end: jest.fn().mockResolvedValue({ phase: "OPEN" }) };
  const restart = { schedule: jest.fn().mockReturnValue(false) };
  const markerAction = `RESTORE_SWAP_MARKER_${randomUUID()}`;
  const admin = {
    userId: "",
    username: "",
  };
  let backupDir: string;
  let stateDir: string;
  let previousBackupDir: string | undefined;
  let previousStateDir: string | undefined;
  let previousMinFreeBytes: string | undefined;
  let previousPsqlBin: string | undefined;
  let previousDumpBin: string | undefined;
  let previousRestoreBin: string | undefined;
  let selectedFilename = "";
  let swapId = "";
  let adminUserCreated = false;

  beforeAll(async () => {
    previousBackupDir = process.env.BACKUP_DIR;
    previousStateDir = process.env.STATE_DIR;
    previousMinFreeBytes = process.env.BACKUP_MIN_FREE_BYTES;
    previousPsqlBin = process.env.PSQL_BIN;
    previousDumpBin = process.env.PG_DUMP_BIN;
    previousRestoreBin = process.env.PG_RESTORE_BIN;
    backupDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "vereinorder-native-restore-backups-"),
    );
    stateDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "vereinorder-native-restore-state-"),
    );
    process.env.BACKUP_DIR = backupDir;
    process.env.STATE_DIR = stateDir;
    process.env.BACKUP_MIN_FREE_BYTES = "0";
    if (process.platform === "win32") {
      const psql = "C:\\Program Files\\PostgreSQL\\18\\bin\\psql.exe";
      const dump = "C:\\Program Files\\PostgreSQL\\18\\bin\\pg_dump.exe";
      const restore = "C:\\Program Files\\PostgreSQL\\18\\bin\\pg_restore.exe";
      if (fs.existsSync(psql)) process.env.PSQL_BIN = psql;
      if (fs.existsSync(dump)) process.env.PG_DUMP_BIN = dump;
      if (fs.existsSync(restore)) process.env.PG_RESTORE_BIN = restore;
    }
    const username = `restore-swap-admin-${randomUUID()}`;
    const user = await prisma.user.create({
      data: {
        username,
        pinHash: "integration-test-only",
        role: "ADMINISTRATOR",
      },
      select: { id: true, username: true },
    });
    adminUserCreated = true;
    admin.userId = user.id;
    admin.username = user.username;
  });

  afterAll(async () => {
    await recoverOriginalDatabase().catch(() => undefined);
    await prisma.$connect().catch(() => undefined);
    await prisma.auditLog
      .deleteMany({
        where: {
          OR: [
            { action: markerAction },
            ...(swapId ? [{ entityId: swapId }] : []),
            ...(selectedFilename ? [{ entityId: selectedFilename }] : []),
          ],
        },
      })
      .catch(() => undefined);
    if (adminUserCreated && admin.userId) {
      await prisma.user
        .delete({ where: { id: admin.userId } })
        .catch(() => undefined);
    }
    await prisma.$disconnect();
    fs.rmSync(backupDir, { recursive: true, force: true });
    fs.rmSync(stateDir, { recursive: true, force: true });
    restoreEnvironment("BACKUP_DIR", previousBackupDir);
    restoreEnvironment("STATE_DIR", previousStateDir);
    restoreEnvironment("BACKUP_MIN_FREE_BYTES", previousMinFreeBytes);
    restoreEnvironment("PSQL_BIN", previousPsqlBin);
    restoreEnvironment("PG_DUMP_BIN", previousDumpBin);
    restoreEnvironment("PG_RESTORE_BIN", previousRestoreBin);
  }, 120_000);

  it("stellt den geprüften Dump um, auditiert, nimmt zurück und verwirft erst nach Abnahme", async () => {
    const backups = new NativeBackupService(prisma, lockedState as any, tools);
    const restore = new NativeRestoreService(
      prisma,
      lockedState as any,
      maintenance as any,
      backups,
      tools,
      restart as any,
    );
    const selected = await backups.createBackup("MANUAL", admin);
    selectedFilename = selected.filename;
    await prisma.auditLog.create({
      data: {
        action: markerAction,
        entityId: "after-selected-backup",
        entityType: "BackupTest",
        userId: admin.userId,
      },
    });

    const result = await restore.execute(
      selected.filename,
      {
        confirmedCreatedAt: selected.createdAt,
        queuesConfirmed: true,
      },
      admin,
    );
    swapId = result.operation.swapId;

    expect(result).toMatchObject({
      liveDatabaseChanged: true,
      restartScheduled: false,
      operation: { phase: "COMPLETED", rollbackAvailable: true },
    });
    expect(
      await prisma.auditLog.count({ where: { action: markerAction } }),
    ).toBe(0);
    expect(
      await prisma.auditLog.count({
        where: { action: "RESTORE_COMPLETED", entityId: swapId },
      }),
    ).toBe(1);

    const rolledBack = await restore.rollback(
      swapId,
      selected.createdAt,
      admin,
    );
    expect(rolledBack.operation).toMatchObject({
      phase: "ROLLBACK_COMPLETED",
      acceptanceAvailable: true,
    });
    expect(
      await prisma.auditLog.count({ where: { action: markerAction } }),
    ).toBe(1);
    expect(await restore.getStatus()).not.toBeNull();

    await expect(
      restore.accept(swapId, selected.createdAt, admin),
    ).resolves.toEqual({ accepted: true, maintenanceEnded: true });
    expect(await restore.getStatus()).toBeNull();
    expect(maintenance.end).toHaveBeenCalledWith(admin.userId, admin.username);
    const leaked = (
      await tools.listDatabaseNames(process.env.DATABASE_URL!)
    ).filter(
      (name) =>
        name.startsWith("vereinorder_restore_test_") ||
        name.startsWith("vereinorder_pre_test_"),
    );
    expect(leaked).toEqual([]);
  }, 120_000);

  async function recoverOriginalDatabase(): Promise<void> {
    if (!process.env.DATABASE_URL || !fs.existsSync(stateDir)) return;
    const statePath = path.join(stateDir, "restore-swap-state.json");
    if (!fs.existsSync(statePath)) return;
    const state = JSON.parse(fs.readFileSync(statePath, "utf8")) as {
      liveDatabase: string;
      stagedDatabase: string;
      previousDatabase: string;
    };
    const databases = new Set(
      await tools.listDatabaseNames(process.env.DATABASE_URL),
    );
    if (databases.has(state.previousDatabase)) {
      if (databases.has(state.liveDatabase)) {
        if (databases.has(state.stagedDatabase)) {
          await tools.dropRestoreSwapDatabase(
            process.env.DATABASE_URL,
            state.stagedDatabase,
          );
        }
        await tools.terminateDatabaseConnections(
          process.env.DATABASE_URL,
          state.liveDatabase,
        );
        await tools.renameDatabase(
          process.env.DATABASE_URL,
          state.liveDatabase,
          state.stagedDatabase,
        );
      }
      await tools.renameDatabase(
        process.env.DATABASE_URL,
        state.previousDatabase,
        state.liveDatabase,
      );
    }
    const afterRecovery = new Set(
      await tools.listDatabaseNames(process.env.DATABASE_URL),
    );
    if (afterRecovery.has(state.stagedDatabase)) {
      await tools.dropRestoreSwapDatabase(
        process.env.DATABASE_URL,
        state.stagedDatabase,
      );
    }
  }
});

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
