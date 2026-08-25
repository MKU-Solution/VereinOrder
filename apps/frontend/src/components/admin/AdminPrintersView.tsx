import { useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Edit2,
  Printer,
  RotateCcw,
  Trash2,
} from "lucide-react";

import { AdminEmptyState } from "./AdminEmptyState";
import { AdminToolbar } from "./AdminToolbar";
import {
  describeJobType,
  describeUnresolvedReason,
  formatClockTime,
  formatMinutesAgoLong,
} from "./printerAdminModel";

export interface AdminPrintersViewProps {
  printers: any[];
  unresolvedJobs: any[];
  printerTests: Record<string, { state: string; message: string }>;
  canDiscardPrintJobs?: boolean;
  justResolvedIds?: Record<
    string,
    { tone: "ok" | "reprint" | "discard"; text: string }
  >;
  isRefreshing?: boolean;
  onRefresh: () => void;
  onOpenCreate: () => void;
  onEdit: (printer: any) => void;
  onDelete?: (id: string) => void;
  onTestPrint: (printerId: string) => void;
  onOpenResolveDialog: (
    job: any,
    resolution: "CONFIRMED_PRINTED" | "REPRINTED" | "DISCARDED",
  ) => void;
}

export const AdminPrintersView = ({
  printers,
  unresolvedJobs,
  printerTests,
  canDiscardPrintJobs = false,
  justResolvedIds = {},
  isRefreshing = false,
  onRefresh,
  onOpenCreate,
  onEdit,
  onDelete,
  onTestPrint,
  onOpenResolveDialog,
}: AdminPrintersViewProps) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("ALL");

  const filteredPrinters = useMemo(() => {
    return printers.filter((p) => {
      const q = searchQuery.trim().toLowerCase();
      const matchesSearch =
        !q ||
        (p.name || "").toLowerCase().includes(q) ||
        (p.ipAddress || "").toLowerCase().includes(q) ||
        (p.type || "").toLowerCase().includes(q);

      const matchesType =
        typeFilter === "ALL" ||
        (typeFilter === "CONSOLE" && p.type === "CONSOLE") ||
        (typeFilter === "NETWORK" &&
          (p.type === "ESC_POS_NETWORK" || p.type === "NETWORK"));

      return matchesSearch && matchesType;
    });
  }, [printers, searchQuery, typeFilter]);

  const isFiltered = searchQuery.trim().length > 0 || typeFilter !== "ALL";

  const handleResetFilters = () => {
    setSearchQuery("");
    setTypeFilter("ALL");
  };

  const typeFilterSelect = (
    <div className="flex items-center gap-2">
      <label htmlFor="admin-printers-type-filter" className="sr-only">
        Druckertyp filtern
      </label>
      <select
        id="admin-printers-type-filter"
        value={typeFilter}
        onChange={(e) => setTypeFilter(e.target.value)}
        className="min-h-11 rounded-xl border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-bold text-slate-200 transition-colors hover:border-slate-600 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-400/30"
      >
        <option value="ALL">Alle Druckertypen</option>
        <option value="NETWORK">Netzwerkdrucker (ESC/POS)</option>
        <option value="CONSOLE">Konsole (Simulator)</option>
      </select>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Unklare Druckaufträge Sektion */}
      {unresolvedJobs.length === 0 ? (
        <div
          role="status"
          className="flex items-center gap-2 rounded-2xl border border-slate-800 bg-slate-900/60 px-4 py-3 text-xs font-semibold text-slate-400"
        >
          <CheckCircle2
            aria-hidden="true"
            className="h-4 w-4 text-emerald-400"
          />
          <span>Keine unklaren Druckaufträge.</span>
          <span className="text-slate-400">
            Alle Bons wurden ordnungsgemäß zugestellt.
          </span>
        </div>
      ) : (
        <section
          aria-label="Unklare Druckaufträge"
          className="space-y-3 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 sm:p-5"
        >
          <div className="flex items-start gap-3">
            <AlertTriangle
              aria-hidden="true"
              className="mt-0.5 h-6 w-6 shrink-0 text-amber-400"
            />
            <div className="min-w-0 flex-1">
              <h3 className="text-base font-bold text-amber-100">
                Unklare Druckaufträge ({unresolvedJobs.length})
              </h3>
              <p className="mt-0.5 text-xs text-amber-200/80">
                Ein Bon konnte nach mehreren Versuchen oder Verbindungsabbrüchen
                nicht sicher gedruckt werden. Bitte prüfe vor Ort am Drucker, ob
                der Bon bereits vorliegt.
              </p>
            </div>
          </div>

          <div className="space-y-3 pt-2">
            {unresolvedJobs.map((job: any) => {
              const unresolvedDate = job.unresolvedAt
                ? new Date(job.unresolvedAt)
                : null;
              const contentTitle = describeJobType(job);
              const orderNumber = job.content?.orderNumber;

              return (
                <article
                  key={job.id}
                  className="space-y-3 rounded-xl border border-amber-500/30 bg-slate-900/90 p-4 shadow-md text-xs text-slate-300"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-slate-800 pb-2.5">
                    <div className="font-bold text-slate-100 text-sm">
                      {contentTitle}
                      {orderNumber ? ` · Bestellung #${orderNumber}` : ""}
                    </div>
                    <div className="text-slate-400 font-mono">
                      {unresolvedDate ? (
                        <span>
                          {formatClockTime(unresolvedDate)} (vor{" "}
                          {formatMinutesAgoLong(unresolvedDate)})
                        </span>
                      ) : null}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                    <div>
                      <span className="text-slate-400 block">
                        Drucker: {job.printerName || job.printerId}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400 block">Ursache:</span>
                      <span className="font-bold text-amber-300">
                        {describeUnresolvedReason(job)}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400 block">
                        Versuche / Failover:
                      </span>
                      <span className="font-mono text-slate-200">
                        {job.attemptCount ?? "–"} Versuche ·{" "}
                        {job.failoverCount ?? 0} Failover
                      </span>
                    </div>
                  </div>

                  {job.cupsJobState && (
                    <div className="text-slate-400 font-mono">
                      CUPS-Status: {job.cupsJobState}
                    </div>
                  )}

                  {justResolvedIds[job.id] ? (
                    <div
                      role="status"
                      className={`border-t border-slate-800 pt-3 text-xs font-bold ${
                        justResolvedIds[job.id].tone === "ok"
                          ? "text-emerald-400"
                          : justResolvedIds[job.id].tone === "reprint"
                            ? "text-indigo-400"
                            : "text-rose-400"
                      }`}
                    >
                      {justResolvedIds[job.id].text}
                    </div>
                  ) : (
                    <div className="flex flex-col sm:flex-row sm:items-center gap-2 border-t border-slate-800 pt-3">
                      <button
                        type="button"
                        onClick={() =>
                          onOpenResolveDialog(job, "CONFIRMED_PRINTED")
                        }
                        className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl bg-slate-800 px-4 py-2 text-xs font-bold text-slate-100 border border-slate-700 hover:bg-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-200"
                      >
                        <CheckCircle2
                          aria-hidden="true"
                          className="h-4 w-4 text-emerald-400"
                        />
                        Als gedruckt bestätigen
                      </button>
                      <button
                        type="button"
                        onClick={() => onOpenResolveDialog(job, "REPRINTED")}
                        className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl bg-slate-800 px-4 py-2 text-xs font-bold text-slate-100 border border-slate-700 hover:bg-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-200"
                      >
                        <RotateCcw
                          aria-hidden="true"
                          className="h-4 w-4 text-indigo-400"
                        />
                        Erneut drucken
                      </button>
                      {canDiscardPrintJobs && (
                        <button
                          type="button"
                          onClick={() => onOpenResolveDialog(job, "DISCARDED")}
                          className="sm:ml-auto inline-flex min-h-11 items-center justify-center text-xs font-bold text-rose-400 hover:text-rose-300 underline underline-offset-2 p-2"
                        >
                          Verwerfen
                        </button>
                      )}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      )}

      {/* Toolbar */}
      <AdminToolbar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        searchPlaceholder="Druckername oder IP suchen …"
        searchLabel="Drucker durchsuchen"
        totalCount={printers.length}
        filteredCount={filteredPrinters.length}
        isRefreshing={isRefreshing}
        onRefresh={onRefresh}
        filters={typeFilterSelect}
      />

      {/* Druckerliste */}
      {filteredPrinters.length === 0 ? (
        <AdminEmptyState
          icon={Printer}
          title="Noch keine Drucker angelegt"
          description="Lege Bondrucker für Schank, Küche oder die Zentrale an, um Bons automatisch zu drucken."
          actionLabel="Drucker anlegen"
          onAction={onOpenCreate}
          isFiltered={isFiltered && printers.length > 0}
          onResetFilters={handleResetFilters}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredPrinters.map((printer: any) => {
            const testState = printerTests[printer.id];

            return (
              <article
                key={printer.id}
                className="flex flex-col justify-between space-y-4 rounded-2xl border border-slate-700/80 bg-slate-900/80 p-5 shadow-lg"
              >
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/20 p-2.5 text-indigo-400">
                        <Printer aria-hidden="true" className="h-6 w-6" />
                      </div>
                      <div>
                        <h3 className="text-lg font-bold text-slate-100 break-words">
                          {printer.name}
                        </h3>
                        <span className="block font-mono text-xs text-slate-400">
                          Typ: {printer.type}{" "}
                          {printer.ipAddress
                            ? `(${printer.ipAddress}:${printer.port || 9100})`
                            : ""}
                        </span>
                      </div>
                    </div>
                    <span
                      className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-bold ${
                        printer.isActive
                          ? "border-emerald-500/30 bg-emerald-500/20 text-emerald-400"
                          : "border-slate-700 bg-slate-800 text-slate-400"
                      }`}
                    >
                      {printer.isActive ? "Bereit" : "Inaktiv"}
                    </span>
                  </div>

                  <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3 font-mono text-xs text-slate-400">
                    <p className="text-slate-300">
                      {printer.paperWidth || 80} mm ·{" "}
                      {printer.codepage || "CP858"} · Schnitt:{" "}
                      {printer.cutMode || "PARTIAL"}
                    </p>
                    <div className="grid grid-cols-2 gap-1.5 mt-2 pt-2 border-t border-slate-800/80 text-slate-400">
                      <span>Kopien: {printer.copies || 1}x</span>
                      <span>Timeout: {printer.timeoutMs || 5000} ms</span>
                      {printer.fallbackPrinterId && (
                        <span className="col-span-2 text-indigo-300">
                          Ersatzdrucker konfiguriert
                        </span>
                      )}
                    </div>
                  </div>

                  {testState && (
                    <div
                      role="status"
                      aria-live="polite"
                      className={`rounded-xl border px-3.5 py-2 text-xs font-bold ${
                        testState.state === "ok"
                          ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-300"
                          : testState.state === "error"
                            ? "border-rose-500/30 bg-rose-500/15 text-rose-300"
                            : "border-slate-700 bg-slate-800 text-slate-300"
                      }`}
                    >
                      {testState.message}
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-800 pt-3">
                  <button
                    type="button"
                    onClick={() => onTestPrint(printer.id)}
                    disabled={testState?.state === "running"}
                    className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-indigo-500/30 bg-indigo-600/20 px-3.5 py-2 text-xs font-bold text-indigo-300 hover:bg-indigo-600/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-200 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Printer aria-hidden="true" className="h-4 w-4" />
                    {testState?.state === "running"
                      ? "Testbon läuft …"
                      : "Testbon drucken"}
                  </button>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onEdit(printer)}
                      className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-slate-700 bg-slate-800 p-2.5 text-slate-300 hover:bg-slate-700 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-200"
                      title="Bearbeiten"
                      aria-label={`Drucker ${printer.name} bearbeiten`}
                    >
                      <Edit2 aria-hidden="true" className="h-4 w-4" />
                    </button>
                    {onDelete && (
                      <button
                        type="button"
                        onClick={() => onDelete(printer.id)}
                        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-rose-500/30 bg-rose-500/20 p-2.5 text-rose-300 hover:bg-rose-500/30 hover:text-rose-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-200"
                        title="Löschen"
                        aria-label={`Drucker ${printer.name} löschen`}
                      >
                        <Trash2 aria-hidden="true" className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
};
