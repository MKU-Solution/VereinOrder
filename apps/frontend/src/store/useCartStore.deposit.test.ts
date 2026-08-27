import { beforeEach, describe, expect, it } from "vitest";
import { useCartStore } from "./useCartStore";

describe("useCartStore – Pfandverwaltung (Issue #137)", () => {
  beforeEach(() => {
    useCartStore.getState().clearCart();
  });

  it("schlägt deposit auf den Einzelpreis und den Gesamtpreis auf", () => {
    const productWithDeposit = {
      id: "prod-beer",
      name: "Bier 0,5l",
      price: 450,
      deposit: 100,
    };

    useCartStore.getState().addItem(productWithDeposit);

    const state = useCartStore.getState();
    expect(state.items).toHaveLength(1);
    expect(state.items[0].finalPrice).toBe(550); // 450 + 100
    expect(state.total).toBe(550);

    // 2. Bier hinzufügen
    useCartStore.getState().addItem(productWithDeposit);
    const updatedState = useCartStore.getState();
    expect(updatedState.items[0].quantity).toBe(2);
    expect(updatedState.total).toBe(1100);
  });

  it("zieht Pfandrückgaben korrekt vom Gesamtbetrag ab", () => {
    const productWithDeposit = {
      id: "prod-beer",
      name: "Bier 0,5l",
      price: 450,
      deposit: 100,
    };

    useCartStore.getState().addItem(productWithDeposit); // 550 Cent (450 + 100)
    expect(useCartStore.getState().total).toBe(550);

    // 2 Gläser zurückgeben (2 * 100 = 200 Cent Abzug)
    useCartStore.getState().setDepositRefundCount(2);

    expect(useCartStore.getState().depositRefundCount).toBe(2);
    expect(useCartStore.getState().total).toBe(350); // 550 - 200 = 350
  });

  it("übernimmt die Pfandvorgabe der Produktkategorie", () => {
    useCartStore.getState().addItem({
      id: "prod-water",
      name: "Wasser",
      price: 250,
      deposit: 0,
      category: { deposit: 50 },
    });

    expect(useCartStore.getState().items[0].finalPrice).toBe(300);
  });

  it("deckelt den Gesamtbetrag bei 0, wenn Pfandrückgabe höher ist als der Einkauf", () => {
    const product = {
      id: "prod-spritzer",
      name: "Spritzer",
      price: 300,
      deposit: 100,
    };

    useCartStore.getState().addItem(product); // 400 Cent
    useCartStore.getState().setDepositRefundCount(5); // 500 Cent Rückgabe

    expect(useCartStore.getState().total).toBe(0); // Math.max(0, 400 - 500)
  });

  it("setzt depositRefundCount beim Leeren des Warenkorbs zurück", () => {
    useCartStore.getState().setDepositRefundCount(3);
    expect(useCartStore.getState().depositRefundCount).toBe(3);

    useCartStore.getState().clearCart();
    expect(useCartStore.getState().depositRefundCount).toBe(0);
    expect(useCartStore.getState().total).toBe(0);
  });

  it("übernimmt keine unendlichen oder negativen Rückgabewerte", () => {
    useCartStore.getState().setDepositRefundCount(Number.POSITIVE_INFINITY);
    useCartStore.getState().setDepositRefundUnitPrice(-100);

    expect(useCartStore.getState().depositRefundCount).toBe(0);
    expect(useCartStore.getState().depositRefundUnitPrice).toBe(0);
    expect(useCartStore.getState().total).toBe(0);
  });
});
