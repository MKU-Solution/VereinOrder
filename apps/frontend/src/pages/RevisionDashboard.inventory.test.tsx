import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "../lib/api";
import { RevisionDashboard } from "./RevisionDashboard";

vi.mock("../lib/api", () => ({ api: { get: vi.fn() } }));

const mockedApi = api as unknown as { get: ReturnType<typeof vi.fn> };

const summary = {
  totalAmount: 0,
  orderCount: 0,
  openAmount: 0,
  cashRevenue: 0,
  cardRevenue: 0,
  voucherRevenue: 0,
  cancelledCount: 0,
  cancelledAmount: 0,
};

beforeEach(() => {
  mockedApi.get.mockReset();
  mockedApi.get.mockImplementation((url: string) => {
    if (url === "/events") {
      return Promise.resolve({
        data: [
          {
            id: "event-test",
            name: "Probe",
            status: "TEST_MODE",
            testMode: true,
          },
        ],
      });
    }
    if (url === "/reports/summary?eventId=event-test") {
      return Promise.resolve({ data: summary });
    }
    if (
      url === "/reports/products?eventId=event-test" ||
      url === "/reports/categories?eventId=event-test" ||
      url === "/reports/users?eventId=event-test" ||
      url === "/reports/hourly?eventId=event-test" ||
      url === "/reports/sessions?eventId=event-test"
    ) {
      return Promise.resolve({ data: [] });
    }
    if (url === "/reports/inventory?eventId=event-test&dataMode=TEST") {
      return Promise.resolve({
        data: [
          {
            productId: "product-1",
            name: "Bier",
            inventoryTracked: true,
            initialQuantity: 20,
            grossSales: 6,
            cancellations: 1,
            expectedQuantity: 15,
            actualQuantity: 15,
            difference: 0,
            effectiveAvailability: "LOW_STOCK",
          },
        ],
      });
    }
    if (url === "/reports/export/inventory?eventId=event-test&dataMode=TEST") {
      return Promise.resolve({ data: "Produkt;Soll;Ist" });
    }
    throw new Error(`Unerwarteter API-Aufruf im Revisionstest: ${url}`);
  });
  vi.stubGlobal("alert", vi.fn());
  vi.stubGlobal("URL", {
    createObjectURL: vi.fn(() => "blob:inventory"),
    revokeObjectURL: vi.fn(),
  });
});

describe("Bestandsabgleich in der Revision (Issue #141)", () => {
  it("lädt und zeigt die TEST-Bestandsbewegungen getrennt an und exportiert denselben Betrieb als CSV", async () => {
    render(<RevisionDashboard />);

    await waitFor(() =>
      expect(mockedApi.get).toHaveBeenCalledWith(
        "/reports/inventory?eventId=event-test&dataMode=TEST",
      ),
    );
    const bestandsButtons = await screen.findAllByRole("button", {
      name: "Bestandsabgleich",
    });
    const inventoryTab = bestandsButtons.find((button) =>
      button.parentElement?.className.includes("overflow-x-auto"),
    );
    if (!inventoryTab) throw new Error("Tab Bestandsabgleich nicht gefunden.");
    fireEvent.click(inventoryTab);
    expect(
      await screen.findByText("Testbetrieb", { exact: false }),
    ).toBeInTheDocument();
    expect(screen.getByText("Bier")).toBeInTheDocument();
    expect(screen.getByText("LOW_STOCK")).toBeInTheDocument();

    const inventoryExport = screen
      .getAllByRole("button", { name: "Bestandsabgleich" })
      .find((button) => button.parentElement?.className.includes("flex-wrap"));
    if (!inventoryExport)
      throw new Error("CSV-Export Bestandsabgleich nicht gefunden.");
    fireEvent.click(inventoryExport);
    await waitFor(() =>
      expect(mockedApi.get).toHaveBeenCalledWith(
        "/reports/export/inventory?eventId=event-test&dataMode=TEST",
        { responseType: "blob" },
      ),
    );
  });
});
