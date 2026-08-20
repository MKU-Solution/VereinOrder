import { useEffect, useRef, useState } from "react";
import { Delete, LockKeyhole, TimerReset, UserRoundCog, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api } from "../../lib/api";
import { useAuthStore } from "../../store/useAuthStore";
import { defaultRouteForRole } from "./routeAccess";

interface SessionGateProps {
  mode: "locked" | "switch";
  timeoutSeconds: number;
  onTimeoutChange: (seconds: number) => void;
  onClose: () => void;
  onAuthenticated: () => void;
}

const timeoutOptions = [
  { value: 30, label: "30 Sekunden" },
  { value: 60, label: "1 Minute" },
  { value: 120, label: "2 Minuten" },
  { value: 300, label: "5 Minuten" },
  { value: 900, label: "15 Minuten" },
];

export const SessionGate = ({
  mode,
  timeoutSeconds,
  onTimeoutChange,
  onClose,
  onAuthenticated,
}: SessionGateProps) => {
  const user = useAuthStore((state) => state.user);
  const setToken = useAuthStore((state) => state.setToken);
  const navigate = useNavigate();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [username, setUsername] = useState(user?.username || "");
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  const appendDigit = (digit: string) => {
    setError("");
    setPin((current) => (current.length < 12 ? current + digit : current));
  };

  const authenticate = async () => {
    if (!username.trim() || pin.length < 4 || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await api.post("/auth/switch", {
        username: username.trim(),
        pin,
      });
      setToken(response.data.access_token);
      const nextUser = useAuthStore.getState().user;
      onAuthenticated();
      if (nextUser) navigate(defaultRouteForRole(nextUser.role));
    } catch (requestError: any) {
      setPin("");
      setError(
        requestError.response?.status === 429
          ? "Zu viele Fehlversuche. Dieser Benutzer ist fünf Minuten gesperrt."
          : requestError.response?.data?.message ||
              "Benutzername oder PIN ist ungültig.",
      );
    } finally {
      setBusy(false);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    const isUsernameInput = event.target instanceof HTMLInputElement;

    if (event.key === "Tab") {
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (
        event.shiftKey &&
        (document.activeElement === first ||
          document.activeElement === dialogRef.current)
      ) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    } else if (/^\d$/.test(event.key) && !isUsernameInput) {
      event.preventDefault();
      appendDigit(event.key);
    } else if (event.key === "Backspace" && !isUsernameInput) {
      event.preventDefault();
      setPin((current) => current.slice(0, -1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      void authenticate();
    } else if (event.key === "Escape" && mode === "switch") {
      event.preventDefault();
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-[80] grid place-items-center overflow-y-auto bg-slate-950/95 p-3 backdrop-blur-md sm:p-6">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="session-gate-title"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className="relative my-auto grid w-full max-w-3xl overflow-hidden rounded-[2rem] border border-slate-700 bg-slate-900 shadow-2xl shadow-black/50 outline-none md:grid-cols-[minmax(0,1fr)_22rem]"
      >
        <section className="flex flex-col justify-between bg-gradient-to-br from-indigo-600 via-indigo-700 to-slate-900 p-6 md:p-8">
          <div>
            <div className="mb-6 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-white/15 text-white shadow-inner">
              {mode === "locked" ? (
                <LockKeyhole className="h-7 w-7" aria-hidden="true" />
              ) : (
                <UserRoundCog className="h-7 w-7" aria-hidden="true" />
              )}
            </div>
            <p className="text-sm font-black uppercase tracking-[0.2em] text-indigo-200">
              {mode === "locked" ? "Gerät geschützt" : "Schichtübergabe"}
            </p>
            <h1
              id="session-gate-title"
              className="mt-2 text-3xl font-black tracking-tight text-white md:text-4xl"
            >
              {mode === "locked"
                ? "PIN eingeben und weiterarbeiten."
                : "Nächsten Benutzer übernehmen lassen."}
            </h1>
            <p className="mt-3 max-w-md text-sm leading-6 text-indigo-100">
              Der Warenkorb bleibt auf dem Gerät. Aktionen werden ab jetzt dem
              neu bestätigten Benutzer zugeordnet.
            </p>
          </div>

          <label className="mt-6 block text-sm font-bold text-indigo-100">
            <span className="mb-2 flex items-center gap-2">
              <TimerReset className="h-4 w-4" aria-hidden="true" />
              Automatisch sperren nach
            </span>
            <select
              value={timeoutSeconds}
              onChange={(event) => onTimeoutChange(Number(event.target.value))}
              className="min-h-12 w-full rounded-xl border border-white/20 bg-slate-950/30 px-3 text-white outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              {timeoutOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </section>

        <section className="relative p-5 sm:p-6">
          {mode === "switch" && (
            <button
              type="button"
              onClick={onClose}
              className="absolute right-3 top-3 inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-800 hover:text-white focus-visible:ring-2 focus-visible:ring-indigo-300"
              aria-label="Benutzerwechsel schließen"
            >
              <X className="h-5 w-5" />
            </button>
          )}

          <label className="block">
            <span className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">
              Benutzername
            </span>
            <input
              value={username}
              onChange={(event) => {
                setUsername(event.target.value);
                setError("");
              }}
              autoCapitalize="none"
              autoComplete="username"
              className="mt-2 min-h-12 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 text-lg font-bold text-white outline-none focus-visible:border-indigo-400 focus-visible:ring-2 focus-visible:ring-indigo-400/40"
            />
          </label>

          <div
            className="my-4 flex min-h-12 items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-950"
            aria-label={
              pin ? `PIN-Eingabe, ${pin.length} Stellen` : "PIN-Eingabe leer"
            }
          >
            {pin ? (
              [...pin].map((_, index) => (
                <span
                  key={index}
                  className="h-3 w-3 rounded-full bg-indigo-300"
                />
              ))
            ) : (
              <span className="text-sm text-slate-500">
                PIN über Tastenfeld
              </span>
            )}
          </div>

          {error && (
            <p
              role="alert"
              className="mb-3 rounded-xl border border-rose-500/50 bg-rose-500/10 px-3 py-2 text-sm font-semibold text-rose-200"
            >
              {error}
            </p>
          )}

          <div className="grid grid-cols-3 gap-2" aria-label="PIN-Tastenfeld">
            {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((digit) => (
              <button
                key={digit}
                type="button"
                onClick={() => appendDigit(digit)}
                className="min-h-14 rounded-xl bg-slate-800 font-mono text-2xl font-black text-white hover:bg-slate-700 active:scale-95 focus-visible:ring-2 focus-visible:ring-indigo-300"
              >
                {digit}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setPin("")}
              className="min-h-14 rounded-xl bg-slate-800 text-sm font-bold text-slate-300 hover:bg-slate-700 focus-visible:ring-2 focus-visible:ring-indigo-300"
            >
              Löschen
            </button>
            <button
              type="button"
              onClick={() => appendDigit("0")}
              className="min-h-14 rounded-xl bg-slate-800 font-mono text-2xl font-black text-white hover:bg-slate-700 active:scale-95 focus-visible:ring-2 focus-visible:ring-indigo-300"
            >
              0
            </button>
            <button
              type="button"
              onClick={() => setPin((current) => current.slice(0, -1))}
              className="inline-flex min-h-14 items-center justify-center rounded-xl bg-slate-800 text-slate-300 hover:bg-slate-700 focus-visible:ring-2 focus-visible:ring-indigo-300"
              aria-label="Letzte PIN-Ziffer löschen"
            >
              <Delete className="h-5 w-5" />
            </button>
          </div>

          <button
            type="button"
            disabled={busy || !username.trim() || pin.length < 4}
            onClick={() => void authenticate()}
            className="mt-4 min-h-12 w-full rounded-xl bg-emerald-500 px-4 text-lg font-black text-slate-950 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-emerald-200"
          >
            {busy ? "Wird geprüft …" : "Benutzer bestätigen"}
          </button>
        </section>
      </div>
    </div>
  );
};
