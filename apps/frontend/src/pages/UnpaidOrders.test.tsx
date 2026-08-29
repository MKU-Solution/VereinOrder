import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../lib/api";
import { UnpaidOrders } from "./UnpaidOrders";

vi.mock("../lib/api", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

vi.mock("../components/CheckoutModal", () => ({
  CheckoutModal: ({
    valueVoucherContext,
  }: {
    valueVoucherContext?: {
      eventId: string;
      orderId: string;
      cashierSessionId: string;
    };
  }) => (
    <output data-testid="value-voucher-context">
      {JSON.stringify(valueVoucherContext ?? null)}
    </output>
  ),
}));
vi.mock("../components/OrderDetailsModal", () => ({
  OrderDetailsModal: () => null,
}));
vi.mock("../components/OrderSplitModal", () => ({
  OrderSplitModal: () => null,
}));

const mockedApi = api as unknown as {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
};

describe("UnpaidOrders", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lädt offene Tischbestellungen aus dem aktuellen Sitzungs-Kontext statt vom ersten Produkt", async () => {
    const oldEventId = "11111111-1111-4111-8111-111111111111";
    const currentEventId = "22222222-2222-4222-8222-222222222222";
    const openTableOrder = {
      id: "order-t139",
      orderNumber: 139,
      eventId: currentEventId,
      tableName: "T139",
      totalAmount: 350,
      paymentStatus: "OPEN",
      lifecycleStatus: "SUBMITTED",
      items: [
        {
          id: "item-cola",
          quantity: 1,
          paidQuantity: 0,
          priceAtTime: 350,
          status: "PENDING",
          product: { name: "Cola" },
        },
      ],
      payments: [],
    };

    mockedApi.get.mockImplementation(async (url: string) => {
      if (url === "/sessions/context") {
        return {
          data: [
            {
              id: oldEventId,
              name: "Altes Sommerfest",
              status: "TEST_MODE",
              testMode: true,
              activeSession: null,
            },
            {
              id: currentEventId,
              name: "Aktuelles Sommerfest",
              status: "TEST_MODE",
              testMode: true,
              activeSession: { id: "session-current" },
            },
          ],
        } as any;
      }
      if (url === `/orders/unpaid?eventId=${oldEventId}`) {
        return { data: [] } as any;
      }
      if (url === `/orders/unpaid?eventId=${currentEventId}`) {
        return { data: [openTableOrder] } as any;
      }
      // Dieser Altpfad war die Ursache: das erste Produkt kann zu einem
      // anderen, parallel vorhandenen Event gehören.
      if (url === "/products") {
        return { data: [{ eventId: oldEventId }] } as any;
      }
      throw new Error(`Unerwarteter Request: ${url}`);
    });

    render(<UnpaidOrders />);

    await waitFor(() => {
      expect(screen.getByText("T139")).toBeInTheDocument();
      expect(screen.getByText(/1x Cola/)).toBeInTheDocument();
    });

    expect(mockedApi.get).toHaveBeenCalledWith("/sessions/context");
    expect(mockedApi.get).toHaveBeenCalledWith(
      `/orders/unpaid?eventId=${oldEventId}`,
    );
    expect(mockedApi.get).toHaveBeenCalledWith(
      `/orders/unpaid?eventId=${currentEventId}`,
    );
    expect(mockedApi.get).not.toHaveBeenCalledWith("/products");

    fireEvent.click(screen.getByRole("button", { name: "Voll abkassieren" }));
    await waitFor(() => {
      expect(screen.getByTestId("value-voucher-context")).toHaveTextContent(
        JSON.stringify({
          eventId: currentEventId,
          orderId: "order-t139",
          cashierSessionId: "session-current",
        }),
      );
    });
  });
});
