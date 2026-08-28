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
  buildPostgreSqlDatabaseUrl,
} from "./postgresql-backup.tools";
import { PrepareNativeRestoreDto } from "./backup.dto";

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
  restoreVerificationAvailable: boolean;
  restoreVerificationUnavailableReason: string | null;
  restorePreparationAvailable: boolean;
  restorePreparationUnavailableReason: string | null;
  downloadFiles: string[];
}

export interface RestorePreparationResult {
  selectedBackup: BackupListItem;
  safetyBackup: BackupListItem;
  activeCashierSessions: number;
  liveDatabaseChanged: false;
}

export interface BackupRetentionPolicy {
  hourlyKeep: number;
  dailyKeep: number;
  eventKeep: number;
  minFreeBytes: number;
}

export interface BackupStorageStatus {
  totalBytes: number;
  freeBytes: number;
  backupCount: number;
  backupBytes: number;
  latestStructuredBackup: BackupListItem | null;
  latestRestoredBackup: BackupListItem | null;
  retention: BackupRetentionPolicy;
  creationAllowed: boolean;
}

interface DatabaseIdentity {
  databaseName: string;
  serverVersionNum: number;
}

export interface DatabaseMeasurements {
  tableNames: string[];
  counts: Record<string, number>;
  sums: BackupSums;
  migrations: BackupMigration[];
}

