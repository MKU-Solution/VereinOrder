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

// Deckt den Änderungsfall aus Issue #82 ab: eine bereits im Warenkorb
// befindliche Zusammenstellung wird erneut geöffnet, diesmal vorbelegt mit
// der zuvor getroffenen Auswahl. Die Regel aus #75 (Anlegefall: keine
// Vorauswahl) wird dadurch nicht aufgeweicht — der obige describe-Block
// bleibt unverändert grün und deckt weiterhin ausschließlich den
// Standardmodus ("add") ab, in dem initialSelectedOptions gar nicht gesetzt
// wird.
const reisSelection = {
  id: "option-reis",
  name: "Reis",
  priceEffect: 0,
  groupId: "group-beilage",
  groupName: "Beilage",
  priceMode: "SURCHARGE" as const,
};

const extraSosseSelection = {
  id: "option-extra-sosse",
  name: "extra Soße",
  priceEffect: 80,
  groupId: "group-anpassung",
  groupName: "Anpassung",
  priceMode: "SURCHARGE" as const,
};

describe("ProductOptionsModal – Änderungsfall einer Warenkorbzeile (Issue #82)", () => {
  it("öffnet im Änderungsmodus vorbelegt mit der bisherigen Auswahl und beschriftet den Hauptknopf 'Übernehmen'", () => {
    render(
      <ProductOptionsModal
        product={schnitzelProduct}
        isOpen={true}
        onClose={vi.fn()}
        onAdd={vi.fn()}
        mode="edit"
        initialSelectedOptions={[reisSelection, extraSosseSelection]}
      />,
    );

    expect(optionButton("Reis")).toHaveClass("border-indigo-500");
    expect(optionButton("Pommes")).not.toHaveClass("border-indigo-500");
    expect(optionButton("extra Soße")).toHaveClass("border-emerald-500");

    expect(
      screen.getByRole("button", { name: /^Übernehmen/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^Hinzufügen/ }),
    ).not.toBeInTheDocument();
  });

  it("übernimmt eine geänderte Auswahl und behält dabei die Menge der Zeile bei (Mengenerhalt liegt beim Aufrufer)", () => {
    const onAdd = vi.fn();
    render(
      <ProductOptionsModal
        product={schnitzelProduct}
        isOpen={true}
        onClose={vi.fn()}
        onAdd={onAdd}
        mode="edit"
        initialSelectedOptions={[reisSelection, extraSosseSelection]}
      />,
    );

    // Statt Reis nun Pommes; die freiwillige Zusatzauswahl bleibt bestehen.
    fireEvent.click(optionButton("Pommes"));

    fireEvent.click(screen.getByRole("button", { name: /^Übernehmen/ }));

    expect(onAdd).toHaveBeenCalledTimes(1);
    const [submittedProduct, selectedOptions] = onAdd.mock.calls[0];
    expect(submittedProduct).toBe(schnitzelProduct);
    expect(selectedOptions).toEqual([
      expect.objectContaining({ id: "option-pommes" }),
      expect.objectContaining({ id: "option-extra-sosse" }),
    ]);
  });

  it("lässt sich abbrechen, ohne onAdd aufzurufen", () => {
    const onAdd = vi.fn();
    const onClose = vi.fn();
    render(
      <ProductOptionsModal
        product={schnitzelProduct}
        isOpen={true}
        onClose={onClose}
        onAdd={onAdd}
        mode="edit"
        initialSelectedOptions={[reisSelection]}
      />,
    );

    fireEvent.click(optionButton("Pommes"));
    fireEvent.click(screen.getByRole("button", { name: "Schließen" }));

    expect(onAdd).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("lässt eine Pflichtgruppe im Änderungsfall nicht leer übernehmen", () => {
    const onAdd = vi.fn();
    render(
      <ProductOptionsModal
        product={schnitzelProduct}
        isOpen={true}
        onClose={vi.fn()}
        onAdd={onAdd}
        mode="edit"
        initialSelectedOptions={[reisSelection]}
      />,
    );

    // Die vorbelegte Pflichtantwort abwählen (Einfachauswahl: erneutes
    // Tippen hebt die Auswahl auf) und danach versuchen, zu übernehmen.
    fireEvent.click(optionButton("Reis"));

    expect(
      screen.getByRole("button", { name: "Weiter zu: Beilage" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Weiter zu: Beilage" }));

    expect(onAdd).not.toHaveBeenCalled();
  });

  it("wählt beim Anlegen weiterhin nichts vor, selbst wenn initialSelectedOptions übergeben würde, solange mode nicht 'edit' ist", () => {
    render(
      <ProductOptionsModal
        product={schnitzelProduct}
        isOpen={true}
        onClose={vi.fn()}
        onAdd={vi.fn()}
        initialSelectedOptions={[reisSelection]}
      />,
    );

    expect(optionButton("Reis")).not.toHaveClass("border-indigo-500");
    expect(
      screen.getByRole("button", { name: "Weiter zu: Beilage" }),
    ).toBeInTheDocument();
  });

  it("erzwingt bei Pflicht-Mehrfachauswahl mit minSelect=2 die Mindestanzahl und benennt die fehlende Anzahl präzise (Issue #94)", () => {
    const multiMinProduct = {
      id: "product-plate",
      name: "Grillteller",
      price: 1200,
      optionGroups: [
        {
          id: "group-beilagen",
          name: "Beilagen",
          selectionType: "MULTIPLE",
          isRequired: true,
          minSelect: 2,
          maxSelect: 3,
          priceMode: "SURCHARGE",
          quickSaleTiles: false,
          sortOrder: 0,
          options: [
            {
              id: "opt-pommes",
              name: "Pommes",
              priceEffect: 0,
              isActive: true,
              sortOrder: 0,
            },
            {
              id: "opt-reis",
              name: "Djuvec-Reis",
              priceEffect: 0,
              isActive: true,
              sortOrder: 1,
            },
            {
              id: "opt-salat",
              name: "Krautsalat",
              priceEffect: 50,
              isActive: true,
              sortOrder: 2,
            },
            {
              id: "opt-brot",
              name: "Fladenbrot",
              priceEffect: 50,
              isActive: true,
              sortOrder: 3,
            },
          ],
        },
      ],
    };

    const onAdd = vi.fn();
    render(
      <ProductOptionsModal
        product={multiMinProduct}
        isOpen={true}
        onClose={vi.fn()}
        onAdd={onAdd}
      />,
    );

    // Initial: 0 von 2 gewählt -> Button blockiert, Status benennt 2 fehlende Antworten
    expect(
      screen.getByText("Noch 2 Antworten bei „Beilagen“ wählen"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Weiter zu: Beilagen" }),
    ).toBeInTheDocument();

    // 1 gewählt -> Status benennt 1 fehlende Antwort, Button blockiert weiterhin
    fireEvent.click(optionButton("Pommes"));
    expect(
      screen.getByText("Noch 1 Antwort bei „Beilagen“ wählen"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Weiter zu: Beilagen" }),
    ).toBeInTheDocument();

    // Klick auf "Weiter zu: Beilagen" löst kein onAdd aus
    fireEvent.click(
      screen.getByRole("button", { name: "Weiter zu: Beilagen" }),
    );
    expect(onAdd).not.toHaveBeenCalled();

    // 2. Beilage wählen -> Mindestanzahl erreicht!
    fireEvent.click(optionButton("Djuvec-Reis"));
    expect(
      screen.getByText("Alle Pflichtangaben ausgewählt"),
    ).toBeInTheDocument();

    const addButton = screen.getByRole("button", { name: /Hinzufügen/ });
    expect(addButton).toBeInTheDocument();

    // 3. Beilage wählen (innerhalb von maxSelect: 3)
    fireEvent.click(optionButton("Krautsalat"));
    expect(optionButton("Krautsalat")).toHaveClass("border-emerald-500");

    // 4. Beilage versuchen (übersteigt maxSelect: 3) -> darf nicht gewählt werden
    fireEvent.click(optionButton("Fladenbrot"));
    expect(optionButton("Fladenbrot")).not.toHaveClass("border-emerald-500");
    expect(screen.getByText("Maximal 3 ausgewählt.")).toBeInTheDocument();

    // Hinzufügen mit den 3 gewählten Optionen
    fireEvent.click(screen.getByRole("button", { name: /Hinzufügen/ }));
    expect(onAdd).toHaveBeenCalledTimes(1);
    const [, selectedOptions] = onAdd.mock.calls[0];
    expect(selectedOptions).toHaveLength(3);
  });
});
