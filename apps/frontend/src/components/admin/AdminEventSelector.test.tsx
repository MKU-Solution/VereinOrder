import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { AdminEventSelector } from "./AdminEventSelector";
import type { EventItem } from "./adminDomainTypes";

describe("AdminEventSelector", () => {
  const mockEvents: EventItem[] = [
    {
      id: "evt-1",
      name: "Feuerwehrfest 2026",
      status: "ACTIVE",
      testMode: false,
      timezone: "Europe/Vienna",
    },
    {
      id: "evt-2",
      name: "Schulungsevent",
      status: "TEST_MODE",
      testMode: true,
      timezone: "Europe/Vienna",
    },
  ];

  it("rendert Dropdown mit Events und triggert onSelectEvent", () => {
    const onSelect = vi.fn();

    render(
      <MemoryRouter>
        <AdminEventSelector
          events={mockEvents}
          selectedEventId="evt-1"
          onSelectEvent={onSelect}
        />
      </MemoryRouter>,
    );

    const select = screen.getByRole("combobox", { name: "Veranstaltung:" });
    expect(select).toBeInTheDocument();
    expect(screen.getByText("Echtbetrieb")).toBeInTheDocument();

    fireEvent.change(select, { target: { value: "evt-2" } });
    expect(onSelect).toHaveBeenCalledWith("evt-2");
  });

  it("zeigt Hinweismeldung mit Link wenn keine Events vorhanden sind", () => {
    render(
      <MemoryRouter>
        <AdminEventSelector
          events={[]}
          selectedEventId=""
          onSelectEvent={vi.fn()}
        />
      </MemoryRouter>,
    );

    expect(
      screen.getByText("Keine Veranstaltung vorhanden."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Zu den Veranstaltungen" }),
    ).toHaveAttribute("href", "/admin/events");
  });
});
