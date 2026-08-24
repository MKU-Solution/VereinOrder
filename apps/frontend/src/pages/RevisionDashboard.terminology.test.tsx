import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "../lib/api";
import { RevisionDashboard } from "./RevisionDashboard";

vi.mock("../lib/api", () => ({
  api: {
    get: vi.fn(),
  },
}));

const mockedApi = api as unknown as { get: ReturnType<typeof vi.fn> };

beforeEach(() => {
  mockedApi.get.mockReset();
  mockedApi.get.mockImplementation((url: string) => {
    if (url === "/events") {
      return Promise.resolve({
        data: [{ id: "event-1", name: "Sommerfest", status: "ACTIVE" }],
      });
    }
    if (url.startsWith("/reports/summary")) {
      return Promise.resolve({
        data: {
          totalAmount: 0,
          orderCount: 0,
          openAmount: 0,
          cashRevenue: 0,
          cardRevenue: 0,
          voucherRevenue: 0,
          cancelledCount: 0,
          cancelledAmount: 0,
        },
      });
    }
    return Promise.resolve({ data: [] });
  });
});

describe("einheitliche Kategorie-Terminologie (Issue #95)", () => {
  it("verwendet in der Revision ausschließlich den Begriff Kategorie", async () => {
    render(<RevisionDashboard />);

    expect(
      await screen.findByRole("button", { name: "Produkte & Kategorien" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Umsatz nach Kategorien")).toBeInTheDocument();
    expect(screen.queryByText(/Warengrupp/i)).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Produkte & Kategorien" }),
    );

    expect(await screen.findByText("Kategorie")).toBeInTheDocument();
    expect(screen.queryByText(/Warengrupp/i)).not.toBeInTheDocument();
  });
});
