import { resolveTargetStationId } from "./target-station";

describe("resolveTargetStationId – Auflösung nach Issue #84", () => {
  it("nimmt die eigene Station des Produkts, auch wenn die Kategorie eine andere Station vorgibt", () => {
    const product = {
      targetStationId: "station-product",
      category: { targetStationId: "station-category" },
    };

    expect(resolveTargetStationId(product)).toBe("station-product");
  });

  it("fällt auf die Station der Kategorie zurück, wenn das Produkt keine eigene Ausnahme trägt", () => {
    const product = {
      targetStationId: null,
      category: { targetStationId: "station-category" },
    };

    expect(resolveTargetStationId(product)).toBe("station-category");
  });

  it("liefert null (zentrale Ausgabe), wenn weder Produkt noch Kategorie eine Station tragen", () => {
    const product = {
      targetStationId: null,
      category: { targetStationId: null },
    };

    expect(resolveTargetStationId(product)).toBeNull();
  });
});
