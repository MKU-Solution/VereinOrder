import type { ReactNode } from "react";
import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  CircleDashed,
  Database,
  FlaskConical,
  HardDrive,
  Printer,
  ShieldCheck,
  ShieldX,
  Store,
  Users,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { Link } from "react-router-dom";

import type { EventItem } from "./adminDomainTypes";
import {
  type AdminOverviewDiagnostics,
  type OverviewStatusSlice,
  useAdminOverviewStatus,
} from "./useAdminOverviewStatus";

interface AdminOverviewPageProps {
  refreshToken?: number;
}

const formatDateTime = (value: string | Date | null) => {
  if (!value) return "noch nicht geprüft";
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Zeitpunkt nicht verfügbar";
  return parsed.toLocaleString("de-AT", {
    dateStyle: "short",
    timeStyle: "short",
  });
};

const sourceLine = (source: string, checkedAt: Date | null) =>
  `Quelle: ${source} · geprüft ${formatDateTime(checkedAt)}`;

const attemptedLine = (checkedAt: Date | null) =>
  `Quelle: lokale Abfrage · Abruf versucht ${formatDateTime(checkedAt)}`;

const verificationLabel = (
  verification:
    | "STRUCTURE_VERIFIED"
    | "RESTORE_VERIFIED"
    | "LEGACY"
    | "CORRUPT"
    | undefined,
) => {
  switch (verification) {
    case "RESTORE_VERIFIED":
      return "Wiederherstellung geprüft";
    case "STRUCTURE_VERIFIED":
      return "Struktur geprüft";
    case "LEGACY":
      return "Altes Sicherungsformat";
    case "CORRUPT":
      return "Sicherung beschädigt";
    default:
      return "Prüfstand nicht verfügbar";
  }
};

interface StatusRowProps {
  icon: ReactNode;
  title: string;
  status: string;
  detail: string;
  source: string;
  href: string;
  action: string;
  tone?: "ok" | "warning" | "error" | "neutral";
}

const toneStyles: Record<NonNullable<StatusRowProps["tone"]>, string> = {
  ok: "border-emerald-800/70 bg-emerald-950/20",
  warning: "border-amber-800/70 bg-amber-950/20",
  error: "border-rose-800/70 bg-rose-950/20",
  neutral: "border-slate-700 bg-slate-950/30",
};

const StatusRow = ({
  icon,
  title,
  status,
  detail,
  source,
  href,
  action,
  tone = "neutral",
}: StatusRowProps) => (
  <article
    className={`relative grid gap-3 rounded-2xl border p-4 sm:grid-cols-[2.75rem_minmax(0,1fr)_auto] sm:items-center ${toneStyles[tone]}`}
  >
    <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-slate-700 bg-slate-900 text-slate-200">
      {icon}
    </div>
    <div className="min-w-0">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h3 className="font-bold text-slate-50">{title}</h3>
        <span className="text-sm font-semibold text-slate-200">{status}</span>
      </div>
      <p className="mt-1 text-sm leading-5 text-slate-300">{detail}</p>
      <p className="mt-2 text-xs leading-4 text-slate-400">{source}</p>
    </div>
    <Link
      to={href}
      className="inline-flex min-h-11 items-center gap-2 rounded-[10px] px-3 text-sm font-bold text-indigo-300 hover:bg-slate-800 focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-amber-200 sm:justify-self-end"
    >
      {action}
      <ArrowRight aria-hidden="true" className="h-4 w-4" />
    </Link>
  </article>
);

const LoadingRow = ({ title }: { title: string }) => (
  <div className="flex min-h-28 items-center gap-3 rounded-2xl border border-slate-700 bg-slate-950/30 p-4 text-slate-300">
    <CircleDashed aria-hidden="true" className="h-5 w-5 animate-spin" />
    <span>{title} wird lokal geprüft …</span>
  </div>
);

const ErrorRow = ({
  title,
  slice,
  href,
}: {
  title: string;
  slice: OverviewStatusSlice<unknown>;
  href: string;
}) => (
  <StatusRow
    icon={<ShieldX aria-hidden="true" className="h-5 w-5 text-rose-300" />}
    title={title}
    status="Nicht verfügbar"
    detail={slice.error ?? "Der Status konnte nicht geladen werden."}
    source={attemptedLine(slice.checkedAt)}
    href={href}
    action="Bereich prüfen"
    tone="error"
  />
);

