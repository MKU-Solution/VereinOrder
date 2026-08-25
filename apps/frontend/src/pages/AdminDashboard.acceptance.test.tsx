import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ADMIN_PAGES,
  getAdminPageDefinition,
  type AdminPageId,
} from "../components/admin/adminAreaRegistry";
import { AdminDashboardShell } from "../components/admin/AdminDashboardShell";
import { AppLayout } from "../components/layout/AppLayout";
import { AuthGuard } from "../components/layout/AuthGuard";
import { RoleGuard } from "../components/layout/RoleGuard";
import { routeAccess } from "../components/layout/routeAccess";
import { useAuthStore, type UserRole } from "../store/useAuthStore";
import { AdminDashboard } from "./AdminDashboard";

vi.mock("../components/admin/AdminDashboardController", () => ({
  AdminDashboardController: ({ activePage }: { activePage: AdminPageId }) => {
    const page = getAdminPageDefinition(activePage);
    return (
      <AdminDashboardShell
        activePage={activePage}
        unresolvedJobCount={0}
        connectionStatus="connected"
        connectionCheckedAt={new Date()}
      >
        <div data-testid={`admin-view-${activePage}`}>
          <p>{page.description}</p>
        </div>
      </AdminDashboardShell>
    );
  },
}));

vi.mock("../lib/maintenance", () => ({
  getMaintenanceStatus: vi.fn().mockResolvedValue({
    phase: "OPEN",
    since: null,
    expectedUntil: null,
  }),
  useMaintenanceStatus: () => ({
    phase: "OPEN",
    since: null,
    expectedUntil: null,
  }),
}));

vi.mock("../lib/api", () => ({
  api: {
    get: vi.fn().mockResolvedValue({
      data: {
        phase: "OPEN",
        since: null,
        expectedUntil: null,
      },
    }),
    post: vi.fn().mockResolvedValue({ data: {} }),
    patch: vi.fn().mockResolvedValue({ data: {} }),
    delete: vi.fn().mockResolvedValue({ data: {} }),
  },
}));

const CurrentPath = () => {
  const location = useLocation();
  return <output data-testid="current-path">{location.pathname}</output>;
};

const FullGuardedRoutes = () => (
  <Routes>
    <Route
      path="/login"
      element={<h1 data-testid="login-page">Anmeldung</h1>}
    />

    <Route element={<AuthGuard />}>
      <Route element={<AppLayout />}>
        <Route element={<RoleGuard route={routeAccess.dashboard} />}>
          <Route
            path="/"
            element={<h1 data-testid="waiter-sale-page">Bestellaufnahme</h1>}
          />
        </Route>
        <Route element={<RoleGuard route={routeAccess.admin} />}>
          <Route path="/admin/*" element={<AdminDashboard />} />
        </Route>
      </Route>
    </Route>

    <Route path="*" element={<CurrentPath />} />
  </Routes>
);

const loginAs = (role: UserRole, username = "admin") => {
  useAuthStore.setState({
    user: { username, userId: "u1", role },
    token: "valid-test-token",
  });
};

