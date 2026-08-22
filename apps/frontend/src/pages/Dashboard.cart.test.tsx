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
//
// `products` simuliert die lebende Produktliste aus Dashboard.tsx, die über
// den Ereignisstrom aktuell gehalten wird (Issue #80). Ein zweiter Aufruf
// von `rerenderWithProducts` mit einer geänderten Liste bildet eine
// PRODUCT_AVAILABILITY_CHANGED-Meldung nach, ohne die SSE-Anbindung selbst
// zu testen.
const renderCart = (initialProducts: any[] = []) => {
  const Wrapper = ({ products }: { products: any[] }) => {
    const { items, addItem, removeItem, deleteItem } = useCartStore();
    return (
      <div>
        {items.map((item) => (
          <CartItem
            key={item.id}
            item={item}
            products={products}
            addItem={addItem}
            removeItem={removeItem}
            deleteItem={deleteItem}
          />
        ))}
      </div>
    );
  };
  const utils = render(<Wrapper products={initialProducts} />);
  return {
    ...utils,
    rerenderWithProducts: (products: any[]) =>
      utils.rerender(<Wrapper products={products} />),
  };
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

describe("Warenkorbzeile – Verfügbarkeitsänderung nach dem Hinzufügen (Issue #80)", () => {
  it("kennzeichnet die Zeile sichtbar und in Textform, sobald das Produkt in der lebenden Liste als ausverkauft geführt wird, und sperrt Erhöhen", () => {
    useCartStore.getState().addItem(drinkProduct, [sizeOption]);
    const { rerenderWithProducts } = renderCart([drinkProduct]);

    // Zunächst verfügbar: keine Kennzeichnung, Erhöhen erlaubt.
    expect(screen.queryByText("Ausverkauft")).not.toBeInTheDocument();

    // Die Station meldet das Produkt ausverkauft; die lebende Produktliste
    // aktualisiert sich (hier simuliert), die Warenkorbzeile nicht separat.
    rerenderWithProducts([{ ...drinkProduct, availability: "OUT_OF_STOCK" }]);

    expect(screen.getByText("Ausverkauft")).toBeInTheDocument();

    const increaseButton = screen.getByRole("button", {
      name: "Menge von Getränk erhöhen",
    });
    expect(increaseButton).toBeDisabled();
    expect(increaseButton).toHaveAttribute("aria-disabled", "true");

    fireEvent.click(increaseButton);

    expect(useCartStore.getState().items[0].quantity).toBe(1);
  });

  it("erlaubt Verringern und Entfernen weiterhin, wenn die Zeile ausverkauft gekennzeichnet ist", () => {
    useCartStore.getState().addItem(drinkProduct, [sizeOption]);
    useCartStore.getState().addItem(drinkProduct, [sizeOption]);
    renderCart([{ ...drinkProduct, availability: "OUT_OF_STOCK" }]);

    expect(screen.getByText("Ausverkauft")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Menge von Getränk verringern" }),
    );

    expect(useCartStore.getState().items[0].quantity).toBe(1);

    fireEvent.click(
      screen.getByRole("button", { name: "Menge von Getränk verringern" }),
    );

    expect(useCartStore.getState().items).toHaveLength(0);
  });

  it("hebt die Kennzeichnung auf und erlaubt Erhöhen wieder, wenn das Produkt erneut als verfügbar gemeldet wird", () => {
    useCartStore.getState().addItem(drinkProduct, [sizeOption]);
    const { rerenderWithProducts } = renderCart([
      { ...drinkProduct, availability: "OUT_OF_STOCK" },
    ]);

    expect(screen.getByText("Ausverkauft")).toBeInTheDocument();

    rerenderWithProducts([{ ...drinkProduct, availability: "AVAILABLE" }]);

    expect(screen.queryByText("Ausverkauft")).not.toBeInTheDocument();

    const increaseButton = screen.getByRole("button", {
      name: "Menge von Getränk erhöhen",
    });
    expect(increaseButton).not.toBeDisabled();

    fireEvent.click(increaseButton);

    expect(useCartStore.getState().items[0].quantity).toBe(2);
  });

  it("fällt auf die Momentaufnahme der Zeile zurück, wenn das Produkt nicht (mehr) in der lebenden Liste enthalten ist", () => {
    useCartStore.getState().addItem(drinkProduct, [sizeOption]);
    renderCart([]);

    expect(screen.queryByText("Ausverkauft")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Menge von Getränk erhöhen" }),
    ).not.toBeDisabled();
  });
});
