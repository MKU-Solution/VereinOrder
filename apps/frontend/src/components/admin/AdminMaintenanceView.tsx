import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Activity,
  AlertTriangle,
  Database,
  Power,
  PowerOff,
  RefreshCw,
} from "lucide-react";

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
  OPEN: "Normalbetrieb (Kassen & Festbetrieb aktiv)",
  DRAINING: "Wird beendet (DRAINING)",
  LOCKED: "Wartungssperre aktiv (Kassen gesperrt)",
};

export function AdminMaintenanceView() {
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
        "Wartungsmodus jetzt starten? Neue Bestellungen werden abgewiesen, sobald die Sperre greift. Administratoren behalten vollen Zugriff.",
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
    if (
      !confirm(
        "Wartungsmodus jetzt beenden und regulären Festbetrieb freigeben?",
      )
    )
      return;
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

  const isActive = state && state.phase !== "OPEN";

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Statuskarte */}
      <section
        aria-label="Wartungszustand"
        className={`rounded-2xl border p-5 sm:p-6 shadow-lg transition-colors ${
          isActive
            ? "border-rose-500/40 bg-rose-950/20"
            : "border-emerald-500/40 bg-emerald-950/20"
        }`}
      >
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <div
              className={`rounded-2xl border p-3 shrink-0 ${
                isActive
                  ? "border-rose-500/40 bg-rose-500/20 text-rose-400"
                  : "border-emerald-500/40 bg-emerald-500/20 text-emerald-400"
              }`}
            >
              {isActive ? (
                <PowerOff aria-hidden="true" className="h-7 w-7" />
              ) : (
                <Power aria-hidden="true" className="h-7 w-7" />
              )}
            </div>

            <div className="space-y-1.5 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-bold text-slate-100">
                  {state ? phaseLabel[state.phase] : "Lade Status …"}
                </h2>
                <span
                  className={`rounded-full border px-2.5 py-0.5 text-xs font-extrabold uppercase tracking-wide ${
                    isActive
                      ? "border-rose-500/40 bg-rose-500/20 text-rose-300"
                      : "border-emerald-500/40 bg-emerald-500/20 text-emerald-300"
                  }`}
                >
                  {isActive ? "Gesperrt" : "Aktiv"}
                </span>
              </div>

              {isActive && state && (
                <div className="space-y-1 text-xs text-slate-300 font-mono">
                  <p>Aktiv seit: {formatTimestamp(state.since)}</p>
                  {state.expectedUntil && (
                    <p>
                      Voraussichtlich bis:{" "}
                      {formatTimestamp(state.expectedUntil)}
                    </p>
                  )}
                  {state.byUsername && <p>Aktiviert von: {state.byUsername}</p>}
                  {state.reason && (
                    <p className="text-amber-200 font-sans mt-1">
                      Grund: „{state.reason}“
                    </p>
                  )}
                </div>
              )}

              {!isActive && (
                <p className="text-xs text-slate-300">
                  Bestellungen, Kassen und Kellnergeräte sind uneingeschränkt
                  betriebsbereit.
                </p>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="inline-flex min-h-11 items-center justify-center gap-1.5 self-start rounded-xl border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-bold text-slate-200 hover:bg-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-200"
            title="Status aktualisieren"
          >
            <RefreshCw
              aria-hidden="true"
              className={`h-4 w-4 ${loading ? "animate-spin" : ""}`}
            />
            Aktualisieren
          </button>
        </div>
      </section>

      {/* Fehlermeldung */}
      {error && (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-xl border border-rose-500/40 bg-rose-500/15 p-4 text-xs font-bold text-rose-200"
        >
          <AlertTriangle
            aria-hidden="true"
            className="h-4 w-4 shrink-0 text-rose-400"
          />
          <span>{error}</span>
        </div>
      )}

      {/* Steuerungs-Panel */}
      <section
        aria-label="Wartungssteuerung"
        className="rounded-2xl border border-slate-700/80 bg-slate-900/80 p-5 sm:p-6 shadow-lg space-y-4"
      >
        <h3 className="text-sm font-bold text-slate-100 uppercase tracking-wider">
          {isActive ? "Wartungsmodus beenden" : "Wartungsmodus aktivieren"}
        </h3>

        {isActive ? (
          <div className="space-y-4">
            <p className="text-xs text-slate-300 leading-relaxed">
              Beim Beenden des Wartungsmodus wird der Festbetrieb sofort wieder
              freigegeben. Kellner und Kassen können wieder Bestellungen
              aufnehmen.
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={handleEnd}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-xs font-bold text-white shadow-lg shadow-emerald-950/40 hover:bg-emerald-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-200 disabled:opacity-50"
            >
              <Power aria-hidden="true" className="h-4 w-4" />
              {busy ? "Beende Wartungsmodus …" : "Wartungsmodus jetzt beenden"}
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-xs text-slate-300 leading-relaxed">
              Im Wartungsmodus werden neue Bestellungen blockiert.
              Administratoren behalten vollen Zugriff auf das Verwaltungsportal.
            </p>

            <div className="space-y-3">
              <div>
                <label
                  htmlFor="admin-maintenance-reason"
                  className="block text-xs font-bold text-slate-300 mb-1"
                >
                  Begründung für Wartung (optional)
                </label>
                <input
                  id="admin-maintenance-reason"
                  type="text"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="z. B. Datenbank-Wiederherstellung oder Software-Aktualisierung"
                  className="w-full min-h-11 rounded-xl border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-medium text-slate-100 placeholder-slate-500 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-400/30"
                />
              </div>

              <div>
                <label
                  htmlFor="admin-maintenance-until"
                  className="block text-xs font-bold text-slate-300 mb-1"
                >
                  Voraussichtlich bis (optional)
                </label>
                <input
                  id="admin-maintenance-until"
                  type="datetime-local"
                  value={expectedUntil}
                  onChange={(e) => setExpectedUntil(e.target.value)}
                  className="w-full min-h-11 rounded-xl border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-medium text-slate-100 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-400/30"
                />
              </div>
            </div>

            <button
              type="button"
              disabled={busy}
              onClick={handleStart}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-amber-600 px-5 py-2.5 text-xs font-bold text-white shadow-lg shadow-amber-950/40 hover:bg-amber-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-200 disabled:opacity-50"
            >
              <PowerOff aria-hidden="true" className="h-4 w-4" />
              {busy ? "Starte Wartungsmodus …" : "Wartungsmodus starten"}
            </button>
          </div>
        )}
      </section>

      {/* Querverweise */}
      <section
        aria-label="Verwandte Systembereiche"
        className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 sm:p-5 text-xs text-slate-400 space-y-2.5"
      >
        <h4 className="font-bold text-slate-300 uppercase tracking-wider">
          Verwandte Verwaltungsbereiche
        </h4>
        <div className="flex flex-wrap gap-2.5">
          <Link
            to="/admin/diagnostics"
            className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-3.5 py-2 font-bold text-slate-200 hover:bg-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-200"
          >
            <Activity aria-hidden="true" className="h-4 w-4 text-indigo-400" />
            Systemstatus & Diagnose
          </Link>
          <Link
            to="/admin/backups"
            className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-3.5 py-2 font-bold text-slate-200 hover:bg-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-200"
          >
            <Database aria-hidden="true" className="h-4 w-4 text-emerald-400" />
            Datensicherungen & Restore
          </Link>
        </div>
      </section>
    </div>
  );
}

export const MaintenancePanel = AdminMaintenanceView;
