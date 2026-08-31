import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Setup } from "./Setup";
import { api } from "../lib/api";
import type { SetupCheck } from "../lib/setup";
import {
  SetupStatusProvider,
  SetupStatusTestProvider,
} from "../lib/SetupStatusProvider";
import { AuthGuard } from "../components/layout/AuthGuard";
import { useAuthStore } from "../store/useAuthStore";

vi.mock("../lib/api");

/**
 * Baut ein strukturell gültiges JWT für `useAuthStore.setToken`
 * (`decodeToken` prüft nur Form und Nutzlast, keine Signatur - siehe
 * `useAuthStore.ts`).
 */
function buildFakeToken(payload: Record<string, unknown>): string {
  const base64url = (value: unknown) =>
    btoa(JSON.stringify(value))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  return `${base64url({ alg: "none", typ: "JWT" })}.${base64url(payload)}.signature`;
}

/**
 * `SetupStatusTestProvider` injiziert den Zustand direkt über den Kontext
 * (siehe `lib/setup.ts` und `lib/SetupStatusProvider.tsx`) - ohne auf eine
 * gemockte `GET /setup/status` Antwort und einen Umlauf des Ereignisrings zu
 * warten. Das hält diese Tests deterministisch und unabhängig davon, wie
 * `SetupStatusProvider` seinen Zustand im Detail ermittelt (dafür gibt es
 * `lib/SetupStatusProvider.test.tsx`).
 */
function renderSetup(setupCheck: SetupCheck, initialPath = "/setup") {
  return render(
    <SetupStatusTestProvider value={setupCheck}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/setup" element={<Setup />} />
          <Route path="/login" element={<div>LOGIN-SEITE</div>} />
          <Route path="/" element={<div>DASHBOARD-SEITE</div>} />
        </Routes>
      </MemoryRouter>
    </SetupStatusTestProvider>,
  );
}

