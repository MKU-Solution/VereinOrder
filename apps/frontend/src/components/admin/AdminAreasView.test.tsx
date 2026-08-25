import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AdminAreasView } from "./AdminAreasView";

describe("AdminAreasView", () => {
  const mockAreas = [
    { id: "area-1", name: "Gastgarten", sortOrder: 1 },
    { id: "area-2", name: "Festhalle", sortOrder: 2 },
  ];

  it("rendert alle Bereiche und filtert nach Suche", () => {
    const onEdit = vi.fn();
    const onDelete = vi.fn();

    render(
      <AdminAreasView
        areas={mockAreas}
        onRefresh={vi.fn()}
        onOpenCreate={vi.fn()}
        onEdit={onEdit}
        onDelete={onDelete}
      />,
    );

    expect(screen.getAllByText("Gastgarten").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Festhalle").length).toBeGreaterThan(0);

    const searchInput = screen.getByPlaceholderText("Bereich suchen …");
    fireEvent.change(searchInput, { target: { value: "Gast" } });

    expect(screen.getAllByText("Gastgarten").length).toBeGreaterThan(0);
    expect(screen.queryByText("Festhalle")).not.toBeInTheDocument();

    const editBtns = screen.getAllByRole("button", {
      name: "Bereich Gastgarten bearbeiten",
    });
    fireEvent.click(editBtns[0]);
    expect(onEdit).toHaveBeenCalledWith(mockAreas[0]);
  });

  it("zeigt leeren Zustand wenn keine Bereiche vorhanden sind", () => {
    const onOpenCreate = vi.fn();

    render(
      <AdminAreasView
        areas={[]}
        onRefresh={vi.fn()}
        onOpenCreate={onOpenCreate}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(
      screen.getByText("Noch keine Bereiche angelegt"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Bereich anlegen" }));
    expect(onOpenCreate).toHaveBeenCalled();
  });
});
