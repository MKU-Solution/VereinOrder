import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "../lib/api";
import { TableSelectionModal } from "./TableSelectionModal";

vi.mock("../lib/api", () => ({
  api: { get: vi.fn() },
}));

const sources: Array<{ onmessage: ((event: MessageEvent) => void) | null }> =
  [];

class MockEventSource {
  onmessage: ((event: MessageEvent) => void) | null = null;
  constructor(_url: string) {
    sources.push(this);
  }
  close() {}
}

describe("TableSelectionModal – Raumplan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sources.length = 0;
    vi.stubGlobal("EventSource", MockEventSource);
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url.startsWith("/areas/floor-plans")) {
        return {
          data: [
            {
              id: "area-1",
              name: "Festzelt",
              sortOrder: 0,
              floorPlan: {
                version: 1,
                width: 1000,
                height: 700,
                elements: [
                  {
                    id: "table-1",
                    kind: "TABLE_RECTANGLE",
                    label: "Tisch A1",
                    tableName: "A1",
                    x: 100,
                    y: 100,
                    width: 160,
                    height: 90,
                    rotation: 0,
                    status: "FREE",
                    openOrderCount: 0,
                  },
                ],
              },
            },
          ],
        } as any;
      }
      return { data: [{ id: "area-1", name: "Festzelt" }] } as any;
    });
  });

  it("wechselt ohne Verlust des Listen-Fallbacks zum Plan und übernimmt den Tisch", async () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(
      <TableSelectionModal
        isOpen
        eventId="event-1"
        onSelect={onSelect}
        onClose={onClose}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Liste & Eingabe" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Raumplan" }));
    const table = await screen.findByRole("button", {
      name: "Tisch A1, Frei",
    });
    fireEvent.click(table);

    await waitFor(() => expect(onSelect).toHaveBeenCalledWith("A1", "area-1"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("lädt den Raumplan bei einem unbekannten Nachrichtentyp (z. B. dem Herzschlag aus #186) nicht neu", async () => {
    render(
      <TableSelectionModal
        isOpen
        eventId="event-1"
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Raumplan" }));
    await screen.findByRole("button", { name: "Tisch A1, Frei" });
    await waitFor(() => expect(sources.length).toBeGreaterThan(0));

    const floorPlanCallsBefore = vi
      .mocked(api.get)
      .mock.calls.filter(([url]) =>
        (url as string).startsWith("/areas/floor-plans"),
      ).length;

    sources[sources.length - 1]?.onmessage?.({
      data: JSON.stringify({
        type: "HEARTBEAT",
        data: null,
        timestamp: "2026-09-03T00:00:00.000Z",
      }),
    } as MessageEvent);

    await new Promise((resolve) => setTimeout(resolve, 0));
    const floorPlanCallsAfter = vi
      .mocked(api.get)
      .mock.calls.filter(([url]) =>
        (url as string).startsWith("/areas/floor-plans"),
      ).length;
    expect(floorPlanCallsAfter).toBe(floorPlanCallsBefore);
  });
});
