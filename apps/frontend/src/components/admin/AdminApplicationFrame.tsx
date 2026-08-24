import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  LayoutDashboard,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  UserRoundCog,
  X,
} from "lucide-react";
import { Link, NavLink } from "react-router-dom";

import { ADMIN_NAVIGATION_GROUPS, ADMIN_PAGES } from "./adminAreaRegistry";

const SIDEBAR_PREFERENCE_KEY = "adminSidebarVisible";

interface AdminApplicationFrameProps {
  username: string;
  onExitAdmin: () => void;
  onSwitchUser: () => void;
  onLogout: () => void;
  children: ReactNode;
}

interface AdminNavigationProps {
  onNavigate?: () => void;
}

const AdminNavigation = ({ onNavigate }: AdminNavigationProps) => (
  <nav aria-label="Verwaltungsbereiche" className="space-y-5">
    {ADMIN_NAVIGATION_GROUPS.map((group) => {
      const pages = ADMIN_PAGES.filter((page) => page.group === group.id);
      return (
        <div key={group.id}>
          <p className="mb-1.5 px-3 text-[0.6875rem] font-bold uppercase tracking-[0.16em] text-slate-400">
            {group.label}
          </p>
          <ul className="space-y-1">
            {pages.map((page) => {
              const Icon = page.icon;
              return (
                <li key={page.id}>
                  <NavLink
                    to={page.path}
                    onClick={onNavigate}
                    className={({ isActive }) =>
                      `group flex min-h-11 items-center gap-3 rounded-[10px] border-l-4 px-3 py-2 text-sm font-semibold leading-5 transition-colors focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-amber-200 ${
                        isActive
                          ? "border-indigo-300 bg-slate-800 text-indigo-300"
                          : "border-transparent text-slate-200 hover:border-slate-600 hover:bg-slate-800/70 hover:text-white"
                      }`
                    }
                  >
                    <Icon
                      aria-hidden="true"
                      className="h-5 w-5 shrink-0 text-slate-400 group-aria-[current=page]:text-indigo-300"
                    />
                    <span className="min-w-0 whitespace-normal break-words">
                      {page.label}
                    </span>
                  </NavLink>
                </li>
              );
            })}
          </ul>
        </div>
      );
    })}
  </nav>
);

