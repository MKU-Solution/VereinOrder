import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AdminProductsView } from "./AdminProductsView";

describe("AdminProductsView", () => {
  const mockCategories = [
    { id: "cat-1", name: "Getränke", targetStationId: "stat-1" },
    { id: "cat-2", name: "Essen", targetStationId: "stat-2" },
  ];

  const mockStations = [
    { id: "stat-1", name: "Schank" },
    { id: "stat-2", name: "Grill" },
  ];

  const mockProducts = [
    {
      id: "prod-1",
      name: "Bier 0,5l",
      price: 450,
      categoryId: "cat-1",
      targetStationId: null,
      sortOrder: 1,
      optionGroups: [],
    },
    {
      id: "prod-2",
      name: "Bratwurst",
      price: 600,
      categoryId: "cat-2",
      targetStationId: null,
      sortOrder: 2,
      optionGroups: [
        {
          id: "grp-1",
          name: "Beilage",
          minSelect: 1,
          maxSelect: 1,
          options: [{ id: "opt-1", name: "Semmel", priceDelta: 0 }],
        },
      ],
    },
  ];

  it("rendert Produkte formatiert in Euro mit Kategorie und Optionen", () => {
    render(
      <AdminProductsView
        products={mockProducts}
        categoriesList={mockCategories}
        stationsList={mockStations}
        onRefresh={vi.fn()}
        onOpenCreate={vi.fn()}
        onEdit={vi.fn()}
        onToggleAvailability={vi.fn()}
      />,
    );

    expect(screen.getAllByText("Bier 0,5l").length).toBeGreaterThan(0);
    expect(screen.getAllByText("€ 4,50").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Bratwurst").length).toBeGreaterThan(0);
    expect(screen.getAllByText("€ 6,00").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Getränke").length).toBeGreaterThan(0);
    expect(screen.getAllByText("1 Option").length).toBeGreaterThan(0);

    const catFilter = screen.getByRole("combobox", {
      name: "Kategorie filtern",
    });
    fireEvent.change(catFilter, { target: { value: "cat-1" } });

    expect(screen.getAllByText("Bier 0,5l").length).toBeGreaterThan(0);
    expect(screen.queryByText("Bratwurst")).not.toBeInTheDocument();
  });

  it("zeigt Pfandwert bei Produkten mit deposit > 0 an", () => {
    const productsWithDeposit = [
      {
        id: "prod-3",
        name: "Mineralwasser Glas",
        price: 300,
        deposit: 100,
        categoryId: "cat-1",
        targetStationId: null,
        sortOrder: 1,
      },
    ];

    render(
      <AdminProductsView
        products={productsWithDeposit}
        categoriesList={mockCategories}
        stationsList={mockStations}
        onRefresh={vi.fn()}
        onOpenCreate={vi.fn()}
        onEdit={vi.fn()}
        onToggleAvailability={vi.fn()}
      />,
    );

    expect(screen.getAllByText("+ € 1,00 Pfand").length).toBeGreaterThan(0);
  });

  // Issue #168: Der frühere Löschknopf traf ins Leere - jedes je bestellte
  // Produkt ist per RESTRICT ohnehin unlöschbar, sonst wäre die
  // Bestellhistorie nicht mehr lesbar. Er wurde durch den bereits
  // vorhandenen Verfügbarkeitsweg (manualAvailability = DISABLED) ersetzt.
  //
  // Issue #171: Die Beschriftung wurde von "deaktivieren" auf "ganz aus dem
  // Sortiment nehmen" umgestellt, damit sie nicht mit der veranstaltungs-
  // bezogenen Sperre (manualBlocked, InventoryControls) verwechselt wird.
  it("zeigt keinen Löschen-Knopf mehr, sondern einen Knopf zum Sortiment-Entfernen (Issue #168, #171)", () => {
    render(
      <AdminProductsView
        products={mockProducts}
        categoriesList={mockCategories}
        stationsList={mockStations}
        onRefresh={vi.fn()}
        onOpenCreate={vi.fn()}
        onEdit={vi.fn()}
        onToggleAvailability={vi.fn()}
      />,
    );

    expect(
      screen.queryByRole("button", { name: /löschen/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.getAllByRole("button", {
        name: /Bier 0,5l ganz aus dem Sortiment nehmen/i,
      }).length,
    ).toBeGreaterThan(0);
  });

  it("ruft onToggleAvailability beim Klick auf den Sortiment-entfernen-Knopf auf", () => {
    const onToggleAvailability = vi.fn();
    render(
      <AdminProductsView
        products={mockProducts}
        categoriesList={mockCategories}
        stationsList={mockStations}
        onRefresh={vi.fn()}
        onOpenCreate={vi.fn()}
        onEdit={vi.fn()}
        onToggleAvailability={onToggleAvailability}
      />,
    );

    fireEvent.click(
      screen.getAllByRole("button", {
        name: /Bier 0,5l ganz aus dem Sortiment nehmen/i,
      })[0],
    );

    expect(onToggleAvailability).toHaveBeenCalledTimes(1);
    expect(onToggleAvailability).toHaveBeenCalledWith(
      expect.objectContaining({ id: "prod-1" }),
    );
  });

  it("zeigt einen Knopf zum Wieder-Aufnehmen für bereits aus dem Sortiment genommene Produkte", () => {
    const disabledProduct = [
      { ...mockProducts[0], manualAvailability: "DISABLED" },
    ];
    render(
      <AdminProductsView
        products={disabledProduct}
        categoriesList={mockCategories}
        stationsList={mockStations}
        onRefresh={vi.fn()}
        onOpenCreate={vi.fn()}
        onEdit={vi.fn()}
        onToggleAvailability={vi.fn()}
      />,
    );

    expect(
      screen.getAllByRole("button", {
        name: /Bier 0,5l wieder ins Sortiment aufnehmen/i,
      }).length,
    ).toBeGreaterThan(0);
  });

  // Issue #171, Teil 1: Ein eigenes Badge macht "ganz aus dem Sortiment
  // genommen" (global, beide Betriebsarten dieser Veranstaltung) sichtbar,
  // getrennt von der veranstaltungsbezogenen Sperre.
  it("zeigt das Badge 'Aus dem Sortiment genommen' nur bei manualAvailability DISABLED", () => {
    const disabledProduct = [
      { ...mockProducts[0], manualAvailability: "DISABLED" },
    ];
    const { rerender } = render(
      <AdminProductsView
        products={mockProducts}
        categoriesList={mockCategories}
        stationsList={mockStations}
        onRefresh={vi.fn()}
        onOpenCreate={vi.fn()}
        onEdit={vi.fn()}
        onToggleAvailability={vi.fn()}
      />,
    );
    expect(
      screen.queryByText("Aus dem Sortiment genommen"),
    ).not.toBeInTheDocument();

    rerender(
      <AdminProductsView
        products={disabledProduct}
        categoriesList={mockCategories}
        stationsList={mockStations}
        onRefresh={vi.fn()}
        onOpenCreate={vi.fn()}
        onEdit={vi.fn()}
        onToggleAvailability={vi.fn()}
      />,
    );
    expect(
      screen.getAllByText("Aus dem Sortiment genommen").length,
    ).toBeGreaterThan(0);
  });

  // Issue #171, Teil 2: Der blinde Fleck aus dem Nachtrag zu #170 -
  // effectiveAvailability kennt die Warengruppe nicht, ein Produkt in einer
  // stillgelegten Gruppe erscheint deshalb als AVAILABLE, obwohl die Kassen
  // es nicht anbieten. Das Badge muss deshalb unabhängig von
  // prod.availability erscheinen, allein aus category.isActive.
  it("zeigt das Badge 'Warengruppe inaktiv' auch dann, wenn das Produkt selbst AVAILABLE ist", () => {
    const inactiveCategories = [
      { ...mockCategories[0], isActive: false },
      mockCategories[1],
    ];
    const productInInactiveCategory = [
      { ...mockProducts[0], availability: "AVAILABLE" },
    ];

    render(
      <AdminProductsView
        products={productInInactiveCategory}
        categoriesList={inactiveCategories}
        stationsList={mockStations}
        onRefresh={vi.fn()}
        onOpenCreate={vi.fn()}
        onEdit={vi.fn()}
        onToggleAvailability={vi.fn()}
      />,
    );

    expect(screen.getAllByText("Warengruppe inaktiv").length).toBeGreaterThan(
      0,
    );
  });

  it("zeigt das Badge 'Warengruppe inaktiv' nicht, wenn die Kategorie aktiv ist", () => {
    render(
      <AdminProductsView
        products={mockProducts}
        categoriesList={mockCategories}
        stationsList={mockStations}
        onRefresh={vi.fn()}
        onOpenCreate={vi.fn()}
        onEdit={vi.fn()}
        onToggleAvailability={vi.fn()}
      />,
    );

    expect(screen.queryByText("Warengruppe inaktiv")).not.toBeInTheDocument();
  });

  // Issue #171, Teil 3: manualBlocked und automatischer Bestand 0
  // verschmolzen bisher zum selben Wort "Ausverkauft".
  it("unterscheidet 'Für dieses Fest gesperrt' (manualBlocked) von automatisch 'Ausverkauft'", () => {
    const products = [
      {
        ...mockProducts[0],
        id: "prod-blocked",
        availability: "OUT_OF_STOCK",
        manualBlocked: true,
        inventoryTracked: true,
        stockQuantity: 12,
        lowStockThreshold: 2,
      },
      {
        ...mockProducts[1],
        id: "prod-soldout",
        availability: "OUT_OF_STOCK",
        manualBlocked: false,
        inventoryTracked: true,
        stockQuantity: 0,
        lowStockThreshold: 2,
      },
    ];

    render(
      <AdminProductsView
        products={products}
        categoriesList={mockCategories}
        stationsList={mockStations}
        onRefresh={vi.fn()}
        onOpenCreate={vi.fn()}
        onEdit={vi.fn()}
        onToggleAvailability={vi.fn()}
      />,
    );

    expect(
      screen.getAllByText(/Für dieses Fest gesperrt/).length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByText(/Ausverkauft/).length).toBeGreaterThan(0);
  });

  // Mehrere Gründe gleichzeitig: global aus dem Sortiment genommen, in einer
  // stillgelegten Warengruppe und für dieses Fest gesperrt - alle drei
  // Kennzeichen müssen nebeneinander erscheinen, ohne einander zu verdecken.
  it("zeigt alle zutreffenden Kennzeichen gleichzeitig, wenn mehrere Gründe vorliegen", () => {
    const multiReasonCategories = [
      { ...mockCategories[0], isActive: false },
      mockCategories[1],
    ];
    const multiReasonProduct = [
      {
        ...mockProducts[0],
        manualAvailability: "DISABLED",
        availability: "DISABLED",
        manualBlocked: true,
      },
    ];

    render(
      <AdminProductsView
        products={multiReasonProduct}
        categoriesList={multiReasonCategories}
        stationsList={mockStations}
        onRefresh={vi.fn()}
        onOpenCreate={vi.fn()}
        onEdit={vi.fn()}
        onToggleAvailability={vi.fn()}
      />,
    );

    expect(
      screen.getAllByText("Aus dem Sortiment genommen").length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByText("Warengruppe inaktiv").length).toBeGreaterThan(
      0,
    );
    expect(screen.getAllByText("Bier 0,5l").length).toBeGreaterThan(0);
  });
});
