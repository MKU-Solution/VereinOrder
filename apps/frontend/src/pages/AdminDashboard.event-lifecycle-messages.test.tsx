// Issue #158 (Browserabnahme): Die Verwaltung muss bei abgelehnten
// Betriebsart-Wechseln die vom Backend bewusst formulierte Meldung sehen,
// statt eines generischen "Fehler beim ..."-Textes. Betroffen sind genau die
// vier Handler in AdminDashboardController.tsx, die den Veranstaltungs-
// lebenszyklus steuern (Aktivieren, Testmodus, Pausieren, Abschließen).
// Ohne Servermeldung (z. B. Netzwerkfehler) muss der bisherige Rückfalltext
// weiterhin erscheinen.
import "fake-indexeddb/auto";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "../lib/api";
import { resetOfflineQueueDBForTests } from "../lib/offlineQueueDb";
import { useAuthStore } from "../store/useAuthStore";
import { AdminDashboard } from "./AdminDashboard";

vi.mock("../lib/api", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

const mockedApi = api as unknown as {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
  patch: ReturnType<typeof vi.fn>;
};

const events = [
  {
    id: "evt-draft",
    name: "Sommerfest",
    status: "DRAFT",
    testMode: false,
    timezone: "Europe/Vienna",
  },
  {
    id: "evt-active",
    name: "Herbstball",
    status: "ACTIVE",
    testMode: false,
    timezone: "Europe/Vienna",
  },
  {
    id: "evt-paused",
    name: "Wintermarkt",
    status: "PAUSED",
    testMode: false,
    timezone: "Europe/Vienna",
  },
];

const backendRejection = (message: string) => ({
  response: { data: { message } },
});

beforeEach(() => {
  resetOfflineQueueDBForTests();
  useAuthStore.setState({
    user: { username: "admin", userId: "admin-id", role: "ADMINISTRATOR" },
    token: "test-token",
  });
  mockedApi.get.mockImplementation((url: string) => {
    if (url === "/events") return Promise.resolve({ data: events });
    return Promise.resolve({ data: [] });
  });
});

afterEach(() => {
  useAuthStore.setState({ user: null, token: null });
  vi.clearAllMocks();
});

async function openEventsTab() {
  render(
    <MemoryRouter initialEntries={["/admin/events"]}>
      <AdminDashboard />
    </MemoryRouter>,
  );
  await screen.findAllByText("Sommerfest");
}

/**
 * Der Veranstaltungsname erscheint mehrfach (Desktop-Tabelle, Mobile-Karte
 * und ggf. im Betriebsstatus-Header). Diese Hilfsfunktion liefert gezielt
 * die Desktop-Tabellenzeile, in der auch die Aktions-Buttons liegen.
 */
function getEventRow(name: string): HTMLTableRowElement {
  const row = screen
    .getAllByText(name)
    .map((el) => el.closest("tr"))
    .find((tr): tr is HTMLTableRowElement => tr !== null);
  if (!row) throw new Error(`Keine Tabellenzeile für "${name}" gefunden`);
  return row;
}

describe("Rückmeldung des Backends bei abgelehnten Betriebsart-Wechseln (Issue #158)", () => {
  describe("Testmodus aktivieren", () => {
    it("zeigt die Backend-Meldung, wenn der Testbetrieb wegen echter Bestellungen abgelehnt wird", async () => {
      const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
      const backendText =
        "Der Testbetrieb kann nicht aktiviert werden, solange echte Bestellungen oder Kassensitzungen dieser Veranstaltung vorliegen.";
      mockedApi.patch.mockRejectedValueOnce(backendRejection(backendText));
      await openEventsTab();

      const row = getEventRow("Wintermarkt");
      fireEvent.click(within(row).getByRole("button", { name: "Testmodus" }));

      await waitFor(() => expect(alertSpy).toHaveBeenCalledWith(backendText));
      expect(alertSpy).toHaveBeenCalledTimes(1);
    });

    it("zeigt den bisherigen Rückfalltext, wenn beim Testmodus keine Servermeldung vorliegt (Netzwerkfehler)", async () => {
      const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
      mockedApi.patch.mockRejectedValueOnce(new Error("Network Error"));
      await openEventsTab();

      const row = getEventRow("Wintermarkt");
      fireEvent.click(within(row).getByRole("button", { name: "Testmodus" }));

      await waitFor(() =>
        expect(alertSpy).toHaveBeenCalledWith(
          "Fehler beim Aktivieren des Testmodus",
        ),
      );
    });
  });

  describe("Veranstaltung aktivieren (Echtbetrieb)", () => {
    async function openActivationModal() {
      const row = getEventRow("Sommerfest");
      fireEvent.click(
        within(row).getByRole("button", { name: "Scharf schalten" }),
      );
      const dialog = await screen.findByRole("dialog", {
        name: "Rechtlicher Hinweis: RKSV-Konformität",
      });
      fireEvent.click(within(dialog).getByRole("checkbox"));
      fireEvent.click(
        within(dialog).getByRole("button", {
          name: "Bestätigen & Scharf schalten",
        }),
      );
    }

    it("zeigt die Backend-Meldung, wenn die Aktivierung wegen ungereinigter Testdaten abgelehnt wird", async () => {
      const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
      const backendText =
        "Testdaten müssen vor dem Echtbetrieb vollständig bereinigt werden.";
      mockedApi.post.mockRejectedValueOnce(backendRejection(backendText));
      await openEventsTab();

      await openActivationModal();

      await waitFor(() => expect(alertSpy).toHaveBeenCalledWith(backendText));
      expect(alertSpy).toHaveBeenCalledTimes(1);
    });

    it("zeigt den bisherigen Rückfalltext, wenn bei der Aktivierung keine Servermeldung vorliegt (Netzwerkfehler)", async () => {
      const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
      mockedApi.post.mockRejectedValueOnce(new Error("Network Error"));
      await openEventsTab();

      await openActivationModal();

      await waitFor(() =>
        expect(alertSpy).toHaveBeenCalledWith(
          "Fehler bei der Aktivierung der Veranstaltung!",
        ),
      );
    });
  });

  describe("Veranstaltung pausieren", () => {
    it("zeigt die Backend-Meldung, wenn das Pausieren abgelehnt wird", async () => {
      const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
      const backendText =
        "Die Veranstaltung kann derzeit nicht pausiert werden.";
      mockedApi.patch.mockRejectedValueOnce(backendRejection(backendText));
      await openEventsTab();

      const row = getEventRow("Herbstball");
      fireEvent.click(within(row).getByRole("button", { name: "Pausieren" }));

      await waitFor(() => expect(alertSpy).toHaveBeenCalledWith(backendText));
      expect(alertSpy).toHaveBeenCalledTimes(1);
    });

    it("zeigt einen Rückfalltext, wenn beim Pausieren keine Servermeldung vorliegt (Netzwerkfehler)", async () => {
      const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
      mockedApi.patch.mockRejectedValueOnce(new Error("Network Error"));
      await openEventsTab();

      const row = getEventRow("Herbstball");
      fireEvent.click(within(row).getByRole("button", { name: "Pausieren" }));

      await waitFor(() => expect(alertSpy).toHaveBeenCalledTimes(1));
      expect(alertSpy).toHaveBeenCalledWith(expect.stringMatching(/pausier/i));
    });
  });

  describe("Veranstaltung abschließen", () => {
    async function openCompleteModalAndConfirm() {
      const row = getEventRow("Herbstball");
      fireEvent.click(within(row).getByRole("button", { name: "Abschließen" }));
      const dialog = await screen.findByRole("dialog", {
        name: "Veranstaltung abschließen",
      });
      fireEvent.click(
        within(dialog).getByRole("button", {
          name: "Veranstaltung abschließen",
        }),
      );
    }

    it("zeigt die Backend-Meldung, wenn der Abschluss abgelehnt wird", async () => {
      const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
      const backendText =
        "Die Veranstaltung kann nicht abgeschlossen werden, solange eine Kassensitzung offen ist.";
      mockedApi.patch.mockRejectedValueOnce(backendRejection(backendText));
      await openEventsTab();

      await openCompleteModalAndConfirm();

      await waitFor(() => expect(alertSpy).toHaveBeenCalledWith(backendText));
      expect(alertSpy).toHaveBeenCalledTimes(1);
    });

    it("zeigt den bisherigen Rückfalltext, wenn beim Abschluss keine Servermeldung vorliegt (Netzwerkfehler)", async () => {
      const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
      mockedApi.patch.mockRejectedValueOnce(new Error("Network Error"));
      await openEventsTab();

      await openCompleteModalAndConfirm();

      await waitFor(() =>
        expect(alertSpy).toHaveBeenCalledWith(
          "Fehler beim Abschließen der Veranstaltung.",
        ),
      );
    });
  });
});
