import { ConflictException, ServiceUnavailableException } from "@nestjs/common";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { BackupTrigger, parseBackupManifest } from "./backup-manifest";
import { NativeBackupService } from "./native-backup.service";

function createPrisma(options?: {
  changeTablesAfterDump?: boolean;
  valueVoucherMovementBalance?: bigint;
}) {
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
        "ValueVoucher",
        "ValueVoucherMovement",
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
    if (
      sql.includes('FROM "ValueVoucher"') &&
      sql.includes('SUM("currentBalance")')
    ) {
      return [
        {
          dataMode: "LIVE",
          status: "ACTIVE",
          count: BigInt(2),
          balance: BigInt(2000),
        },
      ];
    }
    if (
      sql.includes('FROM "ValueVoucherMovement"') &&
      sql.includes('SUM("balanceDelta")')
    ) {
      return [
        {
          dataMode: "LIVE",
          balance: options?.valueVoucherMovementBalance ?? BigInt(2000),
        },
      ];
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
    cashierSession: { count: jest.fn().mockResolvedValue(2) },
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
    createVerificationDatabase: jest.fn().mockResolvedValue(undefined),
    restoreDump: jest.fn().mockResolvedValue(undefined),
    dropVerificationDatabase: jest.fn().mockResolvedValue(undefined),
  };
}

