import {
  AlertTriangle,
  ArrowRight,
  Calendar,
  CheckCircle2,
} from "lucide-react";
import { Link } from "react-router-dom";

import type { EventItem } from "./adminDomainTypes";

interface AdminOverviewPageProps {
  events: EventItem[];
  unresolvedJobCount: number;
}

export const AdminOverviewPage = ({
  events,
  unresolvedJobCount,
}: AdminOverviewPageProps) => {
  const activeEvent =
    events.find((event) => event.status === "ACTIVE") ??
    events.find((event) => event.status === "TEST_MODE") ??
    events[0];

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="rounded-2xl border border-slate-700 bg-slate-900 p-5">
        <div className="flex items-start gap-3">
          <Calendar
            aria-hidden="true"
            className="mt-0.5 h-5 w-5 shrink-0 text-indigo-300"
          />
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-slate-50">
              Veranstaltung vorbereiten
            </h2>
            <p className="mt-1 text-sm leading-5 text-slate-300">
              {activeEvent
                ? `„${activeEvent.name}“ ist als nächster Betrieb ausgewählt.`
                : "Noch keine Veranstaltung vorhanden. Lege zuerst den Festbetrieb an."}
            </p>
            <Link
              to="/admin/events"
              className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-[10px] px-3 text-sm font-bold text-indigo-300 hover:bg-slate-800 focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-amber-200"
            >
              Veranstaltungen öffnen
              <ArrowRight aria-hidden="true" className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-700 bg-slate-900 p-5">
        <div className="flex items-start gap-3">
          {unresolvedJobCount > 0 ? (
            <AlertTriangle
              aria-hidden="true"
              className="mt-0.5 h-5 w-5 shrink-0 text-amber-300"
            />
          ) : (
            <CheckCircle2
              aria-hidden="true"
              className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300"
            />
          )}
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-slate-50">
              Lokalen Betrieb prüfen
            </h2>
            <p className="mt-1 text-sm leading-5 text-slate-300">
              {unresolvedJobCount > 0
                ? `${unresolvedJobCount} unklare ${
                    unresolvedJobCount === 1 ? "Druckauftrag" : "Druckaufträge"
                  } brauchen eine Entscheidung.`
                : "Derzeit ist kein unklarer Druckauftrag offen."}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Link
                to={
                  unresolvedJobCount > 0
                    ? "/admin/printers"
                    : "/admin/diagnostics"
                }
                className="inline-flex min-h-11 items-center gap-2 rounded-[10px] px-3 text-sm font-bold text-indigo-300 hover:bg-slate-800 focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-amber-200"
              >
                {unresolvedJobCount > 0
                  ? "Druckaufträge prüfen"
                  : "Systemstatus öffnen"}
                <ArrowRight aria-hidden="true" className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};
