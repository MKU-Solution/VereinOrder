import { Navigate, Outlet } from "react-router-dom";
import { useAuthStore } from "../../store/useAuthStore";
import { useSetupRequired } from "../../lib/setup";

/**
 * Issue #174: Steht die Ersteinrichtung aus, führt auch jeder geschützte
 * Pfad (z. B. `/` direkt aufgerufen, ohne über `DefaultRoute` zu laufen) auf
 * `/setup` - diese Prüfung kommt bewusst VOR der Anmeldeprüfung, denn ohne
 * Benutzer kann ohnehin niemand angemeldet sein.
 */
export const AuthGuard = () => {
  const { token, user } = useAuthStore();
  const setupCheck = useSetupRequired();

  if (setupCheck === "loading") return null;
  if (setupCheck === "required") {
    return <Navigate to="/setup" replace />;
  }

  if (!token || !user) {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
};
