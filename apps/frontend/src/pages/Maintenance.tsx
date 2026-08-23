import { PowerOff } from "lucide-react";
import type { MaintenanceStatus } from "../lib/maintenance";

interface MaintenanceProps {
  status: MaintenanceStatus;
}

const formatTimestamp = (value: string | null) => {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleString("de-AT");
};

/**
 * Ganzseitige Anzeige während des Wartungsmodus (Entwurf Abschnitt 6):
 * "Wartung läuft, seit …, voraussichtlich bis …". Wird von `AppLayout`
 * gerendert, sobald die Phase nicht mehr OPEN ist und die angemeldete
 * Person nicht ADMINISTRATOR ist (für ADMINISTRATOR bleibt `/admin`
 * bedienbar).
 */
export const Maintenance = ({ status }: MaintenanceProps) => {
  const since = formatTimestamp(status.since);
  const expectedUntil = formatTimestamp(status.expectedUntil);

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center px-4">
      <div className="max-w-md w-full glass rounded-2xl p-8 text-center space-y-4">
        <div className="mx-auto w-14 h-14 rounded-2xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center">
          <PowerOff className="w-7 h-7 text-amber-400" />
        </div>
        <h1 className="text-xl font-bold text-white">Wartung läuft</h1>
        <p className="text-sm text-slate-300">
          Das System ist vorübergehend nicht verfügbar. Bitte warten Sie, bis
          die Wartung abgeschlossen ist — diese Seite aktualisiert sich von
          selbst.
        </p>
        <div className="text-xs text-slate-400 space-y-1">
          {since && <p>Wartung läuft seit {since}</p>}
          {expectedUntil && <p>Voraussichtlich bis {expectedUntil}</p>}
        </div>
      </div>
    </div>
  );
};
