import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  FileRestoreSwapStateStore,
  RestoreSwapCoordinator,
  RestoreSwapDatabaseDriver,
  RestoreSwapError,
  RestoreSwapState,
  RestoreSwapStateStore,
  assertRestoreSwapState,
  createRestoreSwapState,
} from "./restore-swap";

const DATABASE_URL =
  "postgresql://restore-user:secret@localhost:5432/vereinorder_issue67_test";
const SWAP_ID = "0123456789abcdef";

class MemoryStore implements RestoreSwapStateStore {
  state: RestoreSwapState | null = null;
  readonly writes: RestoreSwapState[] = [];
  failLiveRenamedWriteOnce = false;

  async read(): Promise<RestoreSwapState | null> {
    return this.state ? { ...this.state } : null;
  }

  async write(state: RestoreSwapState): Promise<void> {
    if (this.failLiveRenamedWriteOnce && state.phase === "LIVE_RENAMED") {
      this.failLiveRenamedWriteOnce = false;
      throw new Error("simulierter Prozessabbruch vor Zustands-Sync");
    }
    this.state = { ...state };
    this.writes.push({ ...state });
  }
}

class MemoryDriver implements RestoreSwapDatabaseDriver {
  readonly databases: Set<string>;
  readonly calls: string[] = [];

  constructor(databaseNames: string[]) {
    this.databases = new Set(databaseNames);
  }

  async listDatabaseNames(): Promise<string[]> {
    this.calls.push("list");
    return [...this.databases];
  }

  async terminateDatabaseConnections(
    _databaseUrl: string,
    databaseName: string,
  ): Promise<void> {
    this.calls.push(`terminate:${databaseName}`);
  }

  async renameDatabase(
    _databaseUrl: string,
    sourceDatabase: string,
    targetDatabase: string,
  ): Promise<void> {
    this.calls.push(`rename:${sourceDatabase}->${targetDatabase}`);
    if (
      !this.databases.delete(sourceDatabase) ||
      this.databases.has(targetDatabase)
    ) {
      throw new Error("ungültige Test-Umbenennung");
    }
    this.databases.add(targetDatabase);
  }
}

describe("absturzfester Restore-Datenbanktausch (Issue #67)", () => {
  const requested = () =>
    createRestoreSwapState(
      "vereinorder_issue67_test",
      "2026-08-24T08:00:00.000Z",
      SWAP_ID,
    );

  it("tauscht vorbereitet gegen aktiv und persistiert beide irreversiblen Schritte", async () => {
    const state = requested();
    const store = new MemoryStore();
    const driver = new MemoryDriver([state.liveDatabase, state.stagedDatabase]);

    const result = await new RestoreSwapCoordinator(
      DATABASE_URL,
      store,
      driver,
    ).begin(state);

    expect(result.phase).toBe("SWAPPED");
    expect(store.writes.map((entry) => entry.phase)).toEqual([
      "REQUESTED",
      "LIVE_RENAMED",
      "SWAPPED",
    ]);
    expect(driver.calls).toEqual([
      "list",
      `terminate:${state.liveDatabase}`,
      `rename:${state.liveDatabase}->${state.previousDatabase}`,
      "list",
      `rename:${state.stagedDatabase}->${state.liveDatabase}`,
      "list",
    ]);
    expect(driver.databases).toEqual(
      new Set([state.previousDatabase, state.liveDatabase]),
    );
  });

  it("setzt nach Abbruch direkt nach der ersten Umbenennung ohne Wiederholung fort", async () => {
    const state = requested();
    const store = new MemoryStore();
    store.state = state;
    const driver = new MemoryDriver([
      state.stagedDatabase,
      state.previousDatabase,
    ]);

    const result = await new RestoreSwapCoordinator(
      DATABASE_URL,
      store,
      driver,
    ).resume();

    expect(result.phase).toBe("SWAPPED");
    expect(driver.calls).not.toContain(`terminate:${state.liveDatabase}`);
    expect(driver.calls).toContain(
      `rename:${state.stagedDatabase}->${state.liveDatabase}`,
    );
    expect(store.writes.map((entry) => entry.phase)).toEqual([
      "LIVE_RENAMED",
      "SWAPPED",
    ]);
  });

  it("erkennt einen Abbruch direkt nach der zweiten Umbenennung", async () => {
    const state = requested();
    const store = new MemoryStore();
    store.state = { ...state, phase: "LIVE_RENAMED" };
    const driver = new MemoryDriver([
      state.liveDatabase,
      state.previousDatabase,
    ]);

    const result = await new RestoreSwapCoordinator(
      DATABASE_URL,
      store,
      driver,
    ).resume();

    expect(result.phase).toBe("SWAPPED");
    expect(driver.calls).toEqual(["list"]);
    expect(store.writes.map((entry) => entry.phase)).toEqual(["SWAPPED"]);
  });

  it("rekonstruiert die Zwischenphase, wenn der Zustands-Sync nach der ersten Umbenennung ausfiel", async () => {
    const state = requested();
    const store = new MemoryStore();
    store.failLiveRenamedWriteOnce = true;
    const driver = new MemoryDriver([state.liveDatabase, state.stagedDatabase]);
    const coordinator = new RestoreSwapCoordinator(DATABASE_URL, store, driver);

    await expect(coordinator.begin(state)).rejects.toThrow(
      "simulierter Prozessabbruch",
    );
    expect(store.state?.phase).toBe("REQUESTED");
    expect(driver.databases).toEqual(
      new Set([state.stagedDatabase, state.previousDatabase]),
    );

    await expect(coordinator.resume()).resolves.toMatchObject({
      phase: "SWAPPED",
    });
    expect(
      driver.calls.filter((call) => call.startsWith("terminate:")),
    ).toHaveLength(1);
  });

  it("bricht bei jeder unplausiblen Datenbanklage ohne Mutation geschlossen ab", async () => {
    const state = requested();
    const store = new MemoryStore();
    store.state = state;
    const driver = new MemoryDriver([state.liveDatabase]);

    await expect(
      new RestoreSwapCoordinator(DATABASE_URL, store, driver).resume(),
    ).rejects.toMatchObject<Partial<RestoreSwapError>>({
      code: "INCONSISTENT_DATABASE_LAYOUT",
    });
    expect(driver.calls).toEqual(["list"]);
    expect(store.writes).toEqual([]);
  });

  it("verwirft manipulierte Datenbanknamen und unbekannte Zustandsfelder", () => {
    const state = requested();
    expect(() =>
      assertRestoreSwapState({
        ...state,
        stagedDatabase: `${state.stagedDatabase}";DROP DATABASE vereinorder`,
      }),
    ).toThrow(RestoreSwapError);
    expect(() =>
      assertRestoreSwapState({ ...state, databaseUrl: "secret" }),
    ).toThrow(RestoreSwapError);
  });

  it("veröffentlicht den Dateizustand atomar und verweigert beschädigte Inhalte", async () => {
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "vereinorder-restore-swap-unit-"),
    );
    const store = new FileRestoreSwapStateStore(directory);
    try {
      await store.write(requested());
      await expect(store.read()).resolves.toEqual(requested());
      expect(
        (await fs.readdir(directory)).filter((name) => name.endsWith(".tmp")),
      ).toEqual([]);

      await fs.writeFile(store.statePath, "{nicht-json", "utf8");
      await expect(store.read()).rejects.toMatchObject<
        Partial<RestoreSwapError>
      >({
        code: "INVALID_STATE",
      });
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });
});
