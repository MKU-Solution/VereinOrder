import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProductOptionsModal } from "./ProductOptionsModal";

// Deckt die zentralen Zusagen aus
// docs/product/produktoptionen-bedienkonzept.md ("Kassenmaske") ab, allen
// voran: "Jede Pflichtgruppe startet unbeantwortet" (Abschnitt "Grundprinzip:
// keine stille Vorauswahl, sondern ein sprechender Weiter-Button").

// Produkt mit einer Pflicht-Einfachauswahl-Gruppe, die den Endpreis setzt
// (ABSOLUTE), analog zum "Getränk"-Beispiel aus
// docs/development/produktoptionen-datenmodell.md.
const drinkProduct = {
  id: "product-drink",
  name: "Getränk",
  price: 300,
  optionGroups: [
    {
      id: "group-groesse",
      name: "Größe",
      selectionType: "SINGLE",
      isRequired: true,
      minSelect: 1,
      maxSelect: 1,
      priceMode: "ABSOLUTE",
      quickSaleTiles: true,
      sortOrder: 0,
      options: [
        {
          id: "option-klein",
          name: "0,25 l",
          priceEffect: 350,
          isActive: true,
          sortOrder: 0,
        },
        {
          id: "option-gross",
          name: "0,5 l",
          priceEffect: 500,
          isActive: true,
          sortOrder: 1,
        },
      ],
    },
  ],
};

// Produkt mit einer Pflicht-Einfachauswahl-Gruppe (Aufpreis, hier 0 Cent) und
// einer freiwilligen Mehrfachauswahl-Gruppe, analog zum "Schnitzel"-Beispiel.
const schnitzelProduct = {
  id: "product-schnitzel",
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
      quickSaleTiles: false,
      sortOrder: 0,
      options: [
        {
          id: "option-pommes",
          name: "Pommes",
          priceEffect: 0,
          isActive: true,
          sortOrder: 0,
        },
        {
          id: "option-reis",
          name: "Reis",
          priceEffect: 0,
          isActive: true,
          sortOrder: 1,
        },
      ],
    },
    {
      id: "group-anpassung",
      name: "Anpassung",
      selectionType: "MULTIPLE",
      isRequired: false,
      minSelect: 0,
      maxSelect: null,
      priceMode: "SURCHARGE",
      quickSaleTiles: false,
      sortOrder: 1,
      options: [
        {
          id: "option-ohne-salat",
          name: "ohne Salat",
          priceEffect: 0,
          isActive: true,
          sortOrder: 0,
        },
        {
          id: "option-extra-sosse",
          name: "extra Soße",
          priceEffect: 80,
          isActive: true,
          sortOrder: 1,
        },
      ],
    },
  ],
};

// Produkt mit ausschließlich einer freiwilligen Gruppe, um "leer bleiben
// darf" isoliert von jeder Pflichtgruppe zu prüfen.
const coffeeProduct = {
  id: "product-coffee",
  name: "Kaffee",
  price: 250,
  optionGroups: [
    {
      id: "group-milch",
      name: "Milch",
      selectionType: "MULTIPLE",
      isRequired: false,
      minSelect: 0,
      maxSelect: null,
      priceMode: "SURCHARGE",
      quickSaleTiles: false,
      sortOrder: 0,
      options: [
        {
          id: "option-hafermilch",
          name: "Hafermilch",
          priceEffect: 50,
          isActive: true,
          sortOrder: 0,
        },
      ],
    },
  ],
};

const optionButton = (name: string) => {
  const el = screen.getByText(name).closest("button");
  if (!el) throw new Error(`Kein Button für Antwort "${name}" gefunden.`);
  return el;
};

beforeEach(() => {
  // jsdom implementiert scrollIntoView nicht; der sprechende Button ruft es
  // beim Navigieren zu einer offenen Pflichtgruppe auf.
  Element.prototype.scrollIntoView = vi.fn();
});

describe("ProductOptionsModal – Kassenmaske (Issue #75)", () => {
  it("wählt beim Öffnen keine Antwort vor", () => {
    render(
      <ProductOptionsModal
        product={drinkProduct}
        isOpen={true}
        onClose={vi.fn()}
        onAdd={vi.fn()}
      />,
    );

    // Keine Vorauswahl bedeutet: die Pflichtgruppe "Größe" ist offen, der
    // Haupt-Button nennt sie statt "Hinzufügen" anzuzeigen.
    expect(
      screen.getByRole("button", { name: "Weiter zu: Größe" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Hinzufügen/ }),
    ).not.toBeInTheDocument();

    // Keine der beiden Antworten trägt den Auswahl-Rahmen.
    expect(optionButton("0,25 l")).not.toHaveClass("border-indigo-500");
    expect(optionButton("0,5 l")).not.toHaveClass("border-indigo-500");
  });

  it("fügt nichts hinzu, solange eine Pflichtgruppe offen ist", () => {
    const onAdd = vi.fn();
    render(
      <ProductOptionsModal
        product={schnitzelProduct}
        isOpen={true}
        onClose={vi.fn()}
        onAdd={onAdd}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Weiter zu: Beilage" }));

    expect(onAdd).not.toHaveBeenCalled();
  });

  it("lässt eine freiwillige Gruppe leer und fügt trotzdem hinzu", () => {
    const onAdd = vi.fn();
    render(
      <ProductOptionsModal
        product={coffeeProduct}
        isOpen={true}
        onClose={vi.fn()}
        onAdd={onAdd}
      />,
    );

    // Ohne Pflichtgruppe zeigt der Button von Anfang an "Hinzufügen".
    fireEvent.click(screen.getByRole("button", { name: /Hinzufügen/ }));

    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd).toHaveBeenCalledWith(coffeeProduct, []);
  });

  it("lässt sich hinzufügen, sobald nur die Pflichtgruppe beantwortet ist (freiwillige Gruppe bleibt offen)", () => {
    const onAdd = vi.fn();
    render(
      <ProductOptionsModal
        product={schnitzelProduct}
        isOpen={true}
        onClose={vi.fn()}
        onAdd={onAdd}
      />,
    );

    fireEvent.click(optionButton("Pommes"));

    const addButton = screen.getByRole("button", { name: /Hinzufügen/ });
    fireEvent.click(addButton);

    expect(onAdd).toHaveBeenCalledTimes(1);
    const [, selectedOptions] = onAdd.mock.calls[0];
    expect(selectedOptions).toEqual([
      expect.objectContaining({
        id: "option-pommes",
        groupId: "group-beilage",
      }),
    ]);
  });

  it("zeigt einen Gedankenstrich statt einer Zahl, solange die ABSOLUTE-Pflichtgruppe unbeantwortet ist", () => {
    render(
      <ProductOptionsModal
        product={drinkProduct}
        isOpen={true}
        onClose={vi.fn()}
        onAdd={vi.fn()}
      />,
    );

    expect(
      screen.getByText(
        (_, element) => element?.textContent === "Gesamtpreis: —",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Gesamtpreis: € /)).not.toBeInTheDocument();
  });
});
