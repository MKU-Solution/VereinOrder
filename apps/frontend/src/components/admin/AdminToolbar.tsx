import type { ReactNode } from "react";
import { RefreshCw, Search, X } from "lucide-react";

export interface AdminToolbarProps {
  searchQuery?: string;
  onSearchChange?: (query: string) => void;
  searchPlaceholder?: string;
  searchLabel?: string;
  totalCount?: number;
  filteredCount?: number;
  isRefreshing?: boolean;
  onRefresh?: () => void;
  filters?: ReactNode;
  children?: ReactNode;
}

export const AdminToolbar = ({
  searchQuery = "",
  onSearchChange,
  searchPlaceholder = "Suchen …",
  searchLabel = "In Liste suchen",
  totalCount,
  filteredCount,
  isRefreshing = false,
  onRefresh,
  filters,
  children,
}: AdminToolbarProps) => {
  const isFiltered =
    totalCount !== undefined &&
    filteredCount !== undefined &&
    filteredCount !== totalCount;

  return (
    <section
      aria-label="Werkzeugleiste"
      className="flex flex-col gap-3 rounded-2xl border border-slate-700/80 bg-slate-900/90 p-3 sm:p-4"
    >
      <div className="flex flex-col items-stretch gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center">
          {onSearchChange && (
            <div className="relative min-w-[200px] flex-1 sm:max-w-md">
              <label htmlFor="admin-toolbar-search" className="sr-only">
                {searchLabel}
              </label>
              <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-slate-400">
                <Search aria-hidden="true" className="h-4 w-4" />
              </div>
              <input
                id="admin-toolbar-search"
                type="text"
                value={searchQuery}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder={searchPlaceholder}
                className="min-h-11 w-full rounded-xl border border-slate-700 bg-slate-800/90 pl-10 pr-9 text-sm text-slate-100 placeholder-slate-400 transition-colors hover:border-slate-600 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-400/30"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => onSearchChange("")}
                  className="absolute inset-y-0 right-0 flex items-center pr-3 text-slate-400 hover:text-slate-200"
                  aria-label="Suchbegriff löschen"
                >
                  <X aria-hidden="true" className="h-4 w-4" />
                </button>
              )}
            </div>
          )}

          {filters}
          {children}
        </div>

        <div className="flex items-center justify-between gap-3 sm:justify-end">
          {totalCount !== undefined && (
            <div
              className="text-xs font-semibold text-slate-400"
              aria-live="polite"
            >
              {isFiltered ? (
                <span>
                  <strong className="text-slate-200">{filteredCount}</strong>{" "}
                  von {totalCount} {totalCount === 1 ? "Eintrag" : "Einträgen"}
                </span>
              ) : (
                <span>
                  <strong className="text-slate-200">{totalCount}</strong>{" "}
                  {totalCount === 1 ? "Eintrag" : "Einträge"}
                </span>
              )}
            </div>
          )}

          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              disabled={isRefreshing}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-bold text-slate-200 transition-colors hover:bg-slate-700 hover:text-white focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-amber-200 disabled:opacity-50"
              title="Daten neu laden"
            >
              <RefreshCw
                aria-hidden="true"
                className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`}
              />
              <span className="hidden sm:inline">Aktualisieren</span>
            </button>
          )}
        </div>
      </div>
    </section>
  );
};
