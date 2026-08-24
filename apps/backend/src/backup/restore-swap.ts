import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import * as path from "node:path";

const SWAP_ID_PATTERN = /^[a-f0-9]{16}$/;
const LIVE_DATABASE_PATTERN = /^vereinorder(?:_[a-z0-9]+)*$/;
const MAX_DATABASE_NAME_LENGTH = 63;

export type RestoreSwapPhase =
  | "REQUESTED"
  | "LIVE_RENAMED"
  | "SWAPPED"
  | "COMPLETED"
  | "ROLLBACK_LIVE_RENAMED"
  | "ROLLED_BACK"
  | "ROLLBACK_COMPLETED";

export interface RestoreSwapContext {
  backupFilename: string;
  backupCreatedAt: string;
  backupChecksumSha256: string;
  safetyBackupFilename: string;
  requestedByUserId: string;
  requestedByUsername: string;
  activeCashierSessions: number;
}

export interface RestoreSwapState {
  version: 1;
  swapId: string;
  phase: RestoreSwapPhase;
  liveDatabase: string;
  stagedDatabase: string;
  previousDatabase: string;
  requestedAt: string;
  context: RestoreSwapContext;
}

export interface RestoreSwapStateStore {
  read(): Promise<RestoreSwapState | null>;
  write(state: RestoreSwapState): Promise<void>;
  clear(): Promise<void>;
}

export interface RestoreSwapDatabaseDriver {
  listDatabaseNames(databaseUrl: string): Promise<string[]>;
  terminateDatabaseConnections(
    databaseUrl: string,
    databaseName: string,
  ): Promise<void>;
  renameDatabase(
    databaseUrl: string,
    sourceDatabase: string,
    targetDatabase: string,
  ): Promise<void>;
}

export class RestoreSwapError extends Error {
  constructor(
    public readonly code:
      | "INVALID_STATE"
      | "STATE_NOT_FOUND"
      | "OPERATION_ALREADY_EXISTS"
      | "INCONSISTENT_DATABASE_LAYOUT",
    message: string,
  ) {
    super(message);
  }
}

export function createRestoreSwapState(
  liveDatabase: string,
  requestedAt = new Date().toISOString(),
  swapId = randomBytes(8).toString("hex"),
  context: RestoreSwapContext = {
    backupFilename: "vereinorder_unknown_manual.dump",
    backupCreatedAt: requestedAt,
    backupChecksumSha256: "0".repeat(64),
    safetyBackupFilename: "vereinorder_unknown_prerestore.dump",
    requestedByUserId: "unknown",
    requestedByUsername: "unknown",
    activeCashierSessions: 0,
  },
): RestoreSwapState {
  const testMarker = /(?:^|_)test(?:_|$)/.test(liveDatabase) ? "test_" : "";
  const state: RestoreSwapState = {
    version: 1,
    swapId,
    phase: "REQUESTED",
    liveDatabase,
    stagedDatabase: `vereinorder_restore_${testMarker}${swapId}`,
    previousDatabase: `vereinorder_pre_${testMarker}${swapId}`,
    requestedAt,
    context,
  };
  assertRestoreSwapState(state);
  return state;
}

export function assertRestoreSwapState(
  value: unknown,
): asserts value is RestoreSwapState {
  if (!isPlainObject(value)) {
    throw invalidState("Der Restore-Zustand ist kein Objekt.");
  }
  const expectedKeys = [
    "context",
    "liveDatabase",
    "phase",
    "previousDatabase",
    "requestedAt",
    "stagedDatabase",
    "swapId",
    "version",
  ];
  if (Object.keys(value).sort().join("|") !== expectedKeys.join("|")) {
    throw invalidState("Der Restore-Zustand enthält unerwartete Felder.");
  }
  if (value.version !== 1) {
    throw invalidState("Die Version des Restore-Zustands ist ungültig.");
  }
  if (
    ![
      "REQUESTED",
      "LIVE_RENAMED",
      "SWAPPED",
      "COMPLETED",
      "ROLLBACK_LIVE_RENAMED",
      "ROLLED_BACK",
      "ROLLBACK_COMPLETED",
    ].includes(String(value.phase))
  ) {
    throw invalidState("Die Phase des Restore-Zustands ist ungültig.");
  }
  if (typeof value.swapId !== "string" || !SWAP_ID_PATTERN.test(value.swapId)) {
    throw invalidState("Die Kennung des Restore-Zustands ist ungültig.");
  }
  if (
    typeof value.liveDatabase !== "string" ||
    !isSafeLiveDatabaseName(value.liveDatabase)
  ) {
    throw invalidState("Der Name der aktiven Datenbank ist ungültig.");
  }
  const testMarker = /(?:^|_)test(?:_|$)/.test(value.liveDatabase)
    ? "test_"
    : "";
  const expectedStaged = `vereinorder_restore_${testMarker}${value.swapId}`;
  const expectedPrevious = `vereinorder_pre_${testMarker}${value.swapId}`;
  if (value.stagedDatabase !== expectedStaged) {
    throw invalidState("Der Name der vorbereiteten Datenbank ist ungültig.");
  }
  if (value.previousDatabase !== expectedPrevious) {
    throw invalidState("Der Name der Rückfalldatenbank ist ungültig.");
  }
  if (
    typeof value.requestedAt !== "string" ||
    !isExactIsoTimestamp(value.requestedAt)
  ) {
    throw invalidState("Der Zeitstempel des Restore-Zustands ist ungültig.");
  }
  assertRestoreSwapContext(value.context);
}

