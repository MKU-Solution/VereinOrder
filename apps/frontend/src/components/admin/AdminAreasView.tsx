import { useMemo, useState } from "react";
import { Edit2, Map, Trash2 } from "lucide-react";

import { AdminEmptyState } from "./AdminEmptyState";
import { AdminToolbar } from "./AdminToolbar";

export interface AdminAreasViewProps {
  areas: any[];
  onRefresh: () => void;
  onOpenCreate: () => void;
  onEdit: (area: any) => void;
  onDelete: (id: string) => void;
  isRefreshing?: boolean;
}

export const AdminAreasView = ({
  areas,
  onRefresh,
  onOpenCreate,
  onEdit,
  onDelete,
  isRefreshing = false,
}: AdminAreasViewProps) => {
  const [searchQuery, setSearchQuery] = useState("");

  const filteredAreas = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return areas;
    return areas.filter((a) => (a.name || "").toLowerCase().includes(q));
  }, [areas, searchQuery]);

  const isFiltered = searchQuery.trim().length > 0;

  return (
    <div className="space-y-4">
      <AdminToolbar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        searchPlaceholder="Bereich suchen …"
        searchLabel="Bereiche durchsuchen"
        totalCount={areas.length}
        filteredCount={filteredAreas.length}
        isRefreshing={isRefreshing}
        onRefresh={onRefresh}
      />

      {filteredAreas.length === 0 ? (
        <AdminEmptyState
          icon={Map}
          title="Noch keine Bereiche angelegt"
          description="Lege Bereiche an (z. B. Gastgarten, Festhalle, Bar), um Tische und Kellner zu strukturieren."
          actionLabel="Bereich anlegen"
          onAction={onOpenCreate}
          isFiltered={isFiltered && areas.length > 0}
          onResetFilters={() => setSearchQuery("")}
        />
      ) : (
        <div className="space-y-3">
          {/* Desktop & Tablet Table */}
          <div className="hidden overflow-hidden rounded-2xl border border-slate-700/80 bg-slate-900/60 shadow-lg md:block">
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-slate-700/80 bg-slate-800/60 text-xs font-bold uppercase tracking-wider text-slate-400">
                    <th className="px-5 py-3.5">Bereichsname</th>
                    <th className="px-4 py-3.5">Sortierung</th>
                    <th className="px-5 py-3.5 text-right">Aktionen</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/80 text-sm">
                  {filteredAreas.map((area) => (
                    <tr
                      key={area.id}
                      className="transition-colors hover:bg-slate-800/40"
                    >
                      <td className="px-5 py-4 font-semibold text-slate-50">
                        <div className="flex items-center gap-2.5">
                          <Map
                            aria-hidden="true"
                            className="h-4 w-4 text-indigo-300"
                          />
                          <span>{area.name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-4 text-xs font-mono text-slate-400">
                        Reihenfolge: {area.sortOrder ?? 0}
                      </td>
                      <td className="px-5 py-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => onEdit(area)}
                            className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-lg border border-slate-700 bg-slate-800 p-2 text-slate-300 hover:bg-slate-700 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-200"
                            title="Bereich bearbeiten"
                            aria-label={`Bereich ${area.name} bearbeiten`}
                          >
                            <Edit2 aria-hidden="true" className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => onDelete(area.id)}
                            className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-lg border border-rose-500/30 bg-rose-500/20 p-2 text-rose-300 hover:bg-rose-500/30 hover:text-rose-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-200"
                            title="Bereich löschen"
                            aria-label={`Bereich ${area.name} löschen`}
                          >
                            <Trash2 aria-hidden="true" className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Mobile Card Rows (390×844) */}
          <div className="space-y-2.5 md:hidden">
            {filteredAreas.map((area) => (
              <article
                key={area.id}
                className="flex items-center justify-between gap-3 rounded-2xl border border-slate-700/80 bg-slate-900/80 p-4 shadow-md"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Map
                      aria-hidden="true"
                      className="h-4 w-4 shrink-0 text-indigo-300"
                    />
                    <h3 className="break-words font-bold text-slate-50">
                      {area.name}
                    </h3>
                  </div>
                  <div className="mt-1 text-xs font-mono text-slate-400">
                    Sortierung: {area.sortOrder ?? 0}
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onEdit(area)}
                    className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-slate-700 bg-slate-800 p-2.5 text-slate-200 hover:bg-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-200"
                    title="Bereich bearbeiten"
                    aria-label={`Bereich ${area.name} bearbeiten`}
                  >
                    <Edit2 aria-hidden="true" className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(area.id)}
                    className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-rose-500/30 bg-rose-500/20 p-2.5 text-rose-300 hover:bg-rose-500/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-200"
                    title="Bereich löschen"
                    aria-label={`Bereich ${area.name} löschen`}
                  >
                    <Trash2 aria-hidden="true" className="h-4 w-4" />
                  </button>
                </div>
              </article>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
