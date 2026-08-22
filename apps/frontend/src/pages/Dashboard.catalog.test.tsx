import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "../lib/api";
import { Dashboard } from "./Dashboard";

// Deckt Issue #90 ab: Scheitert der erste Ladeversuch des Produktkatalogs,
// darf die Bestellaufnahme nicht dauerhaft leer bleiben. `api` und
// `offlineSync` werden vollständig ersetzt — dieser Test betrifft
// ausschließlich das Nachladen des Katalogs, nicht die Sendeschleife aus
// Issue #65, die hier bewusst untätig bleibt (leere Warteschlange, kein
// Sitzungskontext).

vi.mock("../lib/api", () => ({
  api: {
    get: vi.fn(),
  },
}));

vi.mock("../lib/offlineSync", () => ({
  OFFLINE_SYNC_HEADER: "x-offline-sync",
  OfflineQueueFullError: class OfflineQueueFullError extends Error {},
  OfflineQueueUnavailableError: class OfflineQueueUnavailableError extends Error {},
  enqueueOfflineOrder: vi.fn(),
  countOpenOfflineOrders: vi.fn().mockResolvedValue(0),
  recoverInterruptedOfflineSends: vi.fn().mockResolvedValue(undefined),
  runOfflineQueueSync: vi.fn().mockResolvedValue(undefined),
}));

const mockedApi = api as unknown as { get: ReturnType<typeof vi.fn> };

const drinkProduct = {
  id: "product-drink",
  name: "Getränk",
  shortName: "Getränk",
  price: 300,
  eventId: "event-1",
};

// Löst die Nichtprodukt-Endpunkte auf, die Dashboard.tsx beim Aufbau
// ebenfalls abfragt (`/sessions/context`), damit sie den Katalog-Fluss
// nicht durch unbehandelte Ablehnungen stören.
const respondTo =
  (productHandler: () => Promise<{ data: unknown }>) => (url: string) => {
    if (url === "/products") return productHandler();
    if (url === "/sessions/context") return Promise.resolve({ data: [] });
    return Promise.resolve({ data: [] });
  };

beforeEach(() => {
  mockedApi.get.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Produktkatalog nachladen nach Serverausfall (Issue #90)", () => {
  it("zeigt bei gescheitertem Erstaufruf einen Hinweis statt einer leeren Fläche", async () => {
    mockedApi.get.mockImplementation(
      respondTo(() => Promise.reject(new Error("Netzwerkfehler"))),
    );

    render(<Dashboard />);

    expect(
      await screen.findByText(/Produktkatalog konnte nicht geladen werden/),
    ).toBeInTheDocument();
    expect(screen.queryByText("Getränk")).not.toBeInTheDocument();
  });

  it("füllt der Katalog nach einem erfolgreichen Zweitversuch von Hand, der Hinweis verschwindet", async () => {
    let attempt = 0;
    mockedApi.get.mockImplementation(
      respondTo(() => {
        attempt += 1;
        if (attempt === 1) return Promise.reject(new Error("Netzwerkfehler"));
        return Promise.resolve({ data: [drinkProduct] });
      }),
    );

    render(<Dashboard />);

    await screen.findByText(/Produktkatalog konnte nicht geladen werden/);

    fireEvent.click(screen.getByRole("button", { name: /Erneut versuchen/ }));

    expect(await screen.findByText("Getränk")).toBeInTheDocument();
    expect(
      screen.queryByText(/Produktkatalog konnte nicht geladen werden/),
    ).not.toBeInTheDocument();
  });

  it("leert einen bereits gefüllten Katalog nicht, wenn ein späterer Versuch scheitert", async () => {
    let attempt = 0;
    mockedApi.get.mockImplementation(
      respondTo(() => {
        attempt += 1;
        if (attempt === 1) return Promise.resolve({ data: [drinkProduct] });
        return Promise.reject(new Error("Netzwerkfehler"));
      }),
    );

    render(<Dashboard />);

    await screen.findByText("Getränk");

    // Simuliert die Wiederkehr der Verbindung (derselbe "online"-Behandler,
    // an den sich der Katalog-Nachladeversuch hängt) — der zweite Versuch
    // scheitert laut Mock oben.
    await waitFor(() => expect(attempt).toBe(1));
    window.dispatchEvent(new Event("online"));

    await waitFor(() => expect(attempt).toBe(2));

    // Der bereits angezeigte Katalog bleibt stehen, kein Hinweis überdeckt
    // ihn.
    expect(screen.getByText("Getränk")).toBeInTheDocument();
    expect(
      screen.queryByText(/Produktkatalog konnte nicht geladen werden/),
    ).not.toBeInTheDocument();
  });

  it("löst über die Schaltfläche im Hinweis keinen zweiten Versuch parallel zu einem laufenden aus", async () => {
    const deferred: { resolve?: (value: { data: unknown }) => void } = {};
    let callCount = 0;
    mockedApi.get.mockImplementation(
      respondTo(() => {
        callCount += 1;
        if (callCount === 1) return Promise.reject(new Error("Netzwerkfehler"));
        return new Promise((resolve) => {
          deferred.resolve = resolve;
        });
      }),
    );

    render(<Dashboard />);
    await screen.findByText(/Produktkatalog konnte nicht geladen werden/);
    expect(callCount).toBe(1);

    const retryButton = screen.getByRole("button", {
      name: /Erneut versuchen/,
    });
    fireEvent.click(retryButton);

    // Während der zweite Versuch noch läuft, zeigt die Schaltfläche den
    // Ladezustand an und ist gesperrt — ein weiterer Klick darf keine
    // zusätzliche Anfrage auslösen.
    const busyButton = await screen.findByRole("button", {
      name: /Wird erneut versucht/,
    });
    expect(busyButton).toBeDisabled();
    fireEvent.click(busyButton);

    expect(callCount).toBe(2);

    deferred.resolve?.({ data: [drinkProduct] });
    expect(await screen.findByText("Getränk")).toBeInTheDocument();
    expect(callCount).toBe(2);
  });
});