export class FileRestoreSwapStateStore implements RestoreSwapStateStore {
  readonly statePath: string;

  constructor(stateDirectory: string) {
    if (!path.isAbsolute(stateDirectory)) {
      throw new RestoreSwapError(
        "INVALID_STATE",
        "Das Restore-Zustandsverzeichnis muss absolut sein.",
      );
    }
    this.statePath = path.join(stateDirectory, "restore-swap-state.json");
  }

  async read(): Promise<RestoreSwapState | null> {
    let raw: string;
    try {
      raw = await fs.readFile(this.statePath, "utf8");
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") return null;
      throw error;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw invalidState("Der persistierte Restore-Zustand ist beschädigt.");
    }
    assertRestoreSwapState(parsed);
    return parsed;
  }

  async write(state: RestoreSwapState): Promise<void> {
    assertRestoreSwapState(state);
    const directory = path.dirname(this.statePath);
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    const temporaryPath = path.join(
      directory,
      `.restore-swap-state.${process.pid}.${randomBytes(8).toString("hex")}.tmp`,
    );
    const handle = await fs.open(temporaryPath, "wx", 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(state)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await fs.rename(temporaryPath, this.statePath);
      await fs.chmod(this.statePath, 0o600);
      if (process.platform !== "win32") {
        const directoryHandle = await fs.open(directory, "r");
        try {
          await directoryHandle.sync();
        } finally {
          await directoryHandle.close();
        }
      }
    } catch (error) {
      await fs.rm(temporaryPath, { force: true });
      throw error;
    }
  }

  async clear(): Promise<void> {
    await fs.rm(this.statePath, { force: true });
  }
}

export class RestoreSwapCoordinator {
  constructor(
    private readonly databaseUrl: string,
    private readonly store: RestoreSwapStateStore,
    private readonly driver: RestoreSwapDatabaseDriver,
  ) {}

  async begin(state: RestoreSwapState): Promise<RestoreSwapState> {
    assertRestoreSwapState(state);
    if (state.phase !== "REQUESTED") {
      throw invalidState("Ein neuer Restore muss in REQUESTED beginnen.");
    }
    if (await this.store.read()) {
      throw new RestoreSwapError(
        "OPERATION_ALREADY_EXISTS",
        "Es besteht bereits ein persistierter Restore-Vorgang.",
      );
    }
    await this.store.write(state);
    return this.resume();
  }

  async resume(): Promise<RestoreSwapState> {
    const state = await this.requireState();
    if (
      state.phase === "ROLLBACK_LIVE_RENAMED" ||
      state.phase === "ROLLED_BACK" ||
      state.phase === "ROLLBACK_COMPLETED"
    ) {
      return this.resumeRollback(state);
    }
    return this.resumeForward(state);
  }

  async markCompleted(): Promise<RestoreSwapState> {
    const state = await this.requireState();
    if (state.phase !== "SWAPPED" && state.phase !== "COMPLETED") {
      throw invalidState(
        "Nur ein vollständig getauschter Restore kann abgeschlossen werden.",
      );
    }
    if (state.phase === "COMPLETED") return state;
    const completed: RestoreSwapState = { ...state, phase: "COMPLETED" };
    await this.store.write(completed);
    return completed;
  }

