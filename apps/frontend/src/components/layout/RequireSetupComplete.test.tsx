import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { RequireSetupComplete } from "./RequireSetupComplete";
import { Login } from "../../pages/Login";
import { SetupStatusTestProvider } from "../../lib/SetupStatusProvider";
import type { SetupCheck } from "../../lib/setup";

/**
 * Nachbesserung zu Issue #174: `/login` lief in der ersten Fassung an
 * `DefaultRoute` und `AuthGuard` vorbei, weil es eine eigenständige Route
 * auf derselben Ebene ist - auf einem frischen System zeigte ein direkter
 * Aufruf von `/login` deshalb weiterhin die Anmeldemaske, obwohl es noch
 * kein Konto gab. Dieser Test verdrahtet `/login` genau wie `App.tsx` es
 * jetzt tut: hinter `RequireSetupComplete`.
 */
function renderLoginBehindGuard(setupCheck: SetupCheck) {
  return render(
    <SetupStatusTestProvider value={setupCheck}>
      <MemoryRouter initialEntries={["/login"]}>
        <Routes>
          <Route element={<RequireSetupComplete />}>
            <Route path="/login" element={<Login />} />
          </Route>
          <Route path="/setup" element={<div>SETUP-SEITE</div>} />
        </Routes>
      </MemoryRouter>
    </SetupStatusTestProvider>,
  );
}

describe("RequireSetupComplete", () => {
  it("führt den direkten Aufruf von /login auf /setup, solange die Ersteinrichtung aussteht", () => {
    renderLoginBehindGuard("required");

    expect(screen.getByText("SETUP-SEITE")).toBeInTheDocument();
    expect(
      screen.queryByPlaceholderText("Benutzername"),
    ).not.toBeInTheDocument();
  });

  it("zeigt /login unverändert, wenn die Ersteinrichtung erledigt ist", () => {
    renderLoginBehindGuard("not-required");

    expect(screen.getByPlaceholderText("Benutzername")).toBeInTheDocument();
    expect(screen.queryByText("SETUP-SEITE")).not.toBeInTheDocument();
  });

  it("zeigt weder /login noch /setup, während der Status noch lädt (kein Flackern)", () => {
    renderLoginBehindGuard("loading");

    expect(
      screen.queryByPlaceholderText("Benutzername"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("SETUP-SEITE")).not.toBeInTheDocument();
  });

  it("gilt für jede Route hinter dem Wrapper, nicht nur /login", () => {
    render(
      <SetupStatusTestProvider value="required">
        <MemoryRouter initialEntries={["/irgendwas"]}>
          <Routes>
            <Route element={<RequireSetupComplete />}>
              <Route path="/irgendwas" element={<div>ANDERE-ROUTE</div>} />
            </Route>
            <Route path="/setup" element={<div>SETUP-SEITE</div>} />
          </Routes>
        </MemoryRouter>
      </SetupStatusTestProvider>,
    );

    expect(screen.getByText("SETUP-SEITE")).toBeInTheDocument();
    expect(screen.queryByText("ANDERE-ROUTE")).not.toBeInTheDocument();
  });
});
