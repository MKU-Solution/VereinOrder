import { describe, expect, it } from "vitest";
import { deriveQuickSaleTiles, type QuickSaleProduct } from "./quickSaleTiles";

// Deckt Issue #66 (Stationskasse) ab: die Kachelableitung wurde aus
// QuickSaleDashboard.tsx herausgezogen, damit Bonkasse und Stationskasse
// dieselben Regeln benutzen (docs/development/produktoptionen-schnittstelle.md,
// Preisbildung ABSOLUTE gegen SURCHARGE). Diese Tests halten die Regeln
// selbst fest, nicht nur ihre Verschiebung.

const baseProduct = (
  overrides: Partial<QuickSaleProduct> = {},
): QuickSaleProduct => ({
  id: "product-1",
  name: "Bier",
  shortName: "Bier",
  price: 400,
  color: "#123456",
  availability: "AVAILABLE",
  category: { id: "cat-1", name: "Getränke", sortOrder: 1 },
  optionGroups: [],
  ...overrides,
});

describe("deriveQuickSaleTiles", () => {
  it("bildet ein Produkt ohne Auswahlgruppen auf genau eine Kachel mit dem Grundpreis ab", () => {
    const tiles = deriveQuickSaleTiles([baseProduct()]);
    expect(tiles).toEqual([
      {
        key: "product-1",
        productId: "product-1",
        optionIds: [],
        label: "Bier",
        hint: undefined,
        price: 400,
        color: "#123456",
        availability: "AVAILABLE",
        category: "Getränke",
      },
    ]);
  });

  it("fällt ohne Kategorie auf 'Ohne Kategorie' zurück", () => {
    const tiles = deriveQuickSaleTiles([baseProduct({ category: null })]);
    expect(tiles[0].category).toBe("Ohne Kategorie");
  });

  it("fächert die Kachelgruppe mit ABSOLUTE-Preisbildung in eigene Kacheln auf, jede mit dem Optionspreis statt dem Produktpreis", () => {
    const product = baseProduct({
      price: 999, // muss von der ABSOLUTE-Antwort ersetzt werden, nicht addiert
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
              name: "0,3 l",
              priceEffect: 350,
              isActive: true,
              sortOrder: 0,
            },
            {
              id: "option-gross",
              name: "0,5 l",
              priceEffect: 450,
              isActive: true,
              sortOrder: 1,
            },
          ],
        },
      ],
    });

    const tiles = deriveQuickSaleTiles([product]);
    expect(tiles).toHaveLength(2);
    expect(tiles[0]).toMatchObject({
      key: "product-1|option-klein",
      optionIds: ["option-klein"],
      detail: "0,3 l",
      price: 350,
    });
    expect(tiles[1]).toMatchObject({
      key: "product-1|option-gross",
      optionIds: ["option-gross"],
      detail: "0,5 l",
      price: 450,
    });
  });

  it("fächert die Kachelgruppe mit SURCHARGE-Preisbildung auf den Produktpreis plus Aufpreis auf", () => {
    const product = baseProduct({
      price: 400,
      optionGroups: [
        {
          id: "group-topping",
          name: "Topping",
          selectionType: "SINGLE",
          isRequired: true,
          minSelect: 1,
          maxSelect: 1,
          priceMode: "SURCHARGE",
          quickSaleTiles: true,
          sortOrder: 0,
          options: [
            {
              id: "option-ohne",
              name: "ohne",
              priceEffect: 0,
              isActive: true,
              sortOrder: 0,
            },
            {
              id: "option-sahne",
              name: "Sahne",
              priceEffect: 50,
              isActive: true,
              sortOrder: 1,
            },
          ],
        },
      ],
    });

    const tiles = deriveQuickSaleTiles([product]);
    expect(tiles).toHaveLength(2);
    expect(tiles.find((t) => t.detail === "ohne")?.price).toBe(400);
    expect(tiles.find((t) => t.detail === "Sahne")?.price).toBe(450);
  });

  it("ignoriert inaktive Antworten der Kachelgruppe", () => {
    const product = baseProduct({
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
              name: "0,3 l",
              priceEffect: 350,
              isActive: true,
              sortOrder: 0,
            },
            {
              id: "option-alt",
              name: "abgekündigt",
              priceEffect: 300,
              isActive: false,
              sortOrder: 1,
            },
          ],
        },
      ],
    });

    const tiles = deriveQuickSaleTiles([product]);
    expect(tiles).toHaveLength(1);
    expect(tiles[0].detail).toBe("0,3 l");
  });

  it("belegt eine weitere, aufpreisfreie Pflichtgruppe vor und nennt sie im Hinweis", () => {
    const product = baseProduct({
      optionGroups: [
        {
          id: "group-eis",
          name: "Kugeln",
          selectionType: "SINGLE",
          isRequired: true,
          minSelect: 1,
          maxSelect: 1,
          priceMode: "ABSOLUTE",
          quickSaleTiles: true,
          sortOrder: 0,
          options: [
            {
              id: "option-1kugel",
              name: "1 Kugel",
              priceEffect: 150,
              isActive: true,
              sortOrder: 0,
            },
          ],
        },
        {
          id: "group-becher",
          name: "Becher",
          selectionType: "SINGLE",
          isRequired: true,
          minSelect: 1,
          maxSelect: 1,
          priceMode: "SURCHARGE",
          quickSaleTiles: false,
          sortOrder: 1,
          options: [
            {
              id: "option-becher-klein",
              name: "kleiner Becher",
              priceEffect: 0,
              isActive: true,
              sortOrder: 0,
            },
            {
              id: "option-becher-gross",
              name: "großer Becher",
              priceEffect: 0,
              isActive: true,
              sortOrder: 1,
            },
          ],
        },
      ],
    });

    const tiles = deriveQuickSaleTiles([product]);
    expect(tiles).toHaveLength(1);
    expect(tiles[0].optionIds).toEqual([
      "option-1kugel",
      "option-becher-klein",
    ]);
    expect(tiles[0].hint).toBe("Standard: kleiner Becher");
  });

  it("nimmt das Produkt aus dem Schnellverkauf, wenn eine weitere Pflichtgruppe einen Aufpreis trägt", () => {
    const product = baseProduct({
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
              name: "0,3 l",
              priceEffect: 350,
              isActive: true,
              sortOrder: 0,
            },
          ],
        },
        {
          id: "group-extra",
          name: "Extra",
          selectionType: "SINGLE",
          isRequired: true,
          minSelect: 1,
          maxSelect: 1,
          priceMode: "SURCHARGE",
          quickSaleTiles: false,
          sortOrder: 1,
          options: [
            {
              id: "option-extra-a",
              name: "Standard",
              priceEffect: 0,
              isActive: true,
              sortOrder: 0,
            },
            {
              id: "option-extra-b",
              name: "Premium",
              priceEffect: 100,
              isActive: true,
              sortOrder: 1,
            },
          ],
        },
      ],
    });

    expect(deriveQuickSaleTiles([product])).toEqual([]);
  });

  it("belegt eine Pflichtgruppe ohne Kachelgruppe ebenfalls vor, wenn sie aufpreisfrei ist", () => {
    const product = baseProduct({
      optionGroups: [
        {
          id: "group-eis",
          name: "Menge",
          selectionType: "SINGLE",
          isRequired: true,
          minSelect: 1,
          maxSelect: 1,
          priceMode: "SURCHARGE",
          quickSaleTiles: false,
          sortOrder: 0,
          options: [
            {
              id: "option-normal",
              name: "normal",
              priceEffect: 0,
              isActive: true,
              sortOrder: 0,
            },
          ],
        },
      ],
    });

    const tiles = deriveQuickSaleTiles([product]);
    expect(tiles).toHaveLength(1);
    expect(tiles[0].optionIds).toEqual(["option-normal"]);
    expect(tiles[0].hint).toBe("Standard: normal");
  });

  it("verarbeitet mehrere Produkte unabhängig voneinander", () => {
    const tiles = deriveQuickSaleTiles([
      baseProduct({ id: "product-a", name: "Bier" }),
      baseProduct({ id: "product-b", name: "Radler" }),
    ]);
    expect(tiles.map((t) => t.productId)).toEqual(["product-a", "product-b"]);
  });
});
