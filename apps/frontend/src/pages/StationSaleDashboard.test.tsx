import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "../lib/api";
import { StationSaleDashboard } from "./StationSaleDashboard";

// Deckt Issue #66 (Stationskasse) ab: siehe
// docs/development/stationskasse.md, Abschnitt 4 ("Ablauf eines Verkaufs")
// und Abschnitt "Notwendige Änderungen" / Oberfläche / Tests.

vi.mock("../lib/api", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

const mockedApi = api as unknown as {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
};

const drinkStation = {
  id: "station-drinks",
  name: "Getränkestand",
  shortName: "Trinken",
  color: "#0d9488",
  sortOrder: 0,
  eventId: "event-1",
};

const iceStation = {
  id: "station-ice",
  name: "Eisstand",
  shortName: "Eis",
  color: "#f97316",
  sortOrder: 1,
  eventId: "event-1",
};

// Kürzel ist optional (Station.shortName ist nullable) - eine Station ohne
// Kürzel muss trotzdem allein über ihren Namen wählbar sein, ohne leere
// Nebenzeile.
const grillStation = {
  id: "station-grill",
  name: "Grillstand",
  shortName: null,
  color: null,
  sortOrder: 2,
  eventId: "event-1",
};

const beer = {
  id: "product-beer",
  name: "Bier",
  shortName: "Bier",
  price: 400,
  availability: "AVAILABLE",
  category: { id: "cat-drinks", name: "Getränke", sortOrder: 0 },
  optionGroups: [],
  targetStationId: "station-drinks",
};

const sausage = {
  id: "product-sausage",
  name: "Wurst",
  shortName: "Wurst",
  price: 350,
  availability: "OUT_OF_STOCK",
  category: { id: "cat-food", name: "Essen", sortOrder: 1 },
  optionGroups: [],
  targetStationId: "station-drinks",
};

const iceCream = {
  id: "product-ice",
  name: "Softeis",
  shortName: "Softeis",
  price: 200,
  availability: "AVAILABLE",
  category: { id: "cat-sweets", name: "Süßes", sortOrder: 2 },
  optionGroups: [],
  targetStationId: "station-ice",
};

const buildContext = (overrides: Record<string, unknown> = {}) => ({
  id: "event-1",
  name: "Sommerfest",
  status: "ACTIVE" as const,
  testMode: false,
  printingReady: true,
  activeSession: {
    id: "session-1",
    eventId: "event-1",
    startingBalance: 5000,
    startTime: new Date().toISOString(),
  },
  products: [beer, sausage, iceCream],
  stations: [drinkStation, iceStation],
  ...overrides,
});

const mockContext = (context: ReturnType<typeof buildContext>) => {
  mockedApi.get.mockImplementation((url: string) => {
    if (url === "/orders/station-sale/context") {
      return Promise.resolve({ data: [context] });
    }
    return Promise.resolve({ data: [] });
  });
};

// Die Stationsknöpfe zeigen Name und Kürzel im selben Element (Name als
// Überschrift, Kürzel als Nebenzeile - siehe StationSelection.tsx). Der
// zugängliche Name des Knopfs ist deshalb beides zusammen; ein Ausschnitt
// über den vollen Stationsnamen reicht zum Auswählen.
const selectStation = async (name: string) => {
  fireEvent.click(
    await screen.findByRole("button", { name: new RegExp(name) }),
  );
};

beforeEach(() => {
  mockedApi.get.mockReset();
  mockedApi.post.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Stationskasse", () => {
  it("zeigt nur Produkte der gewählten Station, ein Produkt einer anderen Station bleibt weg", async () => {
    mockContext(buildContext());
    render(<StationSaleDashboard />);

    await selectStation("Getränkestand");

    expect(await screen.findByText("Bier")).toBeInTheDocument();
    expect(screen.queryByText("Softeis")).not.toBeInTheDocument();
  });

  it("zeigt Ausverkauftes, aber nicht antippbar", async () => {
    mockContext(buildContext());
    render(<StationSaleDashboard />);

    await selectStation("Getränkestand");

    const sausageTile = (await screen.findByText("Wurst")).closest("button");
    expect(sausageTile).toBeDisabled();
    expect(screen.getByText("Ausverkauft")).toBeInTheDocument();
  });

  it("sperrt die Stationswahl, solange der Warenkorb nicht leer ist", async () => {
    mockContext(buildContext());
    render(<StationSaleDashboard />);

    await selectStation("Getränkestand");
    fireEvent.click(await screen.findByText("Bier"));

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Getränkestand/ }),
      ).toBeDisabled(),
    );
    expect(screen.getByRole("button", { name: /Eisstand/ })).toBeDisabled();
  });

  it("blockiert den Verkauf ohne aktive Kassensitzung und bietet den Start an", async () => {
    mockContext(buildContext({ activeSession: null }));
    render(<StationSaleDashboard />);

    await selectStation("Getränkestand");

    expect(
      await screen.findByText("Keine aktive Kassensitzung"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Kassensitzung öffnen/ }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Bier")).not.toBeInTheDocument();
  });

  it("blockiert den Verkauf ohne bereiten Drucker", async () => {
    mockContext(buildContext({ printingReady: false }));
    render(<StationSaleDashboard />);

    await selectStation("Getränkestand");

    expect(await screen.findByText("Verkauf gesperrt")).toBeInTheDocument();
    expect(screen.queryByText("Bier")).not.toBeInTheDocument();
  });

  it("leert nach Abbruch den Warenkorb und zieht einen neuen Idempotenzschlüssel", async () => {
    mockContext(buildContext());
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const randomUUIDSpy = vi.spyOn(crypto, "randomUUID");

    render(<StationSaleDashboard />);
    await selectStation("Getränkestand");
    fireEvent.click(await screen.findByText("Bier"));
    await screen.findByText("1 Bon");

    const callsBeforeAbort = randomUUIDSpy.mock.calls.length;
    fireEvent.click(
      screen.getByRole("button", { name: /Warenkorb abbrechen/ }),
    );

    await waitFor(() =>
      expect(
        screen.getByText("Produkte antippen, um Bons hinzuzufügen."),
      ).toBeInTheDocument(),
    );
    expect(randomUUIDSpy.mock.calls.length).toBeGreaterThan(callsBeforeAbort);
    // Die Station lässt sich nach dem Leeren wieder wechseln.
    expect(screen.getByRole("button", { name: /Eisstand/ })).not.toBeDisabled();
  });

  it("zeigt nach erfolgreichem Verkauf die Abholnummer groß auf dem Bildschirm", async () => {
    mockContext(buildContext());
    mockedApi.post.mockResolvedValue({
      data: {
        order: {
          id: "order-1",
          orderNumber: 7,
          pickupNumber: 42,
          stationId: "station-drinks",
        },
        vouchersIssued: 1,
        tenderedAmount: 500,
        changeAmount: 100,
        pickupNumber: 42,
        idempotentReplay: false,
      },
    });

    render(<StationSaleDashboard />);
    await selectStation("Getränkestand");
    fireEvent.click(await screen.findByText("Bier"));

    fireEvent.change(screen.getByLabelText("Bar gegeben"), {
      target: { value: "5,00" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Bar kassieren/ }));

    expect(await screen.findByText("42")).toBeInTheDocument();
    expect(mockedApi.post).toHaveBeenCalledWith(
      "/orders/station-sale",
      expect.objectContaining({
        eventId: "event-1",
        stationId: "station-drinks",
        paymentMethod: "CASH",
      }),
    );
  });

  it("zeigt eine Ablehnung des Servers mit ihrem eigenen Text an", async () => {
    mockContext(buildContext());
    mockedApi.post.mockRejectedValue({
      response: {
        data: {
          message:
            "Diese Station ist für diesen Verkauf nicht verfügbar. Bitte eine andere Station wählen.",
        },
      },
    });

    render(<StationSaleDashboard />);
    await selectStation("Getränkestand");
    fireEvent.click(await screen.findByText("Bier"));

    fireEvent.change(screen.getByLabelText("Bar gegeben"), {
      target: { value: "5,00" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Bar kassieren/ }));

    expect(
      await screen.findByText(
        "Diese Station ist für diesen Verkauf nicht verfügbar. Bitte eine andere Station wählen.",
      ),
    ).toBeInTheDocument();
  });

  it("zeigt den vollen Stationsnamen (nicht nur das Kürzel) und wählt auch eine Station ohne Kürzel korrekt", async () => {
    mockContext(buildContext({ stations: [drinkStation, grillStation] }));
    render(<StationSaleDashboard />);

    // Name zuerst, wie bei StationSelection.tsx - das Kürzel allein reicht
    // zu Schichtbeginn nicht, siehe Rückmeldung der Projektleitung.
    expect(await screen.findByText("Getränkestand")).toBeInTheDocument();
    expect(screen.getByText("Trinken")).toBeInTheDocument();

    // Eine Station ohne Kürzel (shortName === null) zeigt nur ihren Namen,
    // keine leere Nebenzeile, und bleibt trotzdem normal wählbar.
    const grillButton = screen.getByRole("button", { name: "Grillstand" });
    expect(grillButton).toBeInTheDocument();
    fireEvent.click(grillButton);
    expect(grillButton).toHaveAttribute("aria-pressed", "true");
  });
});
