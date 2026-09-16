import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "../lib/api";
import { useAuthStore } from "../store/useAuthStore";
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
  codepageProfile: "MUNBYN_CLONE",
  cutMode: "PARTIAL",
  copies: 1,
  timeoutMs: 5000,
  isActive: true,
};

const unresolvedJob = {
  id: "job-1",
  jobType: "RECEIPT",
  printerId: "printer-1",
  printerName: "Küchendrucker",
  unresolvedAt: new Date(Date.now() - 6 * 60000).toISOString(),
  unresolvedReason: "TRANSPORT",
  bytesWritten: 412,
  cupsJobState: null,
  attemptCount: 1,
  failoverCount: 0,
  content: {
    title: "KASSENBELEG",
    orderNumber: "482",
    stationName: null,
    tableName: null,
  },
};

const mockedApi = api as unknown as {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
  patch: ReturnType<typeof vi.fn>;
};

let statusResponses: Array<Record<string, unknown>> = [];
let unresolvedJobsResponse: Array<Record<string, unknown>> = [];
let printersResponse: Array<Record<string, unknown>> = [printer];

beforeEach(() => {
  statusResponses = [];
  unresolvedJobsResponse = [];
  printersResponse = [printer];
  mockedApi.get.mockReset();
  mockedApi.get.mockImplementation((url: string) => {
    if (url === "/events")
      return Promise.resolve({ data: [{ id: "event-1" }] });
    if (url === "/print-jobs/printers")
      return Promise.resolve({ data: printersResponse });
    if (url === "/print-jobs/unresolved")
      return Promise.resolve({ data: unresolvedJobsResponse });
    if (url.startsWith("/print-jobs/") && url.endsWith("/status")) {
      const next = statusResponses.shift() ?? { status: "PENDING" };
      return Promise.resolve({ data: next });
    }
    return Promise.resolve({ data: [] });
  });
  mockedApi.post.mockResolvedValue({ data: { id: "job-1" } });
  mockedApi.patch.mockResolvedValue({ data: {} });
});

afterEach(() => {
  useAuthStore.setState({ user: null, token: null });
});

async function openPrinterTab() {
  render(
    <MemoryRouter initialEntries={["/admin/printers"]}>
      <AdminDashboard />
    </MemoryRouter>,
  );
  await screen.findByRole("heading", { name: "Küchendrucker" });
}

function loginAs(role: "ADMINISTRATOR" | "EVENT_MANAGER" | "WAITER") {
  useAuthStore.setState({
    user: { username: "test", userId: "u1", role },
    token: "test-token",
  });
}

