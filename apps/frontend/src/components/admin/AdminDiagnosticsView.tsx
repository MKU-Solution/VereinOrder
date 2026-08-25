import { Link } from "react-router-dom";
import {
  Activity,
  AlertOctagon,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Cpu,
  Database,
  Printer,
  RefreshCw,
  Wifi,
} from "lucide-react";

import { formatStorageBytes, formatUptime } from "./adminFormatters";

export interface AdminDiagnosticsViewProps {
  diagnosticsData: any;
  pollingError?: string | null;
  lastUpdated?: Date | null;
  isRetryingFailedJobs?: boolean;
  retryFailedJobsStatus?: { state: string; message: string } | null;
  onRefresh: () => void;
  onRetryFailedJobs: () => void;
  onNavigateToArea?: (tab: string) => void;
}

export const AdminDiagnosticsView = ({
  diagnosticsData,
  pollingError,
  lastUpdated,
  isRetryingFailedJobs = false,
  retryFailedJobsStatus,
  onRefresh,
  onRetryFailedJobs,
  onNavigateToArea,
}: AdminDiagnosticsViewProps) => {
  const overallHealth = diagnosticsData?.overallHealth || "UNKNOWN";

  const getAreaLink = (actionTab?: string) => {
    switch (actionTab) {
      case "printers":
        return "/admin/printers";
      case "backups":
        return "/admin/backups";
      case "maintenance":
        return "/admin/maintenance";
      case "events":
        return "/admin/events";
      case "areas":
        return "/admin/areas";
      case "stations":
        return "/admin/stations";
      case "categories":
        return "/admin/categories";
      case "products":
        return "/admin/products";
      case "users":
        return "/admin/users";
      case "audit":
        return "/admin/audit";
      default:
        return "/admin";
    }
  };

  return (
    <div className="space-y-6">
      {/* Gesamtzustand & Serverzeit */}
      <section
        aria-label="Systemgesundheit"
        className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 rounded-2xl border border-slate-700/80 bg-slate-900/80 p-5 sm:p-6 shadow-lg"
      >
        <div className="flex items-center gap-4">
          <div
            className={`rounded-2xl border p-3.5 shrink-0 ${
              overallHealth === "GREEN"
                ? "border-emerald-500/40 bg-emerald-500/20 text-emerald-400"
                : overallHealth === "YELLOW"
                  ? "border-amber-500/40 bg-amber-500/20 text-amber-400"
                  : "border-rose-500/40 bg-rose-500/20 text-rose-400"
            }`}
          >
            <Activity aria-hidden="true" className="h-7 w-7" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-bold text-slate-100">
                Systemgesundheit:
              </h2>
              <span
                className={`rounded-full border px-3 py-1 text-xs font-extrabold uppercase tracking-wide ${
                  overallHealth === "GREEN"
                    ? "border-emerald-500/30 bg-emerald-500/20 text-emerald-300"
                    : overallHealth === "YELLOW"
                      ? "border-amber-500/30 bg-amber-500/20 text-amber-300"
                      : "border-rose-500/30 bg-rose-500/20 text-rose-300"
                }`}
              >
                {overallHealth === "GREEN"
                  ? "● Bereit für Festbetrieb"
                  : overallHealth === "YELLOW"
                    ? "▲ Handlung empfohlen"
                    : "✖ Systemstörung"}
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-400">
              Serverzeit:{" "}
              {new Date(
                diagnosticsData?.serverTime || Date.now(),
              ).toLocaleString("de-AT")}{" "}
              {lastUpdated && (
                <span>
                  · Aktualisiert vor{" "}
                  {Math.max(
                    0,
                    Math.floor(
                      (Date.now() - new Date(lastUpdated).getTime()) / 1000,
                    ),
                  )}{" "}
                  s
                </span>
              )}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onRefresh}
          className="inline-flex min-h-11 items-center justify-center gap-2 self-stretch sm:self-auto rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-bold text-slate-200 hover:bg-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-200"
        >
          <RefreshCw aria-hidden="true" className="h-4 w-4" />
          Jetzt aktualisieren
        </button>
      </section>

      {/* Polling Fehlerhinweis falls vorhanden */}
      {pollingError && (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-xl border border-rose-500/40 bg-rose-500/15 p-4 text-xs font-bold text-rose-200"
        >
          <AlertTriangle
            aria-hidden="true"
            className="h-4 w-4 shrink-0 text-rose-400"
          />
          <span>{pollingError}</span>
        </div>
      )}

      {/* Handlungsempfehlungen */}
      {diagnosticsData?.recommendations &&
        diagnosticsData.recommendations.length > 0 && (
          <section aria-label="Handlungsempfehlungen" className="space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Handlungsempfehlungen & Hinweise
            </h3>
            <div className="grid grid-cols-1 gap-3">
              {diagnosticsData.recommendations.map((rec: any, idx: number) => (
                <div
                  key={idx}
                  className={`flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 rounded-2xl border p-4 shadow-sm ${
                    rec.level === "SUCCESS"
                      ? "border-emerald-800/40 bg-emerald-950/30 text-emerald-300"
                      : rec.level === "WARNING"
                        ? "border-amber-800/40 bg-amber-950/30 text-amber-300"
                        : rec.level === "ERROR"
                          ? "border-rose-800/40 bg-rose-950/30 text-rose-300"
                          : "border-indigo-800/40 bg-indigo-950/30 text-indigo-300"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    {rec.level === "SUCCESS" ? (
                      <CheckCircle2
                        aria-hidden="true"
                        className="h-5 w-5 mt-0.5 shrink-0 text-emerald-400"
                      />
                    ) : rec.level === "ERROR" ? (
                      <AlertOctagon
                        aria-hidden="true"
                        className="h-5 w-5 mt-0.5 shrink-0 text-rose-400"
                      />
                    ) : (
                      <AlertTriangle
                        aria-hidden="true"
                        className="h-5 w-5 mt-0.5 shrink-0 text-amber-400"
                      />
                    )}
                    <div>
                      <div className="font-bold text-sm text-slate-100">
                        {rec.title}
                      </div>
                      <div className="mt-0.5 text-xs text-slate-300">
                        {rec.message}
                      </div>
                    </div>
                  </div>

                  {rec.actionTab && (
                    <Link
                      to={getAreaLink(rec.actionTab)}
                      onClick={() =>
                        onNavigateToArea && onNavigateToArea(rec.actionTab)
                      }
                      className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-900/90 px-4 py-2 text-xs font-bold text-white hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-200"
                    >
                      Öffnen{" "}
                      <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
                    </Link>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

      {/* 4 Detail Grid Tiles */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
        {/* 1. Backend & Host-System */}
        <section
          aria-label="Backend und Host"
          className="rounded-2xl border border-slate-700/80 bg-slate-900/80 p-5 shadow-lg space-y-4"
        >
          <div className="flex items-center gap-3">
            <div className="rounded-xl border border-blue-500/30 bg-blue-500/20 p-2.5 text-blue-400">
              <Cpu aria-hidden="true" className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-bold text-slate-100">
                Backend & Host-System
              </h3>
              <span className="text-xs text-slate-400">
                Node.js Runtime & Speicherauslastung
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 font-mono text-xs">
            <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3">
              <span className="block text-slate-400 font-sans mb-1">
                Betriebsbereit seit (Uptime)
              </span>
              <span className="font-bold text-slate-200">
                {diagnosticsData?.backend?.uptimeSeconds != null
                  ? formatUptime(diagnosticsData.backend.uptimeSeconds)
                  : diagnosticsData?.backend?.uptime != null
                    ? formatUptime(diagnosticsData.backend.uptime)
                    : "–"}
              </span>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3">
              <span className="block text-slate-400 font-sans mb-1">
                Node & App Version
              </span>
              <span className="font-bold text-slate-200">
                {diagnosticsData?.backend?.nodeVersion ?? "–"} (v
                {diagnosticsData?.backend?.appVersion ?? "–"})
              </span>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3">
              <span className="block text-slate-400 font-sans mb-1">
                RAM Belegung (RSS)
              </span>
              <span className="font-bold text-slate-200">
                {diagnosticsData?.backend?.memory?.rssMb ?? "–"} MB
              </span>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3">
              <span className="block text-slate-400 font-sans mb-1">
                Node.js Heap
              </span>
              <span className="font-bold text-slate-200">
                {diagnosticsData?.backend?.memory?.heapUsedMb ?? "–"} MB /{" "}
                {diagnosticsData?.backend?.memory?.heapTotalMb ?? "–"} MB
              </span>
            </div>
          </div>
        </section>

        {/* 2. Datenbank & PostgreSQL */}
        <section
          aria-label="Datenbank und PostgreSQL"
          className="rounded-2xl border border-slate-700/80 bg-slate-900/80 p-5 shadow-lg space-y-4"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/20 p-2.5 text-emerald-400">
                <Database aria-hidden="true" className="h-5 w-5" />
              </div>
              <div>
                <h3 className="font-bold text-slate-100">
                  Datenbank & PostgreSQL
                </h3>
                <span className="text-xs text-slate-400">
                  Integrität & Speichervolumen
                </span>
              </div>
            </div>

            <span
              className={`rounded-full border px-2.5 py-0.5 text-xs font-bold ${
                diagnosticsData?.database?.connected ||
                diagnosticsData?.database?.status === "ONLINE"
                  ? "border-emerald-500/30 bg-emerald-500/20 text-emerald-300"
                  : "border-rose-500/30 bg-rose-500/20 text-rose-300"
              }`}
            >
              {diagnosticsData?.database?.connected ||
              diagnosticsData?.database?.status === "ONLINE"
                ? "Verbunden"
                : "Getrennt"}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2 font-mono text-xs">
            <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3">
              <span className="block text-slate-400 font-sans mb-1">
                Datenbankgröße
              </span>
              <span className="font-bold text-slate-200">
                {diagnosticsData?.database?.databaseSize ??
                  (diagnosticsData?.database?.counts
                    ? `${diagnosticsData.database.counts.orders ?? 0} Bestellungen`
                    : "–")}
              </span>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3">
              <span className="block text-slate-400 font-sans mb-1">
                Verbindungspool
              </span>
              <span className="font-bold text-slate-200">
                {diagnosticsData?.database?.poolActiveConnections ?? 0} aktiv /{" "}
                {diagnosticsData?.database?.poolTotalConnections ?? 0} max
              </span>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3 col-span-2 space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <span className="block text-slate-400 font-sans mb-1">
                    Sicherungsspeicher & Prüfstand
                  </span>
                  <div className="space-y-1 text-xs">
                    <div>
                      <span className="text-slate-400 font-sans">
                        Freier Speicher
                      </span>
                      <span>: </span>
                      <span className="font-bold text-slate-200">
                        {diagnosticsData?.backup?.storage?.freeBytes != null
                          ? formatStorageBytes(
                              diagnosticsData.backup.storage.freeBytes,
                            )
                          : diagnosticsData?.backups?.storageUsedBytes != null
                            ? formatStorageBytes(
                                diagnosticsData.backups.storageUsedBytes,
                              )
                            : "–"}
                      </span>
                    </div>
                    {diagnosticsData?.backup?.storage?.retention
                      ?.minFreeBytes != null && (
                      <div className="text-slate-400 font-sans">
                        Rücklage:{" "}
                        <span className="font-bold text-slate-200">
                          {formatStorageBytes(
                            diagnosticsData.backup.storage.retention
                              .minFreeBytes,
                          )}
                        </span>
                      </div>
                    )}
                    <div className="text-slate-400 font-sans">
                      Letzte Wiederherstellungsprüfung:{" "}
                      <span className="font-bold text-slate-200">
                        {diagnosticsData?.backup?.storage?.latestRestoredBackup
                          ?.filename ||
                          diagnosticsData?.backup?.latestRestoredBackup ||
                          "noch nicht durchgeführt"}
                      </span>
                    </div>
                  </div>
                </div>
                <Link
                  to="/admin/backups"
                  className="inline-flex min-h-10 items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-bold text-slate-200 hover:bg-slate-700 self-start"
                >
                  Zu Backups
                </Link>
              </div>
            </div>
          </div>
        </section>

        {/* 3. Drucker-Infrastruktur */}
        <section
          aria-label="Drucker-Infrastruktur"
          className="rounded-2xl border border-slate-700/80 bg-slate-900/80 p-5 shadow-lg space-y-4"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/20 p-2.5 text-indigo-400">
                <Printer aria-hidden="true" className="h-5 w-5" />
              </div>
              <div>
                <h3 className="font-bold text-slate-100">
                  Drucker-Infrastruktur
                </h3>
                <span className="text-xs text-slate-400">
                  Warteschlange & Druckzustellung
                </span>
              </div>
            </div>

            <Link
              to="/admin/printers"
              className="inline-flex min-h-10 items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-bold text-slate-200 hover:bg-slate-700"
            >
              Zu Druckern
            </Link>
          </div>

          <div className="grid grid-cols-2 gap-2 font-mono text-xs">
            <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3">
              <span className="block text-slate-400 font-sans mb-1">
                Drucker aktiv
              </span>
              <span className="font-bold text-slate-200">
                {diagnosticsData?.printers?.activePrinters ??
                  diagnosticsData?.printers?.active ??
                  0}{" "}
                von{" "}
                {diagnosticsData?.printers?.totalConfiguredPrinters ??
                  diagnosticsData?.printers?.total ??
                  0}
              </span>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3">
              <span className="block text-slate-400 font-sans mb-1">
                Druck-Warteschlange
              </span>
              <span className="font-bold text-slate-200">
                {diagnosticsData?.printers?.pendingPrintJobs ??
                  diagnosticsData?.printers?.queue?.pending ??
                  0}{" "}
                anstehend
              </span>
            </div>

            {(diagnosticsData?.printers?.failedPrintJobs ??
              diagnosticsData?.printers?.queue?.failed ??
              0) > 0 && (
              <div className="col-span-2 rounded-xl border border-rose-500/30 bg-rose-500/15 p-3 font-sans space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-rose-300">
                    {diagnosticsData?.printers?.failedPrintJobs ??
                      diagnosticsData?.printers?.queue?.failed}{" "}
                    fehlgeschlagene Druckjobs
                  </span>
                  <button
                    type="button"
                    disabled={isRetryingFailedJobs}
                    onClick={onRetryFailedJobs}
                    className="inline-flex min-h-9 items-center gap-1 rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-rose-500 disabled:opacity-50"
                  >
                    <RefreshCw aria-hidden="true" className="h-3.5 w-3.5" />
                    {isRetryingFailedJobs ? "Wiederhole …" : "Erneut versuchen"}
                  </button>
                </div>
                {retryFailedJobsStatus && (
                  <p className="text-xs text-rose-200 font-mono">
                    {retryFailedJobsStatus.message}
                  </p>
                )}
              </div>
            )}
          </div>
        </section>

        {/* 4. Offline-Synchronisation & Kassenbetrieb */}
        <section
          aria-label="Offline-Synchronisation"
          className="rounded-2xl border border-slate-700/80 bg-slate-900/80 p-5 shadow-lg space-y-4"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/20 p-2.5 text-amber-400">
                <Wifi aria-hidden="true" className="h-5 w-5" />
              </div>
              <div>
                <h3 className="font-bold text-slate-100">
                  Kassen & Offline-Betrieb
                </h3>
                <span className="text-xs text-slate-400">
                  Lokaler Festbetrieb & Warteschlange
                </span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 font-mono text-xs">
            <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3">
              <span className="block text-slate-400 font-sans mb-1">
                Aktive Sitzungen
              </span>
              <span className="font-bold text-slate-200">
                {diagnosticsData?.sessions?.activeSessionsCount ?? 0} Kassen
              </span>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3">
              <span className="block text-slate-400 font-sans mb-1">
                Offline-Warteschlange
              </span>
              <span className="font-bold text-slate-200">
                {diagnosticsData?.offline?.queueCount ?? 0} Aufträge
              </span>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};
