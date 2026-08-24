import { useEffect, useRef, useState } from "react";
import { Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuthStore } from "../../store/useAuthStore";
import {
  LogOut,
  LayoutDashboard,
  Menu,
  UserRoundCog,
  Wallet,
  X,
} from "lucide-react";
import {
  canAccessRoute,
  navigationRoutes,
  routeAccess,
  type RouteAccess,
} from "./routeAccess";
import { SessionGate } from "./SessionGate";
import { useMaintenanceStatus } from "../../lib/maintenance";
import { Maintenance } from "../../pages/Maintenance";
import { AdminApplicationFrame } from "../admin/AdminApplicationFrame";

const allowedLockTimeouts = [30, 60, 120, 300, 900];

export const AppLayout = () => {
  const { logout, user } = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();
  const maintenanceStatus = useMaintenanceStatus();
  const isAdminRoute =
    location.pathname === "/admin" || location.pathname.startsWith("/admin/");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [lockTimeoutSeconds, setLockTimeoutSeconds] = useState(() => {
    const stored = Number(localStorage.getItem("authLockTimeoutSeconds"));
    return allowedLockTimeouts.includes(stored) ? stored : 60;
  });
  const [sessionMode, setSessionMode] = useState<"locked" | "switch" | null>(
    () => (localStorage.getItem("screenLocked") === "1" ? "locked" : null),
  );
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);

  const visibleNavigation = user
    ? navigationRoutes.filter((route) => canAccessRoute(user.role, route))
    : [];
  const canUseCashier = user
    ? canAccessRoute(user.role, routeAccess.cashier)
    : false;

  const handleLogout = () => {
    closeDrawer();
    setSessionMode(null);
    logout();
    navigate("/login");
  };

  const updateLockTimeout = (seconds: number) => {
    if (!allowedLockTimeouts.includes(seconds)) return;
    localStorage.setItem("authLockTimeoutSeconds", String(seconds));
    localStorage.setItem("authLastActivityAt", String(Date.now()));
    setLockTimeoutSeconds(seconds);
  };

  const finishSessionAuthentication = () => {
    localStorage.removeItem("screenLocked");
    localStorage.setItem("authLastActivityAt", String(Date.now()));
    setSessionMode(null);
  };

  const closeDrawer = () => setDrawerOpen(false);
  const navigateTo = (path: string) => {
    navigate(path);
    closeDrawer();
  };
  const isActiveRoute = (route: RouteAccess) =>
    route.path === "/stations"
      ? location.pathname === "/stations" ||
        location.pathname.startsWith("/stations/")
      : location.pathname === route.path;

  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const desktopQuery = window.matchMedia("(min-width: 1024px)");
    const handleBreakpointChange = (event: MediaQueryListEvent) => {
      if (event.matches) setDrawerOpen(false);
    };

    if (desktopQuery.matches) setDrawerOpen(false);
    if (desktopQuery.addEventListener) {
      desktopQuery.addEventListener("change", handleBreakpointChange);
      return () =>
        desktopQuery.removeEventListener("change", handleBreakpointChange);
    }

    desktopQuery.addListener(handleBreakpointChange);
    return () => desktopQuery.removeListener(handleBreakpointChange);
  }, []);

  useEffect(() => {
    if (!drawerOpen) return;
    const previousOverflow = document.body.style.overflow;
    const menuButton = menuButtonRef.current;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeDrawer();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = drawerRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
      menuButton?.focus();
    };
  }, [drawerOpen]);

  useEffect(() => {
    if (!user || sessionMode === "locked") return;
    let timerId: number | undefined;

    const lockScreen = () => {
      localStorage.setItem("screenLocked", "1");
      setDrawerOpen(false);
      setSessionMode("locked");
    };
    const schedule = (recordActivity: boolean) => {
      if (recordActivity) {
        localStorage.setItem("authLastActivityAt", String(Date.now()));
      }
      if (timerId) window.clearTimeout(timerId);
      let lastActivity = Number(localStorage.getItem("authLastActivityAt"));
      if (!Number.isFinite(lastActivity) || lastActivity <= 0) {
        lastActivity = Date.now();
        localStorage.setItem("authLastActivityAt", String(lastActivity));
      }
      const remaining = lockTimeoutSeconds * 1000 - (Date.now() - lastActivity);
      if (remaining <= 0) {
        lockScreen();
        return;
      }
      timerId = window.setTimeout(lockScreen, remaining);
    };
    const handleActivity = () => schedule(true);

    schedule(false);
    const events: Array<keyof WindowEventMap> = [
      "pointerdown",
      "keydown",
      "touchstart",
      "scroll",
    ];
    events.forEach((event) =>
      window.addEventListener(event, handleActivity, { passive: true }),
    );
    return () => {
      if (timerId) window.clearTimeout(timerId);
      events.forEach((event) =>
        window.removeEventListener(event, handleActivity),
      );
    };
  }, [lockTimeoutSeconds, sessionMode, user]);

  const sessionGate = sessionMode && user && (
    <SessionGate
      key={sessionMode}
      mode={sessionMode}
      timeoutSeconds={lockTimeoutSeconds}
      onTimeoutChange={updateLockTimeout}
      onClose={() => {
        localStorage.setItem("authLastActivityAt", String(Date.now()));
        setSessionMode(null);
      }}
      onAuthenticated={finishSessionAuthentication}
    />
  );

  // Issue #67 (Wartungsmodus): für ADMINISTRATOR bleibt /admin/* bedienbar
  // (Entwurf Abschnitt 6) - jede andere Rolle bekommt statt der gewohnten
  // Oberfläche die ganzseitige Anzeige, weil jede ihrer Anfragen ohnehin 503
  // bekäme. Erst nach diesem Punkt geprüft (nicht als früher return), damit
  // sämtliche Hooks oben immer in derselben Reihenfolge laufen.
  if (maintenanceStatus && maintenanceStatus.phase !== "OPEN") {
    if (user?.role === "ADMINISTRATOR") {
      if (!isAdminRoute) {
        return <Navigate to="/admin/overview" replace />;
      }
    } else {
      return <Maintenance status={maintenanceStatus} />;
    }
  }

  if (isAdminRoute && user) {
    return (
      <>
        <AdminApplicationFrame
          username={user.username}
          onExitAdmin={() => navigate("/")}
          onSwitchUser={() => setSessionMode("switch")}
          onLogout={handleLogout}
        >
          <Outlet />
        </AdminApplicationFrame>
        {sessionGate}
      </>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col">
      {/* Top Navigation Bar */}
      <header className="glass sticky top-0 z-50 px-4 py-3 flex justify-between items-center rounded-b-2xl mb-4 mx-2 mt-2">
        <div className="flex items-center gap-6">
          <button
            type="button"
            className="flex items-center gap-2 rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-300"
            onClick={() => navigateTo("/")}
            aria-label="Zur Bestellaufnahme"
          >
            <div className="w-8 h-8 bg-indigo-500 rounded-lg flex items-center justify-center">
              <LayoutDashboard className="w-4 h-4 text-white" />
            </div>
            <span className="font-semibold text-lg bg-clip-text text-transparent bg-gradient-to-r from-white to-slate-300">
              VereinOrder
            </span>
          </button>

          <nav
            className="hidden lg:flex items-center gap-2"
            aria-label="Hauptnavigation"
          >
            {visibleNavigation.map((route) => (
              <button
                key={route.path}
                type="button"
                onClick={() => navigateTo(route.path)}
                aria-current={isActiveRoute(route) ? "page" : undefined}
                className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${isActiveRoute(route) ? "bg-indigo-500/20 text-indigo-300" : "hover:bg-slate-800/50 text-slate-300"}`}
              >
                {route.label}
              </button>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-2">
          {canUseCashier && (
            <button
              type="button"
              onClick={() => navigateTo("/cashier")}
              aria-current={
                location.pathname === "/cashier" ? "page" : undefined
              }
              className="hidden lg:flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-800/50 hover:bg-slate-700/50 text-slate-300 transition-colors"
            >
              <Wallet className="w-4 h-4 text-emerald-400" />
              <span className="text-sm font-medium">Meine Kassa</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => setSessionMode("switch")}
            className="hidden lg:inline-flex min-h-10 items-center gap-2 rounded-xl bg-slate-800/50 px-3 py-2 text-slate-300 transition-colors hover:bg-slate-700/50"
            aria-label="Benutzer wechseln"
          >
            <UserRoundCog className="w-5 h-5" />
            <span className="text-sm font-medium">{user?.username}</span>
          </button>

          <button
            type="button"
            onClick={handleLogout}
            className="hidden lg:block p-2 rounded-xl bg-slate-800/50 hover:bg-slate-700/50 text-slate-300 transition-colors"
            aria-label="Abmelden"
          >
            <LogOut className="w-5 h-5" />
          </button>
          <button
            ref={menuButtonRef}
            type="button"
            onClick={() => setDrawerOpen(true)}
            className="lg:hidden min-w-11 min-h-11 inline-flex items-center justify-center rounded-xl bg-slate-800/50 hover:bg-slate-700/50 text-slate-200"
            aria-label="Navigation öffnen"
            aria-expanded={drawerOpen}
            aria-controls="mobile-navigation"
          >
            <Menu className="w-6 h-6" />
          </button>
        </div>
      </header>

      {drawerOpen && (
        <div className="lg:hidden fixed inset-0 z-[60]" role="presentation">
          <button
            type="button"
            className="absolute inset-0 w-full h-full bg-slate-950/70"
            onClick={closeDrawer}
            aria-label="Navigation schließen"
            tabIndex={-1}
          />
          <div
            ref={drawerRef}
            id="mobile-navigation"
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
            className="absolute right-0 top-0 h-full w-full max-w-sm bg-slate-900 shadow-2xl p-5 flex flex-col"
          >
            <div className="flex items-center justify-between mb-6">
              <span className="font-semibold text-lg text-white">
                Navigation
              </span>
              <button
                ref={closeButtonRef}
                type="button"
                onClick={closeDrawer}
                className="min-w-11 min-h-11 inline-flex items-center justify-center rounded-xl hover:bg-slate-800 text-slate-200"
                aria-label="Navigation schließen"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
            <nav className="space-y-1" aria-label="Mobile Hauptnavigation">
              {visibleNavigation.map((route) => (
                <button
                  key={route.path}
                  type="button"
                  onClick={() => navigateTo(route.path)}
                  aria-current={isActiveRoute(route) ? "page" : undefined}
                  className={`w-full text-left px-4 py-3 rounded-xl text-base font-medium transition-colors ${isActiveRoute(route) ? "bg-indigo-500/20 text-indigo-300" : "text-slate-200 hover:bg-slate-800"}`}
                >
                  {route.label}
                </button>
              ))}
            </nav>
            <div className="mt-auto pt-5 border-t border-slate-700 space-y-2">
              {canUseCashier && (
                <button
                  type="button"
                  onClick={() => navigateTo("/cashier")}
                  aria-current={
                    location.pathname === "/cashier" ? "page" : undefined
                  }
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left text-slate-200 hover:bg-slate-800"
                >
                  <Wallet className="w-5 h-5 text-emerald-400" /> Meine Kassa
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  closeDrawer();
                  setSessionMode("switch");
                }}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left text-slate-200 hover:bg-slate-800"
              >
                <UserRoundCog className="w-5 h-5 text-indigo-300" /> Benutzer
                wechseln
              </button>
              <button
                type="button"
                onClick={handleLogout}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left text-slate-200 hover:bg-slate-800"
              >
                <LogOut className="w-5 h-5" /> Abmelden
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <main className="flex-1 px-4 pb-8 max-w-7xl mx-auto w-full animate-fade-in">
        <Outlet />
      </main>

      {sessionGate}
    </div>
  );
};
