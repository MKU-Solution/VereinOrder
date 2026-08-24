import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { AdminApplicationFrame } from "./AdminApplicationFrame";

const CurrentPath = () => {
  const location = useLocation();
  return <output data-testid="current-path">{location.pathname}</output>;
};

const renderFrame = () => {
  const actions = {
    onExitAdmin: vi.fn(),
    onSwitchUser: vi.fn(),
    onLogout: vi.fn(),
  };
  render(
    <MemoryRouter initialEntries={["/admin/products"]}>
      <AdminApplicationFrame username="admin" {...actions}>
        <CurrentPath />
      </AdminApplicationFrame>
    </MemoryRouter>,
  );
  return actions;
};

describe("Admin-Shell und Sidebar", () => {
  it("gruppiert beschriftete Links und kennzeichnet die aktive Seite semantisch", () => {
    renderFrame();

    expect(screen.getByText("Betrieb")).toBeInTheDocument();
    expect(screen.getByText("Sortiment")).toBeInTheDocument();
    expect(screen.getByText("Personal")).toBeInTheDocument();
    expect(screen.getByText("System")).toBeInTheDocument();
    expect(screen.getByText("Sicherheit")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Produkte" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(
      screen.getByRole("link", { name: "Backups & Wiederherstellung" }),
    ).toBeInTheDocument();
  });

  it("navigiert über Links und speichert nur den Tablet-Darstellungszustand", () => {
    renderFrame();

    fireEvent.click(screen.getByRole("link", { name: "Mitarbeiter" }));
    expect(screen.getByTestId("current-path")).toHaveTextContent(
      "/admin/users",
    );

    fireEvent.click(screen.getByRole("button", { name: "Sidebar schließen" }));
    expect(localStorage.getItem("adminSidebarVisible")).toBe("0");
    expect(localStorage.getItem("token")).toBeNull();
  });

  it("hält Ausstieg, Benutzerwechsel und Abmeldung auf Admin-Unterseiten erreichbar", () => {
    const actions = renderFrame();

    fireEvent.click(
      screen.getByRole("button", { name: "Zur Bestellaufnahme" }),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "Benutzer wechseln, aktuell admin",
      }),
    );
    fireEvent.click(screen.getAllByRole("button", { name: "Abmelden" })[0]);

    expect(actions.onExitAdmin).toHaveBeenCalledOnce();
    expect(actions.onSwitchUser).toHaveBeenCalledOnce();
    expect(actions.onLogout).toHaveBeenCalledOnce();
  });

  it("sperrt den Fokus im mobilen Dialog und gibt ihn nach Escape zurück", () => {
    renderFrame();
    const trigger = screen.getByRole("button", {
      name: "Verwaltungsmenü öffnen",
    });
    fireEvent.click(trigger);

    const dialog = screen.getByRole("dialog", { name: "Verwaltungsmenü" });
    const close = screen.getAllByRole("button", {
      name: "Verwaltungsmenü schließen",
    })[1];
    expect(close).toHaveFocus();
    expect(dialog).toBeInTheDocument();

    const logout = screen.getAllByRole("button", { name: "Abmelden" }).at(-1)!;
    logout.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(close).toHaveFocus();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(document.body).not.toHaveStyle({ overflow: "hidden" });
  });

  it("schließt den mobilen Dialog über die abgedunkelte Fläche", () => {
    renderFrame();
    fireEvent.click(
      screen.getByRole("button", { name: "Verwaltungsmenü öffnen" }),
    );
    fireEvent.click(
      screen.getAllByRole("button", {
        name: "Verwaltungsmenü schließen",
      })[0],
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
