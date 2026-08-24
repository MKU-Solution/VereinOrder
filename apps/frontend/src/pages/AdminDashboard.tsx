import { AdminDashboardController } from "../components/admin/AdminDashboardController";

/**
 * Stabiler Einstiegspunkt der Route `/admin`.
 *
 * Die Bereichsregistrierung, der gemeinsame Ladevertrag und die fachlichen
 * Ansichten liegen bewusst außerhalb dieser Route. So bleibt der öffentliche
 * Pfad unverändert, während der spätere Admin-Panel-Rahmen eine schmale
 * Orchestrierungskomponente erhält.
 */
export const AdminDashboard = () => <AdminDashboardController />;
