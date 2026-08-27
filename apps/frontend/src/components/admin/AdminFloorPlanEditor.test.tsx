import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "../../lib/api";
import { AdminFloorPlanEditor } from "./AdminFloorPlanEditor";

vi.mock("../../lib/api", () => ({
  api: { put: vi.fn() },
}));

describe("AdminFloorPlanEditor", () => {
  beforeEach(() => vi.clearAllMocks());

  it("legt einen Tisch an, benennt ihn und speichert den Plan", async () => {
    vi.mocked(api.put).mockResolvedValue({ data: {} });
    const onSaved = vi.fn();
    const onClose = vi.fn();
    render(
      <AdminFloorPlanEditor
        area={{ id: "area-1", name: "Festzelt", floorPlan: null }}
        onSaved={onSaved}
        onClose={onClose}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Tisch" }));
    fireEvent.change(screen.getByLabelText("Beschriftung"), {
      target: { value: "Ehrentisch" },
    });
    fireEvent.change(
      screen.getByLabelText("Tischbezeichnung für Bestellungen"),
      { target: { value: "E1" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Plan speichern" }));

    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith("/areas/area-1/floor-plan", {
        elements: [
          expect.objectContaining({ label: "Ehrentisch", tableName: "E1" }),
        ],
      }),
    );
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
