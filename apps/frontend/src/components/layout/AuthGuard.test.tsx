import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";
import { AuthGuard } from "./AuthGuard";
import { useAuthStore } from "../../store/useAuthStore";

/**
 * Seit der Nachbesserung zu Issue #174 prüft `AuthGuard` nur noch die
 * Anmeldung - die Ersteinrichtung übernimmt `RequireSetupComplete`
 * (`RequireSetupComplete.test.tsx`), das in `App.tsx` außen um diesen Baum
 * liegt. Kein `SetupStatusProvider` mehr nötig, um diese Komponente isoliert
 * zu testen.
 */
function renderGuard() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route element={<AuthGuard />}>
          <Route path="/" element={<div>GESCHÜTZTER-BEREICH</div>} />
        </Route>
        <Route path="/login" element={<div>LOGIN-SEITE</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("AuthGuard", () => {
  beforeEach(() => {
    useAuthStore.setState({ token: null, user: null });
  });

  it("führt auf /login, wenn niemand angemeldet ist", () => {
    renderGuard();

    expect(screen.getByText("LOGIN-SEITE")).toBeInTheDocument();
  });

  it("zeigt den geschützten Bereich, wenn jemand angemeldet ist", () => {
    useAuthStore.setState({
      token: "gueltiges-token",
      user: { userId: "user-1", username: "admin", role: "ADMINISTRATOR" },
    });

    renderGuard();

    expect(screen.getByText("GESCHÜTZTER-BEREICH")).toBeInTheDocument();
  });
});
