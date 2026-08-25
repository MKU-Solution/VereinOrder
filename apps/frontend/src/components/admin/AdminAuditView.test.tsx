import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AdminAuditView } from "./AdminAuditView";

describe("AdminAuditView", () => {
  const mockAuditLogs = [
    {
      id: "log-1",
      action: "LOGIN",
      createdAt: "2026-08-25T11:00:00.000Z",
      user: { username: "admin" },
      ipAddress: "127.0.0.1",
      details: { method: "PIN" },
    },
    {
      id: "log-2",
      action: "CANCEL_ORDER",
      createdAt: "2026-08-25T11:30:00.000Z",
      user: { username: "kellner1" },
      ipAddress: "192.168.1.101",
      details: { orderNumber: 42, reason: "Fehlbestellung" },
    },
    {
      id: "log-3",
      action: "PRICE_CHANGED",
      createdAt: "2026-08-25T11:45:00.000Z",
      user: { username: "admin" },
      ipAddress: "127.0.0.1",
      details: { productName: "Bier 0.5L", oldPrice: 3.8, newPrice: 4.2 },
    },
  ];

  it("rendert Kennzahlen, Audit-Tabelle und Export-Button", () => {
    render(
      <AdminAuditView
        auditLogs={mockAuditLogs}
        onRefresh={vi.fn()}
        onExportCsv={vi.fn()}
      />,
    );

    expect(screen.getByText("Gesamteinträge")).toBeInTheDocument();
    expect(screen.getAllByText("Anmeldung").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Bestellung storniert").length).toBeGreaterThan(
      0,
    );
    expect(screen.getAllByText("Preisänderung").length).toBeGreaterThan(0);
    expect(
      screen.getByRole("button", { name: "CSV exportieren" }),
    ).toBeInTheDocument();
  });

  it("filtert nach Benutzer oder Aktion", () => {
    render(
      <AdminAuditView
        auditLogs={mockAuditLogs}
        onRefresh={vi.fn()}
        onExportCsv={vi.fn()}
      />,
    );

    const searchInput = screen.getByPlaceholderText(
      "Benutzer, Aktion oder Details suchen …",
    );
    fireEvent.change(searchInput, { target: { value: "kellner1" } });

    expect(screen.getAllByText("kellner1").length).toBeGreaterThan(0);
    expect(screen.queryByText("Bier 0.5L")).not.toBeInTheDocument();
  });
});
