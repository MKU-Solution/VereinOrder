import { BadRequestException } from "@nestjs/common";
import { OrdersService } from "./orders.service";
import { createAuditServiceStub } from "./test-support/audit-service.stub";

// Unit-Tests fuer die Preisberechnung einer Bestellposition nach Issue #75
// (docs/development/produktoptionen-datenmodell.md, "Preisberechnung einer
// Bestellposition" und "Regeln, die die Anwendung erzwingen muss";
// docs/development/produktoptionen-schnittstelle.md, "Bestellannahme").
//
// "resolveOrderItemPricing" ist eine private Methode von OrdersService, die
// weder von der Datenbank noch von HTTP abhaengt (reine Aufloesung/Berechnung
// auf einem bereits geladenen Produkt). Sie wird hier direkt ueber
// "(service as any)" aufgerufen, wie es bereits in
// apps/backend/src/events/events.service.spec.ts fuer "hash" gemacht wird,
// statt den gesamten createOrder/createQuickSale-Ablauf mit Datenbank-Mocks
// nachzubauen.
describe("OrdersService – resolveOrderItemPricing (Issue #75)", () => {
  let service: OrdersService;

  beforeEach(() => {
    // Der Prisma-Client wird von resolveOrderItemPricing nicht verwendet.
    service = new OrdersService({} as any, createAuditServiceStub() as any);
  });

  const resolve = (product: any, optionIds: string[]) =>
    (service as any).resolveOrderItemPricing(product, optionIds);

  // Schnitzel: Pflicht-Einfachauswahl "Beilage" (SURCHARGE, beide Antworten
  // 0 Cent) plus freiwillige Mehrfachauswahl "Anpassung" (SURCHARGE, mit
  // Aufpreis und einem Abschlag). Entspricht dem Beispiel aus
  // produktoptionen-datenmodell.md.
  const schnitzel = {
    id: "product-schnitzel",
    name: "Schnitzel",
    price: 890,
    optionGroups: [
      {
        id: "group-beilage",
        name: "Beilage",
        minSelect: 1,
        maxSelect: 1,
        priceMode: "SURCHARGE" as const,
        options: [
          {
            id: "option-pommes",
            name: "Pommes",
            priceEffect: 0,
            isActive: true,
          },
          { id: "option-reis", name: "Reis", priceEffect: 0, isActive: true },
          {
            id: "option-inaktiv",
            name: "Kartoffelsalat",
            priceEffect: 0,
            isActive: false,
          },
        ],
      },
      {
        id: "group-anpassung",
        name: "Anpassung",
        minSelect: 0,
        maxSelect: 2,
        priceMode: "SURCHARGE" as const,
        options: [
          {
            id: "option-ohne-salat",
            name: "ohne Salat",
            priceEffect: 0,
            isActive: true,
          },
          {
            id: "option-extra-sosse",
            name: "extra Soße",
            priceEffect: 80,
            isActive: true,
          },
          {
            id: "option-extra-kaese",
            name: "extra Käse",
            priceEffect: 150,
            isActive: true,
          },
          {
            id: "option-ohne-beilage",
            name: "ohne Beilage",
            priceEffect: -200,
            isActive: true,
          },
        ],
      },
    ],
  };

  // Getraenk: Pflicht-Einfachauswahl "Größe" mit ABSOLUTE-Preislogik.
  const getraenk = {
    id: "product-getraenk",
    name: "Getränk",
    price: 999, // darf nie als Grundpreis verwendet werden, sobald Größe beantwortet ist
    optionGroups: [
      {
        id: "group-groesse",
        name: "Größe",
        minSelect: 1,
        maxSelect: 1,
        priceMode: "ABSOLUTE" as const,
        options: [
          {
            id: "option-klein",
            name: "0,25 l",
            priceEffect: 350,
            isActive: true,
          },
          {
            id: "option-gross",
            name: "0,5 l",
            priceEffect: 500,
            isActive: true,
          },
        ],
      },
    ],
  };

  // Menü: ABSOLUTE-Pflichtgruppe "Größe" plus zwei SURCHARGE-Gruppen, um die
  // gleichzeitige Kombination aus Grundpreisersatz und mehreren Aufpreisen
  // sowie die Momentaufnahme (variantId/variantName/extras) zu prüfen.
  const menu = {
    id: "product-menu",
    name: "Menü",
    price: 1,
    optionGroups: [
      getraenk.optionGroups[0],
      schnitzel.optionGroups[0],
      schnitzel.optionGroups[1],
    ],
  };

  describe("Aufpreise (SURCHARGE)", () => {
    it("ändert den Preis nicht bei einer Pflicht-Einfachauswahl ohne Aufpreis", () => {
      const result = resolve(schnitzel, ["option-pommes"]);
      expect(result.priceAtTime).toBe(890);
    });

    it("addiert mehrere Aufpreise korrekt", () => {
      const result = resolve(schnitzel, [
        "option-pommes",
        "option-extra-sosse",
        "option-extra-kaese",
      ]);
      // 890 (Grundpreis) + 0 (Pommes) + 80 (Soße) + 150 (Käse)
      expect(result.priceAtTime).toBe(1120);
    });

    it("senkt den Preis durch einen Abschlag mit negativem Betrag", () => {
      const result = resolve(schnitzel, [
        "option-pommes",
        "option-ohne-beilage",
      ]);
      // 890 (Grundpreis) + 0 (Pommes) - 200 (Abschlag)
      expect(result.priceAtTime).toBe(690);
    });
  });

  describe("Grundpreis (ABSOLUTE)", () => {
    it("ersetzt den Grundpreis durch die ABSOLUTE-Antwort statt ihn zu addieren", () => {
      const result = resolve(getraenk, ["option-gross"]);
      // Waere die Antwort addiert worden, stuende hier 999 + 500 = 1499.
      expect(result.priceAtTime).toBe(500);
    });

    it("kombiniert ABSOLUTE mit mehreren gleichzeitigen Aufpreisen", () => {
      const result = resolve(menu, [
        "option-gross",
        "option-pommes",
        "option-extra-sosse",
        "option-extra-kaese",
      ]);
      // Grundpreis 500 (ersetzt 1) + 0 (Pommes) + 80 (Soße) + 150 (Käse)
      expect(result.priceAtTime).toBe(730);
    });
  });

  describe("Momentaufnahme", () => {
    it("schreibt variantId/variantName aus der ABSOLUTE-Antwort und alle übrigen Antworten in extras", () => {
      const result = resolve(menu, [
        "option-gross",
        "option-pommes",
        "option-extra-sosse",
      ]);

      expect(result.variantId).toBe("option-gross");
      expect(result.variantName).toBe("0,5 l");

      expect(result.extras).toHaveLength(2);
      expect(result.extras).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "option-pommes",
            name: "Pommes",
            price: 0,
            groupId: "group-beilage",
            groupName: "Beilage",
          }),
          expect.objectContaining({
            id: "option-extra-sosse",
            name: "extra Soße",
            price: 80,
            groupId: "group-anpassung",
            groupName: "Anpassung",
          }),
        ]),
      );
      // Die preissetzende Antwort selbst darf nicht zusätzlich in extras
      // auftauchen.
      expect(
        result.extras.some((extra: any) => extra.id === "option-gross"),
      ).toBe(false);
    });
  });

  describe("Validierungsfehler", () => {
    it("wirft einen Fehler bei einer unbeantworteten Pflichtgruppe", () => {
      expect(() => resolve(schnitzel, [])).toThrow(BadRequestException);
      expect(() => resolve(schnitzel, [])).toThrow(/Beilage/);
    });

    it("wirft einen Fehler beim Überschreiten von maxSelect", () => {
      expect(() =>
        resolve(schnitzel, [
          "option-pommes",
          "option-ohne-salat",
          "option-extra-sosse",
          "option-extra-kaese",
        ]),
      ).toThrow(BadRequestException);
      expect(() =>
        resolve(schnitzel, [
          "option-pommes",
          "option-ohne-salat",
          "option-extra-sosse",
          "option-extra-kaese",
        ]),
      ).toThrow(/Anpassung/);
    });

    it("wirft einen Fehler bei einer fremden Antwortkennung (gehört zu keiner Gruppe dieses Produkts)", () => {
      // Kennung einer Antwort, die tatsächlich existiert, aber zu einem
      // anderen Produkt gehört (hier: die Größenantwort des Getränks).
      expect(() =>
        resolve(schnitzel, ["option-pommes", "option-gross"]),
      ).toThrow(BadRequestException);
    });

    it("wirft einen Fehler bei einer unbekannten Antwortkennung", () => {
      expect(() =>
        resolve(schnitzel, ["option-pommes", "does-not-exist"]),
      ).toThrow(BadRequestException);
    });

    it("wirft einen Fehler bei einer inaktiven Antwortkennung", () => {
      expect(() => resolve(schnitzel, ["option-inaktiv"])).toThrow(
        BadRequestException,
      );
    });
  });
});
