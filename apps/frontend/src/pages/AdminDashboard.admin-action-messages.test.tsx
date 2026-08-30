// Issue #160: Die restlichen alert()-Aufrufe in AdminDashboardController.tsx
// mit fest codiertem Text verschluckten die vom Backend bewusst formulierte
// Ablehnung (z. B. "Testdaten müssen vor dem Echtbetrieb vollständig bereinigt
// werden."). Dieser Test stellt für jeden umgestellten Handler sicher, dass
// 1) die Servermeldung beim Bedienenden ankommt, und
// 2) ohne Servermeldung (z. B. Netzwerkfehler) weiterhin der bisherige
//    Rückfalltext erscheint.
//
// Unverändert bleiben laut Einteilung im Auftrag: Erfolgsmeldungen (kein
// Fehlerpfad) sowie die sechs Aufrufe, die schon vor diesem Issue
// backendMessage nutzten (siehe AdminDashboard.event-lifecycle-messages.test.tsx
// für die vier davon aus Issue #158).
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
  delete: ReturnType<typeof vi.fn>;
};

const backendRejection = (message: string) => ({
  response: { data: { message } },
});

const events = [
  {
    id: "evt-active",
    name: "Sommerfest",
    status: "ACTIVE",
    testMode: false,
    timezone: "Europe/Vienna",
  },
];

const backups = [
  {
    format: "POSTGRES_CUSTOM",
    filename: "vereinorder_2026-08-01.dump",
    artifacts: [],
    sizeBytes: 12345,
    createdAt: "2026-08-01T10:00:00.000Z",
    checksumSha256: "abc",
    version: "1",
    counts: {},
    trigger: "MANUAL",
    verification: "STRUCTURE_VERIFIED",
    restoreVerificationAvailable: true,
    restorePreparationAvailable: false,
  },
  {
    format: "LEGACY_JSON",
    filename: "legacy-backup.json",
    artifacts: [],
    sizeBytes: 6789,
    createdAt: "2025-01-01T10:00:00.000Z",
    checksumSha256: "def",
    version: "0",
    counts: {},
    trigger: "MANUAL",
    verification: "LEGACY",
  },
];

/** Antworten für alle GET-Aufrufe, die beim Rendern jeder Verwaltungsseite
 * im Hintergrund laufen (Grundgerüst, unklare Druckaufträge, Kategorien-/
 * Stationsvorlade), plus den jeweiligen bereichsspezifischen Endpunkt. */
function defaultGetData(url: string): unknown {
  if (url === "/events") return events;
  if (url === "/print-jobs/printers") return [];
  if (url === "/print-jobs/unresolved") return [];
  if (url.startsWith("/categories")) return [];
  if (url.startsWith("/stations/admin/all")) return [];
  if (url === "/backup/list") return backups;
  if (url === "/backup/restore-operation") return null;
  if (url === "/audit/stats") return {};
  if (url.startsWith("/audit/logs")) return { logs: [] };
  if (url === "/diagnostics/status")
    return { printers: { failedPrintJobs: 3 } };
  return [];
}

beforeEach(() => {
  resetOfflineQueueDBForTests();
  useAuthStore.setState({
    user: { username: "admin", userId: "admin-id", role: "ADMINISTRATOR" },
    token: "test-token",
  });
  mockedApi.get.mockImplementation((url: string) =>
    Promise.resolve({ data: defaultGetData(url) }),
  );
});

afterEach(() => {
  useAuthStore.setState({ user: null, token: null });
  vi.clearAllMocks();
});

async function openTab(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <AdminDashboard />
    </MemoryRouter>,
  );
}

