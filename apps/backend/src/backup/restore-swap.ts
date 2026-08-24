import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import * as path from "node:path";

const SWAP_ID_PATTERN = /^[a-f0-9]{16}$/;
const LIVE_DATABASE_PATTERN = /^vereinorder(?:_[a-z0-9]+)*$/;
const MAX_DATABASE_NAME_LENGTH = 63;

export type RestoreSwapPhase = "REQUESTED" | "LIVE_RENAMED" | "SWAPPED";

export interface RestoreSwapState {
  version: 1;
  swapId: string;
  phase: RestoreSwapPhase;
  liveDatabase: string;
  stagedDatabase: string;
  previousDatabase: string;
  requestedAt: string;
}

export interface RestoreSwapStateStore {
  read(): Promise<RestoreSwapState | null>;
  write(state: RestoreSwapState): Promise<void>;
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
  if (!["REQUESTED", "LIVE_RENAMED", "SWAPPED"].includes(String(value.phase))) {
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
    let state = await this.store.read();
    if (!state) {
      throw new RestoreSwapError(
        "STATE_NOT_FOUND",
        "Es besteht kein persistierter Restore-Vorgang.",
      );
    }
    assertRestoreSwapState(state);

    for (;;) {
      const databases = new Set(
        await this.driver.listDatabaseNames(this.databaseUrl),
      );
      const hasLive = databases.has(state.liveDatabase);
      const hasStaged = databases.has(state.stagedDatabase);
      const hasPrevious = databases.has(state.previousDatabase);

      if (state.phase === "SWAPPED") {
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

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error;
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
