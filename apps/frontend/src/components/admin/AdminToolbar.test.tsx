import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AdminToolbar } from "./AdminToolbar";

describe("AdminToolbar", () => {
  it("rendert Suchfeld, Zähler und Refresh-Button korrekt", () => {
    const onSearchChange = vi.fn();
    const onRefresh = vi.fn();

    const { container } = render(
      <AdminToolbar
        searchQuery=""
        onSearchChange={onSearchChange}
        searchPlaceholder="Test suchen …"
        searchLabel="Test durchsuchen"
        totalCount={10}
        filteredCount={10}
        onRefresh={onRefresh}
      />,
    );

    const input = screen.getByPlaceholderText("Test suchen …");
    expect(input).toBeInTheDocument();
    expect(container.querySelector('[aria-live="polite"]')).toHaveTextContent(
      "10 Einträge",
    );

    fireEvent.change(input, { target: { value: "Bier" } });
    expect(onSearchChange).toHaveBeenCalledWith("Bier");

    const refreshBtn = screen.getByRole("button", { name: "Aktualisieren" });
    fireEvent.click(refreshBtn);
    expect(onRefresh).toHaveBeenCalled();
  });

  it("zeigt gefilterte Anzahl und Such-Löschbutton wenn Text eingegeben wird", () => {
    const onSearchChange = vi.fn();

    const { container } = render(
      <AdminToolbar
        searchQuery="Bier"
        onSearchChange={onSearchChange}
        searchPlaceholder="Test suchen …"
        searchLabel="Test durchsuchen"
        totalCount={10}
        filteredCount={3}
      />,
    );

    expect(container.querySelector('[aria-live="polite"]')).toHaveTextContent(
      "3 von 10 Einträgen",
    );

    const clearBtn = screen.getByRole("button", {
      name: "Suchbegriff löschen",
    });
    fireEvent.click(clearBtn);
    expect(onSearchChange).toHaveBeenCalledWith("");
  });
});
