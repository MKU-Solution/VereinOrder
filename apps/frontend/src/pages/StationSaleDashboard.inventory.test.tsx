import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "../lib/api";
import { StationSaleDashboard } from "./StationSaleDashboard";

vi.mock("../lib/api", () => ({ api: { get: vi.fn(), post: vi.fn() } }));

const mockedApi = api as unknown as { get: ReturnType<typeof vi.fn> };
const sources: Array<{ onmessage: ((event: MessageEvent) => void) | null }> =
  [];

class MockEventSource {
  onmessage: ((event: MessageEvent) => void) | null = null;
  constructor(_url: string) {
    sources.push(this);
  }
  close() {}
}

beforeEach(() => {
  sources.length = 0;
  vi.stubGlobal("EventSource", MockEventSource);
  mockedApi.get.mockReset();
  mockedApi.get.mockResolvedValue({
    data: [
      {
        id: "event-1",
        name: "Sommerfest",
        status: "ACTIVE",
        testMode: false,
        printingReady: true,
        activeSession: {
          id: "session-1",
          startingBalance: 0,
          startTime: "2026-01-01",
        },
        stations: [
          {
            id: "station-1",
            name: "Ausschank",
            shortName: "Bar",
            sortOrder: 0,
          },
        ],
        products: [
          {
            id: "product-1",
            name: "Bier",
            price: 400,
            availability: "AVAILABLE",
            optionGroups: [],
            targetStationId: "station-1",
          },
        ],
      },
    ],
  });
});

describe("Echtzeitbestand der Stationskasse (Issue #141)", () => {
  it("übernimmt PRODUCT_INVENTORY_CHANGED und belässt die Sperre an der Verkaufskachel", async () => {
    render(<StationSaleDashboard />);
    fireEvent.click(await screen.findByRole("button", { name: /Ausschank/ }));
    const tile = await screen.findByRole("button", { name: /Bier/ });
    expect(tile).not.toBeDisabled();
    await waitFor(() => expect(sources.length).toBeGreaterThan(0));

    sources[sources.length - 1]?.onmessage?.({
      data: JSON.stringify({
        type: "PRODUCT_INVENTORY_CHANGED",
        data: {
          productId: "product-1",
          availability: "OUT_OF_STOCK",
          stockQuantity: 0,
          lowStockThreshold: 2,
          version: 3,
        },
      }),
    } as MessageEvent);

    await waitFor(() => expect(tile).toBeDisabled());
  });

  it("kennzeichnet eine knappe Kachel als 'Knapp', lässt sie aber antippbar", async () => {
    render(<StationSaleDashboard />);
    fireEvent.click(await screen.findByRole("button", { name: /Ausschank/ }));
    const tile = await screen.findByRole("button", { name: /Bier/ });
    expect(tile).not.toBeDisabled();
    await waitFor(() => expect(sources.length).toBeGreaterThan(0));

    sources[sources.length - 1]?.onmessage?.({
      data: JSON.stringify({
        type: "PRODUCT_INVENTORY_CHANGED",
        data: {
          productId: "product-1",
          availability: "LOW_STOCK",
          stockQuantity: 2,
          lowStockThreshold: 2,
          version: 3,
        },
      }),
    } as MessageEvent);

    await waitFor(() => expect(screen.getByText("Knapp")).toBeInTheDocument());
    expect(tile).not.toBeDisabled();
    expect(screen.queryByText("Ausverkauft")).not.toBeInTheDocument();
  });
});
