import type { ReactNode } from "react";

import type { AdminAreaId } from "./adminAreaRegistry";

interface AdminAreaStateProps {
  area: AdminAreaId;
  isLoading: boolean;
  error: string | null;
  children: ReactNode;
  onRetry: () => void;
}

/**
 * Gemeinsamer, bewusst kleiner Zustandsvertrag aller Verwaltungsbereiche.
 * Die Fachansicht bleibt im jeweiligen Bereich; Lade- und Fehlerdarstellung
 * verhalten sich dadurch überall gleich und sind unabhängig testbar.
 */
export const AdminAreaState = ({
  area,
  isLoading,
  error,
  children,
  onRetry,
}: AdminAreaStateProps) => (
  <section data-admin-area={area} aria-busy={isLoading}>
    {isLoading ? (
      <div
        role="status"
        className="py-12 text-center text-slate-400 animate-pulse"
      >
        Lade Daten...
      </div>
    ) : error ? (
      <div
        role="alert"
        className="flex flex-col items-center gap-3 rounded-2xl border border-rose-500/30 bg-rose-500/10 px-5 py-8 text-center text-rose-200"
      >
        <p>{error}</p>
        <button
          type="button"
          onClick={onRetry}
          className="min-h-11 rounded-xl bg-rose-500/20 px-4 py-2 font-bold hover:bg-rose-500/30"
        >
          Erneut versuchen
        </button>
      </div>
    ) : (
      children
    )}
  </section>
);
