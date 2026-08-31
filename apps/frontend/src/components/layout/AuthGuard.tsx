import { Navigate, Outlet } from "react-router-dom";
import { useAuthStore } from "../../store/useAuthStore";

/**
 * Prüft nur noch die Anmeldung. Die Ersteinrichtung (#174) wird ab jetzt
 * gemeinsam mit `/login` und dem Catch-all über `RequireSetupComplete`
 * geprüft, das in `App.tsx` als Layout-Route außen um diesen Baum liegt -
 * siehe die Begründung dort für die Konsolidierung.
 */
export const AuthGuard = () => {
  const { token, user } = useAuthStore();

  if (!token || !user) {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
};