const activeEventFrom = (events: EventItem[] | null) =>
  events?.find((event) => event.status === "ACTIVE") ??
  events?.find((event) => event.status === "TEST_MODE") ??
  null;

const quickLinks: Array<{
  label: string;
  href: string;
  icon: LucideIcon;
}> = [
  { label: "Veranstaltung", href: "/admin/events", icon: CalendarDays },
  { label: "Produkte", href: "/admin/products", icon: Store },
  { label: "Kategorien", href: "/admin/categories", icon: Store },
  { label: "Mitarbeiter", href: "/admin/users", icon: Users },
  { label: "Drucker", href: "/admin/printers", icon: Printer },
  { label: "Sicherung", href: "/admin/backups", icon: HardDrive },
];

const getReadiness = ({
  isRefreshing,
  failedSlices,
  maintenancePhase,
  health,
  activeEvent,
}: {
  isRefreshing: boolean;
  failedSlices: number;
  maintenancePhase?: string;
  health?: AdminOverviewDiagnostics["overallHealth"];
  activeEvent: EventItem | null;
}) => {
  if (isRefreshing) {
    return {
      title: "Betriebsstatus wird geprüft",
      detail: "Die lokalen Quellen werden unabhängig voneinander geladen.",
      tone: "neutral" as const,
      icon: (
        <CircleDashed aria-hidden="true" className="h-7 w-7 animate-spin" />
      ),
    };
  }
  if (failedSlices > 0) {
    return {
      title: "Status teilweise verfügbar",
      detail: `${failedSlices} ${failedSlices === 1 ? "Quelle antwortet" : "Quellen antworten"} derzeit nicht. Die verfügbaren Angaben bleiben sichtbar.`,
      tone: "warning" as const,
      icon: <AlertTriangle aria-hidden="true" className="h-7 w-7" />,
    };
  }
  if (maintenancePhase && maintenancePhase !== "OPEN") {
    return {
      title: "Wartung aktiv – Betrieb eingeschränkt",
      detail: "Die Wartung wird ausschließlich im zuständigen Bereich beendet.",
      tone: "warning" as const,
      icon: <Wrench aria-hidden="true" className="h-7 w-7" />,
    };
  }
  if (health === "RED") {
    return {
      title: "Handlungsbedarf vor Festbetrieb",
      detail:
        "Mindestens eine lokale Prüfung meldet eine Störung. Öffne den genannten Fachbereich.",
      tone: "error" as const,
      icon: <ShieldX aria-hidden="true" className="h-7 w-7" />,
    };
  }
  if (!activeEvent) {
    return {
      title: "Veranstaltung für den Betrieb wählen",
      detail: "Es ist derzeit weder ein Test- noch ein Echtbetrieb aktiv.",
      tone: "warning" as const,
      icon: <CalendarDays aria-hidden="true" className="h-7 w-7" />,
    };
  }
  return {
    title: "Lokaler Betrieb ist bereit",
    detail: "Die verfügbaren Prüfungen melden keinen blockierenden Zustand.",
    tone: "ok" as const,
    icon: <CheckCircle2 aria-hidden="true" className="h-7 w-7" />,
  };
};

