import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CartItem } from "./Dashboard";
import {
  useCartStore,
  SelectedCartOption,
  CartItem as CartItemType,
} from "../store/useCartStore";
import { ProductOptionsModal } from "../components/ProductOptionsModal";

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

// Produkt mit einer Pflicht-Einfachauswahl-Gruppe, für die Änderungsfall-
// Tests aus Issue #82. Eigene Kennung/Fixture statt der obigen
// `schnitzelProduct`, damit die bestehenden Issue-#78-Tests unangetastet
// bleiben (dort hat das Produkt bewusst keine optionGroups).
const schnitzelWithGroupsProduct = {
  id: "product-schnitzel-mit-gruppen",
  name: "Schnitzel",
  price: 890,
  optionGroups: [
    {
      id: "group-beilage",
      name: "Beilage",
      selectionType: "SINGLE",
      isRequired: true,
      minSelect: 1,
      maxSelect: 1,
      priceMode: "SURCHARGE",
      options: [
        {
          id: "option-pommes",
          name: "Pommes",
          priceEffect: 0,
          isActive: true,
        },
        {
          id: "option-reis",
          name: "Reis",
          priceEffect: 0,
          isActive: true,
        },
      ],
    },
  ],
};

const reisSelection: SelectedCartOption = {
  id: "option-reis",
  name: "Reis",
  priceEffect: 0,
  groupId: "group-beilage",
  groupName: "Beilage",
  priceMode: "SURCHARGE",
};

const pommesSelection: SelectedCartOption = {
  id: "option-pommes",
  name: "Pommes",
  priceEffect: 0,
  groupId: "group-beilage",
  groupName: "Beilage",
  priceMode: "SURCHARGE",
};

// Bildet den Änderungsfall aus Dashboard.tsx nach: Tippen auf den mittleren
// Bereich einer Zeile öffnet ProductOptionsModal im Änderungsmodus,
// vorbelegt mit der Auswahl dieser Zeile; Übernehmen ruft
// updateItemOptions auf. Eigener Wrapper statt renderCart oben, weil dort
// bewusst keine Auswahlmaske eingebunden ist (Issue #78/#80 betreffen sie
// nicht).
const renderCartWithEditing = (initialProducts: any[] = []) => {
  const EditingWrapper = ({ products }: { products: any[] }) => {
    const { items, addItem, removeItem, deleteItem, updateItemOptions } =
      useCartStore();
    const [editingItem, setEditingItem] = useState<CartItemType | null>(null);

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
            onEditOptions={setEditingItem}
          />
        ))}
        <ProductOptionsModal
          product={editingItem?.product ?? null}
          isOpen={!!editingItem}
          onClose={() => setEditingItem(null)}
          onAdd={(_, selectedOptions) => {
            if (editingItem) {
              updateItemOptions(editingItem.id, selectedOptions);
            }
            setEditingItem(null);
          }}
          mode="edit"
          initialSelectedOptions={editingItem?.selectedOptions}
        />
      </div>
    );
  };
  return render(<EditingWrapper products={initialProducts} />);
};

