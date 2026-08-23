import { ConflictException, ServiceUnavailableException } from "@nestjs/common";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { parseBackupManifest } from "./backup-manifest";
import { NativeBackupService } from "./native-backup.service";

function createPrisma(options?: { changeTablesAfterDump?: boolean }) {
  let tableReads = 0;
  const migrations = [
    { name: "20260801000000_first", checksum: "checksum-a" },
    { name: "20260802000000_second", checksum: "checksum-b" },
  ];
  const query = jest.fn(async (sql: string) => {
    if (sql.includes("current_database()")) {
      return [
        {
          databaseName: "vereinorder_issue67_test",
          serverVersionNum: "160010",
        },
      ];
    }
    if (sql.includes("SELECT migration_name AS name")) return migrations;
    if (sql.includes("FROM pg_catalog.pg_tables")) {
      tableReads += 1;
      const names = [
        "AuditLog",
        "Order",
        "Payment",
        "Product",
        "ProductVoucher",
        "_prisma_migrations",
      ];
      if (options?.changeTablesAfterDump && tableReads > 1)
        names.push("LateTable");
      return names.map((tableName) => ({ tableName }));
    }
    if (sql.includes('SUM("totalAmount")')) {
      return [{ dataMode: "LIVE", amount: BigInt(1050) }];
    }
    if (sql.includes("SUM(p.amount)")) {
      return [{ dataMode: "LIVE", method: "CASH", amount: BigInt(1050) }];
    }
    if (sql.includes('FROM "ProductVoucher"')) {
      return [{ dataMode: "LIVE", status: "ISSUED", count: BigInt(3) }];
    }
    if (sql.includes('FROM "AuditLog"') && sql.includes("withUser")) {
      return [{ total: BigInt(4), withUser: BigInt(3) }];
    }
    if (sql.includes("SELECT COUNT(*)")) return [{ count: BigInt(0) }];
    throw new Error(`Unerwartetes SQL im Test: ${sql}`);
  });
  return {
    $queryRawUnsafe: query,
    auditLog: { create: jest.fn().mockResolvedValue({ id: "audit-1" }) },
  };
}

function createTools() {
  return {
    getDumpVersion: jest.fn().mockResolvedValue("pg_dump (PostgreSQL) 16.10"),
    getRestoreVersion: jest
      .fn()
      .mockResolvedValue("pg_restore (PostgreSQL) 16.10"),
    createDump: jest.fn(async (_databaseUrl: string, destination: string) => {
      fs.writeFileSync(destination, Buffer.from("PGDMP\0native-test-dump"));
    }),
    verifyDump: jest.fn().mockResolvedValue(undefined),
  };
}

