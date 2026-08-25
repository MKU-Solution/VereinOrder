import { useMemo, useState } from "react";
import {
  AlertTriangle,
  Download,
  FileSpreadsheet,
  Key,
  Shield,
  User,
} from "lucide-react";

import { AdminEmptyState } from "./AdminEmptyState";
import { AdminToolbar } from "./AdminToolbar";

export interface AdminAuditViewProps {
  auditLogs: any[];
  auditStats?: any;
  isRefreshing?: boolean;
  isExporting?: boolean;
  onRefresh: () => void;
  onExportCsv: () => void;
}

const getActionLabel = (
  action: string,
): { label: string; badgeClass: string } => {
  switch (action) {
    case "LOGIN":
      return {
        label: "Anmeldung",
        badgeClass: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
      };
    case "FAILED_LOGIN":
      return {
        label: "Fehlgeschlagener Login",
        badgeClass: "bg-rose-500/20 text-rose-300 border-rose-500/30",
      };
    case "CANCEL_ORDER":
      return {
        label: "Bestellung storniert",
        badgeClass: "bg-rose-500/20 text-rose-300 border-rose-500/30",
      };
    case "CANCEL_ORDER_ITEM":
      return {
        label: "Position storniert",
        badgeClass: "bg-amber-500/20 text-amber-300 border-amber-500/30",
      };
    case "PRICE_CHANGED":
      return {
        label: "Preisänderung",
        badgeClass: "bg-indigo-500/20 text-indigo-300 border-indigo-500/30",
      };
    case "PAYMENT_RECEIVED":
      return {
        label: "Zahlung verbucht",
        badgeClass: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
      };
    case "ACTIVATE_EVENT_RKSV":
      return {
        label: "RKSV Scharfschaltung",
        badgeClass: "bg-purple-500/20 text-purple-300 border-purple-500/30",
      };
    case "REPRINT_ORDER":
      return {
        label: "Nachdruck Bon",
        badgeClass: "bg-blue-500/20 text-blue-300 border-blue-500/30",
      };
    default:
      return {
        label: action,
        badgeClass: "bg-slate-800 text-slate-300 border-slate-700",
      };
  }
};

