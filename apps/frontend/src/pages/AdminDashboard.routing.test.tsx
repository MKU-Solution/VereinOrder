import { fireEvent, render, screen } from "@testing-library/react";
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { ADMIN_PAGES } from "../components/admin/adminAreaRegistry";
import { RoleGuard } from "../components/layout/RoleGuard";
import { routeAccess } from "../components/layout/routeAccess";
import { useAuthStore, type UserRole } from "../store/useAuthStore";
import { AdminDashboard } from "./AdminDashboard";

vi.mock("../components/admin/AdminDashboardController", () => ({
  AdminDashboardController: ({ activePage }: { activePage: string }) => (
    <h1 data-testid="admin-page">{activePage}</h1>
  ),
}));

const CurrentPath = () => {
  const location = useLocation();
  return <output data-testid="current-path">{location.pathname}</output>;
};

const HistoryControls = () => {
  const navigate = useNavigate();
  return (
    <>
      <button type="button" onClick={() => navigate("/admin/products")}>
        Produkte laden
      </button>
      <button type="button" onClick={() => navigate(-1)}>
        Zurück
      </button>
    </>
  );
};

const GuardedAdminRoutes = () => (
  <Routes>
    <Route element={<RoleGuard route={routeAccess.admin} />}>
      <Route path="/admin/*" element={<AdminDashboard />} />
    </Route>
    <Route path="*" element={<CurrentPath />} />
  </Routes>
);

const loginAs = (role: UserRole) => {
  useAuthStore.setState({
    user: { username: "test", userId: "u1", role },
    token: "test-token",
  });
};

describe("URL-Navigation der Verwaltung", () => {
  it.each(ADMIN_PAGES)("öffnet $path direkt als $id", (page) => {
    loginAs("ADMINISTRATOR");
    render(
      <MemoryRouter initialEntries={[page.path]}>
        <GuardedAdminRoutes />
      </MemoryRouter>,
    );

    expect(screen.getByTestId("admin-page")).toHaveTextContent(page.id);
  });

  it("ersetzt /admin durch die Betriebsübersicht", () => {
    loginAs("ADMINISTRATOR");
    render(
      <MemoryRouter initialEntries={["/admin"]}>
        <GuardedAdminRoutes />
      </MemoryRouter>,
    );

    expect(screen.getByTestId("admin-page")).toHaveTextContent("overview");
  });

  it("zeigt eine verständliche Nicht-gefunden-Seite innerhalb der Verwaltung", () => {
    loginAs("ADMINISTRATOR");
    render(
      <MemoryRouter initialEntries={["/admin/gibt-es-nicht"]}>
        <GuardedAdminRoutes />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole("heading", {
        name: "Verwaltungsseite nicht gefunden",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Betriebsübersicht öffnen" }),
    ).toHaveAttribute("href", "/admin/overview");
  });

  it.each(ADMIN_PAGES)(
    "fängt Kellner beim direkten Aufruf von $path ab",
    (page) => {
      loginAs("WAITER");
      render(
        <MemoryRouter initialEntries={[page.path]}>
          <GuardedAdminRoutes />
        </MemoryRouter>,
      );

      expect(screen.getByTestId("current-path")).toHaveTextContent("/");
      expect(screen.queryByTestId("admin-page")).not.toBeInTheDocument();
    },
  );

  it("folgt der Browserhistorie, weil der aktive Bereich aus der URL stammt", () => {
    loginAs("ADMINISTRATOR");
    render(
      <MemoryRouter initialEntries={["/admin/events"]}>
        <AdminDashboard />
        <HistoryControls />
      </MemoryRouter>,
    );

    expect(screen.getByTestId("admin-page")).toHaveTextContent("events");
    fireEvent.click(screen.getByRole("button", { name: "Produkte laden" }));
    expect(screen.getByTestId("admin-page")).toHaveTextContent("products");
    fireEvent.click(screen.getByRole("button", { name: "Zurück" }));
    expect(screen.getByTestId("admin-page")).toHaveTextContent("events");
  });
});
