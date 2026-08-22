import type { Prisma } from "@vereinorder/database";

// Einzige Auflösung der Zielstation eines Produkts (Issue #84). Fachliche
// Regel der Projektleitung: Station des Produkts, sonst Station der
// Kategorie, sonst zentrale Ausgabe (null). Bonleitung
// (orders.service.ts), Stationsansicht (stations.service.ts) und die
// Produktabfrage je Station (products.service.ts) benutzen ausschließlich
// diese Funktion; die Regel darf nicht an mehreren Stellen nachgebaut werden.
//
// Der Kategorietyp ist bewusst NICHT optional: seit Issue #84 ist
// Product.categoryId Pflicht, und wer die Kategorie beim Lesen vergisst,
// bekommt hier einen Typfehler statt eines Bons an der falschen Station.
export interface ProductForStationResolution {
  targetStationId: string | null;
  category: {
    targetStationId: string | null;
  };
}

export function resolveTargetStationId(
  product: ProductForStationResolution,
): string | null {
  return product.targetStationId ?? product.category.targetStationId ?? null;
}

// Gegenstück zu resolveTargetStationId fürs Filtern statt fürs Lesen: welche
// Produkte lösen auf die gegebene Station auf? Das ist ein Produkt entweder,
// weil es selbst diese Station als Ausnahme trägt, oder weil es keine eigene
// Ausnahme trägt und seine Kategorie diese Station vorgibt. Wird von der
// Stationsansicht (stations.service.ts, ausstehende Positionen) und der
// Produktabfrage je Station (products.service.ts, findByStation) benutzt,
// damit beide Stellen dasselbe Kriterium prüfen statt es zweimal nachzubauen.
export function productAtStationFilter(
  stationId: string,
): Prisma.ProductWhereInput {
  return {
    OR: [
      { targetStationId: stationId },
      { targetStationId: null, category: { targetStationId: stationId } },
    ],
  };
}
