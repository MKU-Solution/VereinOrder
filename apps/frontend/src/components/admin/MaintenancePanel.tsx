import { useEffect, useState } from "react";
import { AlertTriangle, PowerOff, Power } from "lucide-react";
import { api } from "../../lib/api";

type MaintenancePhase = "OPEN" | "DRAINING" | "LOCKED";

interface MaintenanceState {
  phase: MaintenancePhase;
  since: string | null;
  byUserId: string | null;
  byUsername: string | null;
  reason: string | null;
  expectedUntil: string | null;
}

const formatTimestamp = (value: string | null) => {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "—" : parsed.toLocaleString("de-AT");
};

const phaseLabel: Record<MaintenancePhase, string> = {
  OPEN: "Normalbetrieb",
  DRAINING: "Wird beendet (DRAINING)",
  LOCKED: "Gesperrt (LOCKED)",
};

/**
 * Issue #67, Stufe 1 (Wartungsmodus): Bedienoberfläche für den einzigen Weg,
 * den Wartungsmodus zu setzen und zu beenden (`POST /maintenance/start` und
 * `POST /maintenance/end`, beide ADMINISTRATOR-only, jede Umschaltung wird
 * auditiert). Ohne diese Oberfläche wäre der Wartungsmodus nur über einen
 * direkten API-Aufruf erreichbar - der Entwurf verlangt ausdrücklich, dass
 * er "für sich allein schon Wert hat".
 */
export function MaintenancePanel() {
  const [state, setState] = useState<MaintenanceState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  const [expectedUntil, setExpectedUntil] = useState("");

  const load = async () => {
    try {
      setLoading(true);
      const res = await api.get<MaintenanceState>("/maintenance");
      setState(res.data);
      setError("");
    } catch (err) {
      console.error("Failed to load maintenance status", err);
      setError("Wartungsstatus konnte nicht geladen werden.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleStart = async () => {
    if (
      !confirm(
        "Wartungsmodus jetzt starten? Neue Bestellungen werden abgewiesen, sobald die Sperre greift.",
      )
    )
      return;
    try {
      setBusy(true);
      setError("");
      await api.post("/maintenance/start", {
        reason: reason.trim() || undefined,
        expectedUntil: expectedUntil
          ? new Date(expectedUntil).toISOString()
          : undefined,
      });
      setReason("");
      setExpectedUntil("");
      await load();
    } catch (err: any) {
      setError(
        err?.response?.data?.message ??
          "Wartungsmodus konnte nicht gestartet werden.",
      );
    } finally {
      setBusy(false);
    }
  };

  const handleEnd = async () => {
    if (!confirm("Wartungsmodus jetzt beenden?")) return;
    try {
      setBusy(true);
      setError("");
      await api.post("/maintenance/end");
      await load();
    } catch (err: any) {
      setError(
        err?.response?.data?.message ??
          "Wartungsmodus konnte nicht beendet werden.",
      );
    } finally {
      setBusy(false);
    }
  };

  if (loading && !state) {
    return <p className="text-slate-400 text-sm">Lade Wartungsstatus…</p>;
  }

  const isActive = state && state.phase !== "OPEN";

  return (
    <div className="space-y-6 max-w-2xl">
      <div
        className={`p-5 rounded-2xl border flex items-start gap-4 ${
          isActive
            ? "bg-amber-950/30 border-amber-800/40"
            : "bg-emerald-950/30 border-emerald-800/40"
        }`}
      >
        <div
          className={`p-3 rounded-2xl border shrink-0 ${
            isActive
              ? "bg-amber-500/20 text-amber-400 border-amber-500/30"
              : "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
          }`}
        >
          {isActive ? (
            <PowerOff className="w-6 h-6" />
          ) : (
            <Power className="w-6 h-6" />
          )}
        </div>
        <div className="space-y-1">
          <h3 className="text-lg font-bold text-white">
            {state ? phaseLabel[state.phase] : "—"}
          </h3>
          {isActive && state && (
            <div className="text-sm text-slate-300 space-y-0.5">
              <p>Seit: {formatTimestamp(state.since)}</p>
              {state.expectedUntil && (
                <p>
                  Voraussichtlich bis: {formatTimestamp(state.expectedUntil)}
                </p>
              )}
              {state.byUsername && <p>Gesetzt von: {state.byUsername}</p>}
              {state.reason && <p>Grund: {state.reason}</p>}
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-2xl bg-rose-950/30 border border-rose-800/40 text-rose-300 text-sm flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          {error}
        </div>
      )}

      {!isActive ? (
        <div className="p-5 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">
              Grund (optional)
            </label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="z. B. Wiederherstellung nach Datenverlust"
              className="w-full px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-slate-100 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">
              Voraussichtliches Ende (optional)
            </label>
            <input
              type="datetime-local"
              value={expectedUntil}
              onChange={(e) => setExpectedUntil(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-slate-100 text-sm"
            />
          </div>
          <button
            type="button"
            onClick={handleStart}
            disabled={busy}
            className="px-4 py-2 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white font-bold text-sm rounded-xl transition flex items-center gap-2"
          >
            <PowerOff className="w-4 h-4" />
            Wartungsmodus starten
          </button>
          <p className="text-xs text-slate-500">
            Beginnt mit DRAINING: neue schreibende Vorgänge werden sofort
            abgewiesen, laufende Druckaufträge dürfen zu Ende laufen. Erst
            danach wechselt das System selbständig nach LOCKED.
          </p>
        </div>
      ) : (
        <div className="p-5 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-3">
          <button
            type="button"
            onClick={handleEnd}
            disabled={busy}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold text-sm rounded-xl transition flex items-center gap-2"
          >
            <Power className="w-4 h-4" />
            Wartungsmodus beenden
          </button>
          <p className="text-xs text-slate-500">
            Jede Kasse lädt danach ihren Betriebskontext neu — Veranstaltung,
            Sitzung und Sortiment können sich zurückbewegt haben.
          </p>
        </div>
      )}
    </div>
  );
}
