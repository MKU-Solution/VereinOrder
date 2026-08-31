import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api } from "./api";
import {
  SetupStatusContext,
  type SetupCheck,
  type SetupStatusValue,
} from "./setup";

/** Wie bei `maintenance.ts`: ein einzelner Ausfall darf nicht dazu führen,
 * dass die Anwendung dauerhaft leer bleibt - ein erneuter Versuch nach
 * dieser Zeitspanne holt einen bloß vorübergehenden Ausfall nach (z. B.
 * während der Container noch `prisma migrate deploy` ausführt). */
const RETRY_DELAY_MS = 5000;

/**
 * Fragt `GET /setup/status` GENAU EINMAL für die ganze Anwendung ab (statt
 * einmal je Verbraucher, siehe `setup.ts`) und stellt das Ergebnis über den
 * Kontext bereit.
 *
 * Verhalten bei Fehlschlag (Netzwerkfehler, Backend noch beim Migrieren):
 * Der Zustand fällt auf "not-required" zurück, also auf das Verhalten von
 * vor #174 - die Anwendung landet wie gewohnt auf der Anmeldemaske statt auf
 * einer leeren Seite (siehe `maintenance.ts` für dasselbe Vorbild). Im
 * Hintergrund läuft ein erneuter Versuch, der den Zustand korrigiert, sobald
 * die Abfrage wieder gelingt.
 */
export function SetupStatusProvider({ children }: { children: ReactNode }) {
  const [check, setCheck] = useState<SetupCheck>("loading");

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const load = async () => {
      try {
        const res = await api.get<{ setupRequired: boolean }>("/setup/status");
        if (cancelled) return;
        setCheck(res.data.setupRequired ? "required" : "not-required");
      } catch (err) {
        if (cancelled) return;
        console.error(
          "Ersteinrichtungsstatus konnte nicht geladen werden",
          err,
        );
        setCheck("not-required");
        timer = setTimeout(load, RETRY_DELAY_MS);
      }
    };

    load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  // Siehe `SetupStatusValue.markCompleted` in `setup.ts`: `Setup.tsx` ruft
  // dies unmittelbar nach einer erfolgreichen Kontoanlage auf, damit
  // `AuthGuard` nicht mit dem veralteten Stand "required" auf `/setup`
  // zurückverweist.
  const markCompleted = useCallback(() => setCheck("not-required"), []);

  const value = useMemo<SetupStatusValue>(
    () => ({ check, markCompleted }),
    [check, markCompleted],
  );

  return (
    <SetupStatusContext.Provider value={value}>
      {children}
    </SetupStatusContext.Provider>
  );
}

/**
 * Nur für Tests: injiziert einen festen Zustand, ohne `GET /setup/status`
 * aufzurufen oder auf eine Netzwerkantwort zu warten. `markCompleted` ist
 * hier wirkungslos (`vi.fn()`-artiges No-op reicht für die Tests, die diesen
 * Provider verwenden - keiner von ihnen prüft, DASS `markCompleted`
 * aufgerufen wurde, nur die Auswirkung auf `check` in `SetupStatusProvider`
 * selbst, siehe `SetupStatusProvider.test.tsx`).
 */
export function SetupStatusTestProvider({
  value,
  children,
}: {
  value: SetupCheck;
  children: ReactNode;
}) {
  const contextValue = useMemo<SetupStatusValue>(
    () => ({ check: value, markCompleted: () => {} }),
    [value],
  );
  return (
    <SetupStatusContext.Provider value={contextValue}>
      {children}
    </SetupStatusContext.Provider>
  );
}
