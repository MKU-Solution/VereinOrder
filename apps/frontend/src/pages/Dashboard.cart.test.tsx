import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { CartItem } from "./Dashboard";
import { useCartStore, SelectedCartOption } from "../store/useCartStore";

// Deckt Issue #78 ab: die Menge einer Warenkorbzeile lässt sich durch
// Tippen auf die Mengenzahl (erhöhen) bzw. den Betrag (verringern) ändern,
// zusätzlich zu den bestehenden Wischgesten (unverändert, hier nicht erneut
// getestet).

const drinkProduct = {
  id: "product-drink",
  name: "Getränk",
  price: 300,
};

const sizeOption: SelectedCartOption = {
  id: "option-klein",
  name: "0,25 l",
  priceEffect: 350,
  groupId: "group-groesse",
  groupName: "Größe",
  priceMode: "ABSOLUTE",
};

const schnitzelProduct = {
  id: "product-schnitzel",
  name: "Schnitzel",
  price: 890,
};

const beilageOption: SelectedCartOption = {
  id: "option-pommes",
  name: "Pommes",
  priceEffect: 0,
  groupId: "group-beilage",
  groupName: "Beilage",
  priceMode: "SURCHARGE",
};

const anpassungOption: SelectedCartOption = {
  id: "option-extra-sosse",
  name: "extra Soße",
  priceEffect: 80,
  groupId: "group-anpassung",
  groupName: "Anpassung",
  priceMode: "SURCHARGE",
};

// Rendert die Warenkorbzeilen direkt aus dem echten Store, so wie es
// Dashboard.tsx auch tut, damit sowohl die Schaltflächen der Zeile als auch
// das Zusammenspiel mit useCartStore geprüft werden.
const renderCart = () => {
  const Wrapper = () => {
    const { items, addItem, removeItem, deleteItem } = useCartStore();
    return (
      <div>
        {items.map((item) => (
          <CartItem
            key={item.id}
            item={item}
            addItem={addItem}
            removeItem={removeItem}
            deleteItem={deleteItem}
          />
        ))}
      </div>
    );
  };
  return render(<Wrapper />);
};

beforeEach(() => {
  useCartStore.setState({ items: [], total: 0 });
});

describe("Warenkorbzeile – Menge durch Tippen ändern (Issue #78)", () => {
  it("erhöht die Menge beim Tippen auf die Mengenzahl", () => {
    useCartStore.getState().addItem(drinkProduct, [sizeOption]);
    renderCart();

    fireEvent.click(
      screen.getByRole("button", { name: "Menge von Getränk erhöhen" }),
    );

    const items = useCartStore.getState().items;
    expect(items).toHaveLength(1);
    expect(items[0].quantity).toBe(2);
    expect(useCartStore.getState().total).toBe(700); // 2 x 350
  });

  it("verringert die Menge beim Tippen auf den Betrag", () => {
    useCartStore.getState().addItem(drinkProduct, [sizeOption]);
    useCartStore.getState().addItem(drinkProduct, [sizeOption]);
    renderCart();

    fireEvent.click(
      screen.getByRole("button", { name: "Menge von Getränk verringern" }),
    );

    const items = useCartStore.getState().items;
    expect(items).toHaveLength(1);
    expect(items[0].quantity).toBe(1);
  });

  it("entfernt die Zeile, wenn bei Menge 1 auf den Betrag getippt wird", () => {
    useCartStore.getState().addItem(drinkProduct, [sizeOption]);
    renderCart();

    fireEvent.click(
      screen.getByRole("button", { name: "Menge von Getränk verringern" }),
    );

    expect(useCartStore.getState().items).toHaveLength(0);
    expect(useCartStore.getState().total).toBe(0);
  });

  it("behält bei einem Produkt mit Auswahlgruppen die Auswahl und bleibt eine Zeile", () => {
    useCartStore
      .getState()
      .addItem(schnitzelProduct, [beilageOption, anpassungOption]);
    renderCart();

    fireEvent.click(
      screen.getByRole("button", { name: "Menge von Schnitzel erhöhen" }),
    );

    const items = useCartStore.getState().items;
    expect(items).toHaveLength(1);
    expect(items[0].quantity).toBe(2);
    expect(items[0].selectedOptions).toEqual([beilageOption, anpassungOption]);
  });

  it("ändert die Menge nicht, wenn neben den beiden Flächen getippt wird", () => {
    useCartStore.getState().addItem(drinkProduct, [sizeOption]);
    renderCart();

    fireEvent.click(screen.getByText("Getränk"));

    const items = useCartStore.getState().items;
    expect(items).toHaveLength(1);
    expect(items[0].quantity).toBe(1);
  });
});
