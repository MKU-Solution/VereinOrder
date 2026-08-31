import { useRef, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useAuthStore } from "../store/useAuthStore";
import { useMarkSetupCompleted, useSetupRequired } from "../lib/setup";
import { defaultRouteForRole } from "../components/layout/routeAccess";
import { ShieldCheck, User, KeyRound, WifiOff } from "lucide-react";

/**
 * Issue #174: Muster fuer die PIN, exakt uebernommen aus
 * `apps/backend/src/users/users.dto.ts` (`PIN_PATTERN`). Ein eigenes,
 * abweichendes Muster im Frontend ergaebe ein Konto, das sich anlegen,
 * aber nicht anmelden liesse - deshalb hier bewusst dasselbe Literal wie
 * dort, mit demselben Kommentarverweis. Ein Import ueber Paketgrenzen
 * (Frontend <-> Backend) gibt es in diesem Monorepo fuer DTOs nicht, ein
 * Duplikat mit Verweis ist die naechstbeste Absicherung.
 */
const PIN_PATTERN = /^\d{4,12}$/;
const USERNAME_MAX_LENGTH = 64;

/**
 * Gestaltungsentscheidung (Issue #174):
 *
 * - EIN Schritt, kein mehrstufiger Assistent. Der Umfang ist bewusst auf
 *   drei Felder begrenzt (Benutzername, PIN, PIN-Wiederholung); ein
 *   Mehrschritt-Wizard wuerde hier nur Klicks addieren, ohne dass zwischen
 *   den Schritten etwas zu entscheiden waere.
 * - PIN-Eingabe als Textfeld wie in `Login.tsx`, NICHT als Tastenfeld wie
 *   `SessionGate.tsx`. Das Tastenfeld dort ist fuer die schnelle,
 *   einhaendige Anmeldung an einem gemeinsam genutzten Geraet gebaut. Hier
 *   wird eine NEUE PIN bewusst gewaehlt und zweimal eingegeben, mit
 *   Wahrscheinlichkeit einer angeschlossenen Tastatur (Ersteinrichtung
 *   erfolgt oft am Laptop, bevor das Geraet ans Festzelt-Tablet geht) -
 *   und `Login.tsx` ist fuer genau diesen Anwendungsfall (Benutzername +
 *   PIN gemeinsam per Tastatur) bereits das Vorbild, das laut Aufgabe nicht
 *   neu gestaltet werden soll.
 * - Der Hinweis zum Gaeste-WLAN steht permanent sichtbar ueber dem
 *   Formular, nicht in einem Dialog, der weggeklickt werden kann - er soll
 *   nicht uebersehen werden koennen, aber auch keinen zusaetzlichen Schritt
 *   erzwingen.
 */
