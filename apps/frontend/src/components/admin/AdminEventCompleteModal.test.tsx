import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AdminEventCompleteModal } from "./AdminEventCompleteModal";
import type { EventItem } from "./adminDomainTypes";

const mockEvent: EventItem = {
  id: "evt-123",
  name: "Feuerwehrfest 2026",
  status: "ACTIVE",
  testMode: false,
  timezone: "Europe/Vienna",
  rksvConfirmedAt: "2026-08-20T10:00:00Z",
  startTime: "2026-08-26T10:00:00Z",
  organizer: "FF Musterstadt",
  location: "Festzelt",
};

describe("AdminEventCompleteModal (Issue #97)", () => {
  it("zeigt sauberen Standarddialog bei 0 offenen Vormerkungen und schließt ohne Warnung ab", () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();

    render(
      <AdminEventCompleteModal
        event={mockEvent}
        openQueueSummary={{ count: 0, totalCents: 0 }}
        onClose={onClose}
        onConfirm={onConfirm}
      />,
    );

    expect(
      screen.getByText(
        /Möchtest du die Veranstaltung „Feuerwehrfest 2026“ wirklich abschließen\?/i,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /Auf diesem Gerät liegen keine offenen Vormerkungen vor/i,
      ),
    ).toBeInTheDocument();

    const submitBtn = screen.getByRole("button", {
      name: /Veranstaltung abschließen/i,
    });
    expect(submitBtn).not.toBeDisabled();

    fireEvent.click(submitBtn);
    expect(onConfirm).toHaveBeenCalledWith(false);
  });

  it("zeigt Warnung mit Anzahl, Betrag und Handlungsempfehlung bei offenen Vormerkungen und verlangt Bestätigung", () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();

    render(
      <AdminEventCompleteModal
        event={mockEvent}
        openQueueSummary={{ count: 3, totalCents: 4550 }}
        onClose={onClose}
        onConfirm={onConfirm}
      />,
    );

    expect(
      screen.getByTestId("event-complete-offline-warning"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /Achtung: 3 offene Vormerkungen \(€\s*45,50\) auf diesem Gerät!/i,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /Handlungsempfehlung: Bitte stelle sicher, dass alle Geräte online sind/i,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /Hinweis zur Grenze: Es werden ausschließlich die offenen Vormerkungen auf diesem Gerät geprüft/i,
      ),
    ).toBeInTheDocument();

    const submitBtn = screen.getByRole("button", {
      name: /Veranstaltung abschließen/i,
    });
    expect(submitBtn).toBeDisabled();

    const checkbox = screen.getByRole("checkbox");
    expect(checkbox).not.toBeChecked();

    fireEvent.click(checkbox);
    expect(checkbox).toBeChecked();
    expect(submitBtn).not.toBeDisabled();

    fireEvent.click(submitBtn);
    expect(onConfirm).toHaveBeenCalledWith(true);
  });

  it("bricht beim Klick auf Abbrechen ab", () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();

    render(
      <AdminEventCompleteModal
        event={mockEvent}
        openQueueSummary={{ count: 1, totalCents: 1500 }}
        onClose={onClose}
        onConfirm={onConfirm}
      />,
    );

    const cancelBtn = screen.getByRole("button", { name: /Abbrechen/i });
    fireEvent.click(cancelBtn);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
