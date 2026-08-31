import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";
import { AuthGuard } from "./AuthGuard";
import type { SetupCheck } from "../../lib/setup";
import { SetupStatusTestProvider } from "../../lib/SetupStatusProvider";
import { useAuthStore } from "../../store/useAuthStore";

/**
 * `SetupStatusTestProvider` injiziert den Ersteinrichtungsstatus direkt über
 * den Kontext (siehe `lib/setup.ts` und `lib/SetupStatusProvider.tsx`) -
 * synchron und unabhängig davon, wie `SetupStatusProvider` ihn in der echten
 * Anwendung ermittelt.
 */
function renderGuard(setupCheck: SetupCheck) {
  return render(
    <SetupStatusTestProvider value={setupCheck}>
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route element={<AuthGuard />}>
            <Route path="/" element={<div>GESCHÜTZTER-BEREICH</div>} />
          </Route>
          <Route path="/login" element={<div>LOGIN-SEITE</div>} />
          <Route path="/setup" element={<div>SETUP-SEITE</div>} />
        </Routes>
      </MemoryRouter>
    </SetupStatusTestProvider>,
  );
}

describe("AuthGuard", () => {
  beforeEach(() => {
    useAuthStore.setState({ token: null, user: null });
  });

  it("führt auf /setup, solange die Ersteinrichtung aussteht - unabhängig von der Anmeldung", () => {
    renderGuard("required");

    expect(screen.getByText("SETUP-SEITE")).toBeInTheDocument();
  });

  it("führt auf /login, wenn die Ersteinrichtung erledigt ist und niemand angemeldet ist", () => {
    renderGuard("not-required");

    expect(screen.getByText("LOGIN-SEITE")).toBeInTheDocument();
  });

  it("zeigt den geschützten Bereich, wenn die Ersteinrichtung erledigt und jemand angemeldet ist", () => {
    useAuthStore.setState({
      token: "gueltiges-token",
      user: { userId: "user-1", username: "admin", role: "ADMINISTRATOR" },
    });

    renderGuard("not-required");

    expect(screen.getByText("GESCHÜTZTER-BEREICH")).toBeInTheDocument();
  });

  it("zeigt weder Anmeldung noch geschützten Bereich, während der Status noch lädt", () => {
    renderGuard("loading");

    expect(screen.queryByText("LOGIN-SEITE")).not.toBeInTheDocument();
    expect(screen.queryByText("SETUP-SEITE")).not.toBeInTheDocument();
    expect(screen.queryByText("GESCHÜTZTER-BEREICH")).not.toBeInTheDocument();
  });
});
