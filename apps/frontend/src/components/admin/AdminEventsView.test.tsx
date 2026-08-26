import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AdminEventsView } from "./AdminEventsView";
import type { EventItem } from "./adminDomainTypes";

describe("AdminEventsView", () => {
  const mockEvents: EventItem[] = [
    {
      id: "evt-1",
      name: "Feuerwehrfest 2026",
      organizer: "FF Musterstadt",
      location: "Festzelt Hauptplatz",
      status: "ACTIVE",
      testMode: false,
      timezone: "Europe/Vienna",
      _count: { products: 12, stations: 3, areas: 2, orders: 45 },
    },
    {
      id: "evt-2",
      name: "Jugendturnier",
      organizer: "SV Verein",
      location: "Sportplatz",
      status: "DRAFT",
      testMode: false,
      timezone: "Europe/Vienna",
      _count: { products: 5, stations: 1, areas: 1, orders: 0 },
    },
  ];

  it("rendert alle Veranstaltungen und ermöglicht Suche", () => {
    render(
      <AdminEventsView
        events={mockEvents}
        onRefresh={vi.fn()}
        onOpenCreate={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onActivate={vi.fn()}
        onSetTestMode={vi.fn()}
        onPause={vi.fn()}
        onComplete={vi.fn()}
        onConfigurationDone={vi.fn()}
      />,
    );

    expect(screen.getAllByText("Feuerwehrfest 2026").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Jugendturnier").length).toBeGreaterThan(0);

    const searchInput = screen.getByPlaceholderText(
      "Veranstaltung, Ort oder Veranstalter suchen …",
    );
    fireEvent.change(searchInput, { target: { value: "Musterstadt" } });

    expect(screen.getAllByText("Feuerwehrfest 2026").length).toBeGreaterThan(0);
    expect(screen.queryByText("Jugendturnier")).not.toBeInTheDocument();
  });

  it("filtert nach Status", () => {
    render(
      <AdminEventsView
        events={mockEvents}
        onRefresh={vi.fn()}
        onOpenCreate={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onActivate={vi.fn()}
        onSetTestMode={vi.fn()}
        onPause={vi.fn()}
        onComplete={vi.fn()}
        onConfigurationDone={vi.fn()}
      />,
    );

    const statusFilter = screen.getByRole("combobox", {
      name: "Status filtern",
    });
    fireEvent.change(statusFilter, { target: { value: "DRAFT" } });

    expect(screen.queryByText("Feuerwehrfest 2026")).not.toBeInTheDocument();
    expect(screen.getAllByText("Jugendturnier").length).toBeGreaterThan(0);
  });

  it("ruft Primäraktion und Bearbeiten auf", () => {
    const onOpenCreate = vi.fn();
    const onEdit = vi.fn();

    render(
      <AdminEventsView
        events={mockEvents}
        onRefresh={vi.fn()}
        onOpenCreate={onOpenCreate}
        onEdit={onEdit}
        onDelete={vi.fn()}
        onActivate={vi.fn()}
        onSetTestMode={vi.fn()}
        onPause={vi.fn()}
        onComplete={vi.fn()}
        onConfigurationDone={vi.fn()}
      />,
    );

    const editBtns = screen.getAllByRole("button", {
      name: "Veranstaltung Feuerwehrfest 2026 bearbeiten",
    });
    fireEvent.click(editBtns[0]);
    expect(onEdit).toHaveBeenCalledWith(mockEvents[0]);
  });

  it("zeigt Leeren Zustand wenn keine Veranstaltungen existieren", () => {
    const onOpenCreate = vi.fn();

    render(
      <AdminEventsView
        events={[]}
        onRefresh={vi.fn()}
        onOpenCreate={onOpenCreate}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onActivate={vi.fn()}
        onSetTestMode={vi.fn()}
        onPause={vi.fn()}
        onComplete={vi.fn()}
        onConfigurationDone={vi.fn()}
      />,
    );

    expect(
      screen.getByText("Noch keine Veranstaltungen angelegt"),
    ).toBeInTheDocument();
    const createBtn = screen.getByRole("button", {
      name: "Veranstaltung anlegen",
    });
    fireEvent.click(createBtn);
    expect(onOpenCreate).toHaveBeenCalled();
  });

  it("löst onComplete beim Klick auf Abschließen aus", () => {
    const onComplete = vi.fn();

    render(
      <AdminEventsView
        events={mockEvents}
        onRefresh={vi.fn()}
        onOpenCreate={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onActivate={vi.fn()}
        onSetTestMode={vi.fn()}
        onPause={vi.fn()}
        onComplete={onComplete}
        onConfigurationDone={vi.fn()}
      />,
    );

    const completeBtns = screen.getAllByRole("button", {
      name: /Abschließen/i,
    });
    fireEvent.click(completeBtns[0]);
    expect(onComplete).toHaveBeenCalledWith(mockEvents[0]);
  });
});
