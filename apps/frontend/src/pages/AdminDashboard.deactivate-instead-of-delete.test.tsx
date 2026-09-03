// Issue #168: handleDelete in AdminDashboardController.tsx baute
// Löschendpunkte für sechs Entitätstypen, aber im Backend gibt es nur zwei
// echte DELETE-Routen (areas.controller.ts, events.controller.ts). Die
// Löschknöpfe für Stationen, Warengruppen, Produkte und Benutzer trafen ins
// Leere - der Bedienende bestätigte "unwiderruflich löschen" und der Aufruf
// scheiterte an einer unbekannten Route.
//
// Entscheidung: Löschen abschaffen, Deaktivieren ausbauen.
// - Benutzer: isActive existiert bereits und ist über den Bearbeiten-Dialog
//   erreichbar (users.service.ts protokolliert Vorher-/Nachher-Wert im
//   Audit-Log). Dieser Test belegt nur, dass der Weg nach dem Entfernen des
//   Löschknopfs weiterhin funktioniert.
// - Stationen: Station.isActive existiert im Schema und wird vom Backend
//   unterstützt (stations.dto.ts), war aber im Bearbeiten-Dialog nicht
//   bedienbar. Dieser Test belegt die neu ergänzte Checkbox.
// - Produkte: manualAvailability = DISABLED existiert bereits
//   (products.service.ts#updateAvailability, PATCH /products/:id/availability),
//   war aber in der Produktverwaltung nicht erreichbar (nur in der
//   Stationsansicht). Dieser Test belegt den neu ergänzten Knopf.
// - Warengruppen: hatten kein isActive-Feld - seit Issue #170 tragen sie es
//   (ProductCategory.isActive), im selben Stil wie Stationen. Dieser Test
//   belegt die neu ergänzte Checkbox; der Kasseneffekt der Deaktivierung ist
//   Sache des Backends (siehe products.service.ts/orders.service.ts).
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

const areas = [{ id: "area-1", name: "Innenhof", sortOrder: 1 }];

const stations = [
  {
    id: "stat-1",
    name: "Schank",
    shortName: "SCH",
    sortOrder: 1,
    printerId: null,
    isActive: true,
  },
];

const categories = [
  {
    id: "cat-1",
    name: "Getränke",
    sortOrder: 1,
    targetStationId: null,
    deposit: 0,
    isActive: true,
  },
];

const products = [
  {
    id: "prod-1",
    name: "Bier 0,5l",
    price: 450,
    categoryId: "cat-1",
    targetStationId: null,
    sortOrder: 1,
    manualAvailability: "AVAILABLE",
    optionGroups: [],
  },
];

const users = [
  { id: "usr-1", username: "kellner1", role: "WAITER", isActive: true },
];

