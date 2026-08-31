import { createContext, useContext } from "react";

/**
 * Issue #174 (Oberfläche der Ersteinrichtung), Vorbild `maintenance.ts`:
 * `GET /setup/status` (#173) ist unangemeldet erreichbar und antwortet, ob
 * die Benutzertabelle noch leer ist. Der Abfragezeitpunkt ist die eigentliche
 * Arbeit dieses Issues - der Zustand muss feststehen, BEVOR `DefaultRoute`
 * oder `AuthGuard` eine Entscheidung treffen, sonst landet ein frisches
 * System auf der Anmeldemaske, an der es nichts geben kann.
 *
 * Kontext, Hooks und Typen stehen in dieser reinen `.ts`-Datei, die
 * eigentlichen Provider-Komponenten (JSX) in `SetupStatusProvider.tsx`
 * daneben - sonst verletzt dieselbe Datei
 * `react-refresh/only-export-components`, weil sie dann Komponenten UND
 * Nicht-Komponenten (Hooks, Kontext, Typen) exportieren würde.
 */
export type SetupCheck = "loading" | "required" | "not-required";

export interface SetupStatusValue {
  check: SetupCheck;
  /**
   * Setzt den Zustand sofort auf "not-required", OHNE auf einen erneuten
   * Abruf von `GET /setup/status` zu warten.
   *
   * Grund, warum das nötig ist (ein echter Fehler, beim manuellen
   * Browsertest gefunden, nicht nur vorsorglich): `SetupStatusProvider`
   * fragt den Status GENAU EINMAL beim Einhängen ab (siehe dort). Ohne
   * diese Methode bliebe der Kontext nach einer erfolgreichen Anlage in
   * `Setup.tsx` weiterhin bei "required" stehen - und `AuthGuard` würde den
   * gerade frisch angemeldeten Administrator sofort wieder auf `/setup`
   * zurückschicken, weil sein `setupCheck` denselben, nun veralteten
   * Kontextwert liest. `Setup.tsx` ruft diese Methode deshalb unmittelbar
   * auf, nachdem `POST /setup/admin` erfolgreich war.
   */
  markCompleted: () => void;
}

/**
 * Standardwert (ohne umschließenden `SetupStatusProvider`): "not-required"
 * mit wirkungslosem `markCompleted`. Jede Stelle, die diesen Kontext über
 * `useSetupRequired` liest, verhält sich dann synchron wie vor #174 - ein
 * bereits eingerichtetes System.
 *
 * Das ist bewusst kein Sicherheitsmechanismus (die verbindliche Schranke
 * steht im Backend, `SetupService.createFirstAdministrator`), sondern eine
 * Testbarkeitsentscheidung: `AuthGuard` und `DefaultRoute` waren vor #174
 * rein synchron, und ein guter Teil der bestehenden Komponententests
 * (z. B. `AdminDashboard.acceptance.test.tsx`) rendert sie ohne eigenen
 * Warteschritt und prüft die Ausgabe unmittelbar danach. Nur die
 * tatsächlich ausgelieferte Anwendung (`App.tsx`) umschließt ihren
 * Routenbaum mit `SetupStatusProvider` und startet dort bewusst bei
 * "loading", bis die erste Antwort von `GET /setup/status` eingetroffen
 * ist.
 */
export const SetupStatusContext = createContext<SetupStatusValue>({
  check: "not-required",
  markCompleted: () => {},
});

/** Wird von `DefaultRoute`, `AuthGuard` und der Setup-Seite selbst gelesen. */
export function useSetupRequired(): SetupCheck {
  return useContext(SetupStatusContext).check;
}

/** Wird von der Setup-Seite nach erfolgreicher Anlage aufgerufen. */
export function useMarkSetupCompleted(): () => void {
  return useContext(SetupStatusContext).markCompleted;
}