describe("Backend-Meldungen bei fest codierten alert()-Fehlertexten (Issue #160)", () => {
  describe("Veranstaltung speichern (Bearbeiten-Dialog)", () => {
    async function openEditDialogAndSubmit() {
      await openTab("/admin/events");
      await screen.findAllByText("Sommerfest");
      // Der Veranstaltungsname erscheint sowohl in der Desktop-Tabelle als
      // auch in der Mobile-Karte; die Desktop-Zeile steht im DOM zuerst.
      fireEvent.click(
        screen.getAllByRole("button", {
          name: "Veranstaltung Sommerfest bearbeiten",
        })[0],
      );
      const dialog = await screen.findByRole("dialog", {
        name: "Veranstaltung bearbeiten",
      });
      fireEvent.click(
        within(dialog).getByRole("button", { name: "Speichern" }),
      );
    }

    it("zeigt die Backend-Meldung, wenn das Speichern abgelehnt wird", async () => {
      const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
      const backendText =
        "Der Veranstaltungsname wird bereits von einer anderen Veranstaltung verwendet.";
      mockedApi.patch.mockRejectedValueOnce(backendRejection(backendText));

      await openEditDialogAndSubmit();

      await waitFor(() => expect(alertSpy).toHaveBeenCalledWith(backendText));
      expect(alertSpy).toHaveBeenCalledTimes(1);
    });

    it("zeigt den bisherigen Rückfalltext, wenn beim Speichern keine Servermeldung vorliegt", async () => {
      const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
      mockedApi.patch.mockRejectedValueOnce(new Error("Network Error"));

      await openEditDialogAndSubmit();

      await waitFor(() =>
        expect(alertSpy).toHaveBeenCalledWith("Fehler beim Speichern"),
      );
    });
  });

  describe("Datensicherung erstellen", () => {
    async function clickCreateBackup() {
      await openTab("/admin/backups");
      const button = await screen.findByRole("button", {
        name: "Jetzt sichern (Manuelles Backup)",
      });
      fireEvent.click(button);
    }

    it("zeigt die Backend-Meldung, wenn die Erstellung abgelehnt wird", async () => {
      const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
      const backendText =
        "Es läuft bereits eine Datensicherung. Bitte warte, bis sie abgeschlossen ist.";
      mockedApi.post.mockRejectedValueOnce(backendRejection(backendText));

      await clickCreateBackup();

      await waitFor(() => expect(alertSpy).toHaveBeenCalledWith(backendText));
      expect(alertSpy).toHaveBeenCalledTimes(1);
    });

    it("zeigt den bisherigen Rückfalltext, wenn bei der Erstellung keine Servermeldung vorliegt", async () => {
      const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
      mockedApi.post.mockRejectedValueOnce(new Error("Network Error"));

      await clickCreateBackup();

      await waitFor(() =>
        expect(alertSpy).toHaveBeenCalledWith(
          "Fehler bei der Erstellung des Backups",
        ),
      );
    });
  });

  describe("Datensicherung herunterladen", () => {
    async function clickDownload() {
      await openTab("/admin/backups");
      const button = await screen.findByRole("button", {
        name: "Sicherung vereinorder_2026-08-01.dump herunterladen",
      });
      fireEvent.click(button);
    }

    it("zeigt die Backend-Meldung, wenn das Herunterladen abgelehnt wird", async () => {
      const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
      const backendText = "Die Sicherungsdatei ist nicht mehr vorhanden.";
      mockedApi.get.mockImplementation((url: string) => {
        if (url.startsWith("/backup/download/")) {
          return Promise.reject(backendRejection(backendText));
        }
        return Promise.resolve({ data: defaultGetData(url) });
      });

      await clickDownload();

      await waitFor(() => expect(alertSpy).toHaveBeenCalledWith(backendText));
      expect(alertSpy).toHaveBeenCalledTimes(1);
    });

    it("zeigt den bisherigen Rückfalltext, wenn beim Herunterladen keine Servermeldung vorliegt", async () => {
      const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
      mockedApi.get.mockImplementation((url: string) => {
        if (url.startsWith("/backup/download/")) {
          return Promise.reject(new Error("Network Error"));
        }
        return Promise.resolve({ data: defaultGetData(url) });
      });

      await clickDownload();

      await waitFor(() =>
        expect(alertSpy).toHaveBeenCalledWith(
          "Fehler beim Herunterladen des Backups",
        ),
      );
    });
  });

  describe("Legacy-Sicherung direkt wiederherstellen", () => {
    async function clickDirectRestore() {
      await openTab("/admin/backups");
      await screen.findAllByRole("button", { name: "Legacy wiederherstellen" });
      // Desktop-Tabelle und Mobile-Karte rendern denselben Knopf; die
      // Desktop-Zeile steht im DOM zuerst.
      const button = screen.getAllByRole("button", {
        name: "Legacy wiederherstellen",
      })[0];
      fireEvent.click(button);
    }

    it("zeigt die Backend-Meldung, wenn die Wiederherstellung abgelehnt wird", async () => {
      vi.spyOn(window, "confirm").mockReturnValue(true);
      const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
      const backendText =
        "Die Wiederherstellung ist nur im gesperrten Wartungsmodus möglich.";
      mockedApi.post.mockRejectedValueOnce(backendRejection(backendText));

      await clickDirectRestore();

      await waitFor(() => expect(alertSpy).toHaveBeenCalledWith(backendText));
      expect(alertSpy).toHaveBeenCalledTimes(1);
    });

    it("zeigt den bisherigen Rückfalltext, wenn bei der Wiederherstellung keine Servermeldung vorliegt", async () => {
      vi.spyOn(window, "confirm").mockReturnValue(true);
      const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
      mockedApi.post.mockRejectedValueOnce(new Error("Network Error"));

      await clickDirectRestore();

      await waitFor(() =>
        expect(alertSpy).toHaveBeenCalledWith(
          "Fehler bei der Wiederherstellung des Backups",
        ),
      );
    });
  });

  describe("Wiederherstellungsprüfung", () => {
    async function clickVerify() {
      await openTab("/admin/backups");
      await screen.findAllByRole("button", {
        name: "Wiederherstellung prüfen",
      });
      // Desktop-Tabelle und Mobile-Karte rendern denselben Knopf; die
      // Desktop-Zeile steht im DOM zuerst.
      const button = screen.getAllByRole("button", {
        name: "Wiederherstellung prüfen",
      })[0];
      fireEvent.click(button);
    }

    it("zeigt die Backend-Meldung, wenn die Prüfung abgelehnt wird", async () => {
      const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
      const backendText =
        "Für diesen Sicherungstyp ist keine Wiederherstellungsprüfung möglich.";
      mockedApi.post.mockRejectedValueOnce(backendRejection(backendText));

      await clickVerify();

      await waitFor(() => expect(alertSpy).toHaveBeenCalledWith(backendText));
      expect(alertSpy).toHaveBeenCalledTimes(1);
    });

    it("zeigt den bisherigen Rückfalltext, wenn bei der Prüfung keine Servermeldung vorliegt", async () => {
      const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
      mockedApi.post.mockRejectedValueOnce(new Error("Network Error"));

      await clickVerify();

      await waitFor(() =>
        expect(alertSpy).toHaveBeenCalledWith(
          "Die Wiederherstellungsprüfung ist fehlgeschlagen. Die Festdatenbank wurde nicht verändert.",
        ),
      );
    });
  });

  describe("Audit-Log als CSV exportieren", () => {
    async function clickExport() {
      await openTab("/admin/audit");
      const button = await screen.findByRole("button", {
        name: "CSV exportieren",
      });
      fireEvent.click(button);
    }

    it("zeigt die Backend-Meldung, wenn der Export abgelehnt wird", async () => {
      const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
      const backendText = "Der Export ist derzeit nicht verfügbar.";
      mockedApi.get.mockImplementation((url: string) => {
        if (url === "/audit/export") {
          return Promise.reject(backendRejection(backendText));
        }
        return Promise.resolve({ data: defaultGetData(url) });
      });

      await clickExport();

      await waitFor(() => expect(alertSpy).toHaveBeenCalledWith(backendText));
      expect(alertSpy).toHaveBeenCalledTimes(1);
    });

    it("zeigt den bisherigen Rückfalltext, wenn beim Export keine Servermeldung vorliegt", async () => {
      const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
      mockedApi.get.mockImplementation((url: string) => {
        if (url === "/audit/export") {
          return Promise.reject(new Error("Network Error"));
        }
        return Promise.resolve({ data: defaultGetData(url) });
      });

      await clickExport();

      await waitFor(() =>
        expect(alertSpy).toHaveBeenCalledWith(
          "Fehler beim Exportieren des Audit-Logs",
        ),
      );
    });
  });

  describe("Fehlgeschlagene Druckaufträge wiederholen", () => {
    async function clickRetry() {
      await openTab("/admin/diagnostics");
      const button = await screen.findByRole("button", {
        name: "Erneut versuchen",
      });
      fireEvent.click(button);
    }

    it("zeigt die Backend-Meldung, wenn das Wiederholen abgelehnt wird", async () => {
      const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
      const backendText =
        "Es sind keine fehlgeschlagenen Druckaufträge mehr vorhanden.";
      mockedApi.post.mockRejectedValueOnce(backendRejection(backendText));

      await clickRetry();

      await waitFor(() => expect(alertSpy).toHaveBeenCalledWith(backendText));
      expect(alertSpy).toHaveBeenCalledTimes(1);
    });

    it("zeigt den bisherigen Rückfalltext, wenn beim Wiederholen keine Servermeldung vorliegt", async () => {
      const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
      mockedApi.post.mockRejectedValueOnce(new Error("Network Error"));

      await clickRetry();

      await waitFor(() =>
        expect(alertSpy).toHaveBeenCalledWith(
          "Fehler beim Wiederholen der Druckaufträge",
        ),
      );
    });
  });

  describe("Eintrag löschen", () => {
    async function clickDelete() {
      await openTab("/admin/events");
      await screen.findAllByText("Sommerfest");
      // Der Veranstaltungsname erscheint sowohl in der Desktop-Tabelle als
      // auch in der Mobile-Karte; die Desktop-Zeile steht im DOM zuerst.
      fireEvent.click(
        screen.getAllByRole("button", {
          name: "Veranstaltung Sommerfest löschen",
        })[0],
      );
    }

    it("zeigt die Backend-Meldung, wenn das Löschen abgelehnt wird", async () => {
      vi.spyOn(window, "confirm").mockReturnValue(true);
      const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
      const backendText =
        "Die Veranstaltung kann nicht gelöscht werden, solange Bestellungen vorliegen.";
      mockedApi.delete.mockRejectedValueOnce(backendRejection(backendText));

      await clickDelete();

      await waitFor(() => expect(alertSpy).toHaveBeenCalledWith(backendText));
      expect(alertSpy).toHaveBeenCalledTimes(1);
    });

    it("zeigt den bisherigen Rückfalltext, wenn beim Löschen keine Servermeldung vorliegt", async () => {
      vi.spyOn(window, "confirm").mockReturnValue(true);
      const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
      mockedApi.delete.mockRejectedValueOnce(new Error("Network Error"));

      await clickDelete();

      await waitFor(() =>
        expect(alertSpy).toHaveBeenCalledWith("Fehler beim Löschen"),
      );
    });
  });
});
