import { useMemo, useState } from "react";
import {
  Calendar,
  Edit2,
  MapPin,
  Pause,
  Play,
  Sparkles,
  Square,
  Trash2,
  Users,
} from "lucide-react";

import type { EventItem } from "./adminDomainTypes";
import { AdminEmptyState } from "./AdminEmptyState";
import { EventStatusBadge } from "./AdminStatusBadge";
import { AdminToolbar } from "./AdminToolbar";
import { EventConfigurationActions } from "./EventConfigurationActions";

export interface AdminEventsViewProps {
  events: EventItem[];
  onRefresh: () => void;
  onOpenCreate: () => void;
  onEdit: (event: EventItem) => void;
  onDelete: (id: string) => void;
  onActivate: (event: EventItem) => void;
  onSetTestMode: (event: EventItem) => void;
  onPause: (event: EventItem) => void;
  onComplete: (event: EventItem) => void;
  onConfigurationDone: () => void;
  isRefreshing?: boolean;
}

export const AdminEventsView = ({
  events,
  onRefresh,
  onOpenCreate,
  onEdit,
  onDelete,
  onActivate,
  onSetTestMode,
  onPause,
  onComplete,
  onConfigurationDone,
  isRefreshing = false,
}: AdminEventsViewProps) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");

  const filteredEvents = useMemo(() => {
    return events.filter((evt) => {
      const q = searchQuery.trim().toLowerCase();
      const matchesSearch =
        !q ||
        evt.name.toLowerCase().includes(q) ||
        (evt.organizer && evt.organizer.toLowerCase().includes(q)) ||
        (evt.location && evt.location.toLowerCase().includes(q));

      const matchesStatus =
        statusFilter === "ALL" ||
        (statusFilter === "TEST_MODE" && evt.testMode) ||
        (statusFilter === "ACTIVE" &&
          evt.status === "ACTIVE" &&
          !evt.testMode) ||
        (statusFilter === "DRAFT" && evt.status === "DRAFT") ||
        (statusFilter === "PAUSED" && evt.status === "PAUSED") ||
        (statusFilter === "COMPLETED" && evt.status === "COMPLETED");

      return matchesSearch && matchesStatus;
    });
  }, [events, searchQuery, statusFilter]);

  const isFiltered = searchQuery.trim().length > 0 || statusFilter !== "ALL";

  const handleResetFilters = () => {
    setSearchQuery("");
    setStatusFilter("ALL");
  };

  const statusFilterSelect = (
    <div className="flex items-center gap-2">
      <label htmlFor="admin-events-status-filter" className="sr-only">
        Status filtern
      </label>
      <select
        id="admin-events-status-filter"
        value={statusFilter}
        onChange={(e) => setStatusFilter(e.target.value)}
        className="min-h-11 rounded-xl border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-bold text-slate-200 transition-colors hover:border-slate-600 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-400/30"
      >
        <option value="ALL">Alle Status</option>
        <option value="ACTIVE">Echtbetrieb</option>
        <option value="TEST_MODE">Testmodus</option>
        <option value="DRAFT">Entwurf</option>
        <option value="PAUSED">Pausiert</option>
        <option value="COMPLETED">Abgeschlossen</option>
      </select>
    </div>
  );

  return (
    <div className="space-y-4">
      <AdminToolbar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        searchPlaceholder="Veranstaltung, Ort oder Veranstalter suchen …"
        searchLabel="Veranstaltungen durchsuchen"
        totalCount={events.length}
        filteredCount={filteredEvents.length}
        isRefreshing={isRefreshing}
        onRefresh={onRefresh}
        filters={statusFilterSelect}
      />

      {filteredEvents.length === 0 ? (
        <AdminEmptyState
          icon={Calendar}
          title="Noch keine Veranstaltungen angelegt"
          description="Lege zuerst eine Veranstaltung an, um Festbetrieb, Sortiment, Stationen und Kassen zu strukturieren."
          actionLabel="Veranstaltung anlegen"
          onAction={onOpenCreate}
          isFiltered={isFiltered && events.length > 0}
          onResetFilters={handleResetFilters}
        />
      ) : (
        <div className="space-y-3">
          {/* Desktop & Tablet Table View */}
          <div className="hidden overflow-hidden rounded-2xl border border-slate-700/80 bg-slate-900/60 shadow-lg md:block">
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-slate-700/80 bg-slate-800/60 text-xs font-bold uppercase tracking-wider text-slate-400">
                    <th className="px-5 py-3.5">Veranstaltung</th>
                    <th className="px-4 py-3.5">Ort & Veranstalter</th>
                    <th className="px-4 py-3.5">Umfang</th>
                    <th className="px-4 py-3.5">Status</th>
                    <th className="px-5 py-3.5 text-right">Aktionen</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/80 text-sm">
                  {filteredEvents.map((evt) => (
                    <tr
                      key={evt.id}
                      className="transition-colors hover:bg-slate-800/40"
                    >
                      <td className="px-5 py-4 font-semibold text-slate-50">
                        <div className="text-base">{evt.name}</div>
                        {evt.startTime && (
                          <div className="mt-0.5 text-xs font-normal text-slate-400">
                            📅{" "}
                            {new Date(evt.startTime).toLocaleDateString(
                              "de-AT",
                            )}
                            {evt.endTime
                              ? ` – ${new Date(evt.endTime).toLocaleDateString("de-AT")}`
                              : ""}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-4 text-xs text-slate-300">
                        {evt.organizer && (
                          <div className="flex items-center gap-1.5">
                            <Users
                              aria-hidden="true"
                              className="h-3.5 w-3.5 text-slate-400"
                            />
                            <span>{evt.organizer}</span>
                          </div>
                        )}
                        {evt.location && (
                          <div className="mt-1 flex items-center gap-1.5 text-slate-400">
                            <MapPin
                              aria-hidden="true"
                              className="h-3.5 w-3.5 text-slate-500"
                            />
                            <span>{evt.location}</span>
                          </div>
                        )}
                        {!evt.organizer && !evt.location && "–"}
                      </td>
                      <td className="px-4 py-4 text-xs text-slate-400">
                        {evt._count ? (
                          <div className="space-y-0.5">
                            <div>
                              {evt._count.products} Artikel ·{" "}
                              {evt._count.stations} Stationen
                            </div>
                            <div>
                              {evt._count.areas} Bereiche · {evt._count.orders}{" "}
                              Bestellungen
                            </div>
                          </div>
                        ) : (
                          "–"
                        )}
                      </td>
                      <td className="px-4 py-4">
                        <EventStatusBadge
                          status={evt.testMode ? "TEST_MODE" : evt.status}
                          rksvConfirmedAt={evt.rksvConfirmedAt}
                        />
                      </td>
                      <td className="px-5 py-4 text-right">
                        <div className="flex flex-wrap items-center justify-end gap-1.5">
                          {evt.status !== "ACTIVE" && (
                            <button
                              type="button"
                              onClick={() => onActivate(evt)}
                              className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white shadow-sm shadow-emerald-950/40 hover:bg-emerald-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-200"
                              title="Scharf schalten (Echtbetrieb)"
                            >
                              <Play
                                aria-hidden="true"
                                className="h-3.5 w-3.5"
                              />
                              Scharf schalten
                            </button>
                          )}

                          {evt.status !== "TEST_MODE" &&
                            evt.status !== "ACTIVE" && (
                              <button
                                type="button"
                                onClick={() => onSetTestMode(evt)}
                                className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/20 px-3 py-1.5 text-xs font-bold text-amber-300 hover:bg-amber-500/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-200"
                                title="Testmodus für Schulung aktivieren"
                              >
                                <Sparkles
                                  aria-hidden="true"
                                  className="h-3.5 w-3.5"
                                />
                                Testmodus
                              </button>
                            )}

                          {evt.status === "ACTIVE" && (
                            <button
                              type="button"
                              onClick={() => onPause(evt)}
                              className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-bold text-slate-300 hover:bg-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-200"
                              title="Veranstaltung pausieren"
                            >
                              <Pause
                                aria-hidden="true"
                                className="h-3.5 w-3.5"
                              />
                              Pausieren
                            </button>
                          )}

                          {evt.status !== "COMPLETED" &&
                            evt.status !== "ARCHIVED" && (
                              <button
                                type="button"
                                onClick={() => onComplete(evt)}
                                className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-bold text-slate-300 hover:bg-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-200"
                                title="Veranstaltung abschließen"
                              >
                                <Square
                                  aria-hidden="true"
                                  className="h-3.5 w-3.5"
                                />
                                Abschließen
                              </button>
                            )}

                          <EventConfigurationActions
                            event={evt}
                            events={events}
                            onDone={onConfigurationDone}
                          />

                          <button
                            type="button"
                            onClick={() => onEdit(evt)}
                            className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-lg border border-slate-700 bg-slate-800 p-2 text-slate-300 hover:bg-slate-700 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-200"
                            title="Veranstaltung bearbeiten"
                            aria-label={`Veranstaltung ${evt.name} bearbeiten`}
                          >
                            <Edit2 aria-hidden="true" className="h-4 w-4" />
                          </button>

                          <button
                            type="button"
                            onClick={() => onDelete(evt.id)}
                            className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-lg border border-rose-500/30 bg-rose-500/20 p-2 text-rose-300 hover:bg-rose-500/30 hover:text-rose-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-200"
                            title="Veranstaltung löschen"
                            aria-label={`Veranstaltung ${evt.name} löschen`}
                          >
                            <Trash2 aria-hidden="true" className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Mobile Card View (390×844) */}
          <div className="space-y-3 md:hidden">
            {filteredEvents.map((evt) => (
              <article
                key={evt.id}
                className="space-y-3.5 rounded-2xl border border-slate-700/80 bg-slate-900/80 p-4 shadow-md"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <h3 className="break-words text-base font-bold text-slate-50">
                      {evt.name}
                    </h3>
                    {evt.startTime && (
                      <p className="mt-0.5 text-xs text-slate-400">
                        📅 {new Date(evt.startTime).toLocaleDateString("de-AT")}
                        {evt.endTime
                          ? ` – ${new Date(evt.endTime).toLocaleDateString("de-AT")}`
                          : ""}
                      </p>
                    )}
                  </div>
                  <div className="shrink-0">
                    <EventStatusBadge
                      status={evt.testMode ? "TEST_MODE" : evt.status}
                      rksvConfirmedAt={evt.rksvConfirmedAt}
                      size="sm"
                    />
                  </div>
                </div>

                {(evt.organizer || evt.location) && (
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-300">
                    {evt.organizer && <span>🏛️ {evt.organizer}</span>}
                    {evt.location && <span>📍 {evt.location}</span>}
                  </div>
                )}

                {evt._count && (
                  <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-2.5 text-xs text-slate-400">
                    <div className="grid grid-cols-2 gap-1.5 font-medium">
                      <span>📦 {evt._count.products} Artikel</span>
                      <span>🏪 {evt._count.stations} Stationen</span>
                      <span>🗺️ {evt._count.areas} Bereiche</span>
                      <span>📝 {evt._count.orders} Bestellungen</span>
                    </div>
                  </div>
                )}

                <div className="flex flex-col gap-2 border-t border-slate-800 pt-3">
                  <div className="flex flex-wrap gap-2">
                    {evt.status !== "ACTIVE" && (
                      <button
                        type="button"
                        onClick={() => onActivate(evt)}
                        className="inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-bold text-white shadow-sm hover:bg-emerald-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-200"
                      >
                        <Play aria-hidden="true" className="h-4 w-4" />
                        Scharf schalten
                      </button>
                    )}

                    {evt.status !== "TEST_MODE" && evt.status !== "ACTIVE" && (
                      <button
                        type="button"
                        onClick={() => onSetTestMode(evt)}
                        className="inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-xl border border-amber-500/30 bg-amber-500/20 px-3 py-2 text-xs font-bold text-amber-300 hover:bg-amber-500/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-200"
                      >
                        <Sparkles aria-hidden="true" className="h-4 w-4" />
                        Testmodus
                      </button>
                    )}

                    {evt.status === "ACTIVE" && (
                      <button
                        type="button"
                        onClick={() => onPause(evt)}
                        className="inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-bold text-slate-200 hover:bg-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-200"
                      >
                        <Pause aria-hidden="true" className="h-4 w-4" />
                        Pausieren
                      </button>
                    )}

                    {evt.status !== "COMPLETED" &&
                      evt.status !== "ARCHIVED" && (
                        <button
                          type="button"
                          onClick={() => onComplete(evt)}
                          className="inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-bold text-slate-200 hover:bg-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-200"
                        >
                          <Square aria-hidden="true" className="h-4 w-4" />
                          Abschließen
                        </button>
                      )}
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <EventConfigurationActions
                      event={evt}
                      events={events}
                      onDone={onConfigurationDone}
                    />

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => onEdit(evt)}
                        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-slate-700 bg-slate-800 p-2.5 text-slate-200 hover:bg-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-200"
                        title="Veranstaltung bearbeiten"
                        aria-label={`Veranstaltung ${evt.name} bearbeiten`}
                      >
                        <Edit2 aria-hidden="true" className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onDelete(evt.id)}
                        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-rose-500/30 bg-rose-500/20 p-2.5 text-rose-300 hover:bg-rose-500/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-200"
                        title="Veranstaltung löschen"
                        aria-label={`Veranstaltung ${evt.name} löschen`}
                      >
                        <Trash2 aria-hidden="true" className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
