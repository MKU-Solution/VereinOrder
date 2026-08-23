import {
  ConflictException,
  Inject,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { Prisma, PrismaClient } from "@vereinorder/database";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { PRISMA_CLIENT } from "../prisma/prisma.module";
import { MaintenanceStateService } from "../maintenance/maintenance-state.service";
import {
  BACKUP_MANIFEST_KIND,
  BACKUP_MANIFEST_VERSION,
  BackupCreatedBy,
  BackupManifest,
  BackupMigration,
  BackupModeSums,
  BackupSums,
  BackupTrigger,
  calculateSchemaFingerprint,
  parseBackupManifest,
  serializeBackupManifest,
} from "./backup-manifest";
import {
  PostgreSqlBackupTools,
  PostgreSqlToolError,
  buildPostgreSqlConnectionEnvironment,
} from "./postgresql-backup.tools";

const STARTUP_BACKUP_DELAY_MS = 90_000;
const SCHEDULE_DUE_AFTER_MS = 60 * 60 * 1000;
const SAFE_BACKUP_FILE =
  /^vereinorder_[A-Za-z0-9._-]+_(?:manual|schedule|prerestore|premigration)(?:-\d+)?\.(?:dump|manifest\.json)$/;
const LEGACY_BACKUP_FILE = /^vereinorder_(?:backup_)?[A-Za-z0-9._-]+\.json$/;

export type BackupToolState =
  | "OK"
  | "TOOL_MISSING"
  | "MAJOR_MISMATCH"
  | "DB_UNREACHABLE";

export interface BackupToolStatus {
  state: BackupToolState;
  checkedAt: string;
  enabled: boolean;
  serverVersionNum: number | null;
  serverMajor: number | null;
  dumpVersion: string | null;
  dumpMajor: number | null;
  restoreVersion: string | null;
  restoreMajor: number | null;
  message: string;
}

export interface BackupListItem {
  format: "POSTGRES_CUSTOM" | "LEGACY_JSON" | "CORRUPT";
  filename: string;
  artifacts: string[];
  sizeBytes: number;
  createdAt: string;
  checksumSha256: string;
  version: string;
  counts: Record<string, number>;
  trigger: BackupTrigger | "LEGACY" | null;
  verification:
    | "STRUCTURE_VERIFIED"
    | "RESTORE_VERIFIED"
    | "LEGACY"
    | "CORRUPT";
  compatibility: "CURRENT" | "OLDER" | "NEWER" | "DIVERGED" | "UNKNOWN";
  restoreAvailable: boolean;
  restoreUnavailableReason: string | null;
  downloadFiles: string[];
}

interface DatabaseIdentity {
  databaseName: string;
  serverVersionNum: number;
}

interface DatabaseMeasurements {
  tableNames: string[];
  counts: Record<string, number>;
  sums: BackupSums;
  migrations: BackupMigration[];
}

@Injectable()
export class NativeBackupService implements OnModuleInit, OnModuleDestroy {
  private readonly backupDir: string;
  private backupInProgress = false;
  private startupTimer: NodeJS.Timeout | null = null;
  private toolStatus: BackupToolStatus = {
    state: "DB_UNREACHABLE",
    checkedAt: new Date(0).toISOString(),
    enabled: false,
    serverVersionNum: null,
    serverMajor: null,
    dumpVersion: null,
    dumpMajor: null,
    restoreVersion: null,
    restoreMajor: null,
    message: "Werkzeugprüfung wurde noch nicht ausgeführt.",
  };

  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    private readonly maintenanceState: MaintenanceStateService,
    private readonly tools: PostgreSqlBackupTools,
  ) {
    this.backupDir =
      process.env.BACKUP_DIR || path.join(process.cwd(), "backups");
  }

  async onModuleInit(): Promise<void> {
    await this.ensureBackupDirectory();
    await this.refreshToolStatus();
    this.startupTimer = setTimeout(() => {
      void this.runScheduledBackupIfDue();
    }, STARTUP_BACKUP_DELAY_MS);
    this.startupTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.startupTimer) clearTimeout(this.startupTimer);
  }

  getToolStatus(): BackupToolStatus {
    return { ...this.toolStatus };
  }

  async refreshToolStatus(): Promise<BackupToolStatus> {
    const checkedAt = new Date().toISOString();
    try {
      const identity = await this.readDatabaseIdentity();
      const [dumpVersion, restoreVersion] = await Promise.all([
        this.tools.getDumpVersion(),
        this.tools.getRestoreVersion(),
      ]);
      const serverMajor = this.postgreSqlMajor(identity.serverVersionNum);
      const dumpMajor = this.toolMajor(dumpVersion);
      const restoreMajor = this.toolMajor(restoreVersion);
      const matching =
        dumpMajor === serverMajor && restoreMajor === serverMajor;
      this.toolStatus = {
        state: matching ? "OK" : "MAJOR_MISMATCH",
        checkedAt,
        enabled: matching,
        serverVersionNum: identity.serverVersionNum,
        serverMajor,
        dumpVersion,
        dumpMajor,
        restoreVersion,
        restoreMajor,
        message: matching
          ? "PostgreSQL-Server, pg_dump und pg_restore verwenden dieselbe Hauptversion."
          : "PostgreSQL-Server, pg_dump und pg_restore müssen dieselbe Hauptversion verwenden.",
      };
    } catch (error) {
      const toolError = error instanceof PostgreSqlToolError;
      this.toolStatus = {
        state: toolError ? "TOOL_MISSING" : "DB_UNREACHABLE",
        checkedAt,
        enabled: false,
        serverVersionNum: null,
        serverMajor: null,
        dumpVersion: null,
        dumpMajor: null,
        restoreVersion: null,
        restoreMajor: null,
        message: toolError
          ? "pg_dump oder pg_restore ist nicht verwendbar."
          : "Die PostgreSQL-Version konnte nicht geprüft werden.",
      };
    }
    return this.getToolStatus();
  }

  @Cron("5 * * * *")
  async runScheduledBackupIfDue(): Promise<void> {
    if (
      this.maintenanceState.read().phase === "LOCKED" ||
      this.backupInProgress
    ) {
      return;
    }
    try {
      const latest = (await this.listBackups()).find(
        (backup) => backup.format === "POSTGRES_CUSTOM",
      );
      if (
        latest &&
        Date.now() - new Date(latest.createdAt).getTime() <
          SCHEDULE_DUE_AFTER_MS
      ) {
        return;
      }
      await this.createBackup("SCHEDULE", null);
    } catch {
      // createBackup schreibt einen sicheren Auditfehler. Der Cron darf den
      // Prozess nicht durch eine unbehandelte Ablehnung destabilisieren.
    }
  }

  async createBackup(
    trigger: BackupTrigger,
    createdBy: BackupCreatedBy | null,
  ): Promise<BackupListItem> {
    if (this.backupInProgress) {
      throw new ConflictException("Eine Datensicherung läuft bereits.");
    }
    this.backupInProgress = true;
    let finalDumpPath: string | null = null;
    let finalManifestPath: string | null = null;
    let temporaryDumpPath: string | null = null;
    let temporaryManifestPath: string | null = null;
    let published = false;
    let audited = false;
    try {
      await this.ensureBackupDirectory();
      const status = await this.refreshToolStatus();
      if (!status.enabled) {
        throw new ServiceUnavailableException(status.message);
      }
      const databaseUrl = process.env.DATABASE_URL;
      if (!databaseUrl) {
        throw new ServiceUnavailableException(
          "DATABASE_URL fehlt; Datensicherung ist deaktiviert.",
        );
      }
      // Früh validieren, ohne die URL oder ihr Passwort zu protokollieren.
      buildPostgreSqlConnectionEnvironment(databaseUrl);

      const identity = await this.readDatabaseIdentity();
      const before = await this.measureDatabase();
      const stem = await this.reserveStem(trigger);
      const token = randomUUID();
      finalDumpPath = path.join(this.backupDir, `${stem}.dump`);
      finalManifestPath = path.join(this.backupDir, `${stem}.manifest.json`);
      temporaryDumpPath = path.join(
        this.backupDir,
        `.${stem}.${token}.partial.dump`,
      );
      temporaryManifestPath = path.join(
        this.backupDir,
        `.${stem}.${token}.partial.manifest.json`,
      );

      await this.tools.createDump(databaseUrl, temporaryDumpPath);
      await this.syncFile(temporaryDumpPath);
      const firstHash = await this.hashFile(temporaryDumpPath);
      const dumpStats = await fs.stat(temporaryDumpPath);
      if (!dumpStats.isFile()) throw new Error("BACKUP_NOT_REGULAR_FILE");
      await this.tools.verifyDump(temporaryDumpPath);
      const secondHash = await this.hashFile(temporaryDumpPath);
      if (firstHash !== secondHash) throw new Error("BACKUP_HASH_CHANGED");

      const after = await this.measureDatabase();
      if (
        JSON.stringify(before.tableNames) !==
          JSON.stringify(after.tableNames) ||
        JSON.stringify(before.migrations) !== JSON.stringify(after.migrations)
      ) {
        throw new Error("BACKUP_SCHEMA_CHANGED");
      }

      const manifest: BackupManifest = {
        kind: BACKUP_MANIFEST_KIND,
        manifestVersion: BACKUP_MANIFEST_VERSION,
        createdAt: new Date().toISOString(),
        trigger,
        createdBy,
        appVersion: await this.readAppVersion(),
        databaseName: identity.databaseName,
        serverVersionNum: identity.serverVersionNum,
        dumpToolVersion: status.dumpVersion!,
        migrations: before.migrations,
        schemaFingerprint: calculateSchemaFingerprint(before.migrations),
        countsBefore: before.counts,
        countsAfter: after.counts,
        sumsBefore: before.sums,
        sumsAfter: after.sums,
        dumpFile: path.basename(finalDumpPath),
        dumpSizeBytes: dumpStats.size,
        dumpSha256: secondHash,
        verification: {
          structure: {
            status: "PASSED",
            checkedAt: new Date().toISOString(),
            restoreToolVersion: status.restoreVersion!,
            observedSizeBytes: dumpStats.size,
            observedMtimeMs: Math.trunc(dumpStats.mtimeMs),
          },
          restoration: { status: "NOT_RUN" },
        },
      };
      // Der strikte Parser prüft auch den selbst erzeugten Vertrag, bevor
      // das Manifest zum Commit-Marker der Sicherung wird.
      parseBackupManifest(serializeBackupManifest(manifest));
      await fs.writeFile(
        temporaryManifestPath,
        serializeBackupManifest(manifest),
        { encoding: "utf8", mode: 0o600, flag: "wx" },
      );
      await this.syncFile(temporaryManifestPath);
      await fs.chmod(temporaryDumpPath, 0o600).catch(() => undefined);
      await fs.rename(temporaryDumpPath, finalDumpPath);
      temporaryDumpPath = null;
      await fs.rename(temporaryManifestPath, finalManifestPath);
      temporaryManifestPath = null;
      published = true;
      await this.syncDirectory();

      await this.writeAudit(
        "BACKUP_CREATED",
        path.basename(finalDumpPath),
        createdBy,
        {
          trigger,
          sizeBytes: dumpStats.size,
          checksumSha256: secondHash,
          verification: "STRUCTURE_VERIFIED",
        },
      );
      audited = true;
      return this.toListItem(manifest);
    } catch (error) {
      await this.removeIfPresent(temporaryDumpPath);
      await this.removeIfPresent(temporaryManifestPath);
      // Eine erfolgreiche Sicherung muss auditierbar sein. Schlägt der
      // Auditeintrag nach der Veröffentlichung fehl, wird das Paar wieder
      // entfernt, damit kein unauditierter Erfolg bestehen bleibt.
      if (published && !audited) {
        await this.removeIfPresent(finalManifestPath);
        await this.removeIfPresent(finalDumpPath);
      }
      // Ein Dump ohne Manifest ist kein veröffentlichter Sicherungsstand.
      if (finalDumpPath && finalManifestPath) {
        const manifestExists = await this.exists(finalManifestPath);
        if (!manifestExists) await this.removeIfPresent(finalDumpPath);
      }
      await this.writeAudit("BACKUP_FAILED", "backup", createdBy, {
        trigger,
        errorCode: this.safeErrorCode(error),
      }).catch(() => undefined);
      if (
        error instanceof ConflictException ||
        error instanceof ServiceUnavailableException
      ) {
        throw error;
      }
      throw new ServiceUnavailableException(
        "Die Datensicherung konnte nicht sicher erstellt und geprüft werden.",
      );
    } finally {
      this.backupInProgress = false;
    }
  }

  async listBackups(): Promise<BackupListItem[]> {
    await this.ensureBackupDirectory();
    const names = await fs.readdir(this.backupDir);
    const currentMigrations = await this.readMigrations().catch(() => null);
    const items: BackupListItem[] = [];

    for (const name of names.filter((entry) =>
      entry.endsWith(".manifest.json"),
    )) {
      const manifestPath = path.join(this.backupDir, name);
      try {
        const manifest = parseBackupManifest(
          await fs.readFile(manifestPath, "utf8"),
        );
        if (name !== manifest.dumpFile.replace(/\.dump$/, ".manifest.json"))
          throw new Error("MANIFEST_NAME_MISMATCH");
        if (path.dirname(manifest.dumpFile) !== ".")
          throw new Error("BAD_NAME");
        const dumpPath = path.join(this.backupDir, manifest.dumpFile);
        const dumpStats = await fs.lstat(dumpPath);
        if (!dumpStats.isFile() || dumpStats.isSymbolicLink())
          throw new Error("BAD_DUMP");
        const cached =
          manifest.verification.structure.status === "PASSED" &&
          manifest.verification.structure.observedSizeBytes ===
            dumpStats.size &&
          manifest.verification.structure.observedMtimeMs ===
            Math.trunc(dumpStats.mtimeMs);
        if (!cached) {
          const checksum = await this.hashFile(dumpPath);
          if (checksum !== manifest.dumpSha256)
            throw new Error("HASH_MISMATCH");
          await this.tools.verifyDump(dumpPath);
          manifest.verification.structure = {
            status: "PASSED",
            checkedAt: new Date().toISOString(),
            restoreToolVersion:
              this.toolStatus.restoreVersion ||
              (await this.tools.getRestoreVersion()),
            observedSizeBytes: dumpStats.size,
            observedMtimeMs: Math.trunc(dumpStats.mtimeMs),
          };
          await this.replaceManifest(manifestPath, manifest);
        }
        const item = this.toListItem(manifest);
        item.compatibility = currentMigrations
          ? this.compareMigrations(manifest.migrations, currentMigrations)
          : "UNKNOWN";
        items.push(item);
      } catch {
        const stat = await fs.stat(manifestPath).catch(() => null);
        items.push({
          format: "CORRUPT",
          filename: name,
          artifacts: [name],
          sizeBytes: stat?.size ?? 0,
          createdAt: (stat?.mtime ?? new Date(0)).toISOString(),
          checksumSha256: "",
          version: "unbekannt",
          counts: {},
          trigger: null,
          verification: "CORRUPT",
          compatibility: "UNKNOWN",
          restoreAvailable: false,
          restoreUnavailableReason:
            "Manifest oder Dump ist beschädigt oder unvollständig.",
          downloadFiles: [],
        });
      }
    }

    for (const name of names.filter(
      (entry) =>
        LEGACY_BACKUP_FILE.test(entry) && !entry.endsWith(".manifest.json"),
    )) {
      try {
        const filePath = path.join(this.backupDir, name);
        const stat = await fs.lstat(filePath);
        if (!stat.isFile() || stat.isSymbolicLink()) continue;
        const content = await fs.readFile(filePath, "utf8");
        const parsed = JSON.parse(content) as {
          timestamp?: string;
          version?: string;
          counts?: Record<string, number>;
        };
        items.push({
          format: "LEGACY_JSON",
          filename: name,
          artifacts: [name],
          sizeBytes: stat.size,
          createdAt: parsed.timestamp || stat.mtime.toISOString(),
          checksumSha256: createHash("sha256").update(content).digest("hex"),
          version: parsed.version || "0.1.0",
          counts: parsed.counts || {},
          trigger: "LEGACY",
          verification: "LEGACY",
          compatibility: "UNKNOWN",
          restoreAvailable: true,
          restoreUnavailableReason: null,
          downloadFiles: [name],
        });
      } catch {
        // Defekte Altdateien werden als defekt sichtbar statt verschluckt.
        const stat = await fs
          .stat(path.join(this.backupDir, name))
          .catch(() => null);
        items.push({
          format: "CORRUPT",
          filename: name,
          artifacts: [name],
          sizeBytes: stat?.size ?? 0,
          createdAt: (stat?.mtime ?? new Date(0)).toISOString(),
          checksumSha256: "",
          version: "unbekannt",
          counts: {},
          trigger: "LEGACY",
          verification: "CORRUPT",
          compatibility: "UNKNOWN",
          restoreAvailable: false,
          restoreUnavailableReason: "Die JSON-Altsicherung ist beschädigt.",
          downloadFiles: [],
        });
      }
    }

    return items.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }

  async getDownloadFilePath(filename: string): Promise<string> {
    if (
      !SAFE_BACKUP_FILE.test(filename) &&
      !LEGACY_BACKUP_FILE.test(filename)
    ) {
      throw new ConflictException(
        "Diese Sicherungsdatei darf nicht heruntergeladen werden.",
      );
    }
    const filePath = path.join(this.backupDir, filename);
    const originalStat = await fs.lstat(filePath).catch(() => null);
    if (
      !originalStat ||
      !originalStat.isFile() ||
      originalStat.isSymbolicLink()
    ) {
      throw new ConflictException(
        "Sicherungsdatei wurde nicht gefunden oder ist keine reguläre Datei.",
      );
    }
    const resolvedDirectory = await fs.realpath(this.backupDir);
    const resolvedFile = await fs.realpath(filePath).catch(() => null);
    if (!resolvedFile || path.dirname(resolvedFile) !== resolvedDirectory) {
      throw new ConflictException("Sicherungsdatei wurde nicht gefunden.");
    }
    return resolvedFile;
  }

  private async readDatabaseIdentity(): Promise<DatabaseIdentity> {
    const rows = await this.prisma.$queryRawUnsafe<
      Array<{ databaseName: string; serverVersionNum: string }>
    >(`SELECT current_database() AS "databaseName",
              current_setting('server_version_num') AS "serverVersionNum"`);
    const row = rows[0];
    return {
      databaseName: row.databaseName,
      serverVersionNum: Number(row.serverVersionNum),
    };
  }

  private async measureDatabase(): Promise<DatabaseMeasurements> {
    const [
      tableRows,
      migrations,
      orderRows,
      paymentRows,
      voucherRows,
      auditRows,
    ] = await Promise.all([
      this.prisma.$queryRawUnsafe<Array<{ tableName: string }>>(
        `SELECT tablename AS "tableName"
           FROM pg_catalog.pg_tables
           WHERE schemaname = 'public'
           ORDER BY tablename`,
      ),
      this.readMigrations(),
      this.prisma.$queryRawUnsafe<
        Array<{ dataMode: string; amount: bigint }>
      >(`SELECT "dataMode"::text AS "dataMode",
                  COALESCE(SUM("totalAmount"), 0)::bigint AS amount
           FROM "Order" GROUP BY "dataMode"`),
      this.prisma.$queryRawUnsafe<
        Array<{ dataMode: string; method: string; amount: bigint }>
      >(`SELECT o."dataMode"::text AS "dataMode", p.method::text AS method,
                  COALESCE(SUM(p.amount), 0)::bigint AS amount
           FROM "Payment" p JOIN "Order" o ON o.id = p."orderId"
           GROUP BY o."dataMode", p.method`),
      this.prisma.$queryRawUnsafe<
        Array<{ dataMode: string; status: string; count: bigint }>
      >(`SELECT o."dataMode"::text AS "dataMode", v.status::text AS status,
                  COUNT(*)::bigint AS count
           FROM "ProductVoucher" v JOIN "Order" o ON o.id = v."orderId"
           GROUP BY o."dataMode", v.status`),
      this.prisma.$queryRawUnsafe<
        Array<{ total: bigint; withUser: bigint }>
      >(`SELECT COUNT(*)::bigint AS total,
                  COUNT(*) FILTER (WHERE "userId" IS NOT NULL)::bigint AS "withUser"
           FROM "AuditLog"`),
    ]);

    const tableNames = tableRows.map((row) => row.tableName);
    const counts: Record<string, number> = {};
    for (const tableName of tableNames) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(tableName)) {
        throw new Error("UNSAFE_TABLE_NAME");
      }
      const quoted = `"${tableName.replace(/"/g, '""')}"`;
      const result = await this.prisma.$queryRawUnsafe<
        Array<{ count: bigint }>
      >(`SELECT COUNT(*)::bigint AS count FROM ${quoted}`);
      counts[tableName] = this.safeNumber(result[0].count);
    }

    const byDataMode: Record<string, BackupModeSums> = {
      LIVE: { orderTotalAmount: 0, paymentAmount: {}, voucherCount: {} },
      TEST: { orderTotalAmount: 0, paymentAmount: {}, voucherCount: {} },
    };
    const mode = (name: string) =>
      (byDataMode[name] ??= {
        orderTotalAmount: 0,
        paymentAmount: {},
        voucherCount: {},
      });
    for (const row of orderRows)
      mode(row.dataMode).orderTotalAmount = this.safeNumber(row.amount);
    for (const row of paymentRows)
      mode(row.dataMode).paymentAmount[row.method] = this.safeNumber(
        row.amount,
      );
    for (const row of voucherRows)
      mode(row.dataMode).voucherCount[row.status] = this.safeNumber(row.count);

    return {
      tableNames,
      counts,
      migrations,
      sums: {
        byDataMode,
        auditLogCount: this.safeNumber(auditRows[0].total),
        auditLogWithUserCount: this.safeNumber(auditRows[0].withUser),
      },
    };
  }

  private async readMigrations(): Promise<BackupMigration[]> {
    return this.prisma.$queryRawUnsafe<BackupMigration[]>(
      `SELECT migration_name AS name, checksum
       FROM "_prisma_migrations"
       WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
       ORDER BY migration_name`,
    );
  }

  private toListItem(manifest: BackupManifest): BackupListItem {
    const manifestFile = manifest.dumpFile.replace(/\.dump$/, ".manifest.json");
    return {
      format: "POSTGRES_CUSTOM",
      filename: manifest.dumpFile,
      artifacts: [manifest.dumpFile, manifestFile],
      sizeBytes: manifest.dumpSizeBytes,
      createdAt: manifest.createdAt,
      checksumSha256: manifest.dumpSha256,
      version: `${manifest.manifestVersion} / ${manifest.appVersion}`,
      counts: manifest.countsAfter,
      trigger: manifest.trigger,
      verification:
        manifest.verification.restoration.status === "PASSED"
          ? "RESTORE_VERIFIED"
          : "STRUCTURE_VERIFIED",
      compatibility: "UNKNOWN",
      restoreAvailable: false,
      restoreUnavailableReason:
        "Native Wiederherstellung folgt im nächsten abgesicherten #67-Schnitt.",
      downloadFiles: [manifest.dumpFile, manifestFile],
    };
  }

  private compareMigrations(
    backup: BackupMigration[],
    current: BackupMigration[],
  ): BackupListItem["compatibility"] {
    const pair = (migration: BackupMigration) =>
      `${migration.name}\u0000${migration.checksum}`;
    const left = backup.map(pair);
    const right = current.map(pair);
    if (JSON.stringify(left) === JSON.stringify(right)) return "CURRENT";
    const isPrefix = (prefix: string[], full: string[]) =>
      prefix.every((value, index) => full[index] === value);
    if (left.length < right.length && isPrefix(left, right)) return "OLDER";
    if (right.length < left.length && isPrefix(right, left)) return "NEWER";
    return "DIVERGED";
  }

  private async reserveStem(trigger: BackupTrigger): Promise<string> {
    const triggerName = trigger.toLowerCase().replace("_", "");
    const timestamp = new Date().toISOString().replace(/:/g, "-");
    const base = `vereinorder_${timestamp}_${triggerName}`;
    for (let suffix = 0; suffix < 100; suffix += 1) {
      const stem = suffix === 0 ? base : `${base}-${suffix}`;
      if (
        !(await this.exists(path.join(this.backupDir, `${stem}.dump`))) &&
        !(await this.exists(path.join(this.backupDir, `${stem}.manifest.json`)))
      ) {
        return stem;
      }
    }
    throw new ConflictException("Kein eindeutiger Sicherungsname verfügbar.");
  }

  private async ensureBackupDirectory(): Promise<void> {
    await fs.mkdir(this.backupDir, { recursive: true, mode: 0o700 });
    await fs.chmod(this.backupDir, 0o700).catch(() => undefined);
  }

  private async hashFile(filename: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = createHash("sha256");
      const stream = createReadStream(filename);
      stream.on("error", reject);
      stream.on("data", (chunk) => hash.update(chunk));
      stream.on("end", () => resolve(hash.digest("hex")));
    });
  }

  private async syncFile(filename: string): Promise<void> {
    const handle = await fs.open(filename, "r+");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  private async syncDirectory(): Promise<void> {
    const handle = await fs.open(this.backupDir, "r").catch(() => null);
    if (!handle) return;
    try {
      await handle.sync().catch(() => undefined);
    } finally {
      await handle.close();
    }
  }

  private async replaceManifest(
    manifestPath: string,
    manifest: BackupManifest,
  ): Promise<void> {
    const temporary = `${manifestPath}.${randomUUID()}.partial`;
    await fs.writeFile(temporary, serializeBackupManifest(manifest), {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    await this.syncFile(temporary);
    await fs.rename(temporary, manifestPath);
    await this.syncDirectory();
  }

  private async readAppVersion(): Promise<string> {
    if (process.env.APP_VERSION) return process.env.APP_VERSION;
    try {
      const packagePath = path.resolve(__dirname, "../../package.json");
      const parsed = JSON.parse(await fs.readFile(packagePath, "utf8")) as {
        version?: string;
      };
      return parsed.version || "0.0.0-unknown";
    } catch {
      return "0.0.0-unknown";
    }
  }

  private async writeAudit(
    action: string,
    entityId: string,
    createdBy: BackupCreatedBy | null,
    details: Prisma.InputJsonValue,
  ): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        action,
        entityId,
        entityType: "Backup",
        userId: createdBy?.userId || null,
        details,
      },
    });
  }

  private toolMajor(version: string): number {
    const match = version.match(/(\d+)(?:\.\d+)?/);
    if (!match)
      throw new PostgreSqlToolError(
        "TOOL_FAILED",
        "Werkzeugversion ist unlesbar.",
      );
    return Number(match[1]);
  }

  private postgreSqlMajor(serverVersionNum: number): number {
    return Math.floor(serverVersionNum / 10_000);
  }

  private safeNumber(value: bigint | number): number {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 0) {
      throw new Error("BACKUP_METRIC_OUT_OF_RANGE");
    }
    return number;
  }

  private safeErrorCode(error: unknown): string {
    if (error instanceof PostgreSqlToolError) return error.code;
    if (error instanceof ServiceUnavailableException)
      return "BACKUP_UNAVAILABLE";
    if (error instanceof ConflictException) return "BACKUP_CONFLICT";
    if (error instanceof Error && /^[A-Z0-9_]{3,100}$/.test(error.message))
      return error.message;
    return "BACKUP_FAILED";
  }

  private async exists(filename: string): Promise<boolean> {
    return fs
      .access(filename)
      .then(() => true)
      .catch(() => false);
  }

  private async removeIfPresent(filename: string | null): Promise<void> {
    if (!filename) return;
    await fs.rm(filename, { force: true }).catch(() => undefined);
  }
}