@Injectable()
export class NativeBackupService implements OnModuleInit, OnModuleDestroy {
  private readonly backupDir: string;
  private backupInProgress = false;
  private restoreVerificationInProgress = false;
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
      this.backupInProgress ||
      this.restoreVerificationInProgress
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
    if (this.backupInProgress || this.restoreVerificationInProgress) {
      throw new ConflictException("Eine Sicherungsprüfung läuft bereits.");
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
      await this.assertMinimumFreeSpace();
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
      await this.rotateBackups(createdBy).catch(async (rotationError) => {
        await this.writeAudit("BACKUP_ROTATION_FAILED", "backup", createdBy, {
          errorCode: this.safeErrorCode(rotationError),
        }).catch(() => undefined);
      });
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
        this.applyRestoreVerificationAvailability(item);
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
          restoreVerificationAvailable: false,
          restoreVerificationUnavailableReason:
            "Beschädigte oder unvollständige Sicherungen können nicht geprüft werden.",
          restorePreparationAvailable: false,
          restorePreparationUnavailableReason:
            "Beschädigte oder unvollständige Sicherungen können nicht vorbereitet werden.",
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
          restoreVerificationAvailable: false,
          restoreVerificationUnavailableReason:
            "JSON-Altsicherungen werden in einem eigenen Übernahmeschritt behandelt.",
          restorePreparationAvailable: false,
          restorePreparationUnavailableReason:
            "JSON-Altsicherungen gehören nicht zum nativen Wiederherstellungsweg.",
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
          restoreVerificationAvailable: false,
          restoreVerificationUnavailableReason:
            "Die JSON-Altsicherung ist beschädigt.",
          restorePreparationAvailable: false,
          restorePreparationUnavailableReason:
            "Die JSON-Altsicherung ist beschädigt.",
          downloadFiles: [],
        });
      }
    }

    return items.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }

  async getStorageStatus(
    listedBackups?: BackupListItem[],
  ): Promise<BackupStorageStatus> {
    await this.ensureBackupDirectory();
    const backups = listedBackups ?? (await this.listBackups());
    const capacity = await this.readStorageCapacity();
    const names = await fs.readdir(this.backupDir);
    let backupBytes = 0;
    for (const name of names) {
      if (!SAFE_BACKUP_FILE.test(name) && !LEGACY_BACKUP_FILE.test(name))
        continue;
      const stat = await fs
        .lstat(path.join(this.backupDir, name))
        .catch(() => null);
      if (stat?.isFile() && !stat.isSymbolicLink()) backupBytes += stat.size;
    }
    const latestStructuredBackup =
      backups.find(
        (backup) =>
          backup.verification === "STRUCTURE_VERIFIED" ||
          backup.verification === "RESTORE_VERIFIED",
      ) ?? null;
    const latestRestoredBackup =
      backups.find((backup) => backup.verification === "RESTORE_VERIFIED") ??
      null;
    const retention = this.readRetentionPolicy();
    return {
      ...capacity,
      backupCount: backups.length,
      backupBytes,
      latestStructuredBackup,
      latestRestoredBackup,
      retention,
      creationAllowed: capacity.freeBytes >= retention.minFreeBytes,
    };
  }

  async verifyRestoration(
    filename: string,
    verifiedBy: BackupCreatedBy,
  ): Promise<BackupListItem> {
    if (this.backupInProgress || this.restoreVerificationInProgress) {
      throw new ConflictException("Eine Sicherungsprüfung läuft bereits.");
    }
    if (!filename.endsWith(".dump") || !SAFE_BACKUP_FILE.test(filename)) {
      throw new ConflictException(
        "Nur ein nativer PostgreSQL-Dump kann wiederherstellungsgeprüft werden.",
      );
    }

    this.restoreVerificationInProgress = true;
    const databaseUrl = process.env.DATABASE_URL;
    const verificationDatabase = `vereinorder_restorecheck_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
    let manifest: BackupManifest | null = null;
    let manifestPath: string | null = null;
    let verificationAttempted = false;
    let verificationDatabaseCreated = false;
    let verificationPhase = "PRECHECK";
    let failure: unknown = null;

    try {
      if (!databaseUrl) {
        throw new ServiceUnavailableException(
          "DATABASE_URL fehlt; die Wiederherstellungsprüfung ist deaktiviert.",
        );
      }
      buildPostgreSqlConnectionEnvironment(databaseUrl);
      const status = await this.refreshToolStatus();
      if (!status.enabled) {
        throw new ServiceUnavailableException(status.message);
      }

      const dumpPath = await this.getDownloadFilePath(filename);
      const manifestName = filename.replace(/\.dump$/, ".manifest.json");
      manifestPath = await this.getDownloadFilePath(manifestName);
      manifest = parseBackupManifest(await fs.readFile(manifestPath, "utf8"));
      if (manifest.dumpFile !== filename) {
        throw new ConflictException(
          "Dump und Sicherungsmanifest gehören nicht zusammen.",
        );
      }

      const dumpStats = await fs.lstat(dumpPath);
      if (
        !dumpStats.isFile() ||
        dumpStats.isSymbolicLink() ||
        dumpStats.size !== manifest.dumpSizeBytes
      ) {
        throw new ConflictException(
          "Die Sicherungsdatei hat nicht die im Manifest ausgewiesene Größe.",
        );
      }
      if ((await this.hashFile(dumpPath)) !== manifest.dumpSha256) {
        throw new ConflictException(
          "Die SHA-256-Prüfsumme der Sicherung stimmt nicht.",
        );
      }
      await this.tools.verifyDump(dumpPath);

      const currentMigrations = await this.readMigrations();
      const compatibility = this.compareMigrations(
        manifest.migrations,
        currentMigrations,
      );
      if (compatibility !== "CURRENT") {
        throw new ConflictException(
          compatibility === "OLDER"
            ? "Diese Sicherung ist älter. Die abgesicherte Vorwärtsmigration der Nebendatenbank folgt in einem eigenen Schnitt."
            : "Der Migrationsstand dieser Sicherung ist nicht mit der aktuellen Datenbank vereinbar.",
        );
      }

      verificationAttempted = true;
      verificationPhase = "CREATE_DATABASE";
      await this.tools.createVerificationDatabase(
        databaseUrl,
        verificationDatabase,
      );
      verificationDatabaseCreated = true;
      verificationPhase = "RESTORE_DUMP";
      await this.tools.restoreDump(databaseUrl, verificationDatabase, dumpPath);

      const verificationUrl = buildPostgreSqlDatabaseUrl(
        databaseUrl,
        verificationDatabase,
      );
      const verificationPrisma = this.createVerificationClient(verificationUrl);
      try {
        verificationPhase = "MEASURE_DATABASE";
        const restored = await this.measureDatabase(verificationPrisma);
        const unvalidatedForeignKeys = await verificationPrisma.$queryRawUnsafe<
          Array<{ count: bigint }>
        >(
          `SELECT COUNT(*)::bigint AS count
               FROM pg_catalog.pg_constraint
               WHERE contype = 'f' AND NOT convalidated`,
        );
        if (this.safeNumber(unvalidatedForeignKeys[0].count) !== 0) {
          throw new Error("RESTORE_UNVALIDATED_FOREIGN_KEYS");
        }
        if (
          this.stableJson(restored.tableNames) !==
            this.stableJson(Object.keys(manifest.countsAfter).sort()) ||
          this.stableJson(restored.counts) !==
            this.stableJson(manifest.countsAfter) ||
          this.stableJson(restored.sums) !==
            this.stableJson(manifest.sumsAfter) ||
          this.stableJson(restored.migrations) !==
            this.stableJson(manifest.migrations)
        ) {
          throw new Error("RESTORE_MEASUREMENTS_MISMATCH");
        }
      } finally {
        await verificationPrisma.$disconnect();
      }

      if ((await this.hashFile(dumpPath)) !== manifest.dumpSha256) {
        throw new Error("BACKUP_HASH_CHANGED");
      }
    } catch (error) {
      failure = error;
    }

    if (verificationDatabaseCreated && databaseUrl) {
      try {
        await this.tools.dropVerificationDatabase(
          databaseUrl,
          verificationDatabase,
        );
      } catch {
        verificationPhase = "DROP_DATABASE";
        failure = new Error("RESTORE_CLEANUP_FAILED");
      }
    }

    try {
      if (failure) {
        if (verificationAttempted && manifest && manifestPath) {
          manifest.verification.restoration = {
            status: "FAILED",
            checkedAt: new Date().toISOString(),
          };
          await this.replaceManifest(manifestPath, manifest).catch(
            () => undefined,
          );
        }
        await this.writeAudit(
          "RESTORE_VERIFICATION_FAILED",
          filename,
          verifiedBy,
          { phase: verificationPhase, errorCode: this.safeErrorCode(failure) },
        ).catch(() => undefined);
        if (
          failure instanceof ConflictException ||
          failure instanceof ServiceUnavailableException
        ) {
          throw failure;
        }
        throw new ServiceUnavailableException(
          "Die Sicherung konnte nicht vollständig in einer isolierten Prüfdatenbank wiederhergestellt werden.",
        );
      }

      const previousRestoration = manifest!.verification.restoration;
      manifest!.verification.restoration = {
        status: "PASSED",
        checkedAt: new Date().toISOString(),
      };
      await this.replaceManifest(manifestPath!, manifest!);
      try {
        await this.writeAudit(
          "RESTORE_VERIFICATION_COMPLETED",
          filename,
          verifiedBy,
          {
            checksumSha256: manifest!.dumpSha256,
            counts: manifest!.countsAfter,
          },
        );
      } catch (auditError) {
        manifest!.verification.restoration = previousRestoration;
        await this.replaceManifest(manifestPath!, manifest!).catch(
          () => undefined,
        );
        throw auditError;
      }

      const result = this.toListItem(manifest!);
      result.compatibility = "CURRENT";
      this.applyRestoreVerificationAvailability(result);
      return result;
    } catch (error) {
      if (
        error instanceof ConflictException ||
        error instanceof ServiceUnavailableException
      ) {
        throw error;
      }
      throw new ServiceUnavailableException(
        "Die Wiederherstellungsprüfung konnte nicht sicher abgeschlossen und auditiert werden.",
      );
    } finally {
      this.restoreVerificationInProgress = false;
    }
  }

  async prepareRestoration(
    filename: string,
    confirmation: PrepareNativeRestoreDto,
    preparedBy: BackupCreatedBy,
  ): Promise<RestorePreparationResult> {
    // /backup ist auch bei LOCKED erreichbar. Deshalb muss diese Prüfung im
    // Dienst selbst und zwingend vor dem ersten Dateizugriff stehen.
    if (this.maintenanceState.read().phase !== "LOCKED") {
      const error = new ConflictException(
        "Die Wiederherstellung kann erst im vollständig gesperrten Wartungsmodus vorbereitet werden.",
      );
      await this.writeAudit("RESTORE_REJECTED", filename, preparedBy, {
        phase: "MAINTENANCE_STATE",
        errorCode: "RESTORE_REQUIRES_LOCKED",
      }).catch(() => undefined);
      throw error;
    }

    let safetyBackup: BackupListItem | null = null;
    let phase = "PRECHECK";
    try {
      if (!filename.endsWith(".dump") || !SAFE_BACKUP_FILE.test(filename)) {
        throw new ConflictException(
          "Nur ein nativer PostgreSQL-Dump kann für die Wiederherstellung vorbereitet werden.",
        );
      }
      if (confirmation.queuesConfirmed !== true) {
        throw new ConflictException(
          "Bitte bestätigen, dass alle Kassen online und ihre Warteschlangen leer sind.",
        );
      }

      const dumpPath = await this.getDownloadFilePath(filename);
      const manifestPath = await this.getDownloadFilePath(
        filename.replace(/\.dump$/, ".manifest.json"),
      );
      const manifest = parseBackupManifest(
        await fs.readFile(manifestPath, "utf8"),
      );
      if (
        manifest.dumpFile !== filename ||
        confirmation.confirmedCreatedAt !== manifest.createdAt
      ) {
        throw new ConflictException(
          "Der eingegebene Sicherungszeitpunkt stimmt nicht exakt mit dem Manifest überein.",
        );
      }

      const dumpStats = await fs.lstat(dumpPath);
      if (
        !dumpStats.isFile() ||
        dumpStats.isSymbolicLink() ||
        dumpStats.size !== manifest.dumpSizeBytes ||
        (await this.hashFile(dumpPath)) !== manifest.dumpSha256
      ) {
        throw new ConflictException(
          "Die Sicherungsdatei stimmt nicht mit ihrem Manifest überein.",
        );
      }
      await this.tools.verifyDump(dumpPath);
      const compatibility = this.compareMigrations(
        manifest.migrations,
        await this.readMigrations(),
      );
      if (compatibility !== "CURRENT") {
        throw new ConflictException(
          "Nur eine Sicherung mit identischem Migrationsstand kann derzeit vorbereitet werden.",
        );
      }

      const activeCashierSessions = await this.prisma.cashierSession.count({
        where: { status: "ACTIVE" },
      });
      phase = "PRE_RESTORE_BACKUP";
      safetyBackup = await this.createBackup("PRE_RESTORE", preparedBy);
      phase = "ISOLATED_VERIFICATION";
      const selectedBackup = await this.verifyRestoration(filename, preparedBy);
      phase = "AUDIT";
      await this.writeAudit(
        "RESTORE_PREPARATION_COMPLETED",
        filename,
        preparedBy,
        {
          checksumSha256: manifest.dumpSha256,
          createdAt: manifest.createdAt,
          activeCashierSessions,
          confirmations: { queuesConfirmed: true },
          safetyBackupFilename: safetyBackup.filename,
          liveDatabaseChanged: false,
        },
      );
      return {
        selectedBackup,
        safetyBackup,
        activeCashierSessions,
        liveDatabaseChanged: false,
      };
    } catch (error) {
      await this.writeAudit("RESTORE_REJECTED", filename, preparedBy, {
        phase,
        errorCode: this.safeErrorCode(error),
        safetyBackupFilename: safetyBackup?.filename ?? null,
        liveDatabaseChanged: false,
      }).catch(() => undefined);
      if (
        error instanceof ConflictException ||
        error instanceof ServiceUnavailableException
      ) {
        throw error;
      }
      throw new ServiceUnavailableException(
        "Die Wiederherstellung konnte nicht sicher vorbereitet werden. Die Festdatenbank wurde nicht verändert.",
      );
    }
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

  async measureDatabase(
    prisma: PrismaClient = this.prisma,
  ): Promise<DatabaseMeasurements> {
    const [
      tableRows,
      migrations,
      orderRows,
      paymentRows,
      voucherRows,
      valueVoucherRows,
      valueVoucherMovementRows,
      auditRows,
    ] = await Promise.all([
      prisma.$queryRawUnsafe<Array<{ tableName: string }>>(
        `SELECT tablename AS "tableName"
           FROM pg_catalog.pg_tables
           WHERE schemaname = 'public'
           ORDER BY tablename`,
      ),
      this.readMigrations(prisma),
      prisma.$queryRawUnsafe<
        Array<{ dataMode: string; amount: bigint }>
      >(`SELECT "dataMode"::text AS "dataMode",
                  COALESCE(SUM("totalAmount"), 0)::bigint AS amount
           FROM "Order" GROUP BY "dataMode"`),
      prisma.$queryRawUnsafe<
        Array<{ dataMode: string; method: string; amount: bigint }>
      >(`SELECT o."dataMode"::text AS "dataMode", p.method::text AS method,
                  COALESCE(SUM(p.amount), 0)::bigint AS amount
           FROM "Payment" p JOIN "Order" o ON o.id = p."orderId"
           GROUP BY o."dataMode", p.method`),
      prisma.$queryRawUnsafe<
        Array<{ dataMode: string; status: string; count: bigint }>
      >(`SELECT o."dataMode"::text AS "dataMode", v.status::text AS status,
                  COUNT(*)::bigint AS count
           FROM "ProductVoucher" v JOIN "Order" o ON o.id = v."orderId"
           GROUP BY o."dataMode", v.status`),
      prisma.$queryRawUnsafe<
        Array<{
          dataMode: string;
          status: string;
          count: bigint;
          balance: bigint;
        }>
      >(`SELECT "dataMode"::text AS "dataMode", status::text AS status,
                  COUNT(*)::bigint AS count,
                  COALESCE(SUM("currentBalance"), 0)::bigint AS balance
           FROM "ValueVoucher" GROUP BY "dataMode", status`),
      prisma.$queryRawUnsafe<Array<{ dataMode: string; balance: bigint }>>(
        `SELECT "dataMode"::text AS "dataMode",
                COALESCE(SUM("balanceDelta"), 0)::bigint AS balance
           FROM "ValueVoucherMovement" GROUP BY "dataMode"`,
      ),
      prisma.$queryRawUnsafe<
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
      const result = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT COUNT(*)::bigint AS count FROM ${quoted}`,
      );
      counts[tableName] = this.safeNumber(result[0].count);
    }

    const byDataMode: Record<string, BackupModeSums> = {
      LIVE: {
        orderTotalAmount: 0,
        paymentAmount: {},
        voucherCount: {},
        valueVoucherBalance: 0,
        valueVoucherMovementBalance: 0,
        valueVoucherCount: {},
      },
      TEST: {
        orderTotalAmount: 0,
        paymentAmount: {},
        voucherCount: {},
        valueVoucherBalance: 0,
        valueVoucherMovementBalance: 0,
        valueVoucherCount: {},
      },
    };
    const mode = (name: string) =>
      (byDataMode[name] ??= {
        orderTotalAmount: 0,
        paymentAmount: {},
        voucherCount: {},
        valueVoucherBalance: 0,
        valueVoucherMovementBalance: 0,
        valueVoucherCount: {},
      });
    for (const row of orderRows)
      mode(row.dataMode).orderTotalAmount = this.safeNumber(row.amount);
    for (const row of paymentRows)
      mode(row.dataMode).paymentAmount[row.method] = this.safeNumber(
        row.amount,
      );
    for (const row of voucherRows)
      mode(row.dataMode).voucherCount[row.status] = this.safeNumber(row.count);
    for (const row of valueVoucherRows) {
      const sums = mode(row.dataMode);
      sums.valueVoucherCount[row.status] = this.safeNumber(row.count);
      sums.valueVoucherBalance += this.safeNumber(row.balance);
    }
    for (const row of valueVoucherMovementRows)
      mode(row.dataMode).valueVoucherMovementBalance = this.safeNumber(
        row.balance,
      );
    for (const sums of Object.values(byDataMode)) {
      if (sums.valueVoucherBalance !== sums.valueVoucherMovementBalance) {
        throw new Error("VALUE_VOUCHER_BALANCE_MISMATCH");
      }
    }

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

  async readMigrations(
    prisma: PrismaClient = this.prisma,
  ): Promise<BackupMigration[]> {
    return prisma.$queryRawUnsafe<BackupMigration[]>(
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
        "Der Migrationsstand wurde noch nicht verglichen.",
      restoreVerificationAvailable: false,
      restoreVerificationUnavailableReason:
        "Der Migrationsstand wurde noch nicht verglichen.",
      restorePreparationAvailable: false,
      restorePreparationUnavailableReason:
        "Der Migrationsstand wurde noch nicht verglichen.",
      downloadFiles: [manifest.dumpFile, manifestFile],
    };
  }

  private applyRestoreVerificationAvailability(item: BackupListItem): void {
    item.restoreAvailable =
      item.format === "POSTGRES_CUSTOM" &&
      (item.compatibility === "CURRENT" || item.compatibility === "OLDER");
    item.restoreUnavailableReason = item.restoreAvailable
      ? null
      : item.compatibility === "NEWER" || item.compatibility === "DIVERGED"
        ? "Der Migrationsstand ist nicht mit der laufenden Anwendung vereinbar."
        : "Der Migrationsstand konnte nicht sicher verglichen werden.";
    item.restoreVerificationAvailable =
      item.format === "POSTGRES_CUSTOM" && item.compatibility === "CURRENT";
    item.restoreVerificationUnavailableReason =
      item.restoreVerificationAvailable
        ? null
        : item.compatibility === "OLDER"
          ? "Ältere Sicherungen benötigen zuerst die abgesicherte Vorwärtsmigration der Nebendatenbank."
          : item.compatibility === "NEWER" || item.compatibility === "DIVERGED"
            ? "Der Migrationsstand ist nicht mit der aktuellen Datenbank vereinbar."
            : "Der Migrationsstand konnte nicht sicher verglichen werden.";
    item.restorePreparationAvailable = item.restoreVerificationAvailable;
    item.restorePreparationUnavailableReason = item.restoreVerificationAvailable
      ? null
      : item.restoreVerificationUnavailableReason;
  }

  private createVerificationClient(databaseUrl: string): PrismaClient {
    return new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  }

  private stableJson(value: unknown): string {
    const normalize = (entry: unknown): unknown => {
      if (Array.isArray(entry)) return entry.map(normalize);
      if (entry && typeof entry === "object") {
        return Object.fromEntries(
          Object.entries(entry as Record<string, unknown>)
            .sort(([left], [right]) => left.localeCompare(right, "en"))
            .map(([key, nested]) => [key, normalize(nested)]),
        );
      }
      return entry;
    };
    return JSON.stringify(normalize(value));
  }

  compareMigrations(
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

  private readRetentionPolicy(): BackupRetentionPolicy {
    return {
      hourlyKeep: this.readNonNegativeInteger(
        "BACKUP_RETENTION_HOURLY_KEEP",
        24,
      ),
      dailyKeep: this.readNonNegativeInteger("BACKUP_RETENTION_DAILY_KEEP", 14),
      eventKeep: this.readNonNegativeInteger("BACKUP_RETENTION_EVENT_KEEP", 3),
      minFreeBytes: this.readNonNegativeInteger(
        "BACKUP_MIN_FREE_BYTES",
        1_073_741_824,
        Number.MAX_SAFE_INTEGER,
      ),
    };
  }

  private readNonNegativeInteger(
    name: string,
    fallback: number,
    maximum = 10_000,
  ): number {
    const raw = process.env[name];
    if (raw === undefined || raw.trim() === "") return fallback;
    if (!/^\d+$/.test(raw)) return fallback;
    const parsed = Number(raw);
    return Number.isSafeInteger(parsed) && parsed <= maximum
      ? parsed
      : fallback;
  }

  private async readStorageCapacity(): Promise<{
    totalBytes: number;
    freeBytes: number;
  }> {
    const stats = await fs.statfs(this.backupDir, { bigint: true });
    const totalBytes = stats.bsize * stats.blocks;
    const freeBytes = stats.bsize * stats.bavail;
    if (
      totalBytes > BigInt(Number.MAX_SAFE_INTEGER) ||
      freeBytes > BigInt(Number.MAX_SAFE_INTEGER)
    ) {
      throw new Error("BACKUP_STORAGE_METRIC_OUT_OF_RANGE");
    }
    return {
      totalBytes: Number(totalBytes),
      freeBytes: Number(freeBytes),
    };
  }

  private async assertMinimumFreeSpace(): Promise<void> {
    const policy = this.readRetentionPolicy();
    const capacity = await this.readStorageCapacity();
    if (capacity.freeBytes < policy.minFreeBytes) {
      throw new Error("BACKUP_FREE_SPACE_LOW");
    }
  }

  private async rotateBackups(
    createdBy: BackupCreatedBy | null,
  ): Promise<void> {
    const policy = this.readRetentionPolicy();
    const manifests = await this.readValidNativeManifestsForRotation();
    if (manifests.length === 0) return;

    const protectedDumps = new Set<string>();
    protectedDumps.add(manifests[0].dumpFile);
    const latestRestored = manifests.find(
      (manifest) => manifest.verification.restoration.status === "PASSED",
    );
    if (latestRestored) protectedDumps.add(latestRestored.dumpFile);

    // Manuelle Sicherungen sind bis zu einer eigenen Anheftungsfunktion
    // implizit geschützt. Automatische Rotation darf keine bewusste
    // Administrator-Sicherung stillschweigend entfernen.
    for (const manifest of manifests) {
      if (manifest.trigger === "MANUAL") protectedDumps.add(manifest.dumpFile);
    }

    const scheduled = manifests.filter(
      (manifest) => manifest.trigger === "SCHEDULE",
    );
    for (const manifest of scheduled.slice(0, policy.hourlyKeep)) {
      protectedDumps.add(manifest.dumpFile);
    }
    const dailyCandidates = scheduled.slice(policy.hourlyKeep);
    const dailyLast = new Map<string, BackupManifest>();
    for (const manifest of dailyCandidates) {
      const day = manifest.createdAt.slice(0, 10);
      if (!dailyLast.has(day)) dailyLast.set(day, manifest);
    }
    for (const manifest of [...dailyLast.values()].slice(0, policy.dailyKeep)) {
      protectedDumps.add(manifest.dumpFile);
    }

    for (const trigger of ["PRE_RESTORE", "PRE_MIGRATION"] as const) {
      for (const manifest of manifests
        .filter((candidate) => candidate.trigger === trigger)
        .slice(0, policy.eventKeep)) {
        protectedDumps.add(manifest.dumpFile);
      }
    }

    const deletions = manifests.filter(
      (manifest) => !protectedDumps.has(manifest.dumpFile),
    );
    if (deletions.length === 0) return;
    const filenames = deletions.map((manifest) => manifest.dumpFile);
    await this.writeAudit("BACKUP_ROTATION_STARTED", "backup", createdBy, {
      filenames,
    });
    for (const manifest of deletions) {
      await this.removeNativeBackupPair(manifest);
    }
    await this.writeAudit("BACKUP_ROTATION_COMPLETED", "backup", createdBy, {
      filenames,
      deletedCount: filenames.length,
    });
  }

  private async readValidNativeManifestsForRotation(): Promise<
    BackupManifest[]
  > {
    const names = await fs.readdir(this.backupDir);
    const manifests: BackupManifest[] = [];
    for (const name of names.filter((entry) =>
      entry.endsWith(".manifest.json"),
    )) {
      try {
        const manifest = parseBackupManifest(
          await fs.readFile(path.join(this.backupDir, name), "utf8"),
        );
        const expectedManifest = manifest.dumpFile.replace(
          /\.dump$/,
          ".manifest.json",
        );
        if (
          name !== expectedManifest ||
          !SAFE_BACKUP_FILE.test(name) ||
          !SAFE_BACKUP_FILE.test(manifest.dumpFile) ||
          manifest.verification.structure.status !== "PASSED"
        ) {
          continue;
        }
        const dumpStat = await fs
          .lstat(path.join(this.backupDir, manifest.dumpFile))
          .catch(() => null);
        if (
          !dumpStat?.isFile() ||
          dumpStat.isSymbolicLink() ||
          dumpStat.size !== manifest.dumpSizeBytes
        ) {
          continue;
        }
        const dumpPath = path.join(this.backupDir, manifest.dumpFile);
        if ((await this.hashFile(dumpPath)) !== manifest.dumpSha256) continue;
        await this.tools.verifyDump(dumpPath);
        manifests.push(manifest);
      } catch {
        // Defekte, unvollständige und unbekannte Dateien werden niemals
        // automatisch gelöscht. Sie bleiben in der Diagnose sichtbar.
      }
    }
    return manifests.sort(
      (left, right) =>
        new Date(right.createdAt).getTime() -
        new Date(left.createdAt).getTime(),
    );
  }

  private async removeNativeBackupPair(
    manifest: BackupManifest,
  ): Promise<void> {
    const manifestName = manifest.dumpFile.replace(/\.dump$/, ".manifest.json");
    if (
      !SAFE_BACKUP_FILE.test(manifest.dumpFile) ||
      !SAFE_BACKUP_FILE.test(manifestName)
    ) {
      throw new Error("BACKUP_ROTATION_UNSAFE_FILENAME");
    }
    const manifestPath = path.join(this.backupDir, manifestName);
    const dumpPath = path.join(this.backupDir, manifest.dumpFile);
    const resolvedDirectory = await fs.realpath(this.backupDir);
    for (const filePath of [manifestPath, dumpPath]) {
      const stat = await fs.lstat(filePath);
      const resolvedFile = await fs.realpath(filePath);
      if (
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        path.dirname(resolvedFile) !== resolvedDirectory
      ) {
        throw new Error("BACKUP_ROTATION_UNSAFE_FILE");
      }
    }
    // Das Manifest ist der Commit-Marker. Es verschwindet zuerst, damit ein
    // Absturz höchstens einen ignorierten Dump, nie aber ein scheinbar
    // vollständiges Paar hinterlässt.
    await fs.unlink(manifestPath);
    await this.syncDirectory();
    await fs.unlink(dumpPath);
    await this.syncDirectory();
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
