import { StrictMode } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "../../lib/api";
import { AdminOverviewPage } from "./AdminOverviewPage";
import type { AdminOverviewDiagnostics } from "./useAdminOverviewStatus";

vi.mock("../../lib/api", () => ({
  api: { get: vi.fn() },
}));

const getMock = vi.mocked(api.get);

const event = {
  id: "event-1",
  name: "Sommerfest 2026",
  timezone: "Europe/Vienna",
  status: "ACTIVE" as const,
  testMode: false,
};

const diagnostics: AdminOverviewDiagnostics = {
  overallHealth: "GREEN" as const,
  serverTime: "2026-08-24T14:15:00.000Z",
  backend: { appVersion: "0.1.0", uptimeSeconds: 3600 },
  database: { status: "ONLINE", latencyMs: 4 },
  printers: {
    total: 2,
    active: 2,
    queue: { pending: 0, failed: 0, printed: 17, unclear: 0 },
  },
  backup: {
    totalBackups: 1,
    latestBackup: {
      filename: "vereinorder_manual.dump",
      createdAt: "2026-08-24T13:00:00.000Z",
      verification: "RESTORE_VERIFIED" as const,
    },
    toolStatus: { enabled: true, message: "bereit" },
    storage: { creationAllowed: true },
  },
  recommendations: [
    {
      level: "SUCCESS" as const,
      title: "Alle Systeme bereit für den Festbetrieb",
      message: "Alle lokalen Prüfungen waren erfolgreich.",
    },
  ],
};

const maintenance = {
  phase: "OPEN" as const,
  since: null,
  expectedUntil: null,
};

const respondWith = ({
  events = [event],
  diagnosticsValue = diagnostics,
  maintenanceValue = maintenance,
  diagnosticsError,
}: {
  events?: (typeof event)[];
  diagnosticsValue?: typeof diagnostics;
  maintenanceValue?:
    | typeof maintenance
    | {
        phase: "LOCKED";
        since: string;
        expectedUntil: string | null;
        reason: string;
      };
  diagnosticsError?: Error;
} = {}) => {
  getMock.mockImplementation((url) => {
    if (url === "/events") return Promise.resolve({ data: events });
    if (url === "/diagnostics/status") {
      return diagnosticsError
        ? Promise.reject(diagnosticsError)
        : Promise.resolve({ data: diagnosticsValue });
    }
    if (url === "/maintenance") {
      return Promise.resolve({ data: maintenanceValue });
    }
    return Promise.reject(new Error(`Unerwartete Test-URL: ${url}`));
  });
};

const renderOverview = () =>
  render(
    <MemoryRouter>
      <AdminOverviewPage />
    </MemoryRouter>,
  );

describe("Admin-Betriebsübersicht", () => {
  beforeEach(() => {
    getMock.mockReset();
  });

  it("zeigt den vollständigen lokalen Betriebsstand mit Quellen und Wegen", async () => {
    respondWith();
    renderOverview();

    expect(
      await screen.findByRole("heading", {
        name: "Lokaler Betrieb ist bereit",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Sommerfest 2026", { exact: false }),
    ).toBeInTheDocument();
    expect(screen.getByText("Echtbetrieb")).toBeInTheDocument();
    expect(screen.getByText("Wiederherstellung geprüft")).toBeInTheDocument();
    expect(screen.getByText("Normalbetrieb")).toBeInTheDocument();
    expect(screen.getAllByText(/Quelle: .* · geprüft/)).toHaveLength(5);
    expect(
      screen.getByRole("link", { name: /Drucker prüfen/ }),
    ).toHaveAttribute("href", "/admin/printers");
    expect(
      screen.queryByText("Alle Systeme bereit für den Festbetrieb"),
    ).not.toBeInTheDocument();
  });

  it("erklärt einen leeren Betrieb ohne erfundene Ersatzwerte", async () => {
    respondWith({
      events: [],
      diagnosticsValue: {
        ...diagnostics,
        backup: { ...diagnostics.backup, totalBackups: 0, latestBackup: null },
      },
    });
    renderOverview();

    expect(
      await screen.findByRole("heading", {
        name: "Veranstaltung für den Betrieb wählen",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("Kein aktiver Betrieb")).toBeInTheDocument();
    expect(screen.getByText("Keine Sicherung vorhanden")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Veranstaltung wählen/ }),
    ).toHaveAttribute("href", "/admin/events");
  });

  it("lässt bei einem Netzfehler die anderen Statusbereiche sichtbar", async () => {
    respondWith({ diagnosticsError: new Error("ECONNREFUSED") });
    renderOverview();

    expect(
      await screen.findByRole("heading", {
        name: "Status teilweise verfügbar",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Sommerfest 2026", { exact: false }),
    ).toBeInTheDocument();
    expect(screen.getByText("Normalbetrieb")).toBeInTheDocument();
    expect(
      screen.getAllByText(/Lokaler Systemstatus konnte nicht geladen/),
    ).toHaveLength(3);
    expect(
      screen.getByText(/Nicht alle lokalen Quellen antworten/),
    ).toBeInTheDocument();
    expect(getMock).toHaveBeenCalledWith("/events");
    expect(getMock).toHaveBeenCalledWith("/maintenance");
  });

  it("zeigt den Wartungsmodus textlich und führt nur zum Wartungsbereich", async () => {
    respondWith({
      maintenanceValue: {
        phase: "LOCKED",
        since: "2026-08-24T12:00:00.000Z",
        expectedUntil: null,
        reason: "Geprüfte Wiederherstellung",
      },
    });
    renderOverview();

    expect(
      await screen.findByRole("heading", {
        name: "Wartung aktiv – Betrieb eingeschränkt",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("Wartungssperre aktiv")).toBeInTheDocument();
    expect(
      screen.getByText(/Grund: Geprüfte Wiederherstellung/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Wartung öffnen/ }),
    ).toHaveAttribute("href", "/admin/maintenance");
    expect(
      screen.queryByRole("button", { name: /Wartung.*beenden/ }),
    ).not.toBeInTheDocument();
  });

  it("zeigt während unabhängiger Abfragen einen konkreten Ladezustand", () => {
    getMock.mockImplementation(() => new Promise(() => undefined));
    renderOverview();

    expect(
      screen.getByRole("heading", { name: "Betriebsstatus wird geprüft" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Veranstaltungsstatus wird lokal geprüft …"),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/wird lokal geprüft/)).toHaveLength(5);
  });

  it("fragt alle Quellen erneut ab, wenn der Aktualisierungsimpuls wechselt", async () => {
    respondWith();
    const view = render(
      <MemoryRouter>
        <AdminOverviewPage refreshToken={0} />
      </MemoryRouter>,
    );
    await screen.findByRole("heading", { name: "Lokaler Betrieb ist bereit" });

    view.rerender(
      <MemoryRouter>
        <AdminOverviewPage refreshToken={1} />
      </MemoryRouter>,
    );
    await waitFor(() => expect(getMock).toHaveBeenCalledTimes(6));
  });

  it("verlässt auch unter React StrictMode zuverlässig den Ladezustand", async () => {
    respondWith();
    render(
      <StrictMode>
        <MemoryRouter>
          <AdminOverviewPage />
        </MemoryRouter>
      </StrictMode>,
    );

    expect(
      await screen.findByRole("heading", {
        name: "Lokaler Betrieb ist bereit",
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Betriebsstatus wird geprüft" }),
    ).not.toBeInTheDocument();
  });
});
