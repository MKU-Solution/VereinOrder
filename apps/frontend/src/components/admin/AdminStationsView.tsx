import { useMemo, useState } from "react";
import { Edit2, Printer, Store } from "lucide-react";

import { AdminEmptyState } from "./AdminEmptyState";
import { AdminToolbar } from "./AdminToolbar";
import { UserActiveBadge } from "./AdminStatusBadge";

export interface AdminStationsViewProps {
  stations: any[];
  printersList: any[];
  onRefresh: () => void;
  onOpenCreate: () => void;
  onEdit: (station: any) => void;
  isRefreshing?: boolean;
}

export const AdminStationsView = ({
  stations,
  printersList,
  onRefresh,
  onOpenCreate,
  onEdit,
  isRefreshing = false,
}: AdminStationsViewProps) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [printerFilter, setPrinterFilter] = useState("ALL");

  const printersMap = useMemo(() => {
    const map = new Map<string, any>();
    for (const p of printersList) {
      map.set(p.id, p);
    }
    return map;
  }, [printersList]);

  const filteredStations = useMemo(() => {
    return stations.filter((s) => {
      const q = searchQuery.trim().toLowerCase();
      const matchesSearch =
        !q ||
        (s.name || "").toLowerCase().includes(q) ||
        (s.shortName || "").toLowerCase().includes(q);

      const hasPrinter = Boolean(s.printerId || s.printer);
      const matchesPrinter =
        printerFilter === "ALL" ||
        (printerFilter === "WITH_PRINTER" && hasPrinter) ||
        (printerFilter === "WITHOUT_PRINTER" && !hasPrinter);

      return matchesSearch && matchesPrinter;
    });
  }, [stations, searchQuery, printerFilter]);

  const isFiltered = searchQuery.trim().length > 0 || printerFilter !== "ALL";

  const handleResetFilters = () => {
    setSearchQuery("");
    setPrinterFilter("ALL");
  };

  const printerFilterSelect = (
    <div className="flex items-center gap-2">
      <label htmlFor="admin-stations-printer-filter" className="sr-only">
        Druckerzuordnung filtern
      </label>
      <select
        id="admin-stations-printer-filter"
        value={printerFilter}
        onChange={(e) => setPrinterFilter(e.target.value)}
        className="min-h-11 rounded-xl border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-bold text-slate-200 transition-colors hover:border-slate-600 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-400/30"
      >
        <option value="ALL">Alle Stationen</option>
        <option value="WITH_PRINTER">Mit zugewiesenem Drucker</option>
        <option value="WITHOUT_PRINTER">Ohne eigenen Drucker</option>
      </select>
    </div>
  );

  return (
    <div className="space-y-4">
      <AdminToolbar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        searchPlaceholder="Station oder Kurzbezeichnung suchen …"
        searchLabel="Stationen durchsuchen"
        totalCount={stations.length}
        filteredCount={filteredStations.length}
        isRefreshing={isRefreshing}
        onRefresh={onRefresh}
        filters={printerFilterSelect}
      />

      {filteredStations.length === 0 ? (
        <AdminEmptyState
          icon={Store}
          title="Noch keine Stationen angelegt"
          description="Lege Stationen an (z. B. Schank, Grill, Kaffeebar), um Artikel zu bonieren und Bons gezielt zu drucken."
          actionLabel="Station anlegen"
          onAction={onOpenCreate}
          isFiltered={isFiltered && stations.length > 0}
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
                    <th className="px-5 py-3.5">Station</th>
                    <th className="px-4 py-3.5">Kurzbezeichnung</th>
                    <th className="px-4 py-3.5">Bondrucker</th>
                    <th className="px-4 py-3.5">Status</th>
                    <th className="px-4 py-3.5">Sortierung</th>
                    <th className="px-5 py-3.5 text-right">Aktionen</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/80 text-sm">
                  {filteredStations.map((station) => {
                    const assignedPrinter =
                      station.printer ||
                      (station.printerId
                        ? printersMap.get(station.printerId)
                        : null);

                    return (
                      <tr
                        key={station.id}
                        className="transition-colors hover:bg-slate-800/40"
                      >
                        <td className="px-5 py-4 font-semibold text-slate-50">
                          <div className="flex items-center gap-2.5">
                            <Store
                              aria-hidden="true"
                              className="h-4 w-4 text-indigo-300"
                            />
                            <span>{station.name}</span>
                          </div>
                        </td>
                        <td className="px-4 py-4 text-xs font-mono text-slate-300">
                          {station.shortName ? (
                            <span className="rounded-md border border-slate-700 bg-slate-800 px-2 py-1">
                              {station.shortName}
                            </span>
                          ) : (
                            <span className="text-slate-500">–</span>
                          )}
                        </td>
                        <td className="px-4 py-4 text-xs text-slate-300">
                          {assignedPrinter ? (
                            <span className="inline-flex items-center gap-1.5 rounded-md border border-indigo-500/30 bg-indigo-500/15 px-2 py-1 font-medium text-indigo-300">
                              <Printer
                                aria-hidden="true"
                                className="h-3.5 w-3.5"
                              />
                              {assignedPrinter.name}
                            </span>
                          ) : (
                            <span className="text-slate-400">
                              Standard-Drucker
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-4">
                          <UserActiveBadge
                            isActive={station.isActive ?? true}
                          />
                        </td>
                        <td className="px-4 py-4 text-xs font-mono text-slate-400">
                          Reihenfolge: {station.sortOrder ?? 0}
                        </td>
                        <td className="px-5 py-4 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => onEdit(station)}
                              className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-lg border border-slate-700 bg-slate-800 p-2 text-slate-300 hover:bg-slate-700 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-200"
                              title="Station bearbeiten"
                              aria-label={`Station ${station.name} bearbeiten`}
                            >
                              <Edit2 aria-hidden="true" className="h-4 w-4" />
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
            {filteredStations.map((station) => {
              const assignedPrinter =
                station.printer ||
                (station.printerId ? printersMap.get(station.printerId) : null);

              return (
                <article
                  key={station.id}
                  className="space-y-3 rounded-2xl border border-slate-700/80 bg-slate-900/80 p-4 shadow-md"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <Store
                          aria-hidden="true"
                          className="h-4 w-4 shrink-0 text-indigo-300"
                        />
                        <h3 className="break-words font-bold text-slate-50">
                          {station.name}
                        </h3>
                      </div>
                      {station.shortName && (
                        <div className="mt-1">
                          <span className="rounded-md border border-slate-700 bg-slate-800 px-2 py-0.5 font-mono text-xs text-slate-300">
                            Kurz: {station.shortName}
                          </span>
                        </div>
                      )}
                      <div className="mt-1.5">
                        <UserActiveBadge isActive={station.isActive ?? true} />
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        onClick={() => onEdit(station)}
                        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-slate-700 bg-slate-800 p-2.5 text-slate-200 hover:bg-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-200"
                        title="Station bearbeiten"
                        aria-label={`Station ${station.name} bearbeiten`}
                      >
                        <Edit2 aria-hidden="true" className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-800 pt-2.5 text-xs">
                    <div>
                      {assignedPrinter ? (
                        <span className="inline-flex items-center gap-1.5 rounded-md border border-indigo-500/30 bg-indigo-500/15 px-2 py-1 font-medium text-indigo-300">
                          <Printer aria-hidden="true" className="h-3.5 w-3.5" />
                          {assignedPrinter.name}
                        </span>
                      ) : (
                        <span className="text-slate-400">Standard-Drucker</span>
                      )}
                    </div>
                    <div className="font-mono text-slate-500">
                      Sortierung: {station.sortOrder ?? 0}
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
