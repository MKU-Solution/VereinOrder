import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { Login } from "./Login";

describe("Anmeldung", () => {
  it("zeigt die beiden Pflichtfelder und eine eindeutige Aktion", () => {
    render(
      <MemoryRouter>
        <Login />
      </MemoryRouter>,
    );

    expect(screen.getByPlaceholderText("z.B. admin")).toBeRequired();
    expect(screen.getByPlaceholderText("••••")).toBeRequired();
    expect(screen.getByRole("button", { name: "Anmelden" })).toBeEnabled();
  });
});
