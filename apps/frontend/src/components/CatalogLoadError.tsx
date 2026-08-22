import { RefreshCw, WifiOff } from "lucide-react";

// Ersetzt die leere Kachelfläche der Bestellaufnahme, wenn der
// Produktkatalog nicht geladen werden konnte (Issue #90). Ohne diesen
// Hinweis zeigt die Kasse nach einem Serverausfall nur die Kategorieleiste
// und keine einzige Produktkachel, ohne dass ersichtlich wäre, warum — genau
// das fiel bei der Abnahme zu #65 auf. Die Anwendung versucht im Hintergrund
// selbst mit wachsendem Abstand erneut (siehe Dashboard.tsx); die
// Schaltfläche hier erlaubt zusätzlich einen sofortigen Versuch von Hand.

export interface CatalogLoadErrorProps {
  onRetry: () => void;
  isRetrying: boolean;
}

export const CatalogLoadError = ({
  onRetry,
  isRetrying,
}: CatalogLoadErrorProps) => (
  <div
    role="alert"
    className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-slate-300"
  >
    <WifiOff className="h-8 w-8 text-rose-400" aria-hidden="true" />
    <p className="max-w-xs text-sm font-semibold">
      Produktkatalog konnte nicht geladen werden. Die Anwendung versucht es
      automatisch erneut, sobald der Server wieder erreichbar ist.
    </p>
    <button
      type="button"
      onClick={onRetry}
      disabled={isRetrying}
      className="flex items-center gap-2 rounded-xl bg-orange-500 px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-60"
    >
      <RefreshCw
        className={`h-4 w-4 ${isRetrying ? "animate-spin" : ""}`}
        aria-hidden="true"
      />
      {isRetrying ? "Wird erneut versucht…" : "Erneut versuchen"}
    </button>
  </div>
);
