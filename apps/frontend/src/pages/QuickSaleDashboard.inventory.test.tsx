import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "../lib/api";
import { QuickSaleDashboard } from "./QuickSaleDashboard";

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
        products: [
          {
            id: "product-1",
            name: "Bier",
            price: 400,
            availability: "AVAILABLE",
            optionGroups: [],
          },
        ],
      },
    ],
  });
});

describe("Echtzeitbestand der Bonkasse (Issue #141)", () => {
  it("zeigt Produktkacheln weiterhin an, wenn EventSource in der Umgebung fehlt", async () => {
    const originalEventSource = (globalThis as { EventSource?: unknown })
      .EventSource;
    // Bewusst entfernt, um ein Endgerät ohne EventSource-Unterstützung
    // nachzustellen (Issue #141 Regression).
    delete (globalThis as { EventSource?: unknown }).EventSource;
    try {
      render(
        <MemoryRouter>
          <QuickSaleDashboard />
        </MemoryRouter>,
      );
      const tile = await screen.findByRole("button", { name: /Bier/ });
      expect(tile).not.toBeDisabled();
    } finally {
      vi.stubGlobal("EventSource", originalEventSource);
    }
  });

  it("übernimmt PRODUCT_INVENTORY_CHANGED sofort und sperrt die ausverkaufte Kachel", async () => {
    render(
      <MemoryRouter>
        <QuickSaleDashboard />
      </MemoryRouter>,
    );
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
    expect(screen.getByText("Ausverkauft")).toBeInTheDocument();
  });

  it("kennzeichnet eine knappe Kachel als 'Knapp', lässt sie aber antippbar", async () => {
    render(
      <MemoryRouter>
        <QuickSaleDashboard />
      </MemoryRouter>,
    );
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

  it("lässt einen unbekannten Nachrichtentyp (z. B. den Herzschlag aus #186) folgenlos", async () => {
    render(
      <MemoryRouter>
        <QuickSaleDashboard />
      </MemoryRouter>,
    );
    const tile = await screen.findByRole("button", { name: /Bier/ });
    expect(tile).not.toBeDisabled();
    await waitFor(() => expect(sources.length).toBeGreaterThan(0));

    sources[sources.length - 1]?.onmessage?.({
      data: JSON.stringify({
        type: "HEARTBEAT",
        data: null,
        timestamp: "2026-09-03T00:00:00.000Z",
      }),
    } as MessageEvent);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(tile).not.toBeDisabled();
    expect(screen.queryByText("Ausverkauft")).not.toBeInTheDocument();
    expect(screen.queryByText("Knapp")).not.toBeInTheDocument();
  });
});
