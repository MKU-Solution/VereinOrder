import { useMemo, useState } from "react";
import { Edit2, Layers, Package, Store, Tag, Trash2 } from "lucide-react";

import { AdminEmptyState } from "./AdminEmptyState";
import { AdminToolbar } from "./AdminToolbar";

export interface AdminProductsViewProps {
  products: any[];
  categoriesList: any[];
  stationsList: any[];
  onRefresh: () => void;
  onOpenCreate: () => void;
  onEdit: (product: any) => void;
  onDelete: (id: string) => void;
  isRefreshing?: boolean;
}

export const AdminProductsView = ({
  products,
  categoriesList,
  stationsList,
  onRefresh,
  onOpenCreate,
  onEdit,
  onDelete,
  isRefreshing = false,
}: AdminProductsViewProps) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("ALL");
  const [stationFilter, setStationFilter] = useState("ALL");

  const categoriesMap = useMemo(() => {
    const map = new Map<string, any>();
    for (const c of categoriesList) {
      map.set(c.id, c);
    }
    return map;
  }, [categoriesList]);

  const stationsMap = useMemo(() => {
    const map = new Map<string, any>();
    for (const s of stationsList) {
      map.set(s.id, s);
    }
    return map;
  }, [stationsList]);

  const filteredProducts = useMemo(() => {
    return products.filter((prod) => {
      const q = searchQuery.trim().toLowerCase();
      const matchesSearch = !q || (prod.name || "").toLowerCase().includes(q);

      const matchesCategory =
        categoryFilter === "ALL" || prod.categoryId === categoryFilter;

      const effectiveStationId =
        prod.targetStationId ||
        categoriesMap.get(prod.categoryId)?.targetStationId ||
        "";

      const matchesStation =
        stationFilter === "ALL" ||
        (stationFilter === "CENTRAL" && !effectiveStationId) ||
        stationFilter === effectiveStationId;

      return matchesSearch && matchesCategory && matchesStation;
    });
  }, [products, searchQuery, categoryFilter, stationFilter, categoriesMap]);

  const isFiltered =
    searchQuery.trim().length > 0 ||
    categoryFilter !== "ALL" ||
    stationFilter !== "ALL";

  const handleResetFilters = () => {
    setSearchQuery("");
    setCategoryFilter("ALL");
    setStationFilter("ALL");
  };

  const filtersNode = (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-2">
        <label htmlFor="admin-products-category-filter" className="sr-only">
          Kategorie filtern
        </label>
        <select
          id="admin-products-category-filter"
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="min-h-11 rounded-xl border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-bold text-slate-200 transition-colors hover:border-slate-600 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-400/30"
        >
          <option value="ALL">Alle Kategorien</option>
          {categoriesList.map((c) => (
            <option key={c.id} value={c.id}>
              Kategorie: {c.name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-2">
        <label htmlFor="admin-products-station-filter" className="sr-only">
          Station filtern
        </label>
        <select
          id="admin-products-station-filter"
          value={stationFilter}
          onChange={(e) => setStationFilter(e.target.value)}
          className="min-h-11 rounded-xl border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-bold text-slate-200 transition-colors hover:border-slate-600 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-400/30"
        >
          <option value="ALL">Alle Stationen</option>
          <option value="CENTRAL">Zentrale Ausgabe</option>
          {stationsList.map((s) => (
            <option key={s.id} value={s.id}>
              Station: {s.name}
            </option>
          ))}
        </select>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <AdminToolbar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        searchPlaceholder="Produkt suchen …"
        searchLabel="Produkte durchsuchen"
        totalCount={products.length}
        filteredCount={filteredProducts.length}
        isRefreshing={isRefreshing}
        onRefresh={onRefresh}
        filters={filtersNode}
      />

      {filteredProducts.length === 0 ? (
        <AdminEmptyState
          icon={Package}
          title="Noch keine Produkte angelegt"
          description="Lege Produkte mit Preisen, Kategorien und optionalen Auswahlgruppen an, damit Bestellungen aufgenommen werden können."
          actionLabel="Produkt anlegen"
          onAction={onOpenCreate}
          isFiltered={isFiltered && products.length > 0}
          onResetFilters={handleResetFilters}
        />
      ) : (
        <div className="space-y-3">
          {/* Desktop & Tablet Table */}
          <div className="hidden overflow-hidden rounded-2xl border border-slate-700/80 bg-slate-900/60 shadow-lg md:block">
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-slate-700/80 bg-slate-800/60 text-xs font-bold uppercase tracking-wider text-slate-400">
                    <th className="px-5 py-3.5">Produkt</th>
                    <th className="px-4 py-3.5">Kategorie</th>
                    <th className="px-4 py-3.5">Preis</th>
                    <th className="px-4 py-3.5">Zielstation</th>
                    <th className="px-4 py-3.5">Auswahlgruppen</th>
                    <th className="px-4 py-3.5">Sortierung</th>
                    <th className="px-5 py-3.5 text-right">Aktionen</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/80 text-sm">
                  {filteredProducts.map((prod) => {
                    const category = categoriesMap.get(prod.categoryId);
                    const hasCustomStation = Boolean(prod.targetStationId);
                    const effectiveStation = prod.targetStationId
                      ? stationsMap.get(prod.targetStationId)
                      : category?.targetStationId
                        ? stationsMap.get(category.targetStationId)
                        : null;

                    const optionGroupCount = prod.optionGroups?.length ?? 0;
                    const priceInEuros =
                      Number.isInteger(prod.price) && prod.price >= 0
                        ? (prod.price / 100).toFixed(2).replace(".", ",")
                        : "0,00";

                    return (
                      <tr
                        key={prod.id}
                        className="transition-colors hover:bg-slate-800/40"
                      >
                        <td className="px-5 py-4 font-semibold text-slate-50">
                          <div className="flex items-center gap-2.5">
                            <Package
                              aria-hidden="true"
                              className="h-4 w-4 text-indigo-300"
                            />
                            <span>{prod.name}</span>
                          </div>
                        </td>
                        <td className="px-4 py-4 text-xs text-slate-300">
                          {category ? (
                            <span className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800 px-2 py-1 font-medium text-slate-200">
                              <Tag
                                aria-hidden="true"
                                className="h-3 w-3 text-slate-400"
                              />
                              {category.name}
                            </span>
                          ) : (
                            <span className="text-rose-400 font-bold">
                              Keine Kategorie
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-4 font-mono font-bold text-slate-100">
                          € {priceInEuros}
                        </td>
                        <td className="px-4 py-4 text-xs text-slate-300">
                          {effectiveStation ? (
                            <span
                              className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 font-medium ${
                                hasCustomStation
                                  ? "border-amber-500/30 bg-amber-500/15 text-amber-300"
                                  : "border-slate-700 bg-slate-800 text-slate-300"
                              }`}
                              title={
                                hasCustomStation
                                  ? "Eigene Ausnahme-Station dieses Produkts"
                                  : "Von der Kategorie vorgegebene Station"
                              }
                            >
                              <Store
                                aria-hidden="true"
                                className="h-3.5 w-3.5"
                              />
                              {effectiveStation.name}
                              {hasCustomStation ? " (Ausnahme)" : " (geerbt)"}
                            </span>
                          ) : (
                            <span className="text-slate-400">
                              Zentrale Ausgabe
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-4 text-xs text-slate-400">
                          {optionGroupCount > 0 ? (
                            <span className="inline-flex items-center gap-1 rounded-md border border-indigo-500/30 bg-indigo-500/15 px-2 py-0.5 font-semibold text-indigo-300">
                              <Layers aria-hidden="true" className="h-3 w-3" />
                              {optionGroupCount}{" "}
                              {optionGroupCount === 1 ? "Gruppe" : "Gruppen"}
                            </span>
                          ) : (
                            <span className="text-slate-500">–</span>
                          )}
                        </td>
                        <td className="px-4 py-4 text-xs font-mono text-slate-400">
                          {prod.sortOrder ?? 0}
                        </td>
                        <td className="px-5 py-4 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => onEdit(prod)}
                              className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-lg border border-slate-700 bg-slate-800 p-2 text-slate-300 hover:bg-slate-700 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-200"
                              title="Produkt bearbeiten"
                              aria-label={`Produkt ${prod.name} bearbeiten`}
                            >
                              <Edit2 aria-hidden="true" className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => onDelete(prod.id)}
                              className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-lg border border-rose-500/30 bg-rose-500/20 p-2 text-rose-300 hover:bg-rose-500/30 hover:text-rose-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-200"
                              title="Produkt löschen"
                              aria-label={`Produkt ${prod.name} löschen`}
                            >
                              <Trash2 aria-hidden="true" className="h-4 w-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Mobile Card View (390×844) */}
          <div className="space-y-2.5 md:hidden">
            {filteredProducts.map((prod) => {
              const category = categoriesMap.get(prod.categoryId);
              const hasCustomStation = Boolean(prod.targetStationId);
              const effectiveStation = prod.targetStationId
                ? stationsMap.get(prod.targetStationId)
                : category?.targetStationId
                  ? stationsMap.get(category.targetStationId)
                  : null;

              const optionGroupCount = prod.optionGroups?.length ?? 0;
              const priceInEuros =
                Number.isInteger(prod.price) && prod.price >= 0
                  ? (prod.price / 100).toFixed(2).replace(".", ",")
                  : "0,00";

              return (
                <article
                  key={prod.id}
                  className="space-y-3 rounded-2xl border border-slate-700/80 bg-slate-900/80 p-4 shadow-md"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <Package
                          aria-hidden="true"
                          className="h-4 w-4 shrink-0 text-indigo-300"
                        />
                        <h3 className="break-words font-bold text-slate-50">
                          {prod.name}
                        </h3>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                        {category && (
                          <span className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800 px-2 py-0.5 font-medium text-slate-200">
                            <Tag
                              aria-hidden="true"
                              className="h-3 w-3 text-slate-400"
                            />
                            {category.name}
                          </span>
                        )}
                        {optionGroupCount > 0 && (
                          <span className="inline-flex items-center gap-1 rounded-md border border-indigo-500/30 bg-indigo-500/15 px-2 py-0.5 font-semibold text-indigo-300">
                            <Layers aria-hidden="true" className="h-3 w-3" />
                            {optionGroupCount}{" "}
                            {optionGroupCount === 1 ? "Option" : "Optionen"}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="text-right">
                      <span className="font-mono text-base font-black text-slate-100">
                        € {priceInEuros}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-2 border-t border-slate-800 pt-2.5 text-xs">
                    <div>
                      {effectiveStation ? (
                        <span
                          className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 ${
                            hasCustomStation
                              ? "border-amber-500/30 bg-amber-500/15 text-amber-300"
                              : "border-slate-700 bg-slate-800 text-slate-300"
                          }`}
                        >
                          <Store aria-hidden="true" className="h-3 w-3" />
                          {effectiveStation.name}
                          {hasCustomStation ? " (Ausnahme)" : ""}
                        </span>
                      ) : (
                        <span className="text-slate-400">Zentrale Ausgabe</span>
                      )}
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        onClick={() => onEdit(prod)}
                        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-slate-700 bg-slate-800 p-2.5 text-slate-200 hover:bg-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-200"
                        title="Produkt bearbeiten"
                        aria-label={`Produkt ${prod.name} bearbeiten`}
                      >
                        <Edit2 aria-hidden="true" className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onDelete(prod.id)}
                        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-rose-500/30 bg-rose-500/20 p-2.5 text-rose-300 hover:bg-rose-500/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-200"
                        title="Produkt löschen"
                        aria-label={`Produkt ${prod.name} löschen`}
                      >
                        <Trash2 aria-hidden="true" className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
