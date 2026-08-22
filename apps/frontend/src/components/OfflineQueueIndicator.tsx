import { Inbox, Wifi, WifiOff } from "lucide-react";

// Dauerhaft sichtbarer Hinweis auf Verbindungszustand und Anzahl offener
// Vormerkungen (Issue #65). Farbe trägt nie allein die Aussage: Text und
// Symbol sagen bereits "Online"/"Offline" und "N vorgemerkt" — nie
// verwechselbar mit einer bestätigten Bestellung, die nirgends "vorgemerkt"
// heißt.

export interface OfflineQueueIndicatorProps {
  openCount: number;
  isOnline: boolean;
  onOpen: () => void;
}

export const OfflineQueueIndicator = ({
  openCount,
  isOnline,
  onOpen,
}: OfflineQueueIndicatorProps) => {
  const hasOpenEntries = openCount > 0;
  const connectionLabel = isOnline ? "Online" : "Offline";
  const entriesLabel =
    openCount === 1
      ? "1 lokal vorgemerkte Bestellung, noch nicht vom Server bestätigt"
      : `${openCount} lokal vorgemerkte Bestellungen, noch nicht vom Server bestätigt`;

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Offline-Warteschlange öffnen. ${connectionLabel}. ${
        hasOpenEntries ? entriesLabel : "Keine offenen Vormerkungen."
      }`}
      className={`fixed right-2 top-[70px] z-[60] flex min-h-11 items-center gap-2 rounded-full border px-3 py-2 text-xs font-bold shadow-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900 ${
        hasOpenEntries
          ? "border-amber-400 bg-amber-500 text-slate-950"
          : isOnline
            ? "border-emerald-500/40 bg-slate-900/90 text-emerald-300"
            : "border-rose-500/40 bg-slate-900/90 text-rose-300"
      }`}
    >
      {isOnline ? (
        <Wifi className="h-4 w-4 shrink-0" aria-hidden="true" />
      ) : (
        <WifiOff className="h-4 w-4 shrink-0" aria-hidden="true" />
      )}
      <span>{connectionLabel}</span>
      {hasOpenEntries && (
        <span className="flex items-center gap-1 rounded-full bg-slate-950/15 px-2 py-0.5">
          <Inbox className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {openCount} vorgemerkt
        </span>
      )}
    </button>
  );
};