describe("Druckerverwaltung", () => {
  it("zeigt das Ausgabeprofil jedes Druckers, einschließlich des Codepage-Geräteprofils (Issue #260)", async () => {
    await openPrinterTab();

    expect(
      screen.getByText(
        /58 mm · CP858 \(MUNBYN \/ Nachbau\) · Schnitt: PARTIAL/,
      ),
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

  it("lädt die Druckerliste nach einem erfolgreichen Testbon sofort neu und nimmt „Druckt nicht“ weg (Issue #265)", async () => {
    printersResponse = [
      {
        ...printer,
        lastOkAt: new Date(Date.now() - 60 * 60000).toISOString(),
        lastErrorAt: new Date(Date.now() - 5 * 60000).toISOString(),
        lastErrorCode: "CONNECTION_REFUSED",
      },
    ];
    statusResponses = [{ status: "PRINTED" }];
    await openPrinterTab();
    expect(screen.getByText("Druckt nicht")).toBeInTheDocument();

    // Der Worker hat gedruckt: ab jetzt liefert das Backend den Erfolg.
    mockedApi.post.mockImplementation(() => {
      printersResponse = [
        {
          ...printer,
          lastOkAt: new Date().toISOString(),
          lastErrorAt: new Date(Date.now() - 5 * 60000).toISOString(),
          lastErrorCode: "CONNECTION_REFUSED",
        },
      ];
      return Promise.resolve({ data: { id: "job-1" } });
    });

    fireEvent.click(screen.getByRole("button", { name: /Testbon drucken/ }));

    expect(
      await screen.findByText("Testbon wurde gedruckt.", undefined, {
        timeout: 4000,
      }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByText("Druckt nicht")).not.toBeInTheDocument(),
    );
    expect(screen.getByText("Bereit")).toBeInTheDocument();
  }, 10000);

  it("lädt die Druckerliste auch nach einem gescheiterten Testbon sofort neu (Issue #265)", async () => {
    statusResponses = [{ status: "FAILED", errorMessage: "abgelehnt" }];
    await openPrinterTab();
    const printerCalls = () =>
      mockedApi.get.mock.calls.filter(([url]) => url === "/print-jobs/printers")
        .length;
    const callsBefore = printerCalls();

    fireEvent.click(screen.getByRole("button", { name: /Testbon drucken/ }));

    expect(
      await screen.findByText("abgelehnt", undefined, { timeout: 4000 }),
    ).toBeInTheDocument();
    await waitFor(() => expect(printerCalls()).toBe(callsBefore + 1));
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

  it("bietet auch CUPS_IPP als Druckertyp an, den der Worker bedienen kann", async () => {
    await openPrinterTab();
    fireEvent.click(screen.getByTitle("Bearbeiten"));

    const typeSelect = screen.getByDisplayValue(
      /ESC\/POS-Netzwerkdrucker/,
    ) as HTMLSelectElement;
    const values = Array.from(typeSelect.options).map((option) => option.value);

    expect(values).toEqual(["CONSOLE", "ESC_POS_NETWORK", "CUPS_IPP"]);
  });

  it("zeigt das Codepage-Geräteprofil des Druckers und lässt es umstellen (Issue #260)", async () => {
    await openPrinterTab();
    fireEvent.click(screen.getByTitle("Bearbeiten"));

    const profileSelect = screen.getByLabelText(
      /Geräteprofil für den Zeichensatz-Befehl/,
    ) as HTMLSelectElement;
    const values = Array.from(profileSelect.options).map(
      (option) => option.value,
    );
    expect(values).toEqual(["EPSON_STANDARD", "MUNBYN_CLONE"]);
    // Der Testfixture-Drucker steht auf MUNBYN_CLONE.
    expect(profileSelect.value).toBe("MUNBYN_CLONE");

    fireEvent.change(profileSelect, { target: { value: "EPSON_STANDARD" } });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));

    expect(await screen.findByText(/58 mm/)).toBeInTheDocument();
    expect(mockedApi.patch).toHaveBeenCalledWith(
      "/print-jobs/printers/printer-1",
      expect.objectContaining({ codepageProfile: "EPSON_STANDARD" }),
    );
  });

  it("verlangt bei CUPS_IPP einen Warteschlangennamen", async () => {
    await openPrinterTab();
    fireEvent.click(screen.getByTitle("Bearbeiten"));

    const typeSelect = screen.getByDisplayValue(
      /ESC\/POS-Netzwerkdrucker/,
    ) as HTMLSelectElement;
    fireEvent.change(typeSelect, { target: { value: "CUPS_IPP" } });

    const queueInput = screen.getByLabelText(
      /Warteschlangenname/,
    ) as HTMLInputElement;
    expect(queueInput).toBeRequired();
  });
});

describe("Unklare Druckaufträge", () => {
  it("zeigt den ruhigen Leerzustand ohne unklare Aufträge", async () => {
    unresolvedJobsResponse = [];
    await openPrinterTab();

    expect(
      await screen.findByText("Keine unklaren Druckaufträge."),
    ).toBeInTheDocument();
  });

  it("zeigt einen unklaren Auftrag mit seinen Angaben, Zähler stimmt", async () => {
    unresolvedJobsResponse = [unresolvedJob];
    await openPrinterTab();

    expect(
      await screen.findByText(/Unklare Druckaufträge \(1\)/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Kassenbeleg/)).toBeInTheDocument();
    expect(screen.getByText(/#482/)).toBeInTheDocument();
    expect(
      screen.getByText(/Verbindung nach 412 Byte abgebrochen/),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Betriebsstatus")).toHaveTextContent(
      "1 Hinweis",
    );
  });

  it("druckt über den richtigen Endpunkt erneut und zeigt danach das Ergebnis", async () => {
    loginAs("EVENT_MANAGER");
    unresolvedJobsResponse = [unresolvedJob];
    await openPrinterTab();

    fireEvent.click(screen.getByRole("button", { name: "Erneut drucken" }));

    const select = await screen.findByLabelText(/Zieldrucker/);
    fireEvent.change(select, { target: { value: "printer-1" } });
    fireEvent.click(screen.getByLabelText(/dort liegt kein vollständiger Bon/));

    const submitButtons = screen.getAllByRole("button", {
      name: "Erneut drucken",
    });
    fireEvent.click(submitButtons[submitButtons.length - 1]);

    expect(mockedApi.post).toHaveBeenCalledWith("/print-jobs/job-1/resolve", {
      resolution: "REPRINTED",
      targetPrinterId: "printer-1",
    });
    expect(
      await screen.findByText(
        /Neuer Druckauftrag an „Küchendrucker" eingereiht\./,
      ),
    ).toBeInTheDocument();
  });

  it("verlangt beim Verwerfen zwingend eine Begründung, ohne Mindestlänge", async () => {
    loginAs("ADMINISTRATOR");
    unresolvedJobsResponse = [unresolvedJob];
    await openPrinterTab();

    fireEvent.click(screen.getByRole("button", { name: "Verwerfen" }));

    const submitButtons = await screen.findAllByRole("button", {
      name: "Verwerfen",
    });
    const submit = submitButtons[submitButtons.length - 1];
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/Begründung/), {
      target: { value: "ok" },
    });
    expect(submit).not.toBeDisabled();

    fireEvent.click(submit);

    expect(mockedApi.post).toHaveBeenCalledWith("/print-jobs/job-1/resolve", {
      resolution: "DISCARDED",
      comment: "ok",
    });
    expect(await screen.findByText("Verworfen.")).toBeInTheDocument();
  });

  it("zeigt Kellnern keine Möglichkeit zum Verwerfen", async () => {
    loginAs("WAITER");
    unresolvedJobsResponse = [unresolvedJob];
    await openPrinterTab();

    await screen.findByText(/Unklare Druckaufträge \(1\)/);
    expect(
      screen.queryByRole("button", { name: "Verwerfen" }),
    ).not.toBeInTheDocument();
  });

  it("zeigt bei 409 die vorgesehene Meldung einer bereits getroffenen Entscheidung", async () => {
    loginAs("ADMINISTRATOR");
    unresolvedJobsResponse = [unresolvedJob];
    mockedApi.post.mockImplementation((url: string) => {
      if (url === "/print-jobs/job-1/resolve") {
        return Promise.reject({
          response: {
            status: 409,
            data: {
              message:
                "Der Druckauftrag befindet sich nicht mehr im Zustand UNRESOLVED - vermutlich hat bereits jemand entschieden.",
            },
          },
        });
      }
      return Promise.resolve({ data: { id: "job-1" } });
    });
    await openPrinterTab();

    fireEvent.click(
      screen.getByRole("button", { name: "Als gedruckt bestätigen" }),
    );
    fireEvent.click(await screen.findByLabelText(/liegt dort vor/));
    const confirmButtons = screen.getAllByRole("button", {
      name: "Als gedruckt bestätigen",
    });
    fireEvent.click(confirmButtons[confirmButtons.length - 1]);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "vermutlich hat bereits jemand entschieden",
    );
  });
});
