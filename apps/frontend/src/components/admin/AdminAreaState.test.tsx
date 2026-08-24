import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AdminAreaState } from "./AdminAreaState";
import { ADMIN_AREAS } from "./adminAreaRegistry";

describe("Wächtervertrag der Verwaltungsbereiche", () => {
  it.each(ADMIN_AREAS)(
    "$label unterscheidet Laden, Fehler und Inhalt",
    ({ id }) => {
      const retry = vi.fn();
      const { rerender } = render(
        <AdminAreaState area={id} isLoading error={null} onRetry={retry}>
          <div>Inhalt {id}</div>
        </AdminAreaState>,
      );

      const section = document.querySelector(`[data-admin-area="${id}"]`);
      expect(section).toHaveAttribute("aria-busy", "true");
      expect(screen.getByRole("status")).toHaveTextContent("Lade Daten");
      expect(screen.queryByText(`Inhalt ${id}`)).not.toBeInTheDocument();

      rerender(
        <AdminAreaState
          area={id}
          isLoading={false}
          error="Bereich konnte nicht geladen werden."
          onRetry={retry}
        >
          <div>Inhalt {id}</div>
        </AdminAreaState>,
      );
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Bereich konnte nicht geladen werden.",
      );
      fireEvent.click(screen.getByRole("button", { name: "Erneut versuchen" }));
      expect(retry).toHaveBeenCalledOnce();

      rerender(
        <AdminAreaState
          area={id}
          isLoading={false}
          error={null}
          onRetry={retry}
        >
          <div>Inhalt {id}</div>
        </AdminAreaState>,
      );
      expect(screen.getByText(`Inhalt ${id}`)).toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    },
  );
});