  async rollback(): Promise<RestoreSwapState> {
    const state = await this.requireState();
    if (
      ![
        "SWAPPED",
        "COMPLETED",
        "ROLLBACK_LIVE_RENAMED",
        "ROLLED_BACK",
        "ROLLBACK_COMPLETED",
      ].includes(state.phase)
    ) {
      throw invalidState(
        "Der Restore kann in dieser Phase nicht zurückgenommen werden.",
      );
    }
    return this.resumeRollback(state);
  }

  async markRollbackCompleted(): Promise<RestoreSwapState> {
    const state = await this.requireState();
    if (state.phase !== "ROLLED_BACK" && state.phase !== "ROLLBACK_COMPLETED") {
      throw invalidState(
        "Nur ein vollständig zurückgenommener Restore kann abgeschlossen werden.",
      );
    }
    if (state.phase === "ROLLBACK_COMPLETED") return state;
    const completed: RestoreSwapState = {
      ...state,
      phase: "ROLLBACK_COMPLETED",
    };
    await this.store.write(completed);
    return completed;
  }

  private async resumeForward(
    initialState: RestoreSwapState,
  ): Promise<RestoreSwapState> {
    let state = initialState;
    for (;;) {
      const databases = new Set(
        await this.driver.listDatabaseNames(this.databaseUrl),
      );
      const hasLive = databases.has(state.liveDatabase);
      const hasStaged = databases.has(state.stagedDatabase);
      const hasPrevious = databases.has(state.previousDatabase);

      if (state.phase === "SWAPPED" || state.phase === "COMPLETED") {
        if (hasLive && !hasStaged && hasPrevious) return state;
        throw inconsistentLayout(state, hasLive, hasStaged, hasPrevious);
      }

      if (hasLive && hasStaged && !hasPrevious) {
        if (state.phase !== "REQUESTED") {
          throw inconsistentLayout(state, hasLive, hasStaged, hasPrevious);
        }
        await this.driver.terminateDatabaseConnections(
          this.databaseUrl,
          state.liveDatabase,
        );
        await this.driver.renameDatabase(
          this.databaseUrl,
          state.liveDatabase,
          state.previousDatabase,
        );
        state = { ...state, phase: "LIVE_RENAMED" };
        await this.store.write(state);
        continue;
      }

      if (!hasLive && hasStaged && hasPrevious) {
        if (state.phase === "REQUESTED") {
          state = { ...state, phase: "LIVE_RENAMED" };
          await this.store.write(state);
        }
        await this.driver.renameDatabase(
          this.databaseUrl,
          state.stagedDatabase,
          state.liveDatabase,
        );
        state = { ...state, phase: "SWAPPED" };
        await this.store.write(state);
        continue;
      }

      if (hasLive && !hasStaged && hasPrevious) {
        state = { ...state, phase: "SWAPPED" };
        await this.store.write(state);
        return state;
      }

      throw inconsistentLayout(state, hasLive, hasStaged, hasPrevious);
    }
  }

  private async resumeRollback(
    initialState: RestoreSwapState,
  ): Promise<RestoreSwapState> {
    let state = initialState;
    for (;;) {
      const databases = new Set(
        await this.driver.listDatabaseNames(this.databaseUrl),
      );
      const hasLive = databases.has(state.liveDatabase);
      const hasStaged = databases.has(state.stagedDatabase);
      const hasPrevious = databases.has(state.previousDatabase);

      if (
        state.phase === "ROLLED_BACK" ||
        state.phase === "ROLLBACK_COMPLETED"
      ) {
        if (hasLive && hasStaged && !hasPrevious) return state;
        throw inconsistentLayout(state, hasLive, hasStaged, hasPrevious);
      }

      if (hasLive && !hasStaged && hasPrevious) {
        if (state.phase !== "SWAPPED" && state.phase !== "COMPLETED") {
          throw inconsistentLayout(state, hasLive, hasStaged, hasPrevious);
        }
        await this.driver.terminateDatabaseConnections(
          this.databaseUrl,
          state.liveDatabase,
        );
        await this.driver.renameDatabase(
          this.databaseUrl,
          state.liveDatabase,
          state.stagedDatabase,
        );
        state = { ...state, phase: "ROLLBACK_LIVE_RENAMED" };
        await this.store.write(state);
        continue;
      }

      if (!hasLive && hasStaged && hasPrevious) {
        if (state.phase === "SWAPPED" || state.phase === "COMPLETED") {
          state = { ...state, phase: "ROLLBACK_LIVE_RENAMED" };
          await this.store.write(state);
        }
        await this.driver.renameDatabase(
          this.databaseUrl,
          state.previousDatabase,
          state.liveDatabase,
        );
        state = { ...state, phase: "ROLLED_BACK" };
        await this.store.write(state);
        continue;
      }

      if (hasLive && hasStaged && !hasPrevious) {
        state = { ...state, phase: "ROLLED_BACK" };
        await this.store.write(state);
        return state;
      }

      throw inconsistentLayout(state, hasLive, hasStaged, hasPrevious);
    }
  }

