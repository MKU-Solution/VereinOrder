import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { OrderSplitModal } from "./OrderSplitModal";

describe("OrderSplitModal (#136)", () => {
  const mockOrder = {
    id: "order-1",
    orderNumber: 42,
    tableName: "Tisch 7",
    totalAmount: 3300, // 2x 12,00 + 2x 4,50 = 2400 + 900 = 3300
    items: [
      {
        id: "item-1",
        quantity: 2,
        paidQuantity: 0,
        priceAtTime: 1200,
        variantName: null,
        product: { id: "prod-1", name: "Schnitzel Wiener Art" },
      },
      {
        id: "item-2",
        quantity: 2,
        paidQuantity: 1, // 1 bereits bezahlt, 1 noch offen
        priceAtTime: 450,
        variantName: "0,5l",
        product: { id: "prod-2", name: "Helles Bier" },
      },
    ],
    payments: [{ amount: 450 }],
  };

  it("rendert alle offenen Positionen mit Restmengen und Preisen", () => {
    render(
      <OrderSplitModal
        isOpen={true}
        order={mockOrder}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    expect(
      screen.getByText("Rechnung aufteilen / Teilzahlung"),
    ).toBeInTheDocument();
    expect(screen.getByText("Bestellung #42")).toBeInTheDocument();
    expect(screen.getByText("Tisch 7")).toBeInTheDocument();

    expect(screen.getByText("Schnitzel Wiener Art")).toBeInTheDocument();
    expect(screen.getByText("Helles Bier")).toBeInTheDocument();
    expect(screen.getByText("Offen: 2")).toBeInTheDocument(); // Schnitzel
    expect(screen.getByText("Offen: 1")).toBeInTheDocument(); // Bier
  });

  it("erlaubt Mengenauswahl und berechnet den Teilbetrag live", () => {
    render(
      <OrderSplitModal
        isOpen={true}
        order={mockOrder}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    const plusSchnitzel = screen.getByLabelText(
      "Menge für Schnitzel Wiener Art erhöhen",
    );
    fireEvent.click(plusSchnitzel);

    expect(screen.getByTestId("selected-qty-item-1")).toHaveTextContent("1");
    expect(screen.getByTestId("split-total-cents")).toHaveTextContent(
      "€ 12.00",
    );

    const plusBier = screen.getByLabelText("Menge für Helles Bier erhöhen");
    fireEvent.click(plusBier);

    expect(screen.getByTestId("selected-qty-item-2")).toHaveTextContent("1");
    expect(screen.getByTestId("split-total-cents")).toHaveTextContent(
      "€ 16.50",
    );
  });

  it("wählt mit 'Alle offenen auswählen' alle Restmengen aus", () => {
    render(
      <OrderSplitModal
        isOpen={true}
        order={mockOrder}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    const selectAllBtn = screen.getByText("Alle offenen auswählen");
    fireEvent.click(selectAllBtn);

    expect(screen.getByTestId("selected-qty-item-1")).toHaveTextContent("2");
    expect(screen.getByTestId("selected-qty-item-2")).toHaveTextContent("1");
    // 2x 1200 + 1x 450 = 2400 + 450 = 2850
    expect(screen.getByTestId("split-total-cents")).toHaveTextContent(
      "€ 28.50",
    );
  });

  it("führt Teilzahlung mit gewählter Zahlungsart aus", async () => {
    const handleConfirm = vi.fn().mockResolvedValue(undefined);

    render(
      <OrderSplitModal
        isOpen={true}
        order={mockOrder}
        onClose={vi.fn()}
        onConfirm={handleConfirm}
      />,
    );

    // 1x Schnitzel auswählen
    const plusSchnitzel = screen.getByLabelText(
      "Menge für Schnitzel Wiener Art erhöhen",
    );
    fireEvent.click(plusSchnitzel);

    // Kartenzahlung wählen
    const cardBtn = screen.getByText("Kartenzahlung");
    fireEvent.click(cardBtn);

    // Kassieren
    const submitBtn = screen.getByText(/Teilbetrag kassieren/);
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(handleConfirm).toHaveBeenCalledWith(
        [{ orderItemId: "item-1", quantity: 1 }],
        [{ amount: 1200, method: "CARD" }],
      );
    });
  });
});
