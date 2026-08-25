import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { api } from "../../lib/api";
import { AdminMaintenanceView } from "./AdminMaintenanceView";

vi.mock("../../lib/api", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

describe("AdminMaintenanceView", () => {
  it("rendert Normalbetrieb korrekt", async () => {
    (api.get as any).mockResolvedValueOnce({
      data: {
        phase: "OPEN",
        since: null,
        byUserId: null,
        byUsername: null,
        reason: null,
        expectedUntil: null,
      },
    });

    render(
      <MemoryRouter>
        <AdminMaintenanceView />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(
        screen.getByText("Normalbetrieb (Kassen & Festbetrieb aktiv)"),
      ).toBeInTheDocument();
    });

    expect(
      screen.getByRole("button", { name: "Wartungsmodus starten" }),
    ).toBeInTheDocument();
  });

  it("rendert aktiven Wartungsmodus korrekt", async () => {
    (api.get as any).mockResolvedValueOnce({
      data: {
        phase: "LOCKED",
        since: "2026-08-25T12:00:00.000Z",
        byUserId: "user-1",
        byUsername: "admin",
        reason: "Datenbank-Wartung",
        expectedUntil: null,
      },
    });

    render(
      <MemoryRouter>
        <AdminMaintenanceView />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(
        screen.getByText("Wartungssperre aktiv (Kassen gesperrt)"),
      ).toBeInTheDocument();
    });

    expect(screen.getByText("Gesperrt")).toBeInTheDocument();
    expect(screen.getByText(/Datenbank-Wartung/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Wartungsmodus jetzt beenden" }),
    ).toBeInTheDocument();
  });
});