describe("Native PostgreSQL-Sicherung V1 (Issue #67)", () => {
  let backupDir: string;
  let previousBackupDir: string | undefined;
  let previousDatabaseUrl: string | undefined;
  let previousRetentionEnvironment: Record<string, string | undefined>;

  beforeEach(() => {
    previousBackupDir = process.env.BACKUP_DIR;
    previousDatabaseUrl = process.env.DATABASE_URL;
    previousRetentionEnvironment = Object.fromEntries(
      [
        "BACKUP_RETENTION_HOURLY_KEEP",
        "BACKUP_RETENTION_DAILY_KEEP",
        "BACKUP_RETENTION_EVENT_KEEP",
        "BACKUP_MIN_FREE_BYTES",
      ].map((name) => [name, process.env[name]]),
    );
    backupDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "vereinorder-native-backup-spec-"),
    );
    process.env.BACKUP_DIR = backupDir;
    process.env.DATABASE_URL =
      "postgresql://backup-user:secret@postgres:5432/vereinorder_issue67_test?schema=public";
    process.env.BACKUP_MIN_FREE_BYTES = "0";
  });

  afterEach(() => {
    jest.useRealTimers();
    if (previousBackupDir === undefined) delete process.env.BACKUP_DIR;
    else process.env.BACKUP_DIR = previousBackupDir;
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    for (const [name, value] of Object.entries(previousRetentionEnvironment)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
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
    // Einmal vor Veröffentlichung und einmal vor einer möglichen Rotation.
    expect(tools.verifyDump).toHaveBeenCalledTimes(2);
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
      valueVoucherBalance: 2000,
      valueVoucherMovementBalance: 2000,
      valueVoucherCount: { ACTIVE: 2 },
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

  it("bricht bei einer von den Gutscheinbewegungen abweichenden Saldoprojektion sicher ab", async () => {
    const prisma = createPrisma({
      valueVoucherMovementBalance: BigInt(1900),
    });
    const service = new NativeBackupService(
      prisma as any,
      createTools() as any,
      { read: jest.fn(() => ({ phase: "OPEN" })) } as any,
    );

    await expect(service.createBackup("MANUAL", null)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "BACKUP_FAILED",
          details: expect.objectContaining({
            errorCode: "BACKUP_UNAVAILABLE",
          }),
        }),
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

  it("bricht bei unterschrittener Speicherreserve vor pg_dump ab und auditiert einen sicheren Code", async () => {
    process.env.BACKUP_MIN_FREE_BYTES = String(Number.MAX_SAFE_INTEGER);
    const prisma = createPrisma();
    const tools = createTools();
    const service = new NativeBackupService(
      prisma as any,
      { read: () => ({ phase: "OPEN" }) } as any,
      tools as any,
    );

    await expect(service.createBackup("MANUAL", null)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );

    expect(tools.createDump).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "BACKUP_FAILED",
          details: expect.objectContaining({
            errorCode: "BACKUP_FREE_SPACE_LOW",
          }),
        }),
      }),
    );
  });

  it("rotiert stündliche Sicherungen, schützt aber die jüngste und eine wiederherstellungsgeprüfte Sicherung", async () => {
    jest.useFakeTimers();
    process.env.BACKUP_RETENTION_HOURLY_KEEP = "1";
    process.env.BACKUP_RETENTION_DAILY_KEEP = "0";
    const prisma = createPrisma();
    const service = new NativeBackupService(
      prisma as any,
      { read: () => ({ phase: "OPEN" }) } as any,
      createTools() as any,
    );

    jest.setSystemTime(new Date("2026-08-20T10:00:00.000Z"));
    const restored = await service.createBackup("SCHEDULE", null);
    const restoredManifestPath = path.join(
      backupDir,
      restored.filename.replace(/\.dump$/, ".manifest.json"),
    );
    const restoredManifest = parseBackupManifest(
      fs.readFileSync(restoredManifestPath, "utf8"),
    );
    restoredManifest.verification.restoration = {
      status: "PASSED",
      checkedAt: "2026-08-20T10:05:00.000Z",
    };
    fs.writeFileSync(restoredManifestPath, JSON.stringify(restoredManifest));

    jest.setSystemTime(new Date("2026-08-20T11:00:00.000Z"));
    const obsolete = await service.createBackup("SCHEDULE", null);
    jest.setSystemTime(new Date("2026-08-20T12:00:00.000Z"));
    const newest = await service.createBackup("SCHEDULE", null);

    const listed = await service.listBackups();
    expect(listed.map((backup) => backup.filename).sort()).toEqual(
      [restored.filename, newest.filename].sort(),
    );
    expect(fs.existsSync(path.join(backupDir, obsolete.filename))).toBe(false);
    expect(
      prisma.auditLog.create.mock.calls.some(
        ([call]) => call.data.action === "BACKUP_ROTATION_STARTED",
      ),
    ).toBe(true);
    expect(
      prisma.auditLog.create.mock.calls.some(
        ([call]) => call.data.action === "BACKUP_ROTATION_COMPLETED",
      ),
    ).toBe(true);
    jest.useRealTimers();
  });

  it("meldet Speicherbelegung, Rücklage und jüngste Prüfstufen", async () => {
    process.env.BACKUP_MIN_FREE_BYTES = "1234";
    const service = new NativeBackupService(
      createPrisma() as any,
      { read: () => ({ phase: "OPEN" }) } as any,
      createTools() as any,
    );
    const created = await service.createBackup("MANUAL", null);

    const storage = await service.getStorageStatus();

    expect(storage).toMatchObject({
      backupCount: 1,
      latestStructuredBackup: { filename: created.filename },
      latestRestoredBackup: null,
      retention: { minFreeBytes: 1234 },
      creationAllowed: true,
    });
    expect(storage.totalBytes).toBeGreaterThan(0);
    expect(storage.freeBytes).toBeGreaterThan(0);
    expect(storage.backupBytes).toBeGreaterThan(created.sizeBytes);
  });

  it("begrenzt Ereignissicherungen je Auslöser und löscht manuelle Sicherungen nie automatisch", async () => {
    jest.useFakeTimers();
    process.env.BACKUP_RETENTION_HOURLY_KEEP = "0";
    process.env.BACKUP_RETENTION_DAILY_KEEP = "0";
    process.env.BACKUP_RETENTION_EVENT_KEEP = "1";
    const service = new NativeBackupService(
      createPrisma() as any,
      { read: () => ({ phase: "OPEN" }) } as any,
      createTools() as any,
    );
    const createAt = async (timestamp: string, trigger: BackupTrigger) => {
      jest.setSystemTime(new Date(timestamp));
      return service.createBackup(trigger, null);
    };

    const manualOne = await createAt("2026-08-21T08:00:00.000Z", "MANUAL");
    const manualTwo = await createAt("2026-08-21T09:00:00.000Z", "MANUAL");
    const oldPreRestore = await createAt(
      "2026-08-21T10:00:00.000Z",
      "PRE_RESTORE",
    );
    const newPreRestore = await createAt(
      "2026-08-21T11:00:00.000Z",
      "PRE_RESTORE",
    );
    const oldPreMigration = await createAt(
      "2026-08-21T12:00:00.000Z",
      "PRE_MIGRATION",
    );
    const newPreMigration = await createAt(
      "2026-08-21T13:00:00.000Z",
      "PRE_MIGRATION",
    );

    const filenames = (await service.listBackups()).map(
      (backup) => backup.filename,
    );
    expect(filenames).toEqual(
      expect.arrayContaining([
        manualOne.filename,
        manualTwo.filename,
        newPreRestore.filename,
        newPreMigration.filename,
      ]),
    );
    expect(filenames).not.toContain(oldPreRestore.filename);
    expect(filenames).not.toContain(oldPreMigration.filename);
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

  it("stellt einen aktuellen Dump isoliert wieder her, vergleicht ihn vollständig und entfernt die Prüfdatenbank", async () => {
    const prisma = createPrisma();
    const tools = createTools();
    const service = new NativeBackupService(
      prisma as any,
      { read: () => ({ phase: "OPEN" }) } as any,
      tools as any,
    );
    const created = await service.createBackup("MANUAL", {
      userId: "admin-id",
      username: "admin",
    });
    const restoredPrisma = {
      ...createPrisma(),
      $disconnect: jest.fn().mockResolvedValue(undefined),
    };
    jest
      .spyOn(service as any, "createVerificationClient")
      .mockReturnValue(restoredPrisma);

    const result = await service.verifyRestoration(created.filename, {
      userId: "admin-id",
      username: "admin",
    });

    expect(result).toMatchObject({
      filename: created.filename,
      verification: "RESTORE_VERIFIED",
      compatibility: "CURRENT",
      restoreVerificationAvailable: true,
    });
    expect(tools.createVerificationDatabase).toHaveBeenCalledWith(
      process.env.DATABASE_URL,
      expect.stringMatching(/^vereinorder_restorecheck_[a-f0-9]{16}$/),
    );
    expect(tools.restoreDump).toHaveBeenCalledWith(
      process.env.DATABASE_URL,
      expect.stringMatching(/^vereinorder_restorecheck_[a-f0-9]{16}$/),
      expect.stringContaining(created.filename),
    );
    expect(tools.dropVerificationDatabase).toHaveBeenCalledWith(
      process.env.DATABASE_URL,
      expect.stringMatching(/^vereinorder_restorecheck_[a-f0-9]{16}$/),
    );
    expect(restoredPrisma.$disconnect).toHaveBeenCalledTimes(1);
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "RESTORE_VERIFICATION_COMPLETED",
          userId: "admin-id",
        }),
      }),
    );
    const manifest = parseBackupManifest(
      fs.readFileSync(
        path.join(
          backupDir,
          created.artifacts.find((name) => name.endsWith(".manifest.json"))!,
        ),
        "utf8",
      ),
    );
    expect(manifest.verification.restoration.status).toBe("PASSED");
  });

  it("lehnt die Restore-Vorbereitung außerhalb von LOCKED vor jedem Dateizugriff ab", async () => {
    const prisma = createPrisma();
    const service = new NativeBackupService(
      prisma as any,
      { read: () => ({ phase: "OPEN" }) } as any,
      createTools() as any,
    );
    const downloadSpy = jest.spyOn(service, "getDownloadFilePath");

    await expect(
      service.prepareRestoration(
        "vereinorder_test_manual.dump",
        {
          confirmedCreatedAt: "2026-08-24T08:30:00.000Z",
          queuesConfirmed: true,
        },
        { userId: "admin-id", username: "admin" },
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(downloadSpy).not.toHaveBeenCalled();
    expect(prisma.cashierSession.count).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "RESTORE_REJECTED" }),
      }),
    );
  });

  it("erstellt bei exakter Bestätigung eine PRE_RESTORE-Sicherung und prüft den Zieldump erneut isoliert", async () => {
    const prisma = createPrisma();
    const tools = createTools();
    const openService = new NativeBackupService(
      prisma as any,
      { read: () => ({ phase: "OPEN" }) } as any,
      tools as any,
    );
    const created = await openService.createBackup("MANUAL", {
      userId: "admin-id",
      username: "admin",
    });
    const lockedService = new NativeBackupService(
      prisma as any,
      { read: () => ({ phase: "LOCKED" }) } as any,
      tools as any,
    );
    jest
      .spyOn(lockedService as any, "createVerificationClient")
      .mockReturnValue({
        ...createPrisma(),
        $disconnect: jest.fn().mockResolvedValue(undefined),
      });

    const result = await lockedService.prepareRestoration(
      created.filename,
      {
        confirmedCreatedAt: created.createdAt,
        queuesConfirmed: true,
      },
      { userId: "admin-id", username: "admin" },
    );

    expect(result).toMatchObject({
      selectedBackup: {
        filename: created.filename,
        verification: "RESTORE_VERIFIED",
      },
      safetyBackup: { trigger: "PRE_RESTORE" },
      activeCashierSessions: 2,
      liveDatabaseChanged: false,
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "RESTORE_PREPARATION_COMPLETED",
          details: expect.objectContaining({
            confirmations: { queuesConfirmed: true },
            liveDatabaseChanged: false,
          }),
        }),
      }),
    );
  });

  it("erstellt bei abweichendem Sicherungszeitpunkt keine PRE_RESTORE-Sicherung", async () => {
    const prisma = createPrisma();
    const tools = createTools();
    const openService = new NativeBackupService(
      prisma as any,
      { read: () => ({ phase: "OPEN" }) } as any,
      tools as any,
    );
    const created = await openService.createBackup("MANUAL", null);
    tools.createDump.mockClear();
    const lockedService = new NativeBackupService(
      prisma as any,
      { read: () => ({ phase: "LOCKED" }) } as any,
      tools as any,
    );

    await expect(
      lockedService.prepareRestoration(
        created.filename,
        {
          confirmedCreatedAt: "2026-08-24T00:00:00.000Z",
          queuesConfirmed: true,
        },
        { userId: "admin-id", username: "admin" },
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(tools.createDump).not.toHaveBeenCalled();
    expect(prisma.cashierSession.count).not.toHaveBeenCalled();
  });

  it("lässt bei abgebrochenem pg_restore die Festdatenbank unangetastet und räumt die Prüfdatenbank auf", async () => {
    const prisma = createPrisma();
    const tools = createTools();
    const service = new NativeBackupService(
      prisma as any,
      { read: () => ({ phase: "OPEN" }) } as any,
      tools as any,
    );
    const created = await service.createBackup("MANUAL", {
      userId: "admin-id",
      username: "admin",
    });
    tools.restoreDump.mockRejectedValueOnce(new Error("sensitive stderr"));
    const writesBefore = prisma.auditLog.create.mock.calls.length;

    await expect(
      service.verifyRestoration(created.filename, {
        userId: "admin-id",
        username: "admin",
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    expect(tools.dropVerificationDatabase).toHaveBeenCalledTimes(1);
    expect((service as any).createVerificationClient).toBeDefined();
    expect(prisma.auditLog.create.mock.calls.length).toBe(writesBefore + 1);
    expect(
      JSON.stringify(prisma.auditLog.create.mock.calls.slice(writesBefore)),
    ).not.toContain("sensitive stderr");
    const manifest = parseBackupManifest(
      fs.readFileSync(
        path.join(
          backupDir,
          created.artifacts.find((name) => name.endsWith(".manifest.json"))!,
        ),
        "utf8",
      ),
    );
    expect(manifest.verification.restoration.status).toBe("FAILED");
  });

  it("meldet eine nicht entfernbare Prüfdatenbank als eigenen sicheren Fehler", async () => {
    const prisma = createPrisma();
    const tools = createTools();
    const service = new NativeBackupService(
      prisma as any,
      { read: () => ({ phase: "OPEN" }) } as any,
      tools as any,
    );
    const created = await service.createBackup("MANUAL", {
      userId: "admin-id",
      username: "admin",
    });
    jest.spyOn(service as any, "createVerificationClient").mockReturnValue({
      ...createPrisma(),
      $disconnect: jest.fn().mockResolvedValue(undefined),
    });
    tools.dropVerificationDatabase.mockRejectedValueOnce(
      new Error("sensitive cleanup stderr"),
    );

    await expect(
      service.verifyRestoration(created.filename, {
        userId: "admin-id",
        username: "admin",
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    const calls = prisma.auditLog.create.mock.calls;
    const lastAudit = calls[calls.length - 1]?.[0];
    expect(lastAudit).toMatchObject({
      data: {
        action: "RESTORE_VERIFICATION_FAILED",
        details: {
          phase: "DROP_DATABASE",
          errorCode: "RESTORE_CLEANUP_FAILED",
        },
      },
    });
    expect(JSON.stringify(lastAudit)).not.toContain("sensitive cleanup stderr");
  });
});
