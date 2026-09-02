import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AdminCategoriesView } from "./AdminCategoriesView";

describe("AdminCategoriesView", () => {
  const mockCategories = [
    {
      id: "cat-1",
      name: "Getränke",
      sortOrder: 1,
      targetStationId: "stat-1",
      deposit: 50,
      isActive: true,
    },
    {
      id: "cat-2",
      name: "Speisen",
      sortOrder: 2,
      targetStationId: null,
      deposit: 0,
      isActive: false,
    },
  ];

  const mockStations = [{ id: "stat-1", name: "Schank", shortName: "SCH" }];

  it("rendert Kategorien mit Zielstation und filtert", () => {
    render(
      <AdminCategoriesView
        categories={mockCategories}
        stationsList={mockStations}
        onRefresh={vi.fn()}
        onOpenCreate={vi.fn()}
        onEdit={vi.fn()}
      />,
    );

    expect(screen.getAllByText("Getränke").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Speisen").length).toBeGreaterThan(0);
    expect(screen.getByText("Pfandvorgabe: 0,50 €")).toBeInTheDocument();
    expect(screen.getByText("Keine Pfandvorgabe")).toBeInTheDocument();

    const filter = screen.getByRole("combobox", {
      name: "Zielstation filtern",
    });
    fireEvent.change(filter, { target: { value: "stat-1" } });

    expect(screen.getAllByText("Getränke").length).toBeGreaterThan(0);
    expect(screen.queryByText("Speisen")).not.toBeInTheDocument();
  });

  // Issue #168: Warengruppen haben keine Backend-Löschroute; der frühere
  // Löschknopf traf ins Leere und wurde ersatzlos entfernt. An seine Stelle
  // tritt das Deaktivieren (Issue #170, isActive-Feld, siehe Test unten).
  it("zeigt keinen Löschen-Knopf mehr (Issue #168)", () => {
    render(
      <AdminCategoriesView
        categories={mockCategories}
        stationsList={mockStations}
        onRefresh={vi.fn()}
        onOpenCreate={vi.fn()}
        onEdit={vi.fn()}
      />,
    );

    expect(
      screen.queryByRole("button", { name: /löschen/i }),
    ).not.toBeInTheDocument();
  });

  // Issue #170: die Liste macht den Aktivstatus der Warengruppe sichtbar -
  // ohne diesen Hinweis wäre für die Verwaltung nicht erkennbar, dass eine
  // Gruppe an den Kassen bereits stillgelegt ist.
  it("zeigt den Aktivstatus je Warengruppe", () => {
    render(
      <AdminCategoriesView
        categories={mockCategories}
        stationsList={mockStations}
        onRefresh={vi.fn()}
        onOpenCreate={vi.fn()}
        onEdit={vi.fn()}
      />,
    );

    expect(screen.getAllByText("Aktiv").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Inaktiv").length).toBeGreaterThan(0);
  });
});