describe("Ersteinrichtung", () => {
  beforeEach(() => {
    useAuthStore.setState({ token: null, user: null });
  });

  it("zeigt den Wizard statt der Anmeldemaske, wenn die Ersteinrichtung aussteht", () => {
    renderSetup("required");

    expect(
      screen.getByRole("heading", { name: "Ersteinrichtung" }),
    ).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Benutzername")).toBeRequired();
    expect(screen.queryByText("LOGIN-SEITE")).not.toBeInTheDocument();
  });

  it("ist nach erledigter Ersteinrichtung nicht mehr erreichbar und führt auf /login", () => {
    renderSetup("not-required");

    expect(screen.getByText("LOGIN-SEITE")).toBeInTheDocument();
  });

  it("weist eine abweichende PIN-Wiederholung ab, ohne einen Benutzer anzulegen", () => {
    renderSetup("required");

    fireEvent.change(screen.getByPlaceholderText("Benutzername"), {
      target: { value: "vorstand" },
    });
    const [pinField, repeatField] = screen.getAllByPlaceholderText("••••");
    fireEvent.change(pinField, { target: { value: "1234" } });
    fireEvent.change(repeatField, { target: { value: "4321" } });
    fireEvent.click(
      screen.getByRole("button", { name: "Administrator anlegen" }),
    );

    expect(
      screen.getByText("Die Wiederholung stimmt nicht mit der PIN überein."),
    ).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });

  it("weist eine PIN ab, die nicht aus 4 bis 12 Ziffern besteht", () => {
    renderSetup("required");

    fireEvent.change(screen.getByPlaceholderText("Benutzername"), {
      target: { value: "vorstand" },
    });
    const [pinField, repeatField] = screen.getAllByPlaceholderText("••••");
    fireEvent.change(pinField, { target: { value: "12" } });
    fireEvent.change(repeatField, { target: { value: "12" } });
    fireEvent.click(
      screen.getByRole("button", { name: "Administrator anlegen" }),
    );

    expect(
      screen.getByText("Die PIN muss aus 4 bis 12 Ziffern bestehen."),
    ).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });

  it("legt den Administrator an und meldet ihn unmittelbar an, ohne erneute Eingabe", async () => {
    const fakeToken = buildFakeToken({
      username: "vorstand",
      sub: "user-1",
      role: "ADMINISTRATOR",
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    vi.mocked(api.post).mockImplementation(async (url: string) => {
      if (url === "/setup/admin") {
        return {
          data: {
            id: "user-1",
            username: "vorstand",
            role: "ADMINISTRATOR",
            isActive: true,
          },
        } as any;
      }
      if (url === "/auth/login") {
        return { data: { access_token: fakeToken } } as any;
      }
      throw new Error(`unerwarteter Aufruf: ${url}`);
    });

    renderSetup("required");

    fireEvent.change(screen.getByPlaceholderText("Benutzername"), {
      target: { value: "vorstand" },
    });
    const [pinField, repeatField] = screen.getAllByPlaceholderText("••••");
    fireEvent.change(pinField, { target: { value: "135790" } });
    fireEvent.change(repeatField, { target: { value: "135790" } });
    fireEvent.click(
      screen.getByRole("button", { name: "Administrator anlegen" }),
    );

    await waitFor(() =>
      expect(screen.getByText("DASHBOARD-SEITE")).toBeInTheDocument(),
    );
    expect(api.post).toHaveBeenCalledWith("/setup/admin", {
      username: "vorstand",
      pin: "135790",
    });
    expect(api.post).toHaveBeenCalledWith("/auth/login", {
      username: "vorstand",
      pin: "135790",
    });
    expect(useAuthStore.getState().token).toBe(fakeToken);
  });

  /**
   * Regressionstest für einen echten Fehler, der erst beim manuellen
   * Browsertest gegen ein frisches Docker-Bündel auffiel: Mit dem ECHTEN
   * `SetupStatusProvider` (der `GET /setup/status` nur EINMAL beim
   * Einhängen abfragt) blieb der Kontext nach einer erfolgreichen Anlage
   * bei "required" stehen, und `AuthGuard` schickte den gerade frisch
   * angemeldeten Administrator sofort wieder auf `/setup` zurück - eine
   * Endlosschleife aus Sicht der Bedienung. `renderSetup` oben verwendet
   * `SetupStatusTestProvider` mit einem FESTEN Wert und kann diesen Fehler
   * strukturell nicht sehen, weil dessen `markCompleted` wirkungslos ist.
   * Dieser Test verdrahtet deshalb bewusst den echten Provider mit
   * `AuthGuard`.
   */
  it("lässt AuthGuard nach der Anlage nicht auf /setup zurückverweisen", async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: { setupRequired: true },
    } as any);
    const fakeToken = buildFakeToken({
      username: "vorstand",
      sub: "user-1",
      role: "ADMINISTRATOR",
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    vi.mocked(api.post).mockImplementation(async (url: string) => {
      if (url === "/setup/admin") {
        return { data: { id: "user-1", username: "vorstand" } } as any;
      }
      if (url === "/auth/login") {
        return { data: { access_token: fakeToken } } as any;
      }
      throw new Error(`unerwarteter Aufruf: ${url}`);
    });

    render(
      <SetupStatusProvider>
        <MemoryRouter initialEntries={["/setup"]}>
          <Routes>
            <Route path="/setup" element={<Setup />} />
            <Route path="/login" element={<div>LOGIN-SEITE</div>} />
            <Route element={<AuthGuard />}>
              <Route path="/" element={<div>DASHBOARD-SEITE</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </SetupStatusProvider>,
    );

    // Der echte Provider startet bei "loading" - erst nach dem Abruf zeigt
    // sich der Wizard.
    await screen.findByRole("heading", { name: "Ersteinrichtung" });

    fireEvent.change(screen.getByPlaceholderText("Benutzername"), {
      target: { value: "vorstand" },
    });
    const [pinField, repeatField] = screen.getAllByPlaceholderText("••••");
    fireEvent.change(pinField, { target: { value: "135790" } });
    fireEvent.change(repeatField, { target: { value: "135790" } });
    fireEvent.click(
      screen.getByRole("button", { name: "Administrator anlegen" }),
    );

    await waitFor(() =>
      expect(screen.getByText("DASHBOARD-SEITE")).toBeInTheDocument(),
    );
    expect(screen.queryByText("LOGIN-SEITE")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Ersteinrichtung" }),
    ).not.toBeInTheDocument();
  });

  it("zeigt die Ablehnung des Servers an (z. B. bereits eingerichtet), ohne die Eingaben zu verwerfen", async () => {
    vi.mocked(api.post).mockRejectedValue({
      response: {
        status: 409,
        data: { message: "Die Ersteinrichtung ist bereits abgeschlossen." },
      },
    });

    renderSetup("required");

    fireEvent.change(screen.getByPlaceholderText("Benutzername"), {
      target: { value: "vorstand" },
    });
    const [pinField, repeatField] = screen.getAllByPlaceholderText("••••");
    fireEvent.change(pinField, { target: { value: "135790" } });
    fireEvent.change(repeatField, { target: { value: "135790" } });
    fireEvent.click(
      screen.getByRole("button", { name: "Administrator anlegen" }),
    );

    expect(
      await screen.findByText("Die Ersteinrichtung ist bereits abgeschlossen."),
    ).toBeInTheDocument();
  });
});
