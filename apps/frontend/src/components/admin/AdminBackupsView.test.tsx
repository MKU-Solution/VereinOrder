import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { BackupItem } from "./adminDomainTypes";
import { AdminBackupsView } from "./AdminBackupsView";

describe("AdminBackupsView", () => {
  const mockBackups: BackupItem[] = [
    {
      format: "POSTGRES_CUSTOM",
      filename: "backup_2026-08-25_manual.dump",
      artifacts: ["backup_2026-08-25_manual.dump"],
      sizeBytes: 1024 * 1024,
      createdAt: "2026-08-25T10:00:00.000Z",
      checksumSha256: "abc123",
      version: "1 / 0.1.0",
      counts: { Order: 10 },
      trigger: "MANUAL",
      verification: "STRUCTURE_VERIFIED",
      compatibility: "CURRENT",
      restoreAvailable: true,
      restoreUnavailableReason: null,
      restoreVerificationAvailable: true,
      restoreVerificationUnavailableReason: null,
      restorePreparationAvailable: true,
      restorePreparationUnavailableReason: null,
      downloadFiles: ["backup_2026-08-25_manual.dump"],
    },
    {
      format: "LEGACY_JSON",
      filename: "backup_legacy_2026.json",
      artifacts: ["backup_legacy_2026.json"],
      sizeBytes: 512 * 1024,
      createdAt: "2026-08-24T10:00:00.000Z",
      checksumSha256: "def456",
      version: "0.1.0",
      counts: { orders: 5 },
      trigger: "LEGACY",
      verification: "LEGACY",
      compatibility: "UNKNOWN",
      restoreAvailable: true,
      restoreUnavailableReason: null,
      restoreVerificationAvailable: false,
      restoreVerificationUnavailableReason: "Nicht unterstützt",
      restorePreparationAvailable: false,
      restorePreparationUnavailableReason: "Nicht unterstützt",
      downloadFiles: ["backup_legacy_2026.json"],
    },
  ];

  it("rendert Sicherungsliste, Statuskarte und Aktionen", () => {
    render(
      <AdminBackupsView
        backups={mockBackups}
        restoreOperation={null}
        restoreOperationConfirmation=""
        onRefresh={vi.fn()}
        onCreateBackup={vi.fn()}
        onVerifyBackup={vi.fn()}
        onPrepareRestore={vi.fn()}
        onDownloadBackup={vi.fn()}
        onRollbackRestore={vi.fn()}
        onAcceptRestore={vi.fn()}
        onSetRestoreOperationConfirmation={vi.fn()}
      />,
    );

    expect(
      screen.getByText("Automatische & Manuelle Datensicherung"),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText("backup_2026-08-25_manual.dump").length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText("backup_legacy_2026.json").length,
    ).toBeGreaterThan(0);
    expect(
      screen.getByRole("button", { name: "Jetzt sichern (Manuelles Backup)" }),
    ).toBeInTheDocument();
  });

  it("zeigt Restore-Operation Hinweis bei vorbereiteter Rückfalldatenbank", () => {
    const restoreOperation = {
      backupFilename: "backup_2026-08-25_manual.dump",
      phase: "PREPARED",
      activeCashierSessions: 2,
    };

    render(
      <AdminBackupsView
        backups={mockBackups}
        restoreOperation={restoreOperation}
        restoreOperationConfirmation=""
        onRefresh={vi.fn()}
        onCreateBackup={vi.fn()}
        onVerifyBackup={vi.fn()}
        onPrepareRestore={vi.fn()}
        onDownloadBackup={vi.fn()}
        onRollbackRestore={vi.fn()}
        onAcceptRestore={vi.fn()}
        onSetRestoreOperationConfirmation={vi.fn()}
      />,
    );

    expect(
      screen.getByText("Wiederherstellung wartet auf Abnahme"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Wiederherstellung rückgängig machen",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Wiederherstellung abnehmen und Wartung beenden",
      }),
    ).toBeInTheDocument();
  });

  it("filtert nach Dateiname", () => {
    render(
      <AdminBackupsView
        backups={mockBackups}
        restoreOperation={null}
        restoreOperationConfirmation=""
        onRefresh={vi.fn()}
        onCreateBackup={vi.fn()}
        onVerifyBackup={vi.fn()}
        onPrepareRestore={vi.fn()}
        onDownloadBackup={vi.fn()}
        onRollbackRestore={vi.fn()}
        onAcceptRestore={vi.fn()}
        onSetRestoreOperationConfirmation={vi.fn()}
      />,
    );

    const searchInput = screen.getByPlaceholderText("Sicherungsdatei suchen …");
    fireEvent.change(searchInput, { target: { value: "manual" } });

    expect(
      screen.getAllByText("backup_2026-08-25_manual.dump").length,
    ).toBeGreaterThan(0);
    expect(
      screen.queryByText("backup_legacy_2026.json"),
    ).not.toBeInTheDocument();
  });
});
