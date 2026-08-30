import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AdminStationsView } from "./AdminStationsView";

describe("AdminStationsView", () => {
  const mockStations = [
    {
      id: "stat-1",
      name: "Schank",
      shortName: "SCH",
      sortOrder: 1,
      printerId: "prn-1",
    },
    {
      id: "stat-2",
      name: "Kaffee & Kuchen",
      shortName: "KAF",
      sortOrder: 2,
      printerId: null,
    },
  ];

  const mockPrinters = [
    { id: "prn-1", name: "Bondrucker Bar", type: "NETWORK" },
  ];

  it("rendert Stationen mit Drucker und filtert nach Druckerzuordnung", () => {
    render(
      <AdminStationsView
        stations={mockStations}
        printersList={mockPrinters}
        onRefresh={vi.fn()}
        onOpenCreate={vi.fn()}
        onEdit={vi.fn()}
      />,
    );

    expect(screen.getAllByText("Schank").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Bondrucker Bar").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Kaffee & Kuchen").length).toBeGreaterThan(0);

    const filter = screen.getByRole("combobox", {
      name: "Druckerzuordnung filtern",
    });
    fireEvent.change(filter, { target: { value: "WITH_PRINTER" } });

    expect(screen.getAllByText("Schank").length).toBeGreaterThan(0);
    expect(screen.queryByText("Kaffee & Kuchen")).not.toBeInTheDocument();
  });

  // Issue #168: Der frühere Löschknopf traf ins Leere - im Backend gibt es
  // keine DELETE-Route für Stationen (nur PATCH mit isActive). Der Knopf
  // wurde ersatzlos entfernt, siehe stattdessen den Status in der Tabelle.
  it("zeigt keinen Löschen-Knopf mehr (Issue #168)", () => {
    render(
      <AdminStationsView
        stations={mockStations}
        printersList={mockPrinters}
        onRefresh={vi.fn()}
        onOpenCreate={vi.fn()}
        onEdit={vi.fn()}
      />,
    );

    expect(
      screen.queryByRole("button", { name: /löschen/i }),
    ).not.toBeInTheDocument();
  });

  it("zeigt den Aktiv/Inaktiv-Status der Station an (Issue #168)", () => {
    render(
      <AdminStationsView
        stations={[
          { ...mockStations[0], isActive: true },
          { ...mockStations[1], isActive: false },
        ]}
        printersList={mockPrinters}
        onRefresh={vi.fn()}
        onOpenCreate={vi.fn()}
        onEdit={vi.fn()}
      />,
    );

    expect(screen.getAllByText("Aktiv").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Inaktiv").length).toBeGreaterThan(0);
  });
});
