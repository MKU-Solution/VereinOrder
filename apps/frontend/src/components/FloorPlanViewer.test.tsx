import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { FloorPlanViewer } from "./FloorPlanViewer";
import type { AreaFloorPlan } from "./floorPlanTypes";

const plans: AreaFloorPlan[] = [
  {
    id: "area-zelt",
    name: "Festzelt",
    sortOrder: 0,
    floorPlan: {
      version: 1,
      width: 1000,
      height: 700,
      elements: [
        {
          id: "table-1",
          kind: "TABLE_ROUND",
          label: "Tisch 12",
          tableName: "12",
          x: 100,
          y: 120,
          width: 110,
          height: 110,
          rotation: 0,
          status: "READY",
          openOrderCount: 2,
        },
        {
          id: "stage-1",
          kind: "STAGE",
          label: "Hauptbühne",
          x: 500,
          y: 40,
          width: 300,
          height: 120,
          rotation: 0,
        },
      ],
    },
  },
];

describe("FloorPlanViewer", () => {
  it("zeigt Status und Festelemente und übernimmt einen Tisch direkt", () => {
    const onSelectTable = vi.fn();
    render(<FloorPlanViewer plans={plans} onSelectTable={onSelectTable} />);

    expect(screen.getByText("Hauptbühne")).toBeInTheDocument();
    const table = screen.getByRole("button", {
      name: "Tisch 12, Bereit, 2 offene Bestellungen",
    });
    fireEvent.click(table);
    expect(onSelectTable).toHaveBeenCalledWith("12", "area-zelt");
  });

  it("bietet bedienbare Zoomschritte und einen Reset", () => {
    render(<FloorPlanViewer plans={plans} onSelectTable={vi.fn()} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Raumplan vergrößern" }),
    );
    expect(screen.getByText("125 %")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Zoom zurücksetzen" }));
    expect(screen.getByText("100 %")).toBeInTheDocument();
  });
});
