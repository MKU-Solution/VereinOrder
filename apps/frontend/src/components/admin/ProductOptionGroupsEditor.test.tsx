import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  ProductOptionGroupsEditor,
  buildOptionGroupsPayload,
  loadOptionGroupsFromProduct,
  OptionGroupFormState,
} from "./ProductOptionGroupsEditor";

describe("ProductOptionGroupsEditor – Mindest- und Höchstanzahl (Issue #94)", () => {
  it("lädt und baut Nutzlast mit minSelect und maxSelect bei Mehrfachauswahl korrekt auf", () => {
    const rawProduct = {
      optionGroups: [
        {
          id: "grp-1",
          name: "Beilagen",
          selectionType: "MULTIPLE",
          isRequired: true,
          minSelect: 2,
          maxSelect: 3,
          priceMode: "SURCHARGE",
          quickSaleTiles: false,
          options: [
            { id: "opt-1", name: "Pommes", priceEffect: 0, isActive: true },
            { id: "opt-2", name: "Reis", priceEffect: 0, isActive: true },
            { id: "opt-3", name: "Salat", priceEffect: 100, isActive: true },
          ],
        },
        {
          id: "grp-2",
          name: "Saucen",
          selectionType: "MULTIPLE",
          isRequired: false,
          minSelect: 0,
          maxSelect: null,
          priceMode: "SURCHARGE",
          quickSaleTiles: false,
          options: [
            { id: "opt-4", name: "Ketchup", priceEffect: 50, isActive: true },
            { id: "opt-5", name: "Mayo", priceEffect: 50, isActive: true },
          ],
        },
      ],
    };

    const loaded = loadOptionGroupsFromProduct(rawProduct);
    expect(loaded).toHaveLength(2);
    expect(loaded[0].minSelect).toBe(2);
    expect(loaded[0].maxSelect).toBe(3);
    expect(loaded[1].minSelect).toBe(0);
    expect(loaded[1].maxSelect).toBeNull();

    const payload = buildOptionGroupsPayload(loaded);
    expect(payload[0].minSelect).toBe(2);
    expect(payload[0].maxSelect).toBe(3);
    expect(payload[0].isRequired).toBe(true);
    expect(payload[1].minSelect).toBe(0);
    expect(payload[1].maxSelect).toBeNull();
    expect(payload[1].isRequired).toBe(false);
  });

  it("erlaubt das Einstellen von Mindest- und Höchstanzahl in der Maske", () => {
    const initialGroup: OptionGroupFormState = {
      clientId: "group-1",
      name: "Beilagen",
      selectionType: "MULTIPLE",
      isRequired: true,
      minSelect: 1,
      maxSelect: null,
      priceMode: "SURCHARGE",
      quickSaleTiles: false,
      options: [
        {
          clientId: "opt-1",
          name: "Pommes",
          euro: "0",
          cent: "00",
          negative: false,
          isActive: true,
        },
        {
          clientId: "opt-2",
          name: "Reis",
          euro: "0",
          cent: "00",
          negative: false,
          isActive: true,
        },
        {
          clientId: "opt-3",
          name: "Salat",
          euro: "1",
          cent: "00",
          negative: false,
          isActive: true,
        },
      ],
    };

    const onChange = vi.fn();
    render(
      <ProductOptionGroupsEditor
        groups={[initialGroup]}
        onChange={onChange}
        validationAttempted={false}
      />,
    );

    // Mindestanzahl-Feld existiert und steht auf 1
    const minInput = screen.getByLabelText(/Mindestanzahl/i);
    expect(minInput).toHaveValue(1);

    // Mindestanzahl auf 2 ändern
    fireEvent.change(minInput, { target: { value: "2" } });
    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({
        minSelect: 2,
      }),
    ]);

    // Obergrenze aktivieren
    const limitSelect = screen.getByDisplayValue("Keine Obergrenze");
    fireEvent.change(limitSelect, { target: { value: "LIMITED" } });
    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({
        maxSelect: 1,
      }),
    ]);
  });

  it("stellt bei Einfachauswahl fix minSelect=1 bzw 0 und maxSelect=1 sicher", () => {
    const singleGroup: OptionGroupFormState = {
      clientId: "group-single",
      name: "Größe",
      selectionType: "SINGLE",
      isRequired: true,
      minSelect: 1,
      maxSelect: 1,
      priceMode: "SURCHARGE",
      quickSaleTiles: false,
      options: [
        {
          clientId: "opt-1",
          name: "Klein",
          euro: "0",
          cent: "00",
          negative: false,
          isActive: true,
        },
      ],
    };

    const payload = buildOptionGroupsPayload([singleGroup]);
    expect(payload[0].minSelect).toBe(1);
    expect(payload[0].maxSelect).toBe(1);

    const freiwilligSingle: OptionGroupFormState = {
      ...singleGroup,
      isRequired: false,
    };
    const payloadFreiwillig = buildOptionGroupsPayload([freiwilligSingle]);
    expect(payloadFreiwillig[0].minSelect).toBe(0);
    expect(payloadFreiwillig[0].maxSelect).toBe(1);
  });
});
