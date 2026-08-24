import {
  ConflictException,
  Inject,
  Injectable,
  OnModuleInit,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Prisma, PrismaClient } from "@vereinorder/database";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { MaintenanceService } from "../maintenance/maintenance.service";
import { MaintenanceStateService } from "../maintenance/maintenance-state.service";
import { PRISMA_CLIENT } from "../prisma/prisma.module";
import { BackupManifest, parseBackupManifest } from "./backup-manifest";
import { PrepareNativeRestoreDto } from "./backup.dto";
import {
  DatabaseMeasurements,
  NativeBackupService,
} from "./native-backup.service";
import {
  PostgreSqlBackupTools,
  buildPostgreSqlConnectionEnvironment,
  buildPostgreSqlDatabaseUrl,
} from "./postgresql-backup.tools";
import {
  FileRestoreSwapStateStore,
  RestoreSwapCoordinator,
  RestoreSwapState,
  createRestoreSwapState,
} from "./restore-swap";
import { RestoreProcessRestartService } from "./restore-process-restart.service";

export interface RestoreOperationStatus {
  swapId: string;
  phase: RestoreSwapState["phase"];
  backupFilename: string;
  backupCreatedAt: string;
  safetyBackupFilename: string;
  activeCashierSessions: number;
  requestedAt: string;
  requestedByUsername: string;
  rollbackAvailable: boolean;
  acceptanceAvailable: boolean;
}

export interface NativeRestoreResult {
  operation: RestoreOperationStatus;
  liveDatabaseChanged: true;
  restartScheduled: boolean;
}

interface ValidatedRestoreBackup {
  dumpPath: string;
  manifest: BackupManifest;
  compatibility: "CURRENT" | "OLDER";
}

