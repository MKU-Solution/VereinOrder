import { Navigate, Outlet } from "react-router-dom";
import { useSetupRequired } from "../../lib/setup";

/**
 * Issue #174 (Nachbesserung): EINE Stelle für "steht die Ersteinrichtung
 * aus, dann führt jeder Weg auf /setup" - als Layout-Route um den gesamten
 * übrigen Routenbaum gelegt (siehe `App.tsx`), statt dieselbe Prüfung an
 * mehreren Stellen zu wiederholen.
 *
 * Die erste Fassung prüfte in `DefaultRoute` (dem Catch-all `*`) und in
 * `AuthGuard` (dem geschützten Baum) je für sich - und übersah dabei `/login`:
 * eine eigenständige Route auf derselben Ebene, die an beiden vorbeilief.
 * Auf einem frischen System zeigte ein direkter Aufruf von `/login` deshalb
 * weiterhin die Anmeldemaske, obwohl es noch kein Konto gab, mit dem man
 * sich hätte anmelden können - genau die Sackgasse, die #177 abschaffen
 * soll. Drei einzelne Prüfstellen mit derselben Logik (die dritte wäre eine
 * eigene Prüfung vor `/login` gewesen) sind eine Stelle zu viel zum
 * Auseinanderlaufen; ein gemeinsamer Wrapper um den Routenbaum kann diese
 * Lücke strukturell nicht wiederholen, weil jede neue Route automatisch
 * durch ihn hindurchmuss, statt sich selbst darum kümmern zu müssen.
 * `AuthGuard` prüft danach nur noch Anmeldung, nicht mehr Ersteinrichtung.
 *
 * `/setup` selbst liegt bewusst AUSSERHALB dieses Wrappers (siehe
 * `App.tsx`): es ist das Ziel dieser Weiterleitung und trägt eine
 * spiegelbildliche eigene Prüfung in `Setup.tsx` - "required" zeigt dort
 * das Formular, "not-required" leitet zurück auf `/login`. Ein Wrapper, der
 * sich selbst umschließt, würde nur eine Schleife erzeugen.
 */
export const RequireSetupComplete = () => {
  const setupCheck = useSetupRequired();

  if (setupCheck === "loading") return null;
  if (setupCheck === "required") return <Navigate to="/setup" replace />;

  return <Outlet />;
};
