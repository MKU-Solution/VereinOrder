// Kachelableitung der Ein-Tipp-Kassen (Issue #66, Stationskasse).
//
// Herausgezogen aus QuickSaleDashboard.tsx (vormals der `options`-useMemo-Block).
// Setzt den Vertrag aus docs/development/produktoptionen-schnittstelle.md
// ("Bestellannahme", Preisbildung ABSOLUTE gegen SURCHARGE) für die Kasse um.
// Sowohl die zentrale Bonkasse (QuickSaleDashboard.tsx) als auch die
// Stationskasse (StationSaleDashboard.tsx) benutzen ausschließlich diese
// Funktion. Kopierte man die Regeln stattdessen in die zweite Maske, liefen
// beide Kassen bei der nächsten Änderung an den Auswahlgruppen auseinander -
// und zwar an der Preisbildung. Das ist Geld, und der Fehler fiele erst am
// Festtag auf (docs/development/stationskasse.md, "Notwendige Änderungen" /
// Oberfläche).

export interface QuickSaleOption {
  id: string;
  name: string;
  priceEffect: number;
  isActive: boolean;
  sortOrder: number;
}

export interface QuickSaleOptionGroup {
  id: string;
  name: string;
  selectionType: "SINGLE" | "MULTIPLE";
  isRequired: boolean;
  minSelect: number;
  maxSelect: number | null;
  priceMode: "ABSOLUTE" | "SURCHARGE";
  quickSaleTiles: boolean;
  sortOrder: number;
  options: QuickSaleOption[];
}

export interface QuickSaleProduct {
  id: string;
  name: string;
  shortName?: string | null;
  price: number;
  color?: string | null;
  availability: "AVAILABLE" | "LOW_STOCK" | "OUT_OF_STOCK";
  category?: { id: string; name: string; sortOrder: number } | null;
  optionGroups: QuickSaleOptionGroup[];
}

export interface QuickSaleTile {
  key: string;
  productId: string;
  optionIds: string[];
  label: string;
  detail?: string;
  hint?: string;
  price: number;
  color?: string | null;
  availability: QuickSaleProduct["availability"];
  category: string;
}

/**
 * Leitet aus den Produkten samt Auswahlgruppen die antippbaren Kacheln der
 * Ein-Tipp-Kasse ab.
 *
 * Regeln (siehe docs/development/produktoptionen-schnittstelle.md,
 * "Schnellverkauf" in produktoptionen-datenmodell.md):
 *
 * - Die Auffächerung in mehrere Kacheln hängt ausschließlich an der Gruppe
 *   mit `quickSaleTiles === true`, nie an `priceMode` oder der Anzahl der
 *   Gruppen.
 * - Weitere Pflichtgruppen neben der Kachelgruppe: Die Kasse ist eine
 *   Ein-Tipp-Maske, deshalb kann sie keine Rückfrage stellen. Sind alle
 *   aktiven Antworten einer solchen Gruppe aufpreisfrei (`priceEffect === 0`),
 *   wird die erste Antwort in gepflegter Reihenfolge vorbelegt und die
 *   Kachel trägt einen Hinweis. Trägt eine von ihnen einen Aufpreis, ist der
 *   Kachelpreis unbestimmt und das Produkt wird nicht angeboten.
 * - Preisbildung der Kachelgruppe: `ABSOLUTE` ersetzt den Grundpreis durch
 *   den Optionspreis, `SURCHARGE` addiert ihn auf den Produktpreis.
 */
export function deriveQuickSaleTiles(
  products: QuickSaleProduct[],
): QuickSaleTile[] {
  return products.flatMap((product) => {
    const category = product.category?.name || "Ohne Kategorie";
    const groups = product.optionGroups || [];

    // Die Auffächerung in Kacheln hängt ausschließlich an der Gruppe mit
    // quickSaleTiles === true, nie an priceMode oder der Anzahl der Gruppen.
    const tileGroup = groups.find((g) => g.quickSaleTiles);

    // Weitere Pflichtgruppen neben der Kachelgruppe: Der Schnellverkauf ist
    // eine Ein-Tipp-Maske, deshalb kann er keine Rückfrage stellen. Sind sie
    // alle aufpreisfrei (jede aktive Antwort mit priceEffect 0), wird die
    // erste Antwort in gepflegter Reihenfolge verwendet und die Kachel trägt
    // einen Hinweis. Trägt eine von ihnen einen Aufpreis, ist der
    // Kachelpreis unbestimmt und das Produkt wird im Schnellverkauf nicht
    // angeboten.
    const otherRequiredGroups = groups.filter(
      (g) => g.id !== tileGroup?.id && g.isRequired,
    );
    const isGroupSurchargeFree = (group: QuickSaleOptionGroup) =>
      group.options
        .filter((o) => o.isActive !== false)
        .every((o) => o.priceEffect === 0);
    const blockedByPaidRequiredGroup = otherRequiredGroups.some(
      (g) => !isGroupSurchargeFree(g),
    );
    if (blockedByPaidRequiredGroup) return [];

    const defaultOptions = otherRequiredGroups
      .map((g) => g.options.filter((o) => o.isActive !== false)[0])
      .filter((o): o is QuickSaleOption => !!o);
    const defaultOptionIds = defaultOptions.map((o) => o.id);
    const defaultHint =
      defaultOptions.length > 0
        ? `Standard: ${defaultOptions.map((o) => o.name).join(", ")}`
        : undefined;

    if (tileGroup) {
      const activeTileOptions = tileGroup.options.filter(
        (o) => o.isActive !== false,
      );
      return activeTileOptions.map((option) => {
        const price =
          tileGroup.priceMode === "ABSOLUTE"
            ? option.priceEffect
            : product.price + option.priceEffect;
        return {
          key: `${product.id}|${option.id}`,
          productId: product.id,
          optionIds: [option.id, ...defaultOptionIds],
          label: product.shortName || product.name,
          detail: option.name,
          hint: defaultHint,
          price,
          color: product.color,
          availability: product.availability,
          category,
        };
      });
    }

    return [
      {
        key: product.id,
        productId: product.id,
        optionIds: defaultOptionIds,
        label: product.shortName || product.name,
        hint: defaultHint,
        price: product.price,
        color: product.color,
        availability: product.availability,
        category,
      },
    ];
  });
}
