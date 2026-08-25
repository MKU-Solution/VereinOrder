import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { AdminDiagnosticsView } from "./AdminDiagnosticsView";

describe("AdminDiagnosticsView", () => {
  const mockDiagnosticsData = {
    overallHealth: "GREEN",
    serverTime: "2026-08-25T14:00:00.000Z",
    backend: {
      uptimeSeconds: 3600,
      nodeVersion: "v20.12.7",
      appVersion: "0.1.0",
      memory: {
        rssMb: 120,
        heapUsedMb: 60,
        heapTotalMb: 90,
      },
    },
    database: {
      connected: true,
      databaseSize: "25 MB",
      poolActiveConnections: 2,
      poolTotalConnections: 10,
    },
    backups: {
      storageUsedBytes: 1024 * 1024 * 50,
      totalBackups: 12,
    },
    printers: {
      activePrinters: 3,
      totalConfiguredPrinters: 3,
      pendingPrintJobs: 0,
      failedPrintJobs: 0,
    },
    sessions: {
      activeSessionsCount: 4,
    },
    offline: {
      queueCount: 0,
    },
    recommendations: [
      {
        level: "SUCCESS",
        title: "Drucker bereit",
        message: "Alle 3 Drucker sind erreichbar.",
        actionTab: "printers",
      },
    ],
  };

  it("rendert Ampelstatus, Handlungsempfehlungen und alle 4 Kacheln", () => {
    render(
      <MemoryRouter>
        <AdminDiagnosticsView
          diagnosticsData={mockDiagnosticsData}
          onRefresh={vi.fn()}
          onRetryFailedJobs={vi.fn()}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText("● Bereit für Festbetrieb")).toBeInTheDocument();
    expect(screen.getByText("Drucker bereit")).toBeInTheDocument();
    expect(screen.getByText("Backend & Host-System")).toBeInTheDocument();
    expect(screen.getByText("Datenbank & PostgreSQL")).toBeInTheDocument();
    expect(screen.getByText("Drucker-Infrastruktur")).toBeInTheDocument();
    expect(screen.getByText("Kassen & Offline-Betrieb")).toBeInTheDocument();
    expect(screen.getByText("Verbunden")).toBeInTheDocument();
  });
});