export const Setup = () => {
  const setupCheck = useSetupRequired();
  const markSetupCompleted = useMarkSetupCompleted();
  const setToken = useAuthStore((state) => state.setToken);
  const navigate = useNavigate();

  const [username, setUsername] = useState("");
  const [pin, setPin] = useState("");
  const [pinRepeat, setPinRepeat] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  /**
   * Verhindert ein selbstverursachtes Zurückschnappen auf `/login` in der
   * kurzen Zeitspanne zwischen `markSetupCompleted()` (unten, unmittelbar
   * nach der erfolgreichen Anlage) und dem eigenen `navigate(...)` an das
   * Ende von `handleSubmit`: Sobald `markSetupCompleted()` den Kontext auf
   * "not-required" setzt, würde die Prüfung direkt darunter sonst bei der
   * nächsten Zwischen-Neuzeichnung dieser Komponente selbst auslösen - noch
   * bevor `POST /auth/login` überhaupt geantwortet hat. Ein Ref statt
   * State, weil die Sperre synchron gesetzt werden muss, ohne selbst eine
   * Neuzeichnung auszulösen.
   */
  const justCompletedRef = useRef(false);

  if (setupCheck === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950">
        <span
          className="animate-spin h-8 w-8 border-2 border-white/30 border-t-white rounded-full"
          aria-label="Lädt"
        />
      </div>
    );
  }

  // Die Ersteinrichtung ist bereits abgeschlossen (oder gerade eben, in
  // einem anderen Tab) - dieser Weg existiert nur, solange die
  // Benutzertabelle leer ist. Ausnahme: der eigene, gerade laufende
  // Abschluss dieses Formulars (siehe `justCompletedRef` oben).
  if (setupCheck === "not-required" && !justCompletedRef.current) {
    return <Navigate to="/login" replace />;
  }

  const validate = (): string | null => {
    const trimmedUsername = username.trim();
    if (!trimmedUsername) return "Bitte gib einen Benutzernamen ein.";
    if (trimmedUsername.length > USERNAME_MAX_LENGTH) {
      return `Der Benutzername darf höchstens ${USERNAME_MAX_LENGTH} Zeichen lang sein.`;
    }
    if (!PIN_PATTERN.test(pin)) {
      return "Die PIN muss aus 4 bis 12 Ziffern bestehen.";
    }
    if (pin !== pinRepeat) {
      return "Die Wiederholung stimmt nicht mit der PIN überein.";
    }
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setIsLoading(true);
    const trimmedUsername = username.trim();
    try {
      await api.post("/setup/admin", { username: trimmedUsername, pin });
    } catch (err: any) {
      setError(
        err.response?.data?.message ||
          "Die Ersteinrichtung ist fehlgeschlagen. Bitte überprüfe deine Eingaben.",
      );
      setIsLoading(false);
      return;
    }

    // Das Konto existiert jetzt. Kontext sofort nachziehen (siehe
    // `justCompletedRef` und `SetupStatusValue.markCompleted`), sonst
    // schickt `AuthGuard` gleich mit einem veralteten "required" zurück.
    justCompletedRef.current = true;
    markSetupCompleted();

    // Der Betreiber soll nach dem Anlegen nicht erneut tippen muessen
    // (Issue #174): unmittelbar mit den eben vergebenen Daten anmelden.
    try {
      const response = await api.post("/auth/login", {
        username: trimmedUsername,
        pin,
      });
      setToken(response.data.access_token);
      const loggedInUser = useAuthStore.getState().user;
      navigate(
        loggedInUser ? defaultRouteForRole(loggedInUser.role) : "/login",
      );
    } catch (err: any) {
      // Sehr seltener Randfall: das Konto wurde angelegt, die unmittelbar
      // folgende Anmeldung ist aber gescheitert (z. B. Netzwerkfehler
      // zwischen beiden Anfragen). Das Konto existiert bereits - der Weg
      // zurueck ist die normale Anmeldemaske, nicht ein erneuter Versuch
      // hier (der zweite Aufruf von POST /setup/admin wuerde ohnehin mit
      // 409 abgewiesen).
      setError(
        "Der Administrator wurde angelegt, die automatische Anmeldung ist aber fehlgeschlagen. Bitte melde dich manuell an.",
      );
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden bg-slate-950">
      <div className="absolute top-[-10%] left-[-10%] w-96 h-96 bg-indigo-600/30 rounded-full blur-3xl animate-pulse"></div>
      <div className="absolute bottom-[-10%] right-[-10%] w-96 h-96 bg-emerald-600/20 rounded-full blur-3xl animate-pulse delay-1000"></div>

      <div className="glass w-full max-w-md p-8 rounded-3xl z-10 animate-slide-up relative overflow-hidden">
        <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-indigo-500/50 to-transparent"></div>

        <div className="text-center mb-6 animate-fade-in">
          <div className="w-16 h-16 bg-gradient-to-br from-indigo-500 to-emerald-500 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-indigo-500/20">
            <ShieldCheck className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-slate-400">
            Ersteinrichtung
          </h1>
          <p className="text-slate-400 mt-2 text-sm">
            Dieses System wird zum ersten Mal gestartet. Lege das
            Administrator-Konto an, um fortzufahren.
          </p>
        </div>

        <div
          role="note"
          className="mb-6 bg-amber-500/10 border border-amber-500/40 text-amber-300 px-4 py-3 rounded-xl text-sm flex items-start gap-2 animate-fade-in"
        >
          <WifiOff className="w-5 h-5 shrink-0 mt-0.5" aria-hidden="true" />
          <p>
            Solange die Ersteinrichtung offen ist, wird Administrator, wer
            zuerst darauf zugreift. Schließe sie ab, <strong>bevor</strong> du
            das Gäste-WLAN öffnest.
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="space-y-5 animate-fade-in"
          style={{ animationDelay: "100ms" }}
        >
          {error && (
            <div className="bg-red-500/10 border border-red-500/50 text-red-400 px-4 py-3 rounded-xl text-sm flex items-start gap-2">
              <span className="shrink-0 mt-0.5">⚠</span>
              <p>{error}</p>
            </div>
          )}

          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider ml-1">
              Benutzername
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                <User className="h-5 w-5 text-slate-500" />
              </div>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                maxLength={USERNAME_MAX_LENGTH}
                className="w-full bg-slate-900/50 border border-slate-700/50 rounded-xl py-3 pl-11 pr-4 text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition-all"
                placeholder="Benutzername"
                required
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider ml-1">
              PIN
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                <KeyRound className="h-5 w-5 text-slate-500" />
              </div>
              <input
                type="password"
                inputMode="numeric"
                pattern="[0-9]*"
                minLength={4}
                maxLength={12}
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                className="w-full bg-slate-900/50 border border-slate-700/50 rounded-xl py-3 pl-11 pr-4 text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition-all tracking-widest text-lg font-mono"
                placeholder="••••"
                required
              />
            </div>
            <p className="text-xs text-slate-500 ml-1">4 bis 12 Ziffern.</p>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider ml-1">
              PIN wiederholen
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                <KeyRound className="h-5 w-5 text-slate-500" />
              </div>
              <input
                type="password"
                inputMode="numeric"
                pattern="[0-9]*"
                minLength={4}
                maxLength={12}
                value={pinRepeat}
                onChange={(e) => setPinRepeat(e.target.value)}
                className="w-full bg-slate-900/50 border border-slate-700/50 rounded-xl py-3 pl-11 pr-4 text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition-all tracking-widest text-lg font-mono"
                placeholder="••••"
                required
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full mt-4 bg-gradient-to-r from-indigo-500 to-indigo-600 hover:from-indigo-400 hover:to-indigo-500 text-white font-semibold py-3.5 px-4 rounded-xl shadow-lg shadow-indigo-500/25 transition-all active:scale-[0.98] disabled:opacity-70 disabled:active:scale-100 flex justify-center items-center gap-2"
          >
            {isLoading ? (
              <span className="animate-spin h-5 w-5 border-2 border-white/30 border-t-white rounded-full"></span>
            ) : (
              <span>Administrator anlegen</span>
            )}
          </button>
        </form>
      </div>
    </div>
  );
};
