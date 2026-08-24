import type { ReactNode } from "react";
import { Plus } from "lucide-react";

import {
  ADMIN_AREAS,
  getAdminAreaDefinition,
  type AdminAreaId,
} from "./adminAreaRegistry";

interface AdminDashboardShellProps {
  activeArea: AdminAreaId;
  unresolvedJobCount: number;
  onAreaChange: (area: AdminAreaId) => void;
  onCreate: () => void;
  children: ReactNode;
}

/** Sichtbarer, fachlich neutraler Rahmen der bisherigen Admin-Route. */
export const AdminDashboardShell = ({
  activeArea,
  unresolvedJobCount,
  onAreaChange,
  onCreate,
  children,
}: AdminDashboardShellProps) => (
  <>
    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
      <div>
        <h1 className="text-3xl font-bold">Administration & Stammdaten</h1>
        <p className="text-slate-400 text-sm mt-1">
          Veranstaltungssteuerung, Systemstatus, Druck-Routing, Backups &
          Audit-Log
        </p>
      </div>
      {getAdminAreaDefinition(activeArea).supportsCreate && (
        <button
          type="button"
          onClick={onCreate}
          className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2.5 px-5 rounded-2xl flex items-center gap-2 shadow-lg shadow-indigo-600/30 transition-all active:scale-95 shrink-0"
        >
          <Plus className="w-5 h-5" />
          Neu anlegen
        </button>
      )}
    </div>

    <nav
      aria-label="Verwaltungsbereiche"
      className="flex gap-2 overflow-x-auto pb-2 border-b border-slate-800 scrollbar-hide"
    >
      {ADMIN_AREAS.map((area) => {
        const Icon = area.icon;
        const isActive = activeArea === area.id;
        return (
          <button
            key={area.id}
            type="button"
            aria-current={isActive ? "page" : undefined}
            onClick={() => onAreaChange(area.id)}
            className={`flex items-center gap-2.5 px-4 py-2.5 rounded-2xl font-bold text-sm transition-all whitespace-nowrap ${
              isActive
                ? "bg-indigo-600 text-white shadow-lg shadow-indigo-600/30"
                : "bg-slate-850 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
            }`}
          >
            <Icon className="w-4 h-4" />
            {area.label}
            {area.id === "printers" && (
              <span
                className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-bold ${
                  unresolvedJobCount > 0
                    ? "bg-amber-500 text-slate-950"
                    : "bg-slate-800 text-slate-500"
                }`}
              >
                {unresolvedJobCount > 0 && (
                  <span className="w-1.5 h-1.5 rounded-full bg-slate-950 animate-pulse" />
                )}
                {unresolvedJobCount}
              </span>
            )}
          </button>
        );
      })}
    </nav>

    <div className="glass p-6 rounded-3xl">{children}</div>
  </>
);
