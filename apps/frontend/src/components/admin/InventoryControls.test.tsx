import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "../../lib/api";
import { InventoryControls, InventorySummary } from "./InventoryControls";

vi.mock("../../lib/api", () => ({
  api: { get: vi.fn(), patch: vi.fn(), post: vi.fn() },
}));

const mockedApi = api as unknown as {
  get: ReturnType<typeof vi.fn>;
  patch: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
};

const product = {
  id: "product-1",
  name: "Bier",
  availability: "AVAILABLE" as const,
};

const renderControls = (dataMode: "TEST" | "LIVE" = "TEST") =>
  render(
    <InventoryControls
      product={product}
      eventId="event-1"
      dataMode={dataMode}
      onChanged={vi.fn()}
    />,
  );

beforeEach(() => {
  mockedApi.get.mockReset();
  mockedApi.patch.mockReset();
  mockedApi.post.mockReset();
  mockedApi.get.mockImplementation((url: string) => {
    if (url.includes("/history?")) return Promise.resolve({ data: [] });
    return Promise.resolve({
      data: {
        inventoryTracked: false,
        stockQuantity: null,
        lowStockThreshold: null,
        manualBlocked: false,
      },
    });
  });
});

describe("Bestandssteuerung (Issue #141)", () => {
  it("initialisiert ausschließlich den ausgewählten TEST-Betrieb mit Menge, Schwelle und Sperre", async () => {
    mockedApi.post.mockResolvedValue({ data: {} });
    renderControls("TEST");

    fireEvent.click(screen.getByRole("button", { name: "Bestand" }));
    await screen.findByRole("heading", { name: "Bestand: Bier" });
    fireEvent.change(screen.getByLabelText("Anfangsbestand"), {
      target: { value: "25" },
    });
    fireEvent.change(screen.getByLabelText("Warnschwelle"), {
      target: { value: "4" },
    });
    fireEvent.click(screen.getByLabelText(/Nur für dieses Fest sperren/));
    fireEvent.click(screen.getByRole("button", { name: "Bestand mitzählen" }));

    await waitFor(() =>
      expect(mockedApi.post).toHaveBeenCalledWith(
        "/inventory/products/product-1/initialize",
        expect.objectContaining({
          eventId: "event-1",
          dataMode: "TEST",
          quantity: 25,
          lowStockThreshold: 4,
          trackingEnabled: true,
          manualBlocked: true,
        }),
      ),
    );
  });

  it("speichert Schwelle und manuelle Sperre getrennt, verlangt aber für eine Korrektur immer einen Grund", async () => {
    mockedApi.get.mockImplementation((url: string) => {
      if (url.includes("/history?")) {
        return Promise.resolve({
          data: [
            {
              id: "movement-1",
              type: "INITIALIZATION",
              quantityBefore: 0,
              quantityAfter: 15,
              reason: "Erstbestand",
            },
          ],
        });
      }
      return Promise.resolve({
        data: {
          inventoryTracked: true,
          stockQuantity: 15,
          lowStockThreshold: 3,
          manualBlocked: false,
        },
      });
    });
    mockedApi.patch.mockResolvedValue({ data: {} });
    renderControls("LIVE");

    fireEvent.click(screen.getByRole("button", { name: "Bestand" }));
    expect(await screen.findByText("Echtbetrieb")).toBeInTheDocument();
    expect(await screen.findByText("INITIALIZATION")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Warnschwelle"), {
      target: { value: "5" },
    });
    fireEvent.click(screen.getByLabelText(/Nur für dieses Fest sperren/));
    fireEvent.click(
      screen.getByRole("button", { name: "Schwelle/Sperre speichern" }),
    );
    await waitFor(() =>
      expect(mockedApi.patch).toHaveBeenCalledWith(
        "/inventory/products/product-1/settings",
        {
          eventId: "event-1",
          dataMode: "LIVE",
          lowStockThreshold: 5,
          manualBlocked: true,
        },
      ),
    );

    fireEvent.change(screen.getByLabelText("Aktuell gezählt"), {
      target: { value: "7" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Gezählten Bestand übernehmen" }),
    );
    expect(
      screen.getByText("Bitte begründe die Bestandskorrektur."),
    ).toBeInTheDocument();
    expect(mockedApi.post).not.toHaveBeenCalled();
  });

  // Issue #171, Teil 1: der Dialogkopf soll die Reichweite des Schloss-Knopfs
  // korrekt benennen - "für jedes Fest" wäre nach dem Datenmodell falsch
  // (Product.eventId ist einwertig, ein Produkt gehört zu genau einer
  // Veranstaltung), richtig ist "für beide Betriebsarten dieser
  // Veranstaltung".
  it("beschreibt die Reichweite des Schloss-Knopfs korrekt als beide Betriebsarten dieser Veranstaltung", async () => {
    renderControls("TEST");
    fireEvent.click(screen.getByRole("button", { name: "Bestand" }));
    await screen.findByRole("heading", { name: "Bestand: Bier" });

    expect(
      screen.getByText(
        /das gilt dann für beide Betriebsarten dieser Veranstaltung/,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/für jedes Fest/)).not.toBeInTheDocument();
  });

  // Issue #171, Teil 1: der Hinweistext unter "Nur für dieses Fest sperren"
  // muss den vorhandenen Testbetrieb/Echtbetrieb-Platzhalter aus dem
  // Dialogkopf wiederverwenden, nicht neu bauen.
  it("nennt im Sperr-Hinweis den tatsächlich angezeigten Betrieb", async () => {
    renderControls("LIVE");
    fireEvent.click(screen.getByRole("button", { name: "Bestand" }));
    await screen.findByRole("heading", { name: "Bestand: Bier" });

    expect(
      screen.getByText(/Gilt ausschließlich für den oben gezeigten Betrieb/),
    ).toBeInTheDocument();
    expect(screen.getByText(/\(Echtbetrieb\)/)).toBeInTheDocument();
  });
});

// Issue #171, Teil 3: manualBlocked (veranstaltungsbezogen gesperrt) und
// automatischer Bestand 0 (ausverkauft) verschmolzen bisher zum selben Wort
// "Ausverkauft". Belegt wird: jedes der beiden Kennzeichen erscheint genau
// dann, wenn sein Grund vorliegt, und die beiden Texte sind unterscheidbar.
describe("InventorySummary – gesperrt vs. ausverkauft (Issue #171)", () => {
  it("zeigt 'Für dieses Fest gesperrt' bei manualBlocked, unabhängig vom Bestand", () => {
    render(
      <InventorySummary
        product={{
          id: "p1",
          name: "Bier",
          availability: "OUT_OF_STOCK",
          manualBlocked: true,
          inventoryTracked: true,
          stockQuantity: 12,
          lowStockThreshold: 2,
        }}
      />,
    );

    expect(screen.getByText(/Für dieses Fest gesperrt/)).toBeInTheDocument();
    expect(screen.queryByText(/Ausverkauft/)).not.toBeInTheDocument();
  });

  it("zeigt weiterhin unverändert 'Ausverkauft', wenn der Bestand automatisch auf null steht", () => {
    render(
      <InventorySummary
        product={{
          id: "p2",
          name: "Wasser",
          availability: "OUT_OF_STOCK",
          manualBlocked: false,
          inventoryTracked: true,
          stockQuantity: 0,
          lowStockThreshold: 2,
        }}
      />,
    );

    expect(screen.getByText(/Ausverkauft/)).toBeInTheDocument();
    expect(
      screen.queryByText(/Für dieses Fest gesperrt/),
    ).not.toBeInTheDocument();
  });

  it("zeigt 'Manuell deaktiviert', wenn zusätzlich manualAvailability DISABLED gesetzt ist", () => {
    render(
      <InventorySummary
        product={{
          id: "p3",
          name: "Limo",
          availability: "DISABLED",
          manualBlocked: true,
        }}
      />,
    );

    expect(screen.getByText(/Manuell deaktiviert/)).toBeInTheDocument();
    expect(
      screen.queryByText(/Für dieses Fest gesperrt/),
    ).not.toBeInTheDocument();
  });
});
