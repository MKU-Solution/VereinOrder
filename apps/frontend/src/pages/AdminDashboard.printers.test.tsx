import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "../lib/api";
import { AdminDashboard } from "./AdminDashboard";

vi.mock("../lib/api", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

const printer = {
  id: "printer-1",
  name: "Küchendrucker",
  type: "ESC_POS_NETWORK",
  ipAddress: "192.168.1.50",
  port: 9100,
  paperWidth: 58,
  codepage: "CP858",
  cutMode: "PARTIAL",
  copies: 1,
  timeoutMs: 5000,
  isActive: true,
};

const mockedApi = api as unknown as {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
  patch: ReturnType<typeof vi.fn>;
};

let statusResponses: Array<Record<string, unknown>> = [];

beforeEach(() => {
  statusResponses = [];
  mockedApi.get.mockImplementation((url: string) => {
    if (url === "/events")
      return Promise.resolve({ data: [{ id: "event-1" }] });
    if (url === "/print-jobs/printers")
      return Promise.resolve({ data: [printer] });
    if (url.startsWith("/print-jobs/") && url.endsWith("/status")) {
      const next = statusResponses.shift() ?? { status: "PENDING" };
      return Promise.resolve({ data: next });
    }
    return Promise.resolve({ data: [] });
  });
  mockedApi.post.mockResolvedValue({ data: { id: "job-1" } });
  mockedApi.patch.mockResolvedValue({ data: {} });
});

async function openPrinterTab() {
  render(<AdminDashboard />);
  fireEvent.click(
    screen.getByRole("button", { name: /Drucker & Bon-Routing/ }),
  );
  await screen.findByText("Küchendrucker");
}

describe("Druckerverwaltung", () => {
  it("zeigt das Ausgabeprofil jedes Druckers", async () => {
    await openPrinterTab();

    expect(
      screen.getByText(/58 mm · CP858 · Schnitt: PARTIAL/),
    ).toBeInTheDocument();
  });

  it("meldet einen erfolgreichen Testdruck erst nach dem Druck", async () => {
    statusResponses = [{ status: "PROCESSING" }, { status: "PRINTED" }];
    await openPrinterTab();

    fireEvent.click(screen.getByRole("button", { name: /Testbon drucken/ }));

    expect(
      await screen.findByText(/Testbon eingereiht/, undefined, {
        timeout: 4000,
      }),
    ).toBeInTheDocument();
    expect(
      await screen.findByText("Testbon wurde gedruckt.", undefined, {
        timeout: 6000,
      }),
    ).toBeInTheDocument();
    expect(mockedApi.post).toHaveBeenCalledWith(
      "/print-jobs/printers/printer-1/test",
    );
  }, 10000);

  it("zeigt die Diagnose des Workers, wenn der Druck scheitert", async () => {
    statusResponses = [
      {
        status: "FAILED",
        errorMessage:
          "Verbindung zu 192.168.1.50:9100 wurde abgelehnt. Drucker eingeschaltet und Port korrekt?",
      },
    ];
    await openPrinterTab();

    fireEvent.click(screen.getByRole("button", { name: /Testbon drucken/ }));

    expect(
      await screen.findByText(/wurde abgelehnt/, undefined, { timeout: 6000 }),
    ).toBeInTheDocument();
  }, 10000);

  it("zeigt die Begründung des Backends bei ungültigen Druckerdaten", async () => {
    await openPrinterTab();
    mockedApi.patch.mockRejectedValue({
      response: {
        data: {
          message:
            "Netzwerkdrucker brauchen eine IP-Adresse oder einen Hostnamen.",
        },
      },
    });

    fireEvent.click(screen.getByTitle("Bearbeiten"));
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Netzwerkdrucker brauchen eine IP-Adresse oder einen Hostnamen.",
    );
  });

  it("bietet nur Druckertypen an, die der Worker bedienen kann", async () => {
    await openPrinterTab();
    fireEvent.click(screen.getByTitle("Bearbeiten"));

    const typeSelect = screen.getByDisplayValue(
      /ESC\/POS-Netzwerkdrucker/,
    ) as HTMLSelectElement;
    const values = Array.from(typeSelect.options).map((option) => option.value);

    expect(values).toEqual(["CONSOLE", "ESC_POS_NETWORK"]);
  });
});
