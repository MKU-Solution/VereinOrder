import { fireEvent, render, screen } from "@testing-library/react";
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
