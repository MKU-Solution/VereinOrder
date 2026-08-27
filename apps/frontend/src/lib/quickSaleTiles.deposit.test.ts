import { describe, expect, it } from "vitest";
import { deriveQuickSaleTiles, type QuickSaleProduct } from "./quickSaleTiles";

describe("deriveQuickSaleTiles – Pfandverwaltung (Issue #137)", () => {
  it("addiert deposit zum Kachelpreis einfacher Produkte", () => {
    const products: QuickSaleProduct[] = [
      {
        id: "prod-beer",
        name: "Bier 0,5l",
        price: 450,
        deposit: 100,
        availability: "AVAILABLE",
        optionGroups: [],
      },
    ];

    const tiles = deriveQuickSaleTiles(products);
    expect(tiles).toHaveLength(1);
    expect(tiles[0].price).toBe(550); // 450 + 100
    expect(tiles[0].deposit).toBe(100);
  });

  it("addiert deposit zum Kachelpreis aufgefächerter Produkte", () => {
    const products: QuickSaleProduct[] = [
      {
        id: "prod-wine",
        name: "Wein",
        price: 300,
        deposit: 100,
        availability: "AVAILABLE",
        optionGroups: [
          {
            id: "grp-size",
            name: "Größe",
            selectionType: "SINGLE",
            isRequired: true,
            minSelect: 1,
            maxSelect: 1,
            priceMode: "ABSOLUTE",
            quickSaleTiles: true,
            sortOrder: 1,
            options: [
              {
                id: "opt-small",
                name: "1/8l",
                priceEffect: 250,
                isActive: true,
                sortOrder: 1,
              },
              {
                id: "opt-large",
                name: "1/4l",
                priceEffect: 400,
                isActive: true,
                sortOrder: 2,
              },
            ],
          },
        ],
      },
    ];

    const tiles = deriveQuickSaleTiles(products);
    expect(tiles).toHaveLength(2);
    expect(tiles[0].detail).toBe("1/8l");
    expect(tiles[0].price).toBe(350); // 250 + 100
    expect(tiles[0].deposit).toBe(100);
    expect(tiles[1].detail).toBe("1/4l");
    expect(tiles[1].price).toBe(500); // 400 + 100
    expect(tiles[1].deposit).toBe(100);
  });

  it("übernimmt die Pfandvorgabe der Kategorie ohne Produktpfand", () => {
    const tiles = deriveQuickSaleTiles([
      {
        id: "prod-water",
        name: "Wasser",
        price: 250,
        deposit: 0,
        category: {
          id: "category-bottles",
          name: "Flaschen",
          sortOrder: 1,
          deposit: 50,
        },
        availability: "AVAILABLE",
        optionGroups: [],
      },
    ]);

    expect(tiles[0].price).toBe(300);
    expect(tiles[0].deposit).toBe(50);
  });
});