function defaultGetData(url: string): unknown {
  if (url === "/events") return events;
  if (url === "/print-jobs/printers") return [];
  if (url === "/print-jobs/unresolved") return [];
  if (url.startsWith("/areas")) return areas;
  if (url.startsWith("/stations/admin/all")) return stations;
  if (url.startsWith("/categories")) return categories;
  if (url.startsWith("/products/admin")) return products;
  if (url === "/users") return users;
  if (url === "/backup/list") return [];
  if (url === "/backup/restore-operation") return null;
  if (url === "/audit/stats") return {};
  if (url.startsWith("/audit/logs")) return { logs: [] };
  if (url === "/diagnostics/status") return { printers: {} };
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
  mockedApi.patch.mockResolvedValue({ data: {} });
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

describe("Löschknöpfe entfernt, Deaktivieren stattdessen (Issue #168)", () => {
  it("zeigt für Stationen keinen Löschen-Knopf mehr", async () => {
    await openTab("/admin/stations");
    await screen.findAllByText("Schank");
    expect(
      screen.queryByRole("button", { name: /löschen/i }),
    ).not.toBeInTheDocument();
  });

  it("zeigt für Warengruppen keinen Löschen-Knopf mehr", async () => {
    await openTab("/admin/categories");
    await screen.findAllByText("Getränke");
    expect(
      screen.queryByRole("button", { name: /löschen/i }),
    ).not.toBeInTheDocument();
  });

  it("zeigt für Produkte keinen Löschen-Knopf mehr", async () => {
    await openTab("/admin/products");
    await screen.findAllByText("Bier 0,5l");
    expect(
      screen.queryByRole("button", { name: /löschen/i }),
    ).not.toBeInTheDocument();
  });

  it("zeigt für Benutzer keinen Löschen-Knopf mehr", async () => {
    await openTab("/admin/users");
    await screen.findAllByText("kellner1");
    expect(
      screen.queryByRole("button", { name: /löschen/i }),
    ).not.toBeInTheDocument();
  });

  it("zeigt für Veranstaltungen weiterhin einen Löschen-Knopf (echte Route)", async () => {
    await openTab("/admin/events");
    await screen.findAllByText("Sommerfest");
    expect(
      screen.getAllByRole("button", {
        name: "Veranstaltung Sommerfest löschen",
      }).length,
    ).toBeGreaterThan(0);
  });

  it("zeigt für Bereiche weiterhin einen Löschen-Knopf (echte Route)", async () => {
    await openTab("/admin/areas");
    await screen.findAllByText("Innenhof");
    expect(
      screen.getAllByRole("button", { name: "Bereich Innenhof löschen" })
        .length,
    ).toBeGreaterThan(0);
  });
});

describe("Station deaktivieren (Issue #168)", () => {
  async function openEditDialog() {
    await openTab("/admin/stations");
    await screen.findAllByText("Schank");
    fireEvent.click(
      screen.getAllByRole("button", { name: "Station Schank bearbeiten" })[0],
    );
    return screen.findByRole("dialog");
  }

  it("bietet im Bearbeiten-Dialog eine Aktiv-Checkbox an und speichert isActive", async () => {
    const dialog = await openEditDialog();
    const checkbox = within(dialog).getByRole("checkbox", {
      name: "Station ist aktiv",
    });
    expect(checkbox).toBeChecked();

    fireEvent.click(checkbox);
    fireEvent.click(within(dialog).getByRole("button", { name: "Speichern" }));

    await waitFor(() =>
      expect(mockedApi.patch).toHaveBeenCalledWith(
        "/stations/stat-1",
        expect.objectContaining({ isActive: false }),
      ),
    );
  });
});

describe("Warengruppe deaktivieren (Issue #170)", () => {
  async function openEditDialog() {
    await openTab("/admin/categories");
    await screen.findAllByText("Getränke");
    fireEvent.click(
      screen.getAllByRole("button", {
        name: "Kategorie Getränke bearbeiten",
      })[0],
    );
    return screen.findByRole("dialog");
  }

  it("bietet im Bearbeiten-Dialog eine Aktiv-Checkbox an und speichert isActive", async () => {
    const dialog = await openEditDialog();
    const checkbox = within(dialog).getByRole("checkbox", {
      name: "Warengruppe ist aktiv",
    });
    expect(checkbox).toBeChecked();

    fireEvent.click(checkbox);
    fireEvent.click(within(dialog).getByRole("button", { name: "Speichern" }));

    await waitFor(() =>
      expect(mockedApi.patch).toHaveBeenCalledWith(
        "/categories/cat-1",
        expect.objectContaining({ isActive: false }),
      ),
    );
  });

  it("legt eine neue Warengruppe ohne isActive im Auftrag an (Serverdefault aktiv)", async () => {
    await openTab("/admin/categories");
    await screen.findAllByText("Getränke");
    fireEvent.click(screen.getByRole("button", { name: /anlegen/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Bezeichnung"), {
      target: { value: "Neue Gruppe" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Speichern" }));

    await waitFor(() => expect(mockedApi.post).toHaveBeenCalled());
    const payload = mockedApi.post.mock.calls[0][1];
    expect(payload).not.toHaveProperty("isActive");
  });
});

// Issue #171: Die Beschriftung wurde von "deaktivieren" auf "ganz aus dem
// Sortiment nehmen" umgestellt, damit sie nicht mit der veranstaltungs-
// bezogenen Sperre (manualBlocked, InventoryControls) verwechselt wird. Der
// aufgerufene Endpunkt (manualAvailability = DISABLED) bleibt unverändert.
describe("Produkt deaktivieren (Issue #168, #171)", () => {
  async function clickToggle() {
    await openTab("/admin/products");
    await screen.findAllByText("Bier 0,5l");
    fireEvent.click(
      screen.getAllByRole("button", {
        name: "Produkt Bier 0,5l ganz aus dem Sortiment nehmen",
      })[0],
    );
  }

  it("ruft die vorhandene Verfügbarkeitsroute mit DISABLED auf", async () => {
    await clickToggle();

    await waitFor(() =>
      expect(mockedApi.patch).toHaveBeenCalledWith(
        "/products/prod-1/availability",
        { availability: "DISABLED" },
      ),
    );
  });

  it("bietet für bereits deaktivierte Produkte einen Wieder-Aufnehmen-Knopf, der AVAILABLE setzt", async () => {
    mockedApi.get.mockImplementation((url: string) => {
      if (url.startsWith("/products/admin")) {
        return Promise.resolve({
          data: [{ ...products[0], manualAvailability: "DISABLED" }],
        });
      }
      return Promise.resolve({ data: defaultGetData(url) });
    });

    await openTab("/admin/products");
    await screen.findAllByText("Bier 0,5l");
    fireEvent.click(
      screen.getAllByRole("button", {
        name: "Produkt Bier 0,5l wieder ins Sortiment aufnehmen",
      })[0],
    );

    await waitFor(() =>
      expect(mockedApi.patch).toHaveBeenCalledWith(
        "/products/prod-1/availability",
        { availability: "AVAILABLE" },
      ),
    );
  });

  it("zeigt die Backend-Meldung, wenn das Deaktivieren abgelehnt wird", async () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    const backendText = "Produkt kann nicht deaktiviert werden.";
    mockedApi.patch.mockRejectedValueOnce(backendRejection(backendText));

    await clickToggle();

    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith(backendText));
  });
});

describe("Benutzer deaktivieren funktioniert weiterhin (Issue #168, Regression)", () => {
  it("speichert isActive über den vorhandenen Bearbeiten-Dialog", async () => {
    await openTab("/admin/users");
    await screen.findAllByText("kellner1");
    fireEvent.click(
      screen.getAllByRole("button", {
        name: "Mitarbeiter kellner1 bearbeiten",
      })[0],
    );
    const dialog = await screen.findByRole("dialog");
    const checkbox = within(dialog).getByRole("checkbox", {
      name: "Benutzer ist aktiv",
    });
    expect(checkbox).toBeChecked();

    fireEvent.click(checkbox);
    fireEvent.click(within(dialog).getByRole("button", { name: "Speichern" }));

    await waitFor(() =>
      expect(mockedApi.patch).toHaveBeenCalledWith(
        "/users/usr-1",
        expect.objectContaining({ isActive: false }),
      ),
    );
  });
});
