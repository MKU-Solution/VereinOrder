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
  it("zeigt keinen Löschen-Knopf mehr, sondern einen Deaktivieren-Knopf (Issue #168)", () => {
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
      screen.getAllByRole("button", { name: /Bier 0,5l deaktivieren/i }).length,
    ).toBeGreaterThan(0);
  });

  it("ruft onToggleAvailability beim Klick auf den Deaktivieren-Knopf auf", () => {
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
      screen.getAllByRole("button", { name: /Bier 0,5l deaktivieren/i })[0],
    );

    expect(onToggleAvailability).toHaveBeenCalledTimes(1);
    expect(onToggleAvailability).toHaveBeenCalledWith(
      expect.objectContaining({ id: "prod-1" }),
    );
  });

  it("zeigt einen Aktivieren-Knopf für bereits deaktivierte Produkte", () => {
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
      screen.getAllByRole("button", { name: /Bier 0,5l aktivieren/i }).length,
    ).toBeGreaterThan(0);
  });
});
