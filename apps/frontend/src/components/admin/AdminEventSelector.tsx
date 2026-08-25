import { Calendar, FlaskConical, Plus, ShieldCheck } from "lucide-react";
import { Link } from "react-router-dom";
import type { EventItem } from "./adminDomainTypes";

export interface AdminEventSelectorProps {
  events: EventItem[];
  selectedEventId: string;
  onSelectEvent: (eventId: string) => void;
}

export const AdminEventSelector = ({
  events,
  selectedEventId,
  onSelectEvent,
}: AdminEventSelectorProps) => {
  if (events.length === 0) {
    return (
      <div
        role="alert"
        className="flex flex-col items-start justify-between gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 sm:flex-row sm:items-center"
      >
        <div className="flex items-center gap-3">
          <Calendar
            aria-hidden="true"
            className="h-5 w-5 shrink-0 text-amber-400"
          />
          <div className="text-sm text-amber-200">
            <span className="font-bold">Keine Veranstaltung vorhanden.</span>{" "}
            Bitte lege zuerst eine Veranstaltung an, bevor du Stammdaten
            zuordnest.
          </div>
        </div>
        <Link
          to="/admin/events"
          className="inline-flex min-h-11 items-center gap-2 rounded-[10px] bg-amber-500 px-4 py-2 text-xs font-black text-slate-950 hover:bg-amber-400 focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-amber-200"
        >
          <Plus aria-hidden="true" className="h-4 w-4" />
          Zu den Veranstaltungen
        </Link>
      </div>
    );
  }

  const selectedEvent =
    events.find((e) => e.id === selectedEventId) ?? events[0];

  return (
    <section
      aria-label="Veranstaltungsauswahl"
      className="flex flex-col gap-3 rounded-2xl border border-slate-700/80 bg-slate-900/90 p-3 sm:flex-row sm:items-center sm:justify-between sm:p-4"
    >
      <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-center">
        <label
          htmlFor="admin-active-event-select"
          className="flex shrink-0 items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-400"
        >
          <Calendar aria-hidden="true" className="h-4 w-4 text-indigo-300" />
          Veranstaltung:
        </label>
        <select
          id="admin-active-event-select"
          value={selectedEventId}
          onChange={(e) => onSelectEvent(e.target.value)}
          className="min-h-11 w-full rounded-xl border border-slate-700 bg-slate-800 px-3.5 py-2 text-sm font-semibold text-slate-100 transition-colors hover:border-slate-600 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-400/30 sm:max-w-md"
        >
          {events.map((event) => (
            <option key={event.id} value={event.id}>
              {event.name}
              {event.testMode
                ? " (Testbetrieb)"
                : event.status === "ACTIVE"
                  ? " (Echtbetrieb)"
                  : ` (${event.status})`}
            </option>
          ))}
        </select>
      </div>

      {selectedEvent && (
        <div className="flex items-center gap-2 text-xs text-slate-300">
          <span className="text-slate-400">Status:</span>
          {selectedEvent.testMode ? (
            <span className="inline-flex items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1 font-bold text-amber-300">
              <FlaskConical aria-hidden="true" className="h-3.5 w-3.5" />
              Testbetrieb
            </span>
          ) : selectedEvent.status === "ACTIVE" ? (
            <span className="inline-flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 font-bold text-emerald-300">
              <ShieldCheck aria-hidden="true" className="h-3.5 w-3.5" />
              Echtbetrieb
            </span>
          ) : (
            <span className="inline-flex items-center rounded-md border border-slate-700 bg-slate-800 px-2 py-1 font-medium text-slate-400">
              {selectedEvent.status}
            </span>
          )}
        </div>
      )}
    </section>
  );
};