describe("Native PostgreSQL-Sicherung V1 (Issue #67)", () => {
  let backupDir: string;
  let previousBackupDir: string | undefined;
  let previousDatabaseUrl: string | undefined;

  beforeEach(() => {
    previousBackupDir = process.env.BACKUP_DIR;
    previousDatabaseUrl = process.env.DATABASE_URL;
    backupDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "vereinorder-native-backup-spec-"),
    );
    process.env.BACKUP_DIR = backupDir;
    process.env.DATABASE_URL =
      "postgresql://backup-user:secret@postgres:5432/vereinorder_issue67_test?schema=public";
  });

  afterEach(() => {
    if (previousBackupDir === undefined) delete process.env.BACKUP_DIR;
    else process.env.BACKUP_DIR = previousBackupDir;
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    fs.rmSync(backupDir, { recursive: true, force: true });
  });

  it("veröffentlicht erst nach Dump, Doppelhash und pg_restore-Prüfung ein vollständiges Dateipaar", async () => {
    const prisma = createPrisma();
    const tools = createTools();
    const service = new NativeBackupService(
      prisma as any,
      { read: () => ({ phase: "OPEN" }) } as any,
      tools as any,
    );

    const result = await service.createBackup("MANUAL", {
      userId: "admin-id",
      username: "admin",
    });

    expect(result).toMatchObject({
      format: "POSTGRES_CUSTOM",
      verification: "STRUCTURE_VERIFIED",
      restoreAvailable: false,
      trigger: "MANUAL",
    });
    expect(result.downloadFiles).toHaveLength(2);
    expect(tools.createDump).toHaveBeenCalledWith(
      process.env.DATABASE_URL,
      expect.stringContaining(".partial.dump"),
    );
    expect(tools.verifyDump).toHaveBeenCalledTimes(1);
    expect(fs.readdirSync(backupDir).sort()).toEqual(
      result.artifacts.slice().sort(),
    );
    expect(
      fs.readdirSync(backupDir).some((name) => name.includes("partial")),
    ).toBe(false);

    const manifestName = result.artifacts.find((name) =>
      name.endsWith(".manifest.json"),
    )!;
    const manifest = parseBackupManifest(
      fs.readFileSync(path.join(backupDir, manifestName), "utf8"),
    );
    expect(manifest.countsBefore).toHaveProperty("_prisma_migrations");
    expect(manifest.countsAfter).toEqual(manifest.countsBefore);
    expect(manifest.sumsBefore.byDataMode.LIVE).toMatchObject({
      orderTotalAmount: 1050,
      paymentAmount: { CASH: 1050 },
      voucherCount: { ISSUED: 3 },
    });
    expect(manifest.createdBy).toEqual({
      userId: "admin-id",
      username: "admin",
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "BACKUP_CREATED" }),
      }),
    );
  });

  it("veröffentlicht bei fehlgeschlagener Strukturprüfung keine Teildatei und auditiert nur einen sicheren Fehlercode", async () => {
    const prisma = createPrisma();
    const tools = createTools();
    tools.verifyDump.mockRejectedValueOnce(new Error("secret should not leak"));
    const service = new NativeBackupService(
      prisma as any,
      { read: () => ({ phase: "OPEN" }) } as any,
      tools as any,
    );

    await expect(
      service.createBackup("MANUAL", {
        userId: "admin-id",
        username: "admin",
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(fs.readdirSync(backupDir)).toEqual([]);
    expect(JSON.stringify(prisma.auditLog.create.mock.calls)).not.toContain(
      "secret should not leak",
    );
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "BACKUP_FAILED",
          details: expect.objectContaining({ errorCode: "BACKUP_FAILED" }),
        }),
      }),
    );
  });

  it("verwirft einen während des Dumps geänderten Tabellenbestand", async () => {
    const prisma = createPrisma({ changeTablesAfterDump: true });
    const service = new NativeBackupService(
      prisma as any,
      { read: () => ({ phase: "OPEN" }) } as any,
      createTools() as any,
    );

    await expect(service.createBackup("SCHEDULE", null)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(fs.readdirSync(backupDir)).toEqual([]);
  });

  it("entfernt ein veröffentlichtes Paar wieder, wenn der Erfolgs-Audit fehlschlägt", async () => {
    const prisma = createPrisma();
    prisma.auditLog.create.mockRejectedValueOnce(
      new Error("audit unavailable"),
    );
    const service = new NativeBackupService(
      prisma as any,
      { read: () => ({ phase: "OPEN" }) } as any,
      createTools() as any,
    );

    await expect(
      service.createBackup("MANUAL", {
        userId: "admin-id",
        username: "admin",
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    expect(fs.readdirSync(backupDir)).toEqual([]);
    expect(prisma.auditLog.create).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "BACKUP_FAILED" }),
      }),
    );
  });

  it("verhindert zwei parallele Sicherungen per Single-Flight", async () => {
    const prisma = createPrisma();
    const tools = createTools();
    let release!: () => void;
    let started!: () => void;
    const startedPromise = new Promise<void>((resolve) => (started = resolve));
    const blocker = new Promise<void>((resolve) => (release = resolve));
    tools.createDump.mockImplementationOnce(
      async (_databaseUrl: string, destination: string) => {
        fs.writeFileSync(destination, Buffer.from("PGDMP\0blocked"));
        started();
        await blocker;
      },
    );
    const service = new NativeBackupService(
      prisma as any,
      { read: () => ({ phase: "OPEN" }) } as any,
      tools as any,
    );

    const first = service.createBackup("MANUAL", {
      userId: "admin-id",
      username: "admin",
    });
    await startedPromise;
    await expect(
      service.createBackup("MANUAL", {
        userId: "admin-id",
        username: "admin",
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    release();
    await expect(first).resolves.toMatchObject({ format: "POSTGRES_CUSTOM" });
  });

  it("führt im gesperrten Wartungsmodus keinen Zeitplanlauf und keinen Datenbankzugriff aus", async () => {
    const prisma = createPrisma();
    const tools = createTools();
    const service = new NativeBackupService(
      prisma as any,
      { read: () => ({ phase: "LOCKED" }) } as any,
      tools as any,
    );

    await service.runScheduledBackupIfDue();

    expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled();
    expect(tools.createDump).not.toHaveBeenCalled();
  });

  it("verwendet die Strukturprüfung nur bei unveränderter Größe und mtime aus dem Manifest", async () => {
    const service = new NativeBackupService(
      createPrisma() as any,
      { read: () => ({ phase: "OPEN" }) } as any,
      createTools() as any,
    );
    const created = await service.createBackup("MANUAL", {
      userId: "admin-id",
      username: "admin",
    });
    const tools = (service as any).tools;
    tools.verifyDump.mockClear();

    const cached = await service.listBackups();
    expect(cached[0].verification).toBe("STRUCTURE_VERIFIED");
    expect(tools.verifyDump).not.toHaveBeenCalled();

    fs.appendFileSync(path.join(backupDir, created.filename), "tampered");
    const tampered = await service.listBackups();
    expect(tampered[0]).toMatchObject({
      format: "CORRUPT",
      verification: "CORRUPT",
      restoreAvailable: false,
    });
  });

  it("akzeptiert ein Manifest nicht unter einem vom Dump abweichenden Namen", async () => {
    const service = new NativeBackupService(
      createPrisma() as any,
      { read: () => ({ phase: "OPEN" }) } as any,
      createTools() as any,
    );
    const created = await service.createBackup("MANUAL", {
      userId: "admin-id",
      username: "admin",
    });
    const manifestName = created.artifacts.find((name) =>
      name.endsWith(".manifest.json"),
    )!;
    fs.renameSync(
      path.join(backupDir, manifestName),
      path.join(backupDir, "vereinorder_fremd_manual.manifest.json"),
    );

    const listed = await service.listBackups();

    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      filename: "vereinorder_fremd_manual.manifest.json",
      format: "CORRUPT",
      downloadFiles: [],
    });
  });
});