describe("Admin-Panel Akzeptanz- und Barrierefreiheitsprüfung (Issue #126)", () => {
  beforeEach(() => {
    localStorage.clear();
    loginAs("ADMINISTRATOR");

    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  describe("1. Routing, Deep Links & Seitenidentität", () => {
    it.each(ADMIN_PAGES)(
      "rendert $path mit passender Überschrift und semantischer Seitenkennzeichnung",
      (page) => {
        render(
          <MemoryRouter initialEntries={[page.path]}>
            <FullGuardedRoutes />
          </MemoryRouter>,
        );

        // Prüft, dass die Hauptüberschrift (h1) dem Seitentitel entspricht
        const heading = screen.getByRole("heading", {
          level: 1,
          name: page.title,
        });
        expect(heading).toBeInTheDocument();

        // Prüft, dass der Navigationslink in der Desktop-Sidebar als aktive Seite markiert ist
        const nav = screen.getByRole("navigation", {
          name: "Verwaltungsbereiche",
        });
        const activeLink = within(nav).getByRole("link", { name: page.label });
        expect(activeLink).toHaveAttribute("aria-current", "page");
      },
    );

    it("leitet den Basis-Pfad /admin auf die Betriebsübersicht um", () => {
      render(
        <MemoryRouter initialEntries={["/admin"]}>
          <FullGuardedRoutes />
        </MemoryRouter>,
      );

      expect(
        screen.getByRole("heading", { level: 1, name: "Betriebsübersicht" }),
      ).toBeInTheDocument();
    });

    it("zeigt bei ungültigen Admin-Pfaden eine strukturierte 404-Meldung mit Rückkehrlink", () => {
      render(
        <MemoryRouter initialEntries={["/admin/unbekannte-unterseite"]}>
          <FullGuardedRoutes />
        </MemoryRouter>,
      );

      expect(
        screen.getByRole("heading", {
          level: 1,
          name: "Verwaltungsseite nicht gefunden",
        }),
      ).toBeInTheDocument();

      const backLink = screen.getByRole("link", {
        name: "Betriebsübersicht öffnen",
      });
      expect(backLink).toHaveAttribute("href", "/admin/overview");
    });
  });

  describe("2. Barrierefreiheit & Landmarken", () => {
    it("besitzt vollständige semantische Landmarken (Header, Nav, Main)", () => {
      render(
        <MemoryRouter initialEntries={["/admin/overview"]}>
          <FullGuardedRoutes />
        </MemoryRouter>,
      );

      expect(screen.getByRole("banner")).toBeInTheDocument(); // <header>
      expect(
        screen.getByRole("navigation", { name: "Verwaltungsbereiche" }),
      ).toBeInTheDocument(); // <nav>
      expect(screen.getByRole("main")).toBeInTheDocument(); // <main>
    });

    it("bietet einen funktionierenden Sprunglink zum Hauptinhalt", () => {
      render(
        <MemoryRouter initialEntries={["/admin/overview"]}>
          <FullGuardedRoutes />
        </MemoryRouter>,
      );

      const skipLink = screen.getByRole("link", {
        name: "Zum Verwaltungsinhalt",
      });
      expect(skipLink).toBeInTheDocument();
      expect(skipLink).toHaveAttribute("href", "#admin-content");

      const mainElement = screen.getByRole("main");
      expect(mainElement).toHaveAttribute("id", "admin-content");
      expect(mainElement).toHaveAttribute("tabIndex", "-1");
    });

    it("zeichnet alle 6 Navigationsgruppen und alle 12 Unterseiten barrierefrei aus", () => {
      render(
        <MemoryRouter initialEntries={["/admin/overview"]}>
          <FullGuardedRoutes />
        </MemoryRouter>,
      );

      const nav = screen.getByRole("navigation", {
        name: "Verwaltungsbereiche",
      });
      expect(within(nav).getByText("Übersicht")).toBeInTheDocument();
      expect(within(nav).getByText("Betrieb")).toBeInTheDocument();
      expect(within(nav).getByText("Sortiment")).toBeInTheDocument();
      expect(within(nav).getByText("Personal")).toBeInTheDocument();
      expect(within(nav).getByText("System")).toBeInTheDocument();
      expect(within(nav).getByText("Sicherheit")).toBeInTheDocument();

      // Alle 12 Links in der Navigation vorhanden
      ADMIN_PAGES.forEach((page) => {
        expect(
          within(nav).getByRole("link", { name: page.label }),
        ).toBeInTheDocument();
      });
    });
  });

  describe("3. Responsive Dialog- und Fokussteuerung (Mobile Navigation)", () => {
    it("öffnet die mobile Navigation barrierefrei und setzt den Fokus", () => {
      render(
        <MemoryRouter initialEntries={["/admin/overview"]}>
          <FullGuardedRoutes />
        </MemoryRouter>,
      );

      const menuButton = screen.getByRole("button", {
        name: "Verwaltungsmenü öffnen",
      });
      expect(menuButton).toHaveAttribute("aria-expanded", "false");

      fireEvent.click(menuButton);

      const dialog = screen.getByRole("dialog", { name: "Verwaltungsmenü" });
      expect(dialog).toBeInTheDocument();
      expect(dialog).toHaveAttribute("aria-modal", "true");

      const closeButton = within(dialog).getByRole("button", {
        name: "Verwaltungsmenü schließen",
      });
      expect(closeButton).toHaveFocus();
    });

    it("schließt die mobile Navigation per Escape-Taste und gibt den Fokus zurück", async () => {
      render(
        <MemoryRouter initialEntries={["/admin/overview"]}>
          <FullGuardedRoutes />
        </MemoryRouter>,
      );

      const menuButton = screen.getByRole("button", {
        name: "Verwaltungsmenü öffnen",
      });
      fireEvent.click(menuButton);

      const dialog = screen.getByRole("dialog", { name: "Verwaltungsmenü" });
      expect(dialog).toBeInTheDocument();

      fireEvent.keyDown(document, { key: "Escape", code: "Escape" });

      await waitFor(() => {
        expect(
          screen.queryByRole("dialog", { name: "Verwaltungsmenü" }),
        ).not.toBeInTheDocument();
      });
      expect(menuButton).toHaveFocus();
    });
  });

  describe("4. Rollen- und Sicherheitsabgrenzung", () => {
    it("verweigert Kellnern (WAITER) den Zugriff auf das Admin-Dashboard und leitet auf die Kasse um", () => {
      loginAs("WAITER", "kellner1");
      render(
        <MemoryRouter initialEntries={["/admin/overview"]}>
          <FullGuardedRoutes />
        </MemoryRouter>,
      );

      expect(
        screen.queryByRole("navigation", { name: "Verwaltungsbereiche" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("admin-view-overview"),
      ).not.toBeInTheDocument();
      expect(screen.getByTestId("waiter-sale-page")).toBeInTheDocument();
    });

    it.each(ADMIN_PAGES)(
      "fängt Kellner (WAITER) beim Direktaufruf von $path ab",
      (page) => {
        loginAs("WAITER", "kellner1");
        render(
          <MemoryRouter initialEntries={[page.path]}>
            <FullGuardedRoutes />
          </MemoryRouter>,
        );

        expect(
          screen.queryByRole("heading", { level: 1, name: page.title }),
        ).not.toBeInTheDocument();
        expect(screen.getByTestId("waiter-sale-page")).toBeInTheDocument();
      },
    );

    it("leitet nicht angemeldete Benutzer zur Anmeldung um", () => {
      useAuthStore.setState({ user: null, token: null });
      render(
        <MemoryRouter initialEntries={["/admin/overview"]}>
          <FullGuardedRoutes />
        </MemoryRouter>,
      );

      expect(
        screen.queryByRole("navigation", { name: "Verwaltungsbereiche" }),
      ).not.toBeInTheDocument();
      expect(screen.getByTestId("login-page")).toBeInTheDocument();
    });
  });
});
