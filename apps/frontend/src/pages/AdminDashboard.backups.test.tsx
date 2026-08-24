import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "../lib/api";
import { useAuthStore } from "../store/useAuthStore";
import { AdminDashboard } from "./AdminDashboard";

vi.mock("../lib/api", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

const nativeBackup = {
  format: "POSTGRES_CUSTOM",
  filename: "vereinorder_2026-08-24T08-30-00.000Z_manual.dump",
  artifacts: [
    "vereinorder_2026-08-24T08-30-00.000Z_manual.dump",
    "vereinorder_2026-08-24T08-30-00.000Z_manual.manifest.json",
  ],
  sizeBytes: 4096,
  createdAt: "2026-08-24T08:30:00.000Z",
  checksumSha256: "a".repeat(64),
  version: "1 / 0.1.0",
  counts: { Order: 12, Product: 5 },
  trigger: "MANUAL",
  verification: "STRUCTURE_VERIFIED",
  compatibility: "CURRENT",
  restoreAvailable: false,
  restoreUnavailableReason:
    "Native Wiederherstellung folgt im nächsten abgesicherten #67-Schnitt.",
  restoreVerificationAvailable: true,
  restoreVerificationUnavailableReason: null,
  downloadFiles: [
    "vereinorder_2026-08-24T08-30-00.000Z_manual.dump",
    "vereinorder_2026-08-24T08-30-00.000Z_manual.manifest.json",
  ],
};

const legacyBackup = {
  format: "LEGACY_JSON",
  filename: "vereinorder_backup_2026-08-23.json",
  artifacts: ["vereinorder_backup_2026-08-23.json"],
  sizeBytes: 2048,
  createdAt: "2026-08-23T08:30:00.000Z",
  checksumSha256: "b".repeat(64),
  version: "0.1.0",
  counts: { orders: 4, products: 2 },
  trigger: "LEGACY",
  verification: "LEGACY",
  compatibility: "UNKNOWN",
  restoreAvailable: true,
  restoreUnavailableReason: null,
  restoreVerificationAvailable: false,
  restoreVerificationUnavailableReason:
    "JSON-Altsicherungen werden in einem eigenen Übernahmeschritt behandelt.",
  downloadFiles: ["vereinorder_backup_2026-08-23.json"],
};

const mockedApi = api as unknown as {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
};

const diagnostics = {
  overallHealth: "GREEN",
  serverTime: "2026-08-24T09:00:00.000Z",
  backend: {
    appVersion: "0.1.0",
    nodeVersion: "v22.0.0",
    uptimeSeconds: 60,
    memory: { rssMb: "10.0", heapUsedMb: "5.0", heapTotalMb: "8.0" },
  },
  database: {
    status: "ONLINE",
    latencyMs: 2,
    counts: { events: 1, activeEvents: 1, orders: 12, products: 5, users: 2 },
  },
  printers: {
    total: 0,
    active: 0,
    queue: { pending: 0, failed: 0, printed: 0, unclear: 0 },
    cupsHostReachable: null,
    cupsCheckedAt: null,
    list: [],
  },
  backup: {
    totalBackups: 1,
    latestBackup: nativeBackup,
    toolStatus: { enabled: true },
    storage: {
      totalBytes: 8 * 1024 ** 3,
      freeBytes: 2 * 1024 ** 3,
      backupCount: 1,
      backupBytes: 8192,
      latestStructuredBackup: nativeBackup,
      latestRestoredBackup: null,
      retention: {
        hourlyKeep: 24,
        dailyKeep: 14,
        eventKeep: 3,
        minFreeBytes: 1024 ** 3,
      },
      creationAllowed: true,
    },
  },
  recommendations: [],
};

beforeEach(() => {
  useAuthStore.setState({
    user: { username: "admin", userId: "admin-id", role: "ADMINISTRATOR" },
    token: "test-token",
  });
  mockedApi.get.mockImplementation((url: string) => {
    if (url === "/events") return Promise.resolve({ data: [] });
    if (url === "/backup/list")
      return Promise.resolve({ data: [nativeBackup, legacyBackup] });
    if (url === "/diagnostics/status")
      return Promise.resolve({ data: diagnostics });
    return Promise.resolve({ data: [] });
  });
  mockedApi.post.mockResolvedValue({ data: {} });
});

afterEach(() => {
  useAuthStore.setState({ user: null, token: null });
  vi.clearAllMocks();
});

async function openBackupTab() {
  render(<AdminDashboard />);
  fireEvent.click(
    screen.getByRole("button", { name: /Backups & Datensicherung/ }),
  );
  await screen.findByText(nativeBackup.filename);
}

describe("Native Datensicherung V1 in der Administration (Issue #67)", () => {
  it("zeigt Custom-Dump und Manifest ehrlich als strukturgeprüft und bietet nur die isolierte Restore-Probe an", async () => {
    await openBackupTab();

    expect(
      screen.getByText(/Stündliche PostgreSQL-Sicherung unabhängig/),
    ).toBeInTheDocument();
    const nativeRow = screen.getByText(nativeBackup.filename).closest("tr")!;
    expect(
      within(nativeRow).getByText(/PostgreSQL Custom-Dump/),
    ).toBeInTheDocument();
    expect(within(nativeRow).getByText("Strukturgeprüft")).toBeInTheDocument();
    expect(
      within(nativeRow).getByRole("button", { name: "Dump" }),
    ).toBeInTheDocument();
    expect(
      within(nativeRow).getByRole("button", { name: "Manifest" }),
    ).toBeInTheDocument();
    expect(
      within(nativeRow).queryByRole("button", { name: /Wiederherstellen/ }),
    ).not.toBeInTheDocument();
    expect(
      within(nativeRow).getByRole("button", {
        name: "Wiederherstellung prüfen",
      }),
    ).toBeInTheDocument();
  });

  it("startet die isolierte Restore-Probe und lädt danach den Prüfstatus neu", async () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    await openBackupTab();
    const nativeRow = screen.getByText(nativeBackup.filename).closest("tr")!;

    fireEvent.click(
      within(nativeRow).getByRole("button", {
        name: "Wiederherstellung prüfen",
      }),
    );

    await vi.waitFor(() =>
      expect(mockedApi.post).toHaveBeenCalledWith(
        `/backup/verify-restore/${nativeBackup.filename}`,
      ),
    );
    await vi.waitFor(() => expect(alertSpy).toHaveBeenCalledTimes(1));
    expect(mockedApi.get).toHaveBeenCalledWith("/backup/list");
  });

  it("kennzeichnet JSON-Dateien als Altbestand und bietet nur dafür den gesperrten Legacy-Weg an", async () => {
    await openBackupTab();

    const legacyRow = screen.getByText(legacyBackup.filename).closest("tr")!;
    expect(
      within(legacyRow).getByText("Altbestand (JSON)"),
    ).toBeInTheDocument();
    expect(within(legacyRow).getByText("Legacy-Prüfsumme")).toBeInTheDocument();
    expect(
      within(legacyRow).getByRole("button", {
        name: "Legacy wiederherstellen",
      }),
    ).toHaveAttribute(
      "title",
      "Nur im gesperrten Wartungsmodus wiederherstellen",
    );
  });

  it("zeigt freien Speicher, Rücklage und den Stand der Wiederherstellungsprüfung in der Diagnose", async () => {
    render(<AdminDashboard />);
    fireEvent.click(
      screen.getByRole("button", { name: /System-Status & Diagnose/ }),
    );

    expect(await screen.findByText("Freier Speicher")).toBeInTheDocument();
    expect(screen.getByText("2.0 GB")).toBeInTheDocument();
    expect(screen.getByText(/Rücklage:/)).toHaveTextContent("1.0 GB");
    expect(
      screen.getByText(/Letzte Wiederherstellungsprüfung:/),
    ).toHaveTextContent("noch nicht durchgeführt");
  });
});
