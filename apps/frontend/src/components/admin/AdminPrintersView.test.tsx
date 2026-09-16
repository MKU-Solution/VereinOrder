import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AdminPrintersView } from "./AdminPrintersView";

describe("AdminPrintersView", () => {
  const mockPrinters = [
    {
      id: "p-1",
      name: "Schankdrucker",
      type: "ESC_POS_NETWORK",
      ipAddress: "192.168.1.50",
      port: 9100,
      paperWidth: 80,
      codepage: "CP858",
      cutMode: "PARTIAL",
      copies: 1,
      timeoutMs: 5000,
      isActive: true,
    },
    {
      id: "p-2",
      name: "Simulator Konsole",
      type: "CONSOLE",
      isActive: false,
    },
  ];

  const mockUnresolvedJobs = [
    {
      id: "job-1",
      jobType: "RECEIPT",
      printerId: "p-1",
      printerName: "Schankdrucker",
      unresolvedAt: new Date(Date.now() - 5 * 60000).toISOString(),
      unresolvedReason: "TRANSPORT",
      attemptCount: 2,
      failoverCount: 1,
      content: {
        title: "KASSENBELEG",
        orderNumber: "101",
      },
    },
  ];

  it("rendert Druckerliste, unklare Aufträge und Toolbar", () => {
    render(
      <AdminPrintersView
        printers={mockPrinters}
        unresolvedJobs={mockUnresolvedJobs}
        printerTests={{}}
        onRefresh={vi.fn()}
        onOpenCreate={vi.fn()}
        onEdit={vi.fn()}
        onTestPrint={vi.fn()}
        onOpenResolveDialog={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Schankdrucker" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Simulator Konsole" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Unklare Druckaufträge (1)")).toBeInTheDocument();
    expect(screen.getByText(/Kassenbeleg/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Als gedruckt bestätigen" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Erneut drucken" }),
    ).toBeInTheDocument();
  });

  it("filtert Drucker nach Suche und Druckertyp", () => {
    render(
      <AdminPrintersView
        printers={mockPrinters}
        unresolvedJobs={[]}
        printerTests={{}}
        onRefresh={vi.fn()}
        onOpenCreate={vi.fn()}
        onEdit={vi.fn()}
        onTestPrint={vi.fn()}
        onOpenResolveDialog={vi.fn()}
      />,
    );

    const searchInput = screen.getByPlaceholderText(
      "Druckername oder IP suchen …",
    );
    fireEvent.change(searchInput, { target: { value: "Schank" } });

    expect(screen.getByText("Schankdrucker")).toBeInTheDocument();
    expect(screen.queryByText("Simulator Konsole")).not.toBeInTheDocument();

    const typeFilter = screen.getByLabelText("Druckertyp filtern");
    fireEvent.change(typeFilter, { target: { value: "CONSOLE" } });

    // Both filters applied: 'Schank' + 'CONSOLE' matches nothing
    expect(
      screen.getByText("Keine passenden Einträge gefunden"),
    ).toBeInTheDocument();
  });

  it("ruft onTestPrint bei Klick auf Testbon drucken auf", () => {
    const onTestPrint = vi.fn();
    render(
      <AdminPrintersView
        printers={mockPrinters}
        unresolvedJobs={[]}
        printerTests={{}}
        onRefresh={vi.fn()}
        onOpenCreate={vi.fn()}
        onEdit={vi.fn()}
        onTestPrint={onTestPrint}
        onOpenResolveDialog={vi.fn()}
      />,
    );

    const testButtons = screen.getAllByRole("button", {
      name: "Testbon drucken",
    });
    fireEvent.click(testButtons[0]);

    expect(onTestPrint).toHaveBeenCalledWith("p-1");
  });
});

describe("AdminPrintersView – Druckerzustand (Issue #265)", () => {
  const minutesAgo = (minutes: number) =>
    new Date(Date.now() - minutes * 60000).toISOString();

  const failingA = {
    id: "p-a",
    name: "Küche",
    type: "ESC_POS_NETWORK",
    isActive: true,
    lastOkAt: minutesAgo(90),
    lastErrorAt: minutesAgo(5),
    lastErrorCode: "CONNECTION_REFUSED",
  };
  const recoveredB = {
    id: "p-b",
    name: "Schank",
    type: "ESC_POS_NETWORK",
    isActive: true,
    lastOkAt: minutesAgo(2),
    lastErrorAt: minutesAgo(30),
    lastErrorCode: "TIMEOUT",
  };
  const offWithErrorC = {
    id: "p-c",
    name: "Bar",
    type: "ESC_POS_NETWORK",
    isActive: false,
    lastOkAt: null,
    lastErrorAt: minutesAgo(10),
    lastErrorCode: "UNREACHABLE",
  };
  const neverPrintedD = {
    id: "p-d",
    name: "Terrasse",
    type: "ESC_POS_NETWORK",
    isActive: true,
    lastOkAt: null,
    lastErrorAt: null,
    lastErrorCode: null,
  };

  const renderView = (printers: any[]) =>
    render(
      <AdminPrintersView
        printers={printers}
        unresolvedJobs={[]}
        printerTests={{}}
        onRefresh={vi.fn()}
        onOpenCreate={vi.fn()}
        onEdit={vi.fn()}
        onTestPrint={vi.fn()}
        onOpenResolveDialog={vi.fn()}
      />,
    );

  const card = (name: string) => {
    const article = screen.getByRole("heading", { name }).closest("article");
    if (!article) throw new Error(`Keine Karte für ${name}`);
    return within(article);
  };

  it("zeigt einen Drucker mit jüngerem Fehler anders als einen wieder gesunden", () => {
    renderView([failingA, recoveredB]);

    const a = card("Küche");
    expect(a.getByText("Druckt nicht")).toBeInTheDocument();
    expect(
      a.getByText(
        "Letzter Druckversuch fehlgeschlagen: Drucker nimmt keine Verbindung an",
      ),
    ).toBeInTheDocument();
    expect(a.queryByText("Bereit")).not.toBeInTheDocument();

    const b = card("Schank");
    expect(b.getByText("Bereit")).toBeInTheDocument();
    expect(b.queryByText("Druckt nicht")).not.toBeInTheDocument();
  });

  it("zeigt einen ausgeschalteten Drucker mit Fehler als ausgeschaltet und nennt ihn nicht im Sammelhinweis", () => {
    renderView([failingA, offWithErrorC]);

    const c = card("Bar");
    expect(c.getByText("Ausgeschaltet")).toBeInTheDocument();
    expect(
      c.getByText(
        /^Letzter Druckversuch fehlgeschlagen \(.+\): Drucker ist im Netzwerk nicht erreichbar$/,
      ),
    ).toBeInTheDocument();
    expect(c.queryByText("Druckt nicht")).not.toBeInTheDocument();

    const summary = screen.getByRole("region", {
      name: "Drucker, die nicht drucken",
    });
    expect(summary).toHaveTextContent('Drucker „Küche" druckt nicht');
    expect(summary).not.toHaveTextContent("Bar");
  });

  it("behält den Sammelhinweis, wenn der Suchfilter die fehlerhafte Karte ausblendet", () => {
    renderView([failingA, recoveredB]);

    fireEvent.change(
      screen.getByPlaceholderText("Druckername oder IP suchen …"),
      { target: { value: "Schank" } },
    );

    expect(
      screen.queryByRole("heading", { name: "Küche" }),
    ).not.toBeInTheDocument();
    const summary = screen.getByRole("region", {
      name: "Drucker, die nicht drucken",
    });
    expect(summary).toHaveTextContent('Drucker „Küche" druckt nicht');
    expect(
      within(summary).getByRole("link", { name: "Küche" }),
    ).toHaveAttribute("href", "#printer-p-a");
  });

  it("nennt mehrere fehlerhafte Drucker im Sammelhinweis", () => {
    renderView([failingA, { ...recoveredB, lastOkAt: null }, neverPrintedD]);

    expect(
      screen.getByRole("region", { name: "Drucker, die nicht drucken" }),
    ).toHaveTextContent("2 Drucker drucken nicht: Küche, Schank");
  });

  it("zeigt keinen Sammelhinweis, solange kein eingeschalteter Drucker scheitert", () => {
    renderView([recoveredB, offWithErrorC, neverPrintedD]);

    expect(
      screen.queryByRole("region", { name: "Drucker, die nicht drucken" }),
    ).not.toBeInTheDocument();
  });

  it("zeigt einen nie benutzten Drucker als „Noch nicht getestet“", () => {
    renderView([neverPrintedD]);

    const d = card("Terrasse");
    expect(d.getByText("Noch nicht getestet")).toBeInTheDocument();
    expect(d.queryByText("Bereit")).not.toBeInTheDocument();
  });
});