export const AdminOverviewPage = ({
  refreshToken = 0,
}: AdminOverviewPageProps) => {
  const status = useAdminOverviewStatus(refreshToken);
  const activeEvent = activeEventFrom(status.events.data);
  const diagnostics = status.diagnostics.data;
  const maintenance = status.maintenance.data;
  const failedSlices = [
    status.events,
    status.diagnostics,
    status.maintenance,
  ].filter((slice) => slice.state === "error").length;
  const readiness = getReadiness({
    isRefreshing: status.isRefreshing,
    failedSlices,
    maintenancePhase: maintenance?.phase,
    health: diagnostics?.overallHealth,
    activeEvent,
  });
  const readinessTone = {
    ok: "border-emerald-700 bg-emerald-950/35 text-emerald-200",
    warning: "border-amber-700 bg-amber-950/35 text-amber-200",
    error: "border-rose-700 bg-rose-950/35 text-rose-200",
    neutral: "border-slate-600 bg-slate-950/50 text-slate-200",
  }[readiness.tone];
  const recommendations = (diagnostics?.recommendations ?? []).filter(
    (recommendation) => recommendation.level !== "SUCCESS",
  );

  return (
    <div className="space-y-6">
      <section
        aria-labelledby="readiness-title"
        className={`grid gap-4 rounded-2xl border p-5 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center sm:p-6 ${readinessTone}`}
      >
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-current/30 bg-slate-950/25">
          {readiness.icon}
        </div>
        <div>
          <p className="text-xs font-extrabold uppercase tracking-[0.16em] opacity-80">
            Betriebsfreigabe
          </p>
          <h2
            id="readiness-title"
            className="mt-1 text-xl font-bold sm:text-2xl"
          >
            {readiness.title}
          </h2>
          <p className="mt-1 max-w-3xl text-sm leading-5 text-slate-200">
            {readiness.detail}
          </p>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.65fr)_minmax(18rem,0.85fr)]">
        <section aria-labelledby="status-heading">
          <div className="mb-3 flex items-end justify-between gap-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-indigo-300">
                Lokale Prüflinie
              </p>
              <h2
                id="status-heading"
                className="mt-1 text-lg font-bold text-slate-50"
              >
                Was den Betrieb heute trägt
              </h2>
            </div>
            {status.isRefreshing && (
              <span className="text-xs text-slate-400">
                wird aktualisiert …
              </span>
            )}
          </div>

          <div className="relative space-y-3 before:absolute before:bottom-10 before:left-[2.15rem] before:top-10 before:w-px before:bg-slate-700 before:content-['']">
            {status.events.state === "loading" ? (
              <LoadingRow title="Veranstaltungsstatus" />
            ) : status.events.state === "error" ? (
              <ErrorRow
                title="Veranstaltung"
                slice={status.events}
                href="/admin/events"
              />
            ) : activeEvent ? (
              <StatusRow
                icon={
                  activeEvent.testMode || activeEvent.status === "TEST_MODE" ? (
                    <FlaskConical
                      aria-hidden="true"
                      className="h-5 w-5 text-amber-300"
                    />
                  ) : (
                    <ShieldCheck
                      aria-hidden="true"
                      className="h-5 w-5 text-emerald-300"
                    />
                  )
                }
                title="Veranstaltung"
                status={
                  activeEvent.testMode || activeEvent.status === "TEST_MODE"
                    ? "Testbetrieb"
                    : "Echtbetrieb"
                }
                detail={`„${activeEvent.name}“ ist als laufender Betrieb ausgewählt.`}
                source={sourceLine("Veranstaltungen", status.events.checkedAt)}
                href="/admin/events"
                action="Veranstaltung öffnen"
                tone={
                  activeEvent.testMode || activeEvent.status === "TEST_MODE"
                    ? "warning"
                    : "ok"
                }
              />
            ) : (
              <StatusRow
                icon={
                  <CalendarDays
                    aria-hidden="true"
                    className="h-5 w-5 text-amber-300"
                  />
                }
                title="Veranstaltung"
                status="Kein aktiver Betrieb"
                detail="Lege eine Veranstaltung an oder aktiviere einen vorbereiteten Testbetrieb."
                source={sourceLine("Veranstaltungen", status.events.checkedAt)}
                href="/admin/events"
                action="Veranstaltungen öffnen"
                tone="warning"
              />
            )}

            {status.diagnostics.state === "loading" ? (
              <LoadingRow title="Backend und Datenbank" />
            ) : status.diagnostics.state === "error" ? (
              <ErrorRow
                title="Backend und Datenbank"
                slice={status.diagnostics}
                href="/admin/diagnostics"
              />
            ) : diagnostics ? (
              <StatusRow
                icon={
                  <Database
                    aria-hidden="true"
                    className="h-5 w-5 text-sky-300"
                  />
                }
                title="Backend und Datenbank"
                status={
                  diagnostics.database.status === "ONLINE"
                    ? "Lokal erreichbar"
                    : "Störung"
                }
                detail={
                  diagnostics.database.status === "ONLINE"
                    ? `Backend ${diagnostics.backend.appVersion} antwortet; Datenbank geprüft in ${diagnostics.database.latencyMs} ms.`
                    : "Die lokale Datenbank antwortet nicht zuverlässig."
                }
                source={sourceLine(
                  "Systemdiagnose",
                  status.diagnostics.checkedAt,
                )}
                href="/admin/diagnostics"
                action="Diagnose öffnen"
                tone={diagnostics.database.status === "ONLINE" ? "ok" : "error"}
              />
            ) : null}

            {status.diagnostics.state === "loading" ? (
              <LoadingRow title="Druck und Warteschlange" />
            ) : status.diagnostics.state === "error" ? (
              <ErrorRow
                title="Druck und Warteschlange"
                slice={status.diagnostics}
                href="/admin/printers"
              />
            ) : diagnostics ? (
              <StatusRow
                icon={
                  <Printer
                    aria-hidden="true"
                    className="h-5 w-5 text-violet-300"
                  />
                }
                title="Druck und Warteschlange"
                status={
                  diagnostics.printers.queue.failed > 0 ||
                  diagnostics.printers.queue.unclear > 0
                    ? "Entscheidung nötig"
                    : "Keine offenen Druckprobleme"
                }
                detail={`${diagnostics.printers.active} von ${diagnostics.printers.total} Druckern aktiv · ${diagnostics.printers.queue.pending} wartend · ${diagnostics.printers.queue.failed} fehlgeschlagen · ${diagnostics.printers.queue.unclear} unklar.`}
                source={sourceLine(
                  "Druckdiagnose",
                  status.diagnostics.checkedAt,
                )}
                href="/admin/printers"
                action="Drucker prüfen"
                tone={
                  diagnostics.printers.queue.failed > 0
                    ? "error"
                    : diagnostics.printers.queue.unclear > 0
                      ? "warning"
                      : "ok"
                }
              />
            ) : null}

            {status.diagnostics.state === "loading" ? (
              <LoadingRow title="Datensicherung" />
            ) : status.diagnostics.state === "error" ? (
              <ErrorRow
                title="Datensicherung"
                slice={status.diagnostics}
                href="/admin/backups"
              />
            ) : diagnostics ? (
              <StatusRow
                icon={
                  <HardDrive
                    aria-hidden="true"
                    className="h-5 w-5 text-cyan-300"
                  />
                }
                title="Datensicherung"
                status={
                  diagnostics.backup.latestBackup
                    ? verificationLabel(
                        diagnostics.backup.latestBackup.verification,
                      )
                    : "Keine Sicherung vorhanden"
                }
                detail={
                  diagnostics.backup.latestBackup
                    ? `Letzte Sicherung: ${formatDateTime(diagnostics.backup.latestBackup.createdAt)} · ${diagnostics.backup.latestBackup.filename}`
                    : "Erstelle vor dem Festbetrieb eine lokale Datensicherung."
                }
                source={sourceLine(
                  "Sicherungsdiagnose",
                  status.diagnostics.checkedAt,
                )}
                href="/admin/backups"
                action="Sicherungen öffnen"
                tone={
                  !diagnostics.backup.latestBackup ||
                  !diagnostics.backup.toolStatus.enabled ||
                  !diagnostics.backup.storage.creationAllowed
                    ? "warning"
                    : "ok"
                }
              />
            ) : null}

            {status.maintenance.state === "loading" ? (
              <LoadingRow title="Wartungszustand" />
            ) : status.maintenance.state === "error" ? (
              <ErrorRow
                title="Wartungszustand"
                slice={status.maintenance}
                href="/admin/maintenance"
              />
            ) : maintenance ? (
              <StatusRow
                icon={
                  <Wrench
                    aria-hidden="true"
                    className="h-5 w-5 text-amber-300"
                  />
                }
                title="Wartungszustand"
                status={
                  maintenance.phase === "OPEN"
                    ? "Normalbetrieb"
                    : maintenance.phase === "DRAINING"
                      ? "Wartung wird vorbereitet"
                      : "Wartungssperre aktiv"
                }
                detail={
                  maintenance.phase === "OPEN"
                    ? "Schreibende Vorgänge sind im lokalen Betrieb freigegeben."
                    : `${maintenance.reason ? `Grund: ${maintenance.reason}. ` : ""}${maintenance.since ? `Seit ${formatDateTime(maintenance.since)}.` : ""}`
                }
                source={sourceLine(
                  "Wartungsdienst",
                  status.maintenance.checkedAt,
                )}
                href="/admin/maintenance"
                action="Wartung öffnen"
                tone={maintenance.phase === "OPEN" ? "ok" : "warning"}
              />
            ) : null}
          </div>
        </section>

        <div className="space-y-6">
          <section
            aria-labelledby="actions-heading"
            className="rounded-2xl border border-slate-700 bg-slate-950/30 p-5"
          >
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-indigo-300">
              Nächste Schritte
            </p>
            <h2
              id="actions-heading"
              className="mt-1 text-lg font-bold text-slate-50"
            >
              Handlungsbedarf
            </h2>
            <div className="mt-4 space-y-3">
              {failedSlices > 0 && (
                <p className="rounded-xl border border-amber-800/70 bg-amber-950/25 p-3 text-sm leading-5 text-amber-100">
                  Nicht alle lokalen Quellen antworten. Die betroffenen
                  Prüflinien nennen den zuständigen Bereich.
                </p>
              )}
              {!activeEvent &&
                status.events.state !== "loading" &&
                status.events.state !== "error" && (
                  <Link
                    to="/admin/events"
                    className="block rounded-xl border border-amber-800/60 p-3 text-sm text-slate-200 hover:bg-slate-900 focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-amber-200"
                  >
                    <span className="font-bold text-amber-200">
                      Veranstaltung wählen
                    </span>
                    <span className="mt-1 block text-slate-300">
                      Ohne aktiven Test- oder Echtbetrieb fehlt der Bezug für
                      den Festbetrieb.
                    </span>
                  </Link>
                )}
              {recommendations.map((recommendation) => (
                <Link
                  key={`${recommendation.level}-${recommendation.title}`}
                  to={
                    recommendation.actionTab
                      ? `/admin/${recommendation.actionTab}`
                      : "/admin/diagnostics"
                  }
                  className="block rounded-xl border border-slate-700 p-3 text-sm text-slate-200 hover:bg-slate-900 focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-amber-200"
                >
                  <span className="font-bold text-slate-50">
                    {recommendation.title}
                  </span>
                  <span className="mt-1 block leading-5 text-slate-300">
                    {recommendation.message}
                  </span>
                </Link>
              ))}
              {failedSlices === 0 &&
                activeEvent &&
                recommendations.length === 0 &&
                !status.isRefreshing && (
                  <p className="flex items-start gap-2 rounded-xl border border-emerald-800/60 bg-emerald-950/20 p-3 text-sm leading-5 text-emerald-100">
                    <CheckCircle2
                      aria-hidden="true"
                      className="mt-0.5 h-4 w-4 shrink-0"
                    />
                    Derzeit ist keine konkrete Maßnahme erforderlich.
                  </p>
                )}
            </div>
          </section>

          <section
            aria-labelledby="quick-heading"
            className="rounded-2xl border border-slate-700 bg-slate-950/30 p-5"
          >
            <h2 id="quick-heading" className="text-lg font-bold text-slate-50">
              Häufige Aufgaben
            </h2>
            <nav
              aria-label="Schnellzugriffe"
              className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-1"
            >
              {quickLinks.map(({ label, href, icon: Icon }) => (
                <Link
                  key={href}
                  to={href}
                  className="flex min-h-11 items-center gap-3 rounded-xl border border-transparent px-3 text-sm font-semibold text-slate-200 hover:border-slate-700 hover:bg-slate-900 focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-amber-200"
                >
                  <Icon
                    aria-hidden="true"
                    className="h-4 w-4 text-indigo-300"
                  />
                  {label}
                </Link>
              ))}
            </nav>
          </section>
        </div>
      </div>
    </div>
  );
};
