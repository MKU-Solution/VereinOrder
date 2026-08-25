import {
  CheckCircle2,
  Clock,
  FlaskConical,
  Pause,
  ShieldCheck,
  User,
  UserCheck,
  UserX,
} from "lucide-react";

interface StatusBadgeProps {
  status: string;
  rksvConfirmedAt?: string | null;
  size?: "sm" | "md";
}

export const EventStatusBadge = ({
  status,
  rksvConfirmedAt,
  size = "md",
}: StatusBadgeProps) => {
  const isSm = size === "sm";
  const paddingClass = isSm ? "px-2 py-0.5 text-xs" : "px-2.5 py-1 text-xs";

  switch (status) {
    case "ACTIVE":
      return (
        <div className="flex flex-col items-start gap-1">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/20 font-bold text-emerald-400 shadow-sm shadow-emerald-500/20 ${paddingClass}`}
          >
            <ShieldCheck aria-hidden="true" className="h-3.5 w-3.5" />
            Echtbetrieb
          </span>
          {rksvConfirmedAt && (
            <span className="text-[10px] font-medium text-emerald-300/80">
              ✓ RKSV-Ausschluss bestätigt
            </span>
          )}
        </div>
      );
    case "TEST_MODE":
      return (
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/20 font-bold text-amber-300 ${paddingClass}`}
        >
          <FlaskConical aria-hidden="true" className="h-3.5 w-3.5" />
          Testmodus
        </span>
      );
    case "PAUSED":
      return (
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border border-slate-600 bg-slate-800 font-bold text-slate-300 ${paddingClass}`}
        >
          <Pause aria-hidden="true" className="h-3.5 w-3.5" />
          Pausiert
        </span>
      );
    case "COMPLETED":
      return (
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border border-indigo-500/30 bg-indigo-500/20 font-bold text-indigo-300 ${paddingClass}`}
        >
          <CheckCircle2 aria-hidden="true" className="h-3.5 w-3.5" />
          Abgeschlossen
        </span>
      );
    case "DRAFT":
    default:
      return (
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border border-slate-700 bg-slate-800/80 font-medium text-slate-400 ${paddingClass}`}
        >
          <Clock aria-hidden="true" className="h-3.5 w-3.5" />
          Entwurf
        </span>
      );
  }
};

const ROLE_LABELS: Record<string, { label: string; className: string }> = {
  ADMINISTRATOR: {
    label: "Administrator",
    className: "border-indigo-500/30 bg-indigo-500/20 text-indigo-300",
  },
  EVENT_MANAGER: {
    label: "Veranstaltungsleitung",
    className: "border-purple-500/30 bg-purple-500/20 text-purple-300",
  },
  WAITER: {
    label: "Kellner",
    className: "border-blue-500/30 bg-blue-500/20 text-blue-300",
  },
  CASHIER: {
    label: "Kasse",
    className: "border-emerald-500/30 bg-emerald-500/20 text-emerald-300",
  },
  STATION: {
    label: "Station",
    className: "border-amber-500/30 bg-amber-500/20 text-amber-300",
  },
  RUNNER: {
    label: "Läufer",
    className: "border-cyan-500/30 bg-cyan-500/20 text-cyan-300",
  },
  REVISION: {
    label: "Revision",
    className: "border-rose-500/30 bg-rose-500/20 text-rose-300",
  },
};

export const UserRoleBadge = ({ role }: { role: string }) => {
  const config = ROLE_LABELS[role] ?? {
    label: role,
    className: "border-slate-700 bg-slate-800 text-slate-300",
  };

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-semibold ${config.className}`}
    >
      <User aria-hidden="true" className="h-3 w-3" />
      {config.label}
    </span>
  );
};

export const UserActiveBadge = ({ isActive }: { isActive: boolean }) =>
  isActive ? (
    <span className="inline-flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/15 px-2 py-0.5 text-xs font-semibold text-emerald-300">
      <UserCheck aria-hidden="true" className="h-3 w-3" />
      Aktiv
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800 px-2 py-0.5 text-xs font-semibold text-slate-400">
      <UserX aria-hidden="true" className="h-3 w-3" />
      Inaktiv
    </span>
  );
