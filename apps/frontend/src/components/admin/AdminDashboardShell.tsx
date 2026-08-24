import type { ReactNode } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  FlaskConical,
  Plus,
  RefreshCw,
  ShieldCheck,
  Wifi,
  WifiOff,
} from "lucide-react";

import type { EventItem } from "./adminDomainTypes";
import { getAdminPageDefinition, type AdminPageId } from "./adminAreaRegistry";

interface AdminDashboardShellProps {
  activePage: AdminPageId;
  unresolvedJobCount: number;
  selectedEvent?: EventItem;
  connectionStatus: "checking" | "connected" | "error";
  connectionCheckedAt: Date | null;
  showOperatingStatus?: boolean;
  onPrimaryAction?: () => void;
  children: ReactNode;
}

const formatCheckedAt = (checkedAt: Date | null) =>
  checkedAt
    ? `geprüft um ${checkedAt.toLocaleTimeString("de-AT", {
        hour: "2-digit",
        minute: "2-digit",
      })}`
    : "noch nicht geprüft";

export const AdminDashboardShell = ({
  activePage,
  unresolvedJobCount,
  selectedEvent,
  connectionStatus,
  connectionCheckedAt,
  showOperatingStatus = true,
  onPrimaryAction,
  children,
}: AdminDashboardShellProps) => {
  const page = getAdminPageDefinition(activePage);
  const operatingMode = selectedEvent?.testMode
    ? "Testbetrieb"
    : selectedEvent?.status === "ACTIVE"
      ? "Echtbetrieb"
      : "Betriebsart unbekannt";
  const ModeIcon = selectedEvent?.testMode ? FlaskConical : ShieldCheck;

  return (
    <div className="space-y-5 sm:space-y-6">
      <div className="flex flex-col items-start justify-between gap-4 lg:flex-row lg:gap-8">
        <div className="min-w-0">
          <p className="mb-1 text-sm font-semibold text-indigo-300">
            {page.group === "overview"
              ? "Verwaltung"
              : `${
                  page.group === "operations"
                    ? "Betrieb"
                    : page.group === "catalog"
                      ? "Sortiment"
                      : page.group === "staff"
                        ? "Personal"
                        : page.group === "system"
                          ? "System"
                          : "Sicherheit"
                } / ${page.title}`}
          </p>
          <h1 className="text-2xl font-bold leading-tight text-slate-50 sm:text-[1.75rem] sm:leading-[2.125rem]">
            {page.title}
          </h1>
          <p className="mt-1.5 max-w-3xl text-sm leading-5 text-slate-300 sm:text-base sm:leading-6">
            {page.description}
          </p>
        </div>

        {page.primaryActionLabel && onPrimaryAction && (
          <button
            type="button"
            onClick={onPrimaryAction}
            className="inline-flex min-h-12 w-full shrink-0 items-center justify-center gap-2 rounded-[10px] bg-indigo-600 px-5 py-3 text-sm font-bold text-slate-50 shadow-lg shadow-indigo-950/40 transition-colors hover:bg-indigo-500 focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-amber-200 sm:min-h-11 sm:w-auto sm:py-2.5"
          >
            {page.supportsCreate ? (
              <Plus aria-hidden="true" className="h-5 w-5" />
            ) : (
              <RefreshCw aria-hidden="true" className="h-5 w-5" />
            )}
            {page.primaryActionLabel}
          </button>
        )}
      </div>

      {showOperatingStatus && (
        <section
          aria-label="Betriebsstatus"
          className="grid overflow-hidden rounded-2xl border border-slate-600 bg-slate-900 shadow-lg shadow-slate-950/20 md:grid-cols-3"
        >
          <div className="flex min-h-16 items-center gap-3 border-b border-slate-700 px-4 py-3 md:border-b-0 md:border-r">
            <ModeIcon
              aria-hidden="true"
              className={`h-5 w-5 shrink-0 ${
                selectedEvent?.testMode
                  ? "text-amber-300"
                  : selectedEvent?.status === "ACTIVE"
                    ? "text-emerald-300"
                    : "text-slate-300"
              }`}
            />
            <div className="min-w-0">
              <p className="break-words font-semibold text-slate-50">
                {selectedEvent?.name ?? "Keine Veranstaltung ausgewählt"}
              </p>
              <p className="text-sm text-slate-300">{operatingMode}</p>
            </div>
          </div>

          <div className="flex min-h-16 items-center gap-3 border-b border-slate-700 px-4 py-3 md:border-b-0 md:border-r">
            {connectionStatus === "error" ? (
              <WifiOff
                aria-hidden="true"
                className="h-5 w-5 shrink-0 text-rose-300"
              />
            ) : (
              <Wifi
                aria-hidden="true"
                className="h-5 w-5 shrink-0 text-emerald-300"
              />
            )}
            <div>
              <p className="font-semibold text-slate-50">
                {connectionStatus === "checking"
                  ? "Lokale Verbindung wird geprüft"
                  : connectionStatus === "connected"
                    ? "Lokal verbunden"
                    : "Lokale Verbindung nicht geprüft"}
              </p>
              <p className="text-sm text-slate-300">
                {formatCheckedAt(connectionCheckedAt)}
              </p>
            </div>
          </div>

          <div className="flex min-h-16 items-center gap-3 px-4 py-3">
            {unresolvedJobCount > 0 ? (
              <AlertTriangle
                aria-hidden="true"
                className="h-5 w-5 shrink-0 text-amber-300"
              />
            ) : (
              <CheckCircle2
                aria-hidden="true"
                className="h-5 w-5 shrink-0 text-emerald-300"
              />
            )}
            <div>
              <p className="font-semibold text-slate-50">
                {unresolvedJobCount > 0
                  ? `${unresolvedJobCount} ${
                      unresolvedJobCount === 1 ? "Hinweis" : "Hinweise"
                    }`
                  : "Keine Hinweise"}
              </p>
              <p className="text-sm text-slate-300">
                {unresolvedJobCount > 0
                  ? "Unklare Druckaufträge prüfen"
                  : "Kein offener Druckhinweis"}
              </p>
            </div>
          </div>
        </section>
      )}

      <div className="rounded-2xl border border-slate-700 bg-slate-900/70 p-4 shadow-xl shadow-slate-950/20 sm:p-6">
        {children}
      </div>
    </div>
  );
};
