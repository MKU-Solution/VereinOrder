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
      className={`flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl border px-2.5 py-2 text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-orange-600 ${
        hasOpenEntries
          ? "border-amber-400 bg-amber-500 text-slate-950"
          : isOnline
            ? "border-white/30 bg-orange-600/60 text-white/90"
            : "border-rose-200 bg-rose-950 text-rose-100"
      }`}
    >
      {isOnline ? (
        <Wifi className="h-4 w-4 shrink-0" aria-hidden="true" />
      ) : (
        <WifiOff className="h-4 w-4 shrink-0" aria-hidden="true" />
      )}
      <span className={hasOpenEntries && isOnline ? "hidden sm:inline" : ""}>
        {connectionLabel}
      </span>
      {hasOpenEntries && (
        <span className="flex items-center gap-1 rounded-full bg-slate-950/15 px-2 py-0.5">
          <Inbox className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="sm:hidden">{openCount} offen</span>
          <span className="hidden sm:inline">{openCount} vorgemerkt</span>
        </span>
      )}
    </button>
  );
};