export const AdminAuditView = ({
  auditLogs,
  auditStats,
  isRefreshing = false,
  isExporting = false,
  onRefresh,
  onExportCsv,
}: AdminAuditViewProps) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [actionFilter, setActionFilter] = useState("ALL");

  const filteredLogs = useMemo(() => {
    return auditLogs.filter((log) => {
      const q = searchQuery.trim().toLowerCase();
      const username = (log.user?.username || log.username || "").toLowerCase();
      const action = (log.action || "").toLowerCase();
      const details =
        typeof log.details === "string"
          ? log.details.toLowerCase()
          : JSON.stringify(log.details || {}).toLowerCase();

      const matchesSearch =
        !q || username.includes(q) || action.includes(q) || details.includes(q);

      const matchesAction =
        actionFilter === "ALL" || log.action === actionFilter;

      return matchesSearch && matchesAction;
    });
  }, [auditLogs, searchQuery, actionFilter]);

  const isFiltered = searchQuery.trim().length > 0 || actionFilter !== "ALL";

  const handleResetFilters = () => {
    setSearchQuery("");
    setActionFilter("ALL");
  };

  const actionFilterSelect = (
    <div className="flex items-center gap-2">
      <label htmlFor="admin-audit-action-filter" className="sr-only">
        Aktion filtern
      </label>
      <select
        id="admin-audit-action-filter"
        value={actionFilter}
        onChange={(e) => setActionFilter(e.target.value)}
        className="min-h-11 rounded-xl border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-bold text-slate-200 transition-colors hover:border-slate-600 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-400/30"
      >
        <option value="ALL">Alle Aktionen</option>
        <option value="LOGIN">Anmeldungen (LOGIN)</option>
        <option value="FAILED_LOGIN">Fehlgeschlagene Logins</option>
        <option value="CANCEL_ORDER">Bestellstornos</option>
        <option value="CANCEL_ORDER_ITEM">Positionstornos</option>
        <option value="PRICE_CHANGED">Preisänderungen</option>
        <option value="PAYMENT_RECEIVED">Zahlungen</option>
        <option value="ACTIVATE_EVENT_RKSV">RKSV Scharfschaltung</option>
      </select>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Kennzahlen-Übersicht */}
      <section
        aria-label="Audit-Kennzahlen"
        className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4"
      >
        <div className="rounded-2xl border border-slate-700/80 bg-slate-900/80 p-4 shadow-lg">
          <div className="flex items-center gap-2 text-slate-400 text-xs font-semibold mb-1">
            <Shield aria-hidden="true" className="h-4 w-4 text-indigo-400" />
            <span>Gesamteinträge</span>
          </div>
          <div className="font-mono text-xl font-bold text-slate-100">
            {auditStats?.totalLogs ?? auditLogs.length}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-700/80 bg-slate-900/80 p-4 shadow-lg">
          <div className="flex items-center gap-2 text-slate-400 text-xs font-semibold mb-1">
            <AlertTriangle
              aria-hidden="true"
              className="h-4 w-4 text-rose-400"
            />
            <span>Stornos</span>
          </div>
          <div className="font-mono text-xl font-bold text-rose-300">
            {auditStats?.cancelCount ??
              auditLogs.filter((l) => l.action?.startsWith("CANCEL_")).length}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-700/80 bg-slate-900/80 p-4 shadow-lg">
          <div className="flex items-center gap-2 text-slate-400 text-xs font-semibold mb-1">
            <FileSpreadsheet
              aria-hidden="true"
              className="h-4 w-4 text-amber-400"
            />
            <span>Preisänderungen</span>
          </div>
          <div className="font-mono text-xl font-bold text-amber-300">
            {auditStats?.priceChangeCount ??
              auditLogs.filter((l) => l.action === "PRICE_CHANGED").length}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-700/80 bg-slate-900/80 p-4 shadow-lg">
          <div className="flex items-center gap-2 text-slate-400 text-xs font-semibold mb-1">
            <Key aria-hidden="true" className="h-4 w-4 text-emerald-400" />
            <span>Sicherheits-Events</span>
          </div>
          <div className="font-mono text-xl font-bold text-emerald-300">
            {auditStats?.securityEventCount ??
              auditLogs.filter((l) =>
                ["LOGIN", "FAILED_LOGIN", "ACTIVATE_EVENT_RKSV"].includes(
                  l.action,
                ),
              ).length}
          </div>
        </div>
      </section>

      {/* Toolbar & Export */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex-1">
          <AdminToolbar
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            searchPlaceholder="Benutzer, Aktion oder Details suchen …"
            searchLabel="Audit-Protokoll durchsuchen"
            totalCount={auditLogs.length}
            filteredCount={filteredLogs.length}
            isRefreshing={isRefreshing}
            onRefresh={onRefresh}
            filters={actionFilterSelect}
          />
        </div>

        <button
          type="button"
          disabled={isExporting}
          onClick={onExportCsv}
          className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-indigo-500/30 bg-indigo-600/20 px-4 py-2 text-xs font-bold text-indigo-300 hover:bg-indigo-600/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-200 disabled:opacity-50"
        >
          <Download aria-hidden="true" className="h-4 w-4" />
          {isExporting ? "Export läuft …" : "CSV exportieren"}
        </button>
      </div>

      {/* Audit Logs Liste */}
      {filteredLogs.length === 0 ? (
        <AdminEmptyState
          icon={Shield}
          title="Keine Audit-Einträge gefunden"
          description="Es liegen noch keine revisionssicheren Protokolleinträge für diesen Filter vor."
          isFiltered={isFiltered && auditLogs.length > 0}
          onResetFilters={handleResetFilters}
        />
      ) : (
        <div className="space-y-3">
          {/* Desktop & Tablet Table */}
          <div className="hidden overflow-hidden rounded-2xl border border-slate-700/80 bg-slate-900/60 shadow-lg md:block">
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-slate-700/80 bg-slate-800/60 text-xs font-bold uppercase tracking-wider text-slate-400">
                    <th className="px-5 py-3.5">Zeitpunkt</th>
                    <th className="px-4 py-3.5">Benutzer</th>
                    <th className="px-4 py-3.5">Aktion</th>
                    <th className="px-4 py-3.5">Details</th>
                    <th className="px-5 py-3.5 text-right">IP / Quelle</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/80 text-sm">
                  {filteredLogs.map((log) => {
                    const actionInfo = getActionLabel(log.action);
                    const formattedDetails =
                      typeof log.details === "object" && log.details !== null
                        ? JSON.stringify(log.details, null, 1)
                        : String(log.details || "–");

                    return (
                      <tr
                        key={log.id}
                        className="transition-colors hover:bg-slate-800/40"
                      >
                        <td className="px-5 py-4 font-mono text-xs text-slate-300 whitespace-nowrap">
                          {new Date(log.createdAt).toLocaleString("de-AT")}
                        </td>
                        <td className="px-4 py-4 font-semibold text-slate-100 text-xs">
                          <div className="flex items-center gap-1.5">
                            <User
                              aria-hidden="true"
                              className="h-3.5 w-3.5 text-slate-400"
                            />
                            <span>
                              {log.user?.username || log.username || "System"}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-4 text-xs">
                          <span
                            className={`inline-flex items-center rounded-md border px-2 py-0.5 font-bold ${actionInfo.badgeClass}`}
                          >
                            {actionInfo.label}
                          </span>
                        </td>
                        <td className="px-4 py-4 font-mono text-xs text-slate-300 max-w-md break-all">
                          <div className="max-h-24 overflow-y-auto pr-1">
                            {formattedDetails}
                          </div>
                        </td>
                        <td className="px-5 py-4 text-right font-mono text-xs text-slate-400 whitespace-nowrap">
                          {log.ipAddress || log.source || "Lokal"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Mobile Card View (390×844) */}
          <div className="space-y-3 md:hidden">
            {filteredLogs.map((log) => {
              const actionInfo = getActionLabel(log.action);
              const formattedDetails =
                typeof log.details === "object" && log.details !== null
                  ? JSON.stringify(log.details, null, 1)
                  : String(log.details || "–");

              return (
                <article
                  key={log.id}
                  className="space-y-3 rounded-2xl border border-slate-700/80 bg-slate-900/80 p-4 shadow-md text-xs"
                >
                  <div className="flex items-start justify-between gap-2 border-b border-slate-800 pb-2">
                    <span
                      className={`rounded-md border px-2 py-0.5 font-bold ${actionInfo.badgeClass}`}
                    >
                      {actionInfo.label}
                    </span>
                    <span className="font-mono text-slate-400 text-2xs">
                      {new Date(log.createdAt).toLocaleString("de-AT")}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-slate-300">
                    <div className="flex items-center gap-1.5 font-bold text-slate-100">
                      <User
                        aria-hidden="true"
                        className="h-3.5 w-3.5 text-slate-400"
                      />
                      <span>
                        {log.user?.username || log.username || "System"}
                      </span>
                    </div>
                    <span className="font-mono text-slate-400">
                      IP: {log.ipAddress || log.source || "Lokal"}
                    </span>
                  </div>

                  <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-2.5 font-mono text-slate-300 max-h-32 overflow-y-auto">
                    {formattedDetails}
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