beforeEach(() => {
  useCartStore.setState({ items: [], total: 0 });
  // jsdom implementiert scrollIntoView nicht; ProductOptionsModal ruft es
  // beim Navigieren zu einer offenen Pflichtgruppe auf (siehe unten, Issue
  // #82-Tests).
  Element.prototype.scrollIntoView = vi.fn();
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

// Wählt eine Antwort-Schaltfläche innerhalb der geöffneten Auswahlmaske an
// ihrem Namen an (Präfix genügt, da der volle Accessible Name auch den
// Preis enthält). Anders als ein reiner Text-Query ist das eindeutig, auch
// wenn im Hintergrund noch eine Warenkorbzeile mit demselben Options-Namen
// sichtbar ist — deren mittlerer Bereich trägt ein eigenes aria-label
// ("Auswahl von … ändern") und wird daher nie mitgetroffen.
const modalOptionButton = (name: string) =>
  screen.getByRole("button", { name: new RegExp(`^${name}`) });

describe("Warenkorbzeile – Auswahl ändern vor dem Absenden (Issue #82)", () => {
  it("öffnet beim Tippen auf den mittleren Bereich die Maske vorbelegt mit der bisherigen Auswahl", () => {
    useCartStore
      .getState()
      .addItem(schnitzelWithGroupsProduct, [reisSelection]);
    renderCartWithEditing([schnitzelWithGroupsProduct]);

    fireEvent.click(
      screen.getByRole("button", { name: "Auswahl von Schnitzel ändern" }),
    );

    // Vorbelegt heißt: die zuvor gewählte Antwort trägt den Auswahl-Rahmen,
    // und der Hauptknopf heißt "Übernehmen" statt "Hinzufügen".
    expect(modalOptionButton("Reis")).toHaveClass("border-indigo-500");
    expect(
      screen.getByRole("button", { name: /^Übernehmen/ }),
    ).toBeInTheDocument();
  });

  it("ersetzt die Auswahl beim Übernehmen und behält die Menge der Zeile", () => {
    useCartStore
      .getState()
      .addItem(schnitzelWithGroupsProduct, [reisSelection]);
    useCartStore
      .getState()
      .addItem(schnitzelWithGroupsProduct, [reisSelection]);
    renderCartWithEditing([schnitzelWithGroupsProduct]);

    fireEvent.click(
      screen.getByRole("button", { name: "Auswahl von Schnitzel ändern" }),
    );
    fireEvent.click(modalOptionButton("Pommes"));
    fireEvent.click(screen.getByRole("button", { name: /^Übernehmen/ }));

    const items = useCartStore.getState().items;
    expect(items).toHaveLength(1);
    expect(items[0].quantity).toBe(2);
    expect(items[0].selectedOptions).toEqual([pommesSelection]);
  });

  it("verschmilzt zwei Zeilen, wenn die geänderte Auswahl einer bereits vorhandenen Zusammenstellung entspricht", () => {
    useCartStore
      .getState()
      .addItem(schnitzelWithGroupsProduct, [reisSelection]);
    useCartStore
      .getState()
      .addItem(schnitzelWithGroupsProduct, [pommesSelection]);
    renderCartWithEditing([schnitzelWithGroupsProduct]);

    expect(useCartStore.getState().items).toHaveLength(2);

    // Die Reis-Zeile öffnen und auf Pommes ändern lassen — das entspricht
    // bereits der zweiten Zeile. Vor dem Öffnen der Maske ist "Reis" noch
    // eindeutig (kommt nur in dieser einen Zeile vor).
    const reisRow = screen.getByText("Reis").closest("button");
    if (!reisRow) throw new Error("Zeile mit Reis nicht gefunden.");
    fireEvent.click(reisRow);

    fireEvent.click(modalOptionButton("Pommes"));
    fireEvent.click(screen.getByRole("button", { name: /^Übernehmen/ }));

    const items = useCartStore.getState().items;
    expect(items).toHaveLength(1);
    expect(items[0].quantity).toBe(2);
    expect(items[0].selectedOptions).toEqual([pommesSelection]);
  });

  it("lässt die Zeile unverändert, wenn abgebrochen wird", () => {
    useCartStore
      .getState()
      .addItem(schnitzelWithGroupsProduct, [reisSelection]);
    renderCartWithEditing([schnitzelWithGroupsProduct]);

    fireEvent.click(
      screen.getByRole("button", { name: "Auswahl von Schnitzel ändern" }),
    );
    fireEvent.click(modalOptionButton("Pommes"));
    fireEvent.click(screen.getByRole("button", { name: "Schließen" }));

    const items = useCartStore.getState().items;
    expect(items).toHaveLength(1);
    expect(items[0].selectedOptions).toEqual([reisSelection]);
  });

  it("zeigt bei einem Produkt ohne Auswahlgruppen keine Schaltfläche und tut beim Tippen nichts", () => {
    useCartStore.getState().addItem(drinkProduct, [sizeOption]);
    renderCartWithEditing([drinkProduct]);

    expect(
      screen.queryByRole("button", { name: /^Auswahl von .* ändern$/ }),
    ).not.toBeInTheDocument();

    // Der Produktname bleibt sichtbar, ist aber kein Button.
    const nameEl = screen.getByText("Getränk");
    expect(nameEl.closest("button")).toBeNull();

    fireEvent.click(nameEl);

    const items = useCartStore.getState().items;
    expect(items).toHaveLength(1);
    expect(items[0].selectedOptions).toEqual([sizeOption]);
  });
});
