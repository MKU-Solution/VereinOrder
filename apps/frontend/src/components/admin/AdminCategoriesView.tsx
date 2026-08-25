import { useMemo, useState } from "react";
import { Edit2, Store, Tag, Trash2 } from "lucide-react";

import { AdminEmptyState } from "./AdminEmptyState";
import { AdminToolbar } from "./AdminToolbar";

export interface AdminCategoriesViewProps {
  categories: any[];
  stationsList: any[];
  onRefresh: () => void;
  onOpenCreate: () => void;
  onEdit: (category: any) => void;
  onDelete: (id: string) => void;
  isRefreshing?: boolean;
}

export const AdminCategoriesView = ({
  categories,
  stationsList,
  onRefresh,
  onOpenCreate,
  onEdit,
  onDelete,
  isRefreshing = false,
}: AdminCategoriesViewProps) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [stationFilter, setStationFilter] = useState("ALL");

  const stationsMap = useMemo(() => {
    const map = new Map<string, any>();
    for (const s of stationsList) {
      map.set(s.id, s);
    }
    return map;
  }, [stationsList]);

  const filteredCategories = useMemo(() => {
    return categories.filter((cat) => {
      const q = searchQuery.trim().toLowerCase();
      const matchesSearch = !q || (cat.name || "").toLowerCase().includes(q);

      const targetId = cat.targetStationId || "";
      const matchesStation =
        stationFilter === "ALL" ||
        (stationFilter === "CENTRAL" && !targetId) ||
        stationFilter === targetId;

      return matchesSearch && matchesStation;
    });
  }, [categories, searchQuery, stationFilter]);

  const isFiltered = searchQuery.trim().length > 0 || stationFilter !== "ALL";

  const handleResetFilters = () => {
    setSearchQuery("");
    setStationFilter("ALL");
  };

  const stationFilterSelect = (
    <div className="flex items-center gap-2">
      <label htmlFor="admin-categories-station-filter" className="sr-only">
        Zielstation filtern
      </label>
      <select
        id="admin-categories-station-filter"
        value={stationFilter}
        onChange={(e) => setStationFilter(e.target.value)}
        className="min-h-11 rounded-xl border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-bold text-slate-200 transition-colors hover:border-slate-600 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-400/30"
      >
        <option value="ALL">Alle Zielstationen</option>
        <option value="CENTRAL">Zentrale Ausgabe</option>
        {stationsList.map((s) => (
          <option key={s.id} value={s.id}>
            Station: {s.name}
          </option>
        ))}
      </select>
    </div>
  );

  return (
    <div className="space-y-4">
      <AdminToolbar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        searchPlaceholder="Kategorie suchen …"
        searchLabel="Kategorien durchsuchen"
        totalCount={categories.length}
        filteredCount={filteredCategories.length}
        isRefreshing={isRefreshing}
        onRefresh={onRefresh}
        filters={stationFilterSelect}
      />

      {filteredCategories.length === 0 ? (
        <AdminEmptyState
          icon={Tag}
          title="Noch keine Kategorien angelegt"
          description="Lege zuerst eine Kategorie an, damit du Produkte eindeutig zuordnen und Zielstationen vorgeben kannst."
          actionLabel="Kategorie anlegen"
          onAction={onOpenCreate}
          isFiltered={isFiltered && categories.length > 0}
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
                    <th className="px-5 py-3.5">Kategorie</th>
                    <th className="px-4 py-3.5">Vorgegebene Zielstation</th>
                    <th className="px-4 py-3.5">Sortierung</th>
                    <th className="px-5 py-3.5 text-right">Aktionen</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/80 text-sm">
                  {filteredCategories.map((cat) => {
                    const targetStation = cat.targetStationId
                      ? stationsMap.get(cat.targetStationId)
                      : null;

                    return (
                      <tr
                        key={cat.id}
                        className="transition-colors hover:bg-slate-800/40"
                      >
                        <td className="px-5 py-4 font-semibold text-slate-50">
                          <div className="flex items-center gap-2.5">
                            <Tag
                              aria-hidden="true"
                              className="h-4 w-4 text-indigo-300"
                            />
                            <span>{cat.name}</span>
                          </div>
                        </td>
                        <td className="px-4 py-4 text-xs text-slate-300">
                          {targetStation ? (
                            <span className="inline-flex items-center gap-1.5 rounded-md border border-indigo-500/30 bg-indigo-500/15 px-2 py-1 font-medium text-indigo-300">
                              <Store
                                aria-hidden="true"
                                className="h-3.5 w-3.5"
                              />
                              {targetStation.name}
                            </span>
                          ) : (
                            <span className="text-slate-400">
                              Zentrale Ausgabe (Standard)
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-4 text-xs font-mono text-slate-400">
                          Reihenfolge: {cat.sortOrder ?? 0}
                        </td>
                        <td className="px-5 py-4 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => onEdit(cat)}
                              className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-lg border border-slate-700 bg-slate-800 p-2 text-slate-300 hover:bg-slate-700 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-200"
                              title="Kategorie bearbeiten"
                              aria-label={`Kategorie ${cat.name} bearbeiten`}
                            >
                              <Edit2 aria-hidden="true" className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => onDelete(cat.id)}
                              className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-lg border border-rose-500/30 bg-rose-500/20 p-2 text-rose-300 hover:bg-rose-500/30 hover:text-rose-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-200"
                              title="Kategorie löschen"
                              aria-label={`Kategorie ${cat.name} löschen`}
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
            {filteredCategories.map((cat) => {
              const targetStation = cat.targetStationId
                ? stationsMap.get(cat.targetStationId)
                : null;

              return (
                <article
                  key={cat.id}
                  className="space-y-3 rounded-2xl border border-slate-700/80 bg-slate-900/80 p-4 shadow-md"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <Tag
                          aria-hidden="true"
                          className="h-4 w-4 shrink-0 text-indigo-300"
                        />
                        <h3 className="break-words font-bold text-slate-50">
                          {cat.name}
                        </h3>
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        onClick={() => onEdit(cat)}
                        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-slate-700 bg-slate-800 p-2.5 text-slate-200 hover:bg-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-200"
                        title="Kategorie bearbeiten"
                        aria-label={`Kategorie ${cat.name} bearbeiten`}
                      >
                        <Edit2 aria-hidden="true" className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onDelete(cat.id)}
                        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-rose-500/30 bg-rose-500/20 p-2.5 text-rose-300 hover:bg-rose-500/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-200"
                        title="Kategorie löschen"
                        aria-label={`Kategorie ${cat.name} löschen`}
                      >
                        <Trash2 aria-hidden="true" className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-800 pt-2.5 text-xs">
                    <div>
                      {targetStation ? (
                        <span className="inline-flex items-center gap-1.5 rounded-md border border-indigo-500/30 bg-indigo-500/15 px-2 py-1 font-medium text-indigo-300">
                          <Store aria-hidden="true" className="h-3.5 w-3.5" />
                          Ziel: {targetStation.name}
                        </span>
                      ) : (
                        <span className="text-slate-400">
                          Ziel: Zentrale Ausgabe
                        </span>
                      )}
                    </div>
                    <div className="font-mono text-slate-500">
                      Sortierung: {cat.sortOrder ?? 0}
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
