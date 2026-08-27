import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CheckoutModal } from "./CheckoutModal";

describe("CheckoutModal", () => {
  it("benennt den Schließen-Button zugänglich und schließt die Abrechnung", () => {
    const onClose = vi.fn();

    render(
      <CheckoutModal
        isOpen={true}
        total={1250}
        onClose={onClose}
        onConfirm={vi.fn()}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Abrechnung schließen" }),
    );

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
