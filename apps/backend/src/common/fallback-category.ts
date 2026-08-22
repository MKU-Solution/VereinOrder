// Einzige Regel für die Auffangkategorie eines Produkts ohne Kategorie
// (Issue #84). "Product"."categoryId" ist seit dieser Migration Pflicht;
// Datensätze ohne Kategorie können nur aus der Zeit davor stammen (ältere
// Ereignisvorlagen der Version 1/2, ältere Sicherungen). Die SQL-Migration
// 20260822120000_move_target_station_to_category, der Vorlagenimport
// (events.service.ts) und die Sicherungswiederherstellung
// (backup.service.ts) müssen für dieselbe Ausgangslage dieselbe
// Auffangkategorie erzeugen, sonst leitet ein Produkt je nach Übernahmeweg
// an eine andere Station. Diese Datei ist die eine Stelle für Name und
// Sortierung; sie darf nicht an mehreren Stellen nachgebaut werden.
//
// Regel (siehe Kopfkommentar der Migration): "Sonstige Artikel", ans Ende
// der bestehenden Sortierung der Veranstaltung angehängt. Trägt die
// Veranstaltung bereits eine Kategorie dieses Namens, weicht die
// Auffangkategorie auf "Sonstige Artikel (ohne Kategorie)" aus, damit in
// der Verwaltung keine zwei gleichnamigen Kategorien nebeneinander stehen.
export const FALLBACK_CATEGORY_NAME = "Sonstige Artikel";
export const FALLBACK_CATEGORY_NAME_ON_COLLISION =
  "Sonstige Artikel (ohne Kategorie)";

export interface FallbackCategoryPlan {
  name: string;
  sortOrder: number;
}

// existingCategories: die Kategorien, die die Veranstaltung bereits hat
// (oder im selben Übernahmeschritt gerade bekommt) — genau die Menge, gegen
// die die SQL-Migration mit "EXISTS (SELECT 1 FROM ProductCategory ...)"
// prüft.
export function planFallbackCategory(
  existingCategories: { name: string; sortOrder: number }[],
): FallbackCategoryPlan {
  const hasSonstige = existingCategories.some(
    (c) => c.name === FALLBACK_CATEGORY_NAME,
  );
  const maxSortOrder = existingCategories.reduce(
    (max, c) => Math.max(max, c.sortOrder),
    -1,
  );
  return {
    name: hasSonstige
      ? FALLBACK_CATEGORY_NAME_ON_COLLISION
      : FALLBACK_CATEGORY_NAME,
    sortOrder: maxSortOrder + 1,
  };
}
