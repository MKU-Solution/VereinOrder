import type { UserRole } from "../../store/useAuthStore";

export interface RouteAccess {
  path: string;
  label?: string;
  roles: readonly UserRole[];
}

export const routeAccess = {
  dashboard: {
    path: "/",
    label: "Bestellaufnahme",
    roles: ["ADMINISTRATOR", "WAITER", "CASHIER"],
  },
  quickSale: {
    path: "/quick-sale",
    label: "Bonkasse",
    roles: ["ADMINISTRATOR", "CASHIER"],
  },
  stationSale: {
    path: "/station-sale",
    label: "Stationskasse",
    roles: ["ADMINISTRATOR", "CASHIER", "STATION"],
  },
  unpaid: {
    path: "/unpaid",
    label: "Offene Tische",
    roles: ["ADMINISTRATOR", "WAITER", "CASHIER"],
  },
  stations: {
    path: "/stations",
    label: "Stationen",
    roles: ["ADMINISTRATOR", "STATION", "WAITER"],
  },
  station: {
    path: "/stations/:id",
    roles: ["ADMINISTRATOR", "STATION", "WAITER"],
  },
  cashier: {
    path: "/cashier",
    label: "Meine Kassa",
    // STATION ergänzt (Issue #66, Stationskasse): sonst kann die Rolle ihre
    // eigene Kassensitzung nicht abschließen. Das Backend lässt STATION hier
    // bereits zu (sessions.controller.ts).
    roles: ["ADMINISTRATOR", "WAITER", "CASHIER", "STATION"],
  },
  runner: {
    path: "/runner",
    label: "Zustellung",
    roles: ["ADMINISTRATOR", "RUNNER"],
  },
  revision: {
    path: "/revision",
    label: "Revision",
    roles: ["ADMINISTRATOR", "EVENT_MANAGER", "REVISION"],
  },
  admin: { path: "/admin", label: "Verwaltung", roles: ["ADMINISTRATOR"] },
} as const satisfies Record<string, RouteAccess>;

export const navigationRoutes = [
  routeAccess.dashboard,
  routeAccess.quickSale,
  routeAccess.stationSale,
  routeAccess.unpaid,
  routeAccess.stations,
  routeAccess.runner,
  routeAccess.revision,
  routeAccess.admin,
] as const;

export const canAccessRoute = (role: UserRole, route: RouteAccess) =>
  route.roles.includes(role);

export const defaultRouteForRole = (role: UserRole) => {
  if (role === "CASHIER") return routeAccess.quickSale.path;
  if (role === "EVENT_MANAGER") return routeAccess.revision.path;
  if (role === "STATION") return routeAccess.stations.path;
  if (role === "RUNNER") return routeAccess.runner.path;
  if (role === "REVISION") return routeAccess.revision.path;
  return routeAccess.dashboard.path;
};
