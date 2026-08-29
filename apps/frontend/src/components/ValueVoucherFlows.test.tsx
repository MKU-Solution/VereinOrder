import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { ValueVoucherIssueDialog } from "./ValueVoucherIssueDialog";
import { ValueVoucherPaymentFlow } from "./ValueVoucherPaymentFlow";

const { get, post } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("../lib/api", () => ({ api: { get, post } }));

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: true,
  });
  get.mockResolvedValue({
    data: [{ id: "printer-1", name: "Kasse", isActive: true }],
  });
});

describe("Wertgutschein-Flows", () => {
  it("gibt einen Wertgutschein mit Preset, Drucker und Idempotenz aus", async () => {
    post.mockResolvedValue({
      data: { voucherCode: "LIVE-ABCD", currentBalance: 2000 },
    });
    render(
      <ValueVoucherIssueDialog
        isOpen={true}
        eventId="event-1"
        cashierSessionId="session-1"
        dataMode="LIVE"
        onClose={vi.fn()}
      />,
    );
    await screen.findByRole("option", { name: "Kasse" });
    fireEvent.click(screen.getByRole("button", { name: /20,00/ }));
    fireEvent.change(screen.getByLabelText(/^Bar gegeben/), {
      target: { value: "20" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /Wertgutschein buchen/ }),
    );
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        "/value-vouchers",
        expect.objectContaining({
          eventId: "event-1",
          cashierSessionId: "session-1",
          printerId: "printer-1",
          amount: 2000,
          fundingMethod: "CASH",
          idempotencyKey: expect.any(String),
        }),
      ),
    );
    expect(await screen.findByText(/LIVE-ABCD/)).toBeInTheDocument();
  });

  it("prüft Scanner-/Enter-Eingabe und bestätigt eine Teilentwertung mit Restzahlung", async () => {
    get.mockImplementation((url: string) =>
      url === "/print-jobs/active-printers"
        ? Promise.resolve({
            data: [{ id: "printer-1", name: "Kasse", isActive: true }],
          })
        : Promise.resolve({
            data: {
              voucherCode: "LIVE-…1234",
              balance: 500,
              outstanding: 1200,
              redeemable: 500,
            },
          }),
    );
    post.mockResolvedValue({
      data: {
        voucherCode: "LIVE-…1234",
        currentBalance: 0,
        printStatus: "wartend",
      },
    });
    const onRedeemed = vi.fn();
    render(
      <ValueVoucherPaymentFlow
        context={{
          eventId: "event-1",
          cashierSessionId: "session-1",
          orderId: "order-1",
        }}
        onRedeemed={onRedeemed}
      />,
    );
    await screen.findByPlaceholderText("Code scannen oder eingeben");
    fireEvent.change(
      screen.getByPlaceholderText("Code scannen oder eingeben"),
      { target: { value: "LIVE-SCAN" } },
    );
    fireEvent.submit(
      screen.getByRole("button", { name: /Prüfen/ }).closest("form")!,
    );
    expect(await screen.findByText(/Restzahlung:/)).toHaveTextContent("7,00");
    fireEvent.click(screen.getByRole("button", { name: "Karte" }));
    fireEvent.click(
      screen.getByRole("button", { name: /Gutschein und Restzahlung/ }),
    );
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        "/value-vouchers/redeem",
        expect.objectContaining({
          eventId: "event-1",
          orderId: "order-1",
          code: "LIVE-SCAN",
          printerId: "printer-1",
          remainderPayment: { method: "CARD", tenderedAmount: undefined },
        }),
      ),
    );
    expect(onRedeemed).toHaveBeenCalled();
  });

  it("sperrt Ausgabe offline und zeigt eine sichere Fehlererklärung", async () => {
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      value: false,
    });
    render(
      <ValueVoucherIssueDialog
        isOpen={true}
        eventId="event-1"
        cashierSessionId="session-1"
        dataMode="LIVE"
        onClose={vi.fn()}
      />,
    );
    await screen.findByRole("option", { name: "Kasse" });
    fireEvent.change(screen.getByLabelText(/^Bar gegeben/), {
      target: { value: "10" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /Wertgutschein buchen/ }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /nicht offline vorgemerkt/,
    );
    expect(post).not.toHaveBeenCalled();
  });
});
