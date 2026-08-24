import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { PrismaClient } from "@vereinorder/database";
import { parseBackupManifest } from "../src/backup/backup-manifest";
import { NativeBackupService } from "../src/backup/native-backup.service";
import { PostgreSqlBackupTools } from "../src/backup/postgresql-backup.tools";
import { assertTestDatabaseUrl } from "./test-database";

describe("Native PostgreSQL-Sicherung gegen echte Testdatenbank (Issue #67)", () => {
  assertTestDatabaseUrl();

  const prisma = new PrismaClient();
  let backupDir: string;
  let previousBackupDir: string | undefined;
  let previousDumpBin: string | undefined;
  let previousRestoreBin: string | undefined;
  let previousPsqlBin: string | undefined;
  let previousMinFreeBytes: string | undefined;
  const cleanupEventIds: string[] = [];
  const cleanupUserIds: string[] = [];

  beforeAll(() => {
    previousBackupDir = process.env.BACKUP_DIR;
    previousDumpBin = process.env.PG_DUMP_BIN;
    previousRestoreBin = process.env.PG_RESTORE_BIN;
    previousPsqlBin = process.env.PSQL_BIN;
    previousMinFreeBytes = process.env.BACKUP_MIN_FREE_BYTES;
    backupDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "vereinorder-native-backup-integration-"),
    );
    process.env.BACKUP_DIR = backupDir;
    process.env.BACKUP_MIN_FREE_BYTES = "0";

    if (process.platform === "win32") {
      const postgresBin = "C:\\Program Files\\PostgreSQL\\18\\bin";
      const dump = path.join(postgresBin, "pg_dump.exe");
      const restore = path.join(postgresBin, "pg_restore.exe");
      const psql = path.join(postgresBin, "psql.exe");
      if (fs.existsSync(dump)) process.env.PG_DUMP_BIN = dump;
      if (fs.existsSync(restore)) process.env.PG_RESTORE_BIN = restore;
      if (fs.existsSync(psql)) process.env.PSQL_BIN = psql;
    }
  });

  afterAll(async () => {
    if (cleanupEventIds.length) {
      await prisma.order.deleteMany({
        where: { eventId: { in: cleanupEventIds } },
      });
      await prisma.event.deleteMany({ where: { id: { in: cleanupEventIds } } });
    }
    if (cleanupUserIds.length) {
      await prisma.auditLog.deleteMany({
        where: { userId: { in: cleanupUserIds } },
      });
      await prisma.user.deleteMany({ where: { id: { in: cleanupUserIds } } });
    }
    await prisma.$disconnect();
    fs.rmSync(backupDir, { recursive: true, force: true });
    if (previousBackupDir === undefined) delete process.env.BACKUP_DIR;
    else process.env.BACKUP_DIR = previousBackupDir;
    if (previousDumpBin === undefined) delete process.env.PG_DUMP_BIN;
    else process.env.PG_DUMP_BIN = previousDumpBin;
    if (previousRestoreBin === undefined) delete process.env.PG_RESTORE_BIN;
    else process.env.PG_RESTORE_BIN = previousRestoreBin;
    if (previousPsqlBin === undefined) delete process.env.PSQL_BIN;
    else process.env.PSQL_BIN = previousPsqlBin;
    if (previousMinFreeBytes === undefined)
      delete process.env.BACKUP_MIN_FREE_BYTES;
    else process.env.BACKUP_MIN_FREE_BYTES = previousMinFreeBytes;
  });

  it("erzeugt einen echten Custom-Dump mit vollständigem, nachgemessenem Manifest", async () => {
    const admin = await prisma.user.create({
      data: {
        username: `native-backup-admin-${randomUUID()}`,
        pinHash: "test-hash",
        role: "ADMINISTRATOR",
      },
    });
    cleanupUserIds.push(admin.id);
    const event = await prisma.event.create({
      data: {
        name: `Native Backup ${randomUUID()}`,
        status: "ACTIVE",
        testMode: false,
      },
    });
    cleanupEventIds.push(event.id);
    const station = await prisma.station.create({
      data: { name: "Backup-Station", eventId: event.id },
    });
    const category = await prisma.productCategory.create({
      data: { name: "Backup-Kategorie", eventId: event.id },
    });
    const product = await prisma.product.create({
      data: {
        name: "Backup-Produkt",
        price: 425,
        eventId: event.id,
        categoryId: category.id,
        targetStationId: station.id,
      },
    });
    const session = await prisma.cashierSession.create({
      data: {
        userId: admin.id,
        eventId: event.id,
        dataMode: "LIVE",
      },
    });
    const order = await prisma.order.create({
      data: {
        eventId: event.id,
        userId: admin.id,
        dataMode: "LIVE",
        totalAmount: 425,
        cashierSessionId: session.id,
        items: {
          create: [{ productId: product.id, quantity: 1, priceAtTime: 425 }],
        },
        payments: {
          create: [
            {
              amount: 425,
              method: "CASH",
              cashierSessionId: session.id,
            },
          ],
        },
      },
      include: { items: true },
    });
    await prisma.productVoucher.create({
      data: {
        code: `NB-${randomUUID()}`,
        eventId: event.id,
        productId: product.id,
        orderId: order.id,
        orderItemId: order.items[0].id,
        issuedByUserId: admin.id,
        cashierSessionId: session.id,
      },
    });
    await prisma.auditLog.create({
      data: {
        action: "NATIVE_BACKUP_TEST",
        entityType: "Event",
        entityId: event.id,
        userId: admin.id,
      },
    });

    const tools = new PostgreSqlBackupTools();
    const service = new NativeBackupService(
      prisma,
      { read: () => ({ phase: "OPEN" }) } as any,
      tools,
    );
    const toolStatus = await service.refreshToolStatus();
    expect(toolStatus).toMatchObject({ state: "OK", enabled: true });

    const result = await service.createBackup("MANUAL", {
      userId: admin.id,
      username: admin.username,
    });
    const dumpPath = path.join(backupDir, result.filename);
    const manifestPath = path.join(
      backupDir,
      result.artifacts.find((name) => name.endsWith(".manifest.json"))!,
    );
    const manifest = parseBackupManifest(fs.readFileSync(manifestPath, "utf8"));

    expect(fs.readFileSync(dumpPath).subarray(0, 5).toString("ascii")).toBe(
      "PGDMP",
    );
    await expect(tools.verifyDump(dumpPath)).resolves.toBeUndefined();
    expect(manifest.databaseName).toMatch(/test/i);
    expect(manifest.countsBefore._prisma_migrations).toBeGreaterThan(0);
    expect(manifest.countsBefore).toEqual(manifest.countsAfter);
    expect(manifest.sumsBefore).toEqual(manifest.sumsAfter);
    expect(
      manifest.sumsAfter.byDataMode.LIVE.orderTotalAmount,
    ).toBeGreaterThanOrEqual(425);
    expect(
      manifest.sumsAfter.byDataMode.LIVE.paymentAmount.CASH,
    ).toBeGreaterThanOrEqual(425);
    expect(
      manifest.sumsAfter.byDataMode.LIVE.voucherCount.ISSUED,
    ).toBeGreaterThanOrEqual(1);
    expect(manifest.verification.structure.status).toBe("PASSED");
    expect(JSON.stringify(manifest)).not.toContain("vereinorder_admin");
    expect(JSON.stringify(manifest)).not.toContain(process.env.DATABASE_URL);

    const listed = await service.listBackups();
    expect(listed[0]).toMatchObject({
      filename: result.filename,
      format: "POSTGRES_CUSTOM",
      verification: "STRUCTURE_VERIFIED",
      compatibility: "CURRENT",
      restoreAvailable: false,
    });
    const downloadPath = await service.getDownloadFilePath(result.filename);
    expect(path.basename(downloadPath)).toBe(result.filename);
    expect(fs.readFileSync(downloadPath)).toEqual(fs.readFileSync(dumpPath));
    const storage = await service.getStorageStatus(listed);
    expect(storage).toMatchObject({
      backupCount: 1,
      latestStructuredBackup: { filename: result.filename },
      creationAllowed: true,
    });
    expect(storage.backupBytes).toBeGreaterThan(result.sizeBytes);

    let verified;
    try {
      verified = await service.verifyRestoration(result.filename, {
        userId: admin.id,
        username: admin.username,
      });
    } catch (error) {
      const failureAudit = await prisma.auditLog.findFirst({
        where: {
          action: "RESTORE_VERIFICATION_FAILED",
          entityId: result.filename,
        },
        orderBy: { createdAt: "desc" },
      });
      throw new Error(
        `Wiederherstellungsprüfung fehlgeschlagen (${error instanceof Error ? error.name : "unbekannt"}): ${JSON.stringify(failureAudit?.details ?? null)}`,
      );
    }
    expect(verified).toMatchObject({
      verification: "RESTORE_VERIFIED",
      compatibility: "CURRENT",
      restoreVerificationAvailable: true,
    });
    const verifiedManifest = parseBackupManifest(
      fs.readFileSync(manifestPath, "utf8"),
    );
    expect(verifiedManifest.verification.restoration.status).toBe("PASSED");
    const leakedVerificationDatabases = await prisma.$queryRawUnsafe<
      Array<{ databaseName: string }>
    >(`SELECT datname AS "databaseName"
         FROM pg_catalog.pg_database
         WHERE datname LIKE 'vereinorder_restorecheck_%'`);
    expect(leakedVerificationDatabases).toEqual([]);
    const verificationAudit = await prisma.auditLog.findFirst({
      where: {
        action: "RESTORE_VERIFICATION_COMPLETED",
        entityId: result.filename,
      },
    });
    expect(verificationAudit).not.toBeNull();
  }, 120_000);
});
