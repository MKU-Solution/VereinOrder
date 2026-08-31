import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SetupStatusProvider } from "./SetupStatusProvider";
import { useMarkSetupCompleted, useSetupRequired } from "./setup";
import { api } from "./api";

vi.mock("./api");

const Consumer = () => <output>{useSetupRequired()}</output>;

const ConsumerWithCompletionButton = () => {
  const check = useSetupRequired();
  const markCompleted = useMarkSetupCompleted();
  return (
    <>
      <output>{check}</output>
      <button onClick={markCompleted}>Fertig</button>
    </>
  );
};

describe("SetupStatusProvider", () => {
  it("wechselt zu 'required', wenn die Benutzertabelle laut Server leer ist", async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: { setupRequired: true },
    } as any);

    render(
      <SetupStatusProvider>
        <Consumer />
      </SetupStatusProvider>,
    );

    await waitFor(() =>
      expect(screen.getByText("required")).toBeInTheDocument(),
    );
    expect(api.get).toHaveBeenCalledWith("/setup/status");
  });

  it("wechselt zu 'not-required', wenn bereits ein Benutzer existiert", async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: { setupRequired: false },
    } as any);

    render(
      <SetupStatusProvider>
        <Consumer />
      </SetupStatusProvider>,
    );

    await waitFor(() =>
      expect(screen.getByText("not-required")).toBeInTheDocument(),
    );
  });

  it("fällt bei einem Ausfall auf 'not-required' zurück, statt dauerhaft bei 'loading' zu bleiben", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(api.get).mockRejectedValue(new Error("Netzwerkfehler"));

    render(
      <SetupStatusProvider>
        <Consumer />
      </SetupStatusProvider>,
    );

    await waitFor(() =>
      expect(screen.getByText("not-required")).toBeInTheDocument(),
    );
  });

  /**
   * Regressionstest für `markCompleted` (siehe `SetupStatusValue` in
   * `setup.ts`): ohne diese Methode blieb der Kontext nach einer
   * erfolgreichen Anlage in `Setup.tsx` bei "required" stehen, und
   * `AuthGuard` schickte den frisch angemeldeten Administrator sofort
   * wieder auf `/setup` zurück (beim manuellen Browsertest gefunden).
   */
  it("wechselt über markCompleted sofort auf 'not-required', ohne erneut abzufragen", async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: { setupRequired: true },
    } as any);

    render(
      <SetupStatusProvider>
        <ConsumerWithCompletionButton />
      </SetupStatusProvider>,
    );

    await waitFor(() =>
      expect(screen.getByText("required")).toBeInTheDocument(),
    );
    expect(api.get).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Fertig" }));

    expect(screen.getByText("not-required")).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledTimes(1);
  });
});