  private async requireState(): Promise<RestoreSwapState> {
    const state = await this.store.read();
    if (!state) {
      throw new RestoreSwapError(
        "STATE_NOT_FOUND",
        "Es besteht kein persistierter Restore-Vorgang.",
      );
    }
    assertRestoreSwapState(state);
    return state;
  }
}

function isSafeLiveDatabaseName(value: string): boolean {
  return (
    value.length <= MAX_DATABASE_NAME_LENGTH &&
    LIVE_DATABASE_PATTERN.test(value) &&
    !value.startsWith("vereinorder_restore_") &&
    !value.startsWith("vereinorder_pre_")
  );
}

function isExactIsoTimestamp(value: string): boolean {
  const parsed = new Date(value);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function assertRestoreSwapContext(
  value: unknown,
): asserts value is RestoreSwapContext {
  if (!isPlainObject(value)) {
    throw invalidState("Der Restore-Kontext ist ungültig.");
  }
  const expectedKeys = [
    "activeCashierSessions",
    "backupChecksumSha256",
    "backupCreatedAt",
    "backupFilename",
    "requestedByUserId",
    "requestedByUsername",
    "safetyBackupFilename",
  ];
  if (Object.keys(value).sort().join("|") !== expectedKeys.join("|")) {
    throw invalidState("Der Restore-Kontext enthält unerwartete Felder.");
  }
  if (
    typeof value.backupFilename !== "string" ||
    value.backupFilename.length > 255 ||
    !/^vereinorder_[A-Za-z0-9._-]+\.dump$/.test(value.backupFilename)
  ) {
    throw invalidState("Der Sicherungsname im Restore-Kontext ist ungültig.");
  }
  if (
    typeof value.safetyBackupFilename !== "string" ||
    value.safetyBackupFilename.length > 255 ||
    !/^vereinorder_[A-Za-z0-9._-]+_prerestore(?:-\d+)?\.dump$/.test(
      value.safetyBackupFilename,
    )
  ) {
    throw invalidState("Der Name der Sicherheitssicherung ist ungültig.");
  }
  if (
    typeof value.backupCreatedAt !== "string" ||
    !isExactIsoTimestamp(value.backupCreatedAt) ||
    typeof value.backupChecksumSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.backupChecksumSha256)
  ) {
    throw invalidState(
      "Die Sicherungsidentität im Restore-Kontext ist ungültig.",
    );
  }
  if (
    typeof value.requestedByUserId !== "string" ||
    value.requestedByUserId.length < 1 ||
    value.requestedByUserId.length > 255 ||
    typeof value.requestedByUsername !== "string" ||
    value.requestedByUsername.length < 1 ||
    value.requestedByUsername.length > 255
  ) {
    throw invalidState(
      "Die Administratoridentität im Restore-Kontext ist ungültig.",
    );
  }
  if (
    typeof value.activeCashierSessions !== "number" ||
    !Number.isSafeInteger(value.activeCashierSessions) ||
    value.activeCashierSessions < 0
  ) {
    throw invalidState("Die Zahl offener Kassensitzungen ist ungültig.");
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}

function invalidState(message: string): RestoreSwapError {
  return new RestoreSwapError("INVALID_STATE", message);
}

function inconsistentLayout(
  state: RestoreSwapState,
  hasLive: boolean,
  hasStaged: boolean,
  hasPrevious: boolean,
): RestoreSwapError {
  return new RestoreSwapError(
    "INCONSISTENT_DATABASE_LAYOUT",
    `Die Datenbanklage passt nicht zur Restore-Phase ${state.phase} (aktiv=${hasLive}, vorbereitet=${hasStaged}, rückfall=${hasPrevious}).`,
  );
}
