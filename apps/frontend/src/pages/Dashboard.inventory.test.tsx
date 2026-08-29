import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "../lib/api";
import { enqueueOfflineOrder } from "../lib/offlineSync";
import { useCartStore } from "../store/useCartStore";
import { Dashboard } from "./Dashboard";

vi.mock("../lib/api", () => ({ api: { get: vi.fn(), post: vi.fn() } }));
vi.mock("../lib/offlineSync", () => ({
  OFFLINE_SYNC_HEADER: "x-offline-sync",
  OfflineQueueFullError: class OfflineQueueFullError extends Error {},
  OfflineQueueUnavailableError: class OfflineQueueUnavailableError extends Error {},
  enqueueOfflineOrder: vi.fn(),
  countOpenOfflineOrders: vi.fn().mockResolvedValue(0),
  recoverInterruptedOfflineSends: vi.fn().mockResolvedValue(undefined),
  runOfflineQueueSync: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../components/CheckoutModal", () => ({
  CheckoutModal: ({ isOpen, onConfirm }: any) =>
    isOpen ? (
      <button onClick={() => onConfirm([])}>Test-Abrechnung</button>
    ) : null,
}));

const mockedApi = api as unknown as {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
};
const mockedEnqueue = enqueueOfflineOrder as ReturnType<typeof vi.fn>;
const sources: Array<{ onmessage: ((event: MessageEvent) => void) | null }> =
  [];

class MockEventSource {
  onmessage: ((event: MessageEvent) => void) | null = null;
  constructor(_url: string) {
    sources.push(this);
  }
  close() {}
}

const trackedProduct = {
  id: "product-1",
  eventId: "event-1",
  name: "Bier",
  shortName: "Bier",
  price: 400,
  availability: "AVAILABLE",
  inventoryTracked: true,
  stockQuantity: 1,
  lowStockThreshold: 1,
  optionGroups: [],
};

beforeEach(() => {
  sources.length = 0;
  vi.stubGlobal("EventSource", MockEventSource);
  vi.stubGlobal("alert", vi.fn());
  mockedApi.get.mockReset();
  mockedApi.post.mockReset();
  mockedEnqueue.mockReset();
  useCartStore.setState({ items: [], total: 0 });
  mockedApi.get.mockImplementation((url: string) => {
    if (url === "/products") return Promise.resolve({ data: [trackedProduct] });
    if (url === "/sessions/context") {
      return Promise.resolve({
        data: [
          {
            id: "event-1",
            name: "Sommerfest",
            status: "ACTIVE",
            testMode: false,
            activeSession: { id: "session-1" },
          },
        ],
      });
    }
    return Promise.resolve({ data: [] });
  });
});

describe("Bestandsschutz in der Bestellaufnahme (Issue #141)", () => {
  it("übernimmt PRODUCT_INVENTORY_CHANGED und sperrt die nun ausverkaufte Produktkachel", async () => {
    render(<Dashboard />);
    const tile = await screen.findByRole("button", { name: /Bier/ });
    await waitFor(() => expect(sources.length).toBeGreaterThan(0));

    sources[sources.length - 1]?.onmessage?.({
      data: JSON.stringify({
        type: "PRODUCT_INVENTORY_CHANGED",
        data: {
          productId: "product-1",
          productName: "Bier",
          availability: "OUT_OF_STOCK",
          stockQuantity: 0,
          lowStockThreshold: 1,
          version: 2,
        },
      }),
    } as MessageEvent);

    await waitFor(() => expect(tile).toBeDisabled());
  });

  it("behält den Warenkorb bei INVENTORY_INSUFFICIENT unverändert", async () => {
    mockedApi.post.mockRejectedValue({
      response: { status: 409, data: { code: "INVENTORY_INSUFFICIENT" } },
    });
    render(<Dashboard />);
    fireEvent.click(await screen.findByRole("button", { name: /Bier/ }));
    fireEvent.click(screen.getByRole("button", { name: "Zahlen" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Test-Abrechnung" }),
    );

    await waitFor(() => expect(mockedApi.post).toHaveBeenCalled());
    expect(useCartStore.getState().items).toHaveLength(1);
    expect(mockedEnqueue).not.toHaveBeenCalled();
    expect(globalThis.alert).toHaveBeenCalledWith(
      expect.stringContaining("Warenkorb bleibt unverändert"),
    );
  });

  it("legt gezählte Produkte nach einem Netzfehler niemals in der Offline-Warteschlange ab", async () => {
    mockedApi.post.mockRejectedValue({ code: "ERR_NETWORK" });
    render(<Dashboard />);
    fireEvent.click(await screen.findByRole("button", { name: /Bier/ }));
    fireEvent.click(screen.getByRole("button", { name: "Zahlen" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Test-Abrechnung" }),
    );

    await waitFor(() => expect(globalThis.alert).toHaveBeenCalled());
    expect(mockedEnqueue).not.toHaveBeenCalled();
    expect(useCartStore.getState().items).toHaveLength(1);
    expect(globalThis.alert).toHaveBeenCalledWith(
      expect.stringContaining("nicht offline vorgemerkt"),
    );
  });
});
