import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AdminCategoriesView } from "./AdminCategoriesView";

describe("AdminCategoriesView", () => {
  const mockCategories = [
    { id: "cat-1", name: "Getränke", sortOrder: 1, targetStationId: "stat-1" },
    { id: "cat-2", name: "Speisen", sortOrder: 2, targetStationId: null },
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
        onDelete={vi.fn()}
      />,
    );

    expect(screen.getAllByText("Getränke").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Speisen").length).toBeGreaterThan(0);

    const filter = screen.getByRole("combobox", {
      name: "Zielstation filtern",
    });
    fireEvent.change(filter, { target: { value: "stat-1" } });

    expect(screen.getAllByText("Getränke").length).toBeGreaterThan(0);
    expect(screen.queryByText("Speisen")).not.toBeInTheDocument();
  });
});
