import type { ReactNode } from "react";
import {
  FilterX,
  FolderPlus,
  Plus,
  RotateCcw,
  type LucideIcon,
} from "lucide-react";

export interface AdminEmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  isFiltered?: boolean;
  onResetFilters?: () => void;
  children?: ReactNode;
}

export const AdminEmptyState = ({
  icon: Icon = FolderPlus,
  title,
  description,
  actionLabel,
  onAction,
  isFiltered = false,
  onResetFilters,
  children,
}: AdminEmptyStateProps) => {
  if (isFiltered) {
    return (
      <div
        role="status"
        className="flex flex-col items-center justify-center rounded-2xl border border-slate-700/60 bg-slate-900/40 px-6 py-12 text-center"
      >
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-slate-700 bg-slate-800 text-slate-400">
          <FilterX aria-hidden="true" className="h-6 w-6" />
        </div>
        <h3 className="mt-4 text-base font-bold text-slate-100">
          Keine passenden Einträge gefunden
        </h3>
        <p className="mt-1.5 max-w-md text-sm leading-5 text-slate-400">
          Für die aktuellen Such- und Filterkriterien liegen keine Einträge vor.
        </p>
        {onResetFilters && (
          <button
            type="button"
            onClick={onResetFilters}
            className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-[10px] border border-slate-700 bg-slate-800 px-4 py-2 text-sm font-bold text-slate-200 transition-colors hover:bg-slate-700 hover:text-white focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-amber-200"
          >
            <RotateCcw aria-hidden="true" className="h-4 w-4" />
            Filter & Suche zurücksetzen
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      role="status"
      className="flex flex-col items-center justify-center rounded-2xl border border-slate-700/60 bg-slate-900/40 px-6 py-12 text-center"
    >
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-indigo-500/30 bg-indigo-500/10 text-indigo-300">
        <Icon aria-hidden="true" className="h-7 w-7" />
      </div>
      <h3 className="mt-4 text-lg font-bold text-slate-100">{title}</h3>
      <p className="mt-1.5 max-w-lg text-sm leading-6 text-slate-300">
        {description}
      </p>
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-[10px] bg-indigo-600 px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-indigo-950/40 transition-colors hover:bg-indigo-500 focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-amber-200"
        >
          <Plus aria-hidden="true" className="h-4 w-4" />
          {actionLabel}
        </button>
      )}
      {children}
    </div>
  );
};