export const AdminApplicationFrame = ({
  username,
  onExitAdmin,
  onSwitchUser,
  onLogout,
  children,
}: AdminApplicationFrameProps) => {
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  const [tabletSidebarVisible, setTabletSidebarVisible] = useState(
    () => localStorage.getItem(SIDEBAR_PREFERENCE_KEY) !== "0",
  );
  const appRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const setTabletSidebar = (visible: boolean) => {
    localStorage.setItem(SIDEBAR_PREFERENCE_KEY, visible ? "1" : "0");
    setTabletSidebarVisible(visible);
  };

  const closeMobileNavigation = () => setMobileNavigationOpen(false);

  useEffect(() => {
    if (!mobileNavigationOpen) return;

    const previousOverflow = document.body.style.overflow;
    const trigger = menuButtonRef.current;
    const appElement = appRef.current;
    document.body.style.overflow = "hidden";
    appElement?.setAttribute("inert", "");
    closeButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeMobileNavigation();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
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
      appElement?.removeAttribute("inert");
      document.removeEventListener("keydown", handleKeyDown);
      trigger?.focus();
    };
  }, [mobileNavigationOpen]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50">
      <div ref={appRef}>
        <a
          href="#admin-content"
          className="fixed left-3 top-3 z-[80] -translate-y-24 rounded-[10px] bg-amber-200 px-4 py-3 font-bold text-slate-950 transition-transform focus:translate-y-0 focus:outline-none"
        >
          Zum Verwaltungsinhalt
        </a>

        <header className="sticky top-0 z-50 flex h-14 items-center justify-between border-b border-slate-700 bg-slate-900 px-3 shadow-lg shadow-slate-950/30 sm:h-16 sm:px-4 lg:px-6">
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <button
              ref={menuButtonRef}
              type="button"
              onClick={() => setMobileNavigationOpen(true)}
              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-[10px] text-slate-100 hover:bg-slate-800 focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-amber-200 sm:hidden"
              aria-label="Verwaltungsmenü öffnen"
              aria-expanded={mobileNavigationOpen}
              aria-controls="admin-mobile-navigation"
            >
              <Menu aria-hidden="true" className="h-6 w-6" />
            </button>

            <Link
              to="/admin/overview"
              className="flex min-w-0 items-center gap-2 rounded-[10px] focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-amber-200"
              aria-label="VereinOrder Verwaltung – Betriebsübersicht öffnen"
            >
              <span className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-indigo-600 sm:flex">
                <LayoutDashboard aria-hidden="true" className="h-4 w-4" />
              </span>
              <span className="truncate text-base font-bold sm:text-lg">
                <span className="hidden sm:inline">VereinOrder · </span>
                Verwaltung
              </span>
            </Link>

            <button
              type="button"
              onClick={() => setTabletSidebar(!tabletSidebarVisible)}
              className="ml-1 hidden min-h-11 items-center gap-2 rounded-[10px] px-3 text-sm font-semibold text-slate-300 hover:bg-slate-800 hover:text-white focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-amber-200 sm:inline-flex lg:hidden"
              aria-label={
                tabletSidebarVisible ? "Sidebar schließen" : "Sidebar öffnen"
              }
              aria-expanded={tabletSidebarVisible}
              aria-controls="admin-sidebar"
            >
              {tabletSidebarVisible ? (
                <PanelLeftClose aria-hidden="true" className="h-5 w-5" />
              ) : (
                <PanelLeftOpen aria-hidden="true" className="h-5 w-5" />
              )}
              <span className="hidden md:inline">Bereiche</span>
            </button>
          </div>

          <div className="flex items-center gap-1 sm:gap-2">
            <button
              type="button"
              onClick={onExitAdmin}
              className="hidden min-h-11 items-center gap-2 rounded-[10px] px-3 text-sm font-semibold text-slate-200 hover:bg-slate-800 focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-amber-200 sm:inline-flex"
            >
              <ArrowLeft aria-hidden="true" className="h-4 w-4" />
              Zur Bestellaufnahme
            </button>
            <button
              type="button"
              onClick={onSwitchUser}
              className="inline-flex min-h-11 items-center gap-2 rounded-[10px] px-2 text-sm font-semibold text-slate-200 hover:bg-slate-800 focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-amber-200 sm:px-3"
              aria-label={`Benutzer wechseln, aktuell ${username}`}
            >
              <UserRoundCog
                aria-hidden="true"
                className="hidden h-5 w-5 sm:block"
              />
              <span className="max-w-20 truncate">{username}</span>
            </button>
            <button
              type="button"
              onClick={onLogout}
              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-[10px] text-slate-200 hover:bg-slate-800 focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-amber-200"
              aria-label="Abmelden"
            >
              <LogOut aria-hidden="true" className="h-5 w-5" />
            </button>
          </div>
        </header>

        <div className="flex min-h-[calc(100vh-3.5rem)] sm:min-h-[calc(100vh-4rem)]">
          <aside
            id="admin-sidebar"
            className={`${tabletSidebarVisible ? "sm:block" : "sm:hidden"} admin-scrollbar sticky top-16 hidden h-[calc(100vh-4rem)] w-[216px] shrink-0 overflow-y-auto border-r border-slate-700 bg-slate-900 px-3 py-5 lg:block lg:w-[264px] lg:px-4`}
          >
            <AdminNavigation />
          </aside>

          <main
            id="admin-content"
            tabIndex={-1}
            className="min-w-0 flex-1 overflow-x-hidden px-4 py-5 focus:outline-none sm:px-5 sm:py-6 lg:px-6"
          >
            <div className="mx-auto w-full max-w-[1180px]">{children}</div>
          </main>
        </div>
      </div>

      {mobileNavigationOpen && (
        <div className="fixed inset-0 z-[70] sm:hidden">
          <button
            type="button"
            className="absolute inset-0 h-full w-full bg-slate-950/80"
            onClick={closeMobileNavigation}
            aria-label="Verwaltungsmenü schließen"
            tabIndex={-1}
          />
          <div
            ref={dialogRef}
            id="admin-mobile-navigation"
            role="dialog"
            aria-modal="true"
            aria-label="Verwaltungsmenü"
            className="admin-scrollbar absolute left-0 top-0 flex h-full w-[min(360px,100vw)] flex-col overflow-y-auto border-r border-slate-700 bg-slate-900 p-4 shadow-2xl motion-safe:animate-[admin-slide-in_180ms_ease-out]"
          >
            <div className="mb-4 flex items-center justify-between border-b border-slate-700 pb-3">
              <span className="text-lg font-bold">Verwaltung</span>
              <button
                ref={closeButtonRef}
                type="button"
                onClick={closeMobileNavigation}
                className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-[10px] text-slate-100 hover:bg-slate-800 focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-amber-200"
                aria-label="Verwaltungsmenü schließen"
              >
                <X aria-hidden="true" className="h-6 w-6" />
              </button>
            </div>

            <AdminNavigation onNavigate={closeMobileNavigation} />

            <div className="mt-auto space-y-1 border-t border-slate-700 pt-4">
              <button
                type="button"
                onClick={() => {
                  closeMobileNavigation();
                  onExitAdmin();
                }}
                className="flex min-h-11 w-full items-center gap-3 rounded-[10px] px-3 text-left text-sm font-semibold text-slate-200 hover:bg-slate-800 focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-amber-200"
              >
                <ArrowLeft aria-hidden="true" className="h-5 w-5" />
                Zur Bestellaufnahme
              </button>
              <button
                type="button"
                onClick={() => {
                  closeMobileNavigation();
                  onSwitchUser();
                }}
                className="flex min-h-11 w-full items-center gap-3 rounded-[10px] px-3 text-left text-sm font-semibold text-slate-200 hover:bg-slate-800 focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-amber-200"
              >
                <UserRoundCog aria-hidden="true" className="h-5 w-5" />
                Benutzer wechseln
              </button>
              <button
                type="button"
                onClick={onLogout}
                className="flex min-h-11 w-full items-center gap-3 rounded-[10px] px-3 text-left text-sm font-semibold text-slate-200 hover:bg-slate-800 focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-amber-200"
              >
                <LogOut aria-hidden="true" className="h-5 w-5" />
                Abmelden
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