@Injectable()
export class NativeRestoreService implements OnModuleInit {
  private readonly store: FileRestoreSwapStateStore;
  private operationInProgress = false;

  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    private readonly maintenanceState: MaintenanceStateService,
    private readonly maintenanceService: MaintenanceService,
    private readonly backups: NativeBackupService,
    private readonly tools: PostgreSqlBackupTools,
    private readonly processRestart: RestoreProcessRestartService,
  ) {
    const stateDirectory = path.resolve(
      process.env.STATE_DIR || path.join(process.cwd(), "state"),
    );
    this.store = new FileRestoreSwapStateStore(stateDirectory);
  }

  async onModuleInit(): Promise<void> {
    const state = await this.store.read();
    if (!state) return;
    const databaseUrl = this.requireDatabaseUrl();
    const coordinator = this.coordinator(databaseUrl);
    if (
      state.phase === "REQUESTED" ||
      state.phase === "LIVE_RENAMED" ||
      state.phase === "SWAPPED"
    ) {
      await this.prisma.$disconnect();
      await coordinator.resume();
      await this.prisma.$connect();
      await this.finalizeForward(coordinator);
      return;
    }
    if (
      state.phase === "ROLLBACK_LIVE_RENAMED" ||
      state.phase === "ROLLED_BACK"
    ) {
      await this.prisma.$disconnect();
      await coordinator.rollback();
      await this.prisma.$connect();
      await this.finalizeRollback(coordinator);
    }
  }

  async getStatus(): Promise<RestoreOperationStatus | null> {
    const state = await this.store.read();
    return state ? this.toStatus(state) : null;
  }

  async execute(
    filename: string,
    confirmation: PrepareNativeRestoreDto,
    requestedBy: { userId: string; username: string },
  ): Promise<NativeRestoreResult> {
    this.assertLocked();
    if (this.operationInProgress) {
      throw new ConflictException("Eine Wiederherstellung läuft bereits.");
    }
    if (await this.store.read()) {
      throw new ConflictException(
        "Ein früherer Restore wartet noch auf Abnahme oder Rücknahme.",
      );
    }
    this.operationInProgress = true;
    const databaseUrl = this.requireDatabaseUrl();
    let stagedDatabase: string | null = null;
    let phase = "PRECHECK";
    try {
      const validated = await this.validateBackup(
        filename,
        confirmation.confirmedCreatedAt,
      );
      if (confirmation.queuesConfirmed !== true) {
        throw new ConflictException(
          "Bitte bestätigen, dass alle Kassen online und ihre Warteschlangen leer sind.",
        );
      }
      await this.assertRestoreStorage(validated.manifest.dumpSizeBytes);
      if (validated.compatibility === "CURRENT") {
        phase = "ISOLATED_VERIFICATION";
        await this.backups.verifyRestoration(filename, requestedBy);
      }

      const activeCashierSessions = await this.prisma.cashierSession.count({
        where: { status: "ACTIVE" },
      });
      phase = "PRE_RESTORE_BACKUP";
      const safetyBackup = await this.backups.createBackup(
        "PRE_RESTORE",
        requestedBy,
      );
      const identity = buildPostgreSqlConnectionEnvironment(databaseUrl);
      const state = createRestoreSwapState(
        identity.databaseName,
        new Date().toISOString(),
        undefined,
        {
          backupFilename: filename,
          backupCreatedAt: validated.manifest.createdAt,
          backupChecksumSha256: validated.manifest.dumpSha256,
          safetyBackupFilename: safetyBackup.filename,
          requestedByUserId: requestedBy.userId,
          requestedByUsername: requestedBy.username,
          activeCashierSessions,
        },
      );
      stagedDatabase = state.stagedDatabase;

      phase = "CREATE_STAGED_DATABASE";
      await this.tools.createRestoreSwapDatabase(databaseUrl, stagedDatabase);
      phase = "RESTORE_STAGED_DATABASE";
      await this.tools.restoreDump(
        databaseUrl,
        stagedDatabase,
        validated.dumpPath,
      );
      phase = "VERIFY_STAGED_DATABASE";
      await this.verifyStagedDatabase(databaseUrl, state, validated.manifest);
      if (validated.compatibility === "OLDER") {
        phase = "MIGRATE_STAGED_DATABASE";
        await this.tools.migrateRestoreSwapDatabase(
          databaseUrl,
          stagedDatabase,
        );
        phase = "VERIFY_MIGRATED_DATABASE";
        await this.verifyMigratedDatabase(
          databaseUrl,
          state,
          validated.manifest,
        );
      }

      await this.writeAudit(
        "RESTORE_SWITCH_STARTED",
        state.swapId,
        requestedBy,
        {
          filename,
          checksumSha256: validated.manifest.dumpSha256,
          createdAt: validated.manifest.createdAt,
          safetyBackupFilename: safetyBackup.filename,
          activeCashierSessions,
          confirmations: { queuesConfirmed: true },
        },
      );

      phase = "SWAP_DATABASES";
      const coordinator = this.coordinator(databaseUrl);
      await this.prisma.$disconnect();
      await coordinator.begin(state);
      await this.prisma.$connect();
      const completed = await this.finalizeForward(coordinator);
      const restartScheduled = this.processRestart.schedule();
      return {
        operation: this.toStatus(completed),
        liveDatabaseChanged: true,
        restartScheduled,
      };
    } catch (error) {
      await this.prisma.$connect().catch(() => undefined);
      const persisted = await this.store.read().catch(() => null);
      if (!persisted && stagedDatabase) {
        await this.tools
          .dropRestoreSwapDatabase(databaseUrl, stagedDatabase)
          .catch(() => undefined);
      }
      await this.writeAudit("RESTORE_REJECTED", filename, requestedBy, {
        phase,
        errorCode: this.safeErrorCode(error),
        liveDatabaseChanged: persisted !== null,
      }).catch(() => undefined);
      if (
        error instanceof ConflictException ||
        error instanceof ServiceUnavailableException
      ) {
        throw error;
      }
      throw new ServiceUnavailableException(
        persisted
          ? "Die Wiederherstellung wurde unterbrochen und wird aus dem persistenten Zustand fortgesetzt. Der Wartungsmodus bleibt gesperrt."
          : "Die Wiederherstellung ist vor der Umschaltung fehlgeschlagen. Die Festdatenbank blieb unverändert.",
      );
    } finally {
      this.operationInProgress = false;
    }
  }

  async rollback(
    swapId: string,
    confirmedCreatedAt: string,
    requestedBy: { userId: string; username: string },
  ): Promise<NativeRestoreResult> {
    this.assertLocked();
    const state = await this.requireConfirmedState(swapId, confirmedCreatedAt);
    if (!state.phase.startsWith("ROLLBACK") && state.phase !== "COMPLETED") {
      throw new ConflictException(
        "Diese Wiederherstellung ist noch nicht vollständig abgeschlossen.",
      );
    }
    const databaseUrl = this.requireDatabaseUrl();
    const coordinator = this.coordinator(databaseUrl);
    await this.prisma.$disconnect();
    await coordinator.rollback();
    await this.prisma.$connect();
    const completed = await this.finalizeRollback(coordinator, requestedBy);
    const restartScheduled = this.processRestart.schedule();
    return {
      operation: this.toStatus(completed),
      liveDatabaseChanged: true,
      restartScheduled,
    };
  }

  async accept(
    swapId: string,
    confirmedCreatedAt: string,
    requestedBy: { userId: string; username: string },
  ): Promise<{ accepted: true; maintenanceEnded: true }> {
    this.assertLocked();
    const state = await this.requireConfirmedState(swapId, confirmedCreatedAt);
    if (state.phase !== "COMPLETED" && state.phase !== "ROLLBACK_COMPLETED") {
      throw new ConflictException(
        "Der Restore oder seine Rücknahme ist noch nicht vollständig auditiert.",
      );
    }
    const discardedDatabase =
      state.phase === "COMPLETED"
        ? state.previousDatabase
        : state.stagedDatabase;
    const databaseUrl = this.requireDatabaseUrl();
    await this.writeAudit("RESTORE_ACCEPTED", state.swapId, requestedBy, {
      filename: state.context.backupFilename,
      restoredStateAccepted: state.phase === "COMPLETED",
      discardedDatabaseRole:
        state.phase === "COMPLETED" ? "PRE_RESTORE" : "REJECTED_RESTORE",
    });
    await this.tools.dropRestoreSwapDatabase(databaseUrl, discardedDatabase);
    await this.store.clear();
    await this.maintenanceService.end(requestedBy.userId, requestedBy.username);
    return { accepted: true, maintenanceEnded: true };
  }

  private async validateBackup(
    filename: string,
    confirmedCreatedAt: string,
  ): Promise<ValidatedRestoreBackup> {
    if (!filename.endsWith(".dump")) {
      throw new ConflictException(
        "Nur native PostgreSQL-Sicherungen können umgeschaltet werden.",
      );
    }
    const dumpPath = await this.backups.getDownloadFilePath(filename);
    const manifestPath = await this.backups.getDownloadFilePath(
      filename.replace(/\.dump$/, ".manifest.json"),
    );
    const manifest = parseBackupManifest(
      await fs.readFile(manifestPath, "utf8"),
    );
    if (
      manifest.dumpFile !== filename ||
      manifest.createdAt !== confirmedCreatedAt
    ) {
      throw new ConflictException(
        "Der eingegebene Sicherungszeitpunkt stimmt nicht exakt mit dem Manifest überein.",
      );
    }
    const stat = await fs.lstat(dumpPath);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.size !== manifest.dumpSizeBytes ||
      (await this.hashFile(dumpPath)) !== manifest.dumpSha256
    ) {
      throw new ConflictException(
        "Die Sicherungsdatei stimmt nicht mit ihrem Manifest überein.",
      );
    }
    await this.tools.verifyDump(dumpPath);
    const compatibility = this.backups.compareMigrations(
      manifest.migrations,
      await this.backups.readMigrations(),
    );
    if (compatibility !== "CURRENT" && compatibility !== "OLDER") {
      throw new ConflictException(
        "Der Migrationsstand dieser Sicherung ist nicht mit der laufenden Anwendung vereinbar.",
      );
    }
    return { dumpPath, manifest, compatibility };
  }

  private async verifyStagedDatabase(
    databaseUrl: string,
    state: RestoreSwapState,
    manifest: BackupManifest,
  ): Promise<void> {
    const stagedUrl = buildPostgreSqlDatabaseUrl(
      databaseUrl,
      state.stagedDatabase,
    );
    const stagedPrisma = new PrismaClient({
      datasources: { db: { url: stagedUrl } },
    });
    try {
      const measured = await this.backups.measureDatabase(stagedPrisma);
      const unvalidated = await stagedPrisma.$queryRawUnsafe<
        Array<{ count: bigint }>
      >(`SELECT COUNT(*)::bigint AS count
           FROM pg_catalog.pg_constraint
           WHERE contype = 'f' AND NOT convalidated`);
      if (
        Number(unvalidated[0].count) !== 0 ||
        !this.measurementsMatch(measured, manifest)
      ) {
        throw new Error("RESTORE_MEASUREMENTS_MISMATCH");
      }
    } finally {
      await stagedPrisma.$disconnect();
    }
  }

  private measurementsMatch(
    measured: DatabaseMeasurements,
    manifest: BackupManifest,
  ): boolean {
    return (
      this.stableJson(measured.tableNames) ===
        this.stableJson(Object.keys(manifest.countsAfter).sort()) &&
      this.stableJson(measured.counts) ===
        this.stableJson(manifest.countsAfter) &&
      this.stableJson(measured.sums) === this.stableJson(manifest.sumsAfter) &&
      this.stableJson(measured.migrations) ===
        this.stableJson(manifest.migrations)
    );
  }

  private async verifyMigratedDatabase(
    databaseUrl: string,
    state: RestoreSwapState,
    manifest: BackupManifest,
  ): Promise<void> {
    const stagedUrl = buildPostgreSqlDatabaseUrl(
      databaseUrl,
      state.stagedDatabase,
    );
    const stagedPrisma = new PrismaClient({
      datasources: { db: { url: stagedUrl } },
    });
    try {
      const measured = await this.backups.measureDatabase(stagedPrisma);
      const currentMigrations = await this.backups.readMigrations();
      const unvalidated = await stagedPrisma.$queryRawUnsafe<
        Array<{ count: bigint }>
      >(`SELECT COUNT(*)::bigint AS count
           FROM pg_catalog.pg_constraint
           WHERE contype = 'f' AND NOT convalidated`);
      const oldCountsPreserved = Object.entries(manifest.countsAfter).every(
        ([table, count]) =>
          typeof measured.counts[table] === "number" &&
          measured.counts[table] >= count,
      );
      if (
        Number(unvalidated[0].count) !== 0 ||
        !oldCountsPreserved ||
        this.stableJson(measured.sums) !==
          this.stableJson(manifest.sumsAfter) ||
        this.stableJson(measured.migrations) !==
          this.stableJson(currentMigrations)
      ) {
        throw new Error("RESTORE_MIGRATION_VERIFICATION_FAILED");
      }
    } finally {
      await stagedPrisma.$disconnect();
    }
  }

  private async assertRestoreStorage(dumpSizeBytes: number): Promise<void> {
    const backupDirectory = path.resolve(
      process.env.BACKUP_DIR || path.join(process.cwd(), "backups"),
    );
    const stats = await fs.statfs(backupDirectory, { bigint: true });
    const freeBytes = stats.bsize * stats.bavail;
    const databaseSize = await this.prisma.$queryRawUnsafe<
      Array<{ size: bigint }>
    >(`SELECT pg_database_size(current_database())::bigint AS size`);
    const reserve = BigInt(
      this.readNonNegativeInteger("BACKUP_MIN_FREE_BYTES", 1_073_741_824),
    );
    const required =
      reserve + databaseSize[0].size * BigInt(2) + BigInt(dumpSizeBytes * 2);
    if (freeBytes < required) {
      throw new ConflictException(
        "Der freie Speicher reicht nicht für Nebendatenbank und Rückfallebene.",
      );
    }
  }

  private async finalizeForward(
    coordinator: RestoreSwapCoordinator,
  ): Promise<RestoreSwapState> {
    const state = await this.store.read();
    if (!state) throw new Error("RESTORE_STATE_MISSING");
    await this.writeAuditOnce("RESTORE_COMPLETED", state, {
      filename: state.context.backupFilename,
      checksumSha256: state.context.backupChecksumSha256,
      createdAt: state.context.backupCreatedAt,
      safetyBackupFilename: state.context.safetyBackupFilename,
      activeCashierSessions: state.context.activeCashierSessions,
      confirmations: { queuesConfirmed: true },
    });
    return coordinator.markCompleted();
  }

  private async finalizeRollback(
    coordinator: RestoreSwapCoordinator,
    rolledBackBy?: { userId: string; username: string },
  ): Promise<RestoreSwapState> {
    const state = await this.store.read();
    if (!state) throw new Error("RESTORE_STATE_MISSING");
    await this.writeAuditOnce(
      "RESTORE_ROLLED_BACK",
      state,
      {
        filename: state.context.backupFilename,
        restoredDatabasePreservedForAcceptance: true,
      },
      rolledBackBy,
    );
    return coordinator.markRollbackCompleted();
  }

  private async writeAuditOnce(
    action: string,
    state: RestoreSwapState,
    details: Prisma.InputJsonValue,
    actor?: { userId: string; username: string },
  ): Promise<void> {
    const existing = await this.prisma.auditLog.findFirst({
      where: { action, entityId: state.swapId },
      select: { id: true },
    });
    if (existing) return;
    await this.writeAudit(
      action,
      state.swapId,
      actor ?? {
        userId: state.context.requestedByUserId,
        username: state.context.requestedByUsername,
      },
      details,
    );
  }

  private async writeAudit(
    action: string,
    entityId: string,
    requestedBy: { userId: string; username: string },
    details: Prisma.InputJsonValue,
  ): Promise<void> {
    const data = {
      action,
      entityId,
      entityType: "Backup",
      userId: requestedBy.userId,
      details: {
        ...(details as Prisma.JsonObject),
        requestedByUsername: requestedBy.username,
        requestedByUserId: requestedBy.userId,
      },
    };
    try {
      await this.prisma.auditLog.create({ data });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2003"
      ) {
        await this.prisma.auditLog.create({
          data: { ...data, userId: null },
        });
        return;
      }
      throw error;
    }
  }

  private coordinator(databaseUrl: string): RestoreSwapCoordinator {
    return new RestoreSwapCoordinator(databaseUrl, this.store, this.tools);
  }

  private async requireConfirmedState(
    swapId: string,
    confirmedCreatedAt: string,
  ): Promise<RestoreSwapState> {
    const state = await this.store.read();
    if (
      !state ||
      state.swapId !== swapId ||
      state.context.backupCreatedAt !== confirmedCreatedAt
    ) {
      throw new ConflictException(
        "Restore-Kennung oder Sicherungszeitpunkt stimmen nicht exakt überein.",
      );
    }
    return state;
  }

  private toStatus(state: RestoreSwapState): RestoreOperationStatus {
    const completed =
      state.phase === "COMPLETED" || state.phase === "ROLLBACK_COMPLETED";
    return {
      swapId: state.swapId,
      phase: state.phase,
      backupFilename: state.context.backupFilename,
      backupCreatedAt: state.context.backupCreatedAt,
      safetyBackupFilename: state.context.safetyBackupFilename,
      activeCashierSessions: state.context.activeCashierSessions,
      requestedAt: state.requestedAt,
      requestedByUsername: state.context.requestedByUsername,
      rollbackAvailable: state.phase === "COMPLETED",
      acceptanceAvailable: completed,
    };
  }

  private assertLocked(): void {
    if (this.maintenanceState.read().phase !== "LOCKED") {
      throw new ConflictException(
        "Die Wiederherstellung ist ausschließlich im vollständig gesperrten Wartungsmodus erlaubt.",
      );
    }
  }

  private requireDatabaseUrl(): string {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new ServiceUnavailableException(
        "DATABASE_URL fehlt; Wiederherstellung ist deaktiviert.",
      );
    }
    buildPostgreSqlConnectionEnvironment(databaseUrl);
    return databaseUrl;
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

  private readNonNegativeInteger(name: string, fallback: number): number {
    const raw = process.env[name];
    if (!raw || !/^\d+$/.test(raw)) return fallback;
    const parsed = Number(raw);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
  }

  private safeErrorCode(error: unknown): string {
    if (error instanceof ConflictException) return "RESTORE_CONFLICT";
    if (error instanceof ServiceUnavailableException)
      return "RESTORE_UNAVAILABLE";
    if (error instanceof Error && /^[A-Z0-9_]{3,100}$/.test(error.message)) {
      return error.message;
    }
    return "RESTORE_FAILED";
  }
}
