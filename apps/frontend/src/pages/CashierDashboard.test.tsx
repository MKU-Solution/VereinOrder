import "fake-indexeddb/auto";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CashierDashboard } from "./CashierDashboard";
import { api } from "../lib/api";
import { useAuthStore } from "../store/useAuthStore";
import {
  getOfflineQueueDB,
  putOfflineOrderRecord,
  resetOfflineQueueDBForTests,
} from "../lib/offlineQueueDb";
import type { OfflineOrderRecord } from "../lib/offlineQueueTypes";

vi.mock("../lib/api");

const mockSession = {
  id: "session-1",
  startingBalance: 10000,
  status: "ACTIVE",
  dataMode: "LIVE",
};

const mockSummary = {
  id: "session-1",
  status: "ACTIVE",
  startingBalance: 10000,
  cashSales: 5000,
  cardSales: 2000,
  otherSales: 0,
  expectedCash: 15000,
  startTime: "2026-08-26T08:00:00Z",
};

const mockEvents = [
  {
    id: "event-1",
    name: "Sommerfest",
    status: "ACTIVE",
    testMode: false,
  },
];

function freshRecord(
  overrides: Partial<OfflineOrderRecord> = {},
): OfflineOrderRecord {
  return {
    idempotencyKey: "key-1",
    schemaVersion: 2,
    state: "LOCAL_PENDING",
    createdAt: 1_000,
    updatedAt: 1_000,
    userId: "user-1",
    username: "kellner1",
    userRole: "CASHIER",
    eventId: "event-1",
    eventName: "Sommerfest",
    dataMode: "LIVE",
    cashierSessionId: "session-1",
    items: [],
    payments: [{ amount: 2500, method: "CASH" }],
    tableName: null,
    areaId: null,
    areaName: null,
    totalAtCapture: 2500,
    attempt: 0,
    lastAttemptAt: null,
    nextAttemptAt: 1_000,
    sendingSince: null,
    interruptedAt: null,
    lastError: null,
    conflictKind: null,
    serverOrderId: null,
    serverOrderNumber: null,
    confirmedAt: null,
    legacy: false,
    adoptedByUserId: null,
    adoptedAt: null,
    ...overrides,
  };
}

describe("CashierDashboard – Kassenabschluss & Vormerkungswarnung (Issue #97)", () => {
  beforeEach(() => {
    resetOfflineQueueDBForTests();
    vi.clearAllMocks();
    useAuthStore.setState({
      user: { userId: "user-1", username: "kassier1", role: "CASHIER" },
      token: "valid-token",
    });

    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url === "/sessions/context") {
        return { data: mockEvents } as any;
      }
      if (url.startsWith("/sessions/active")) {
        return { data: mockSession } as any;
      }
      if (url.startsWith("/sessions/session-1/summary")) {
        return { data: mockSummary } as any;
      }
      return { data: null } as any;
    });
  });

  it("schließt eine Sitzung ohne offene Vormerkungen direkt ab", async () => {
    vi.mocked(api.patch).mockResolvedValueOnce({
      data: { status: "CLOSED" },
    } as any);

    render(<CashierDashboard />);

    await waitFor(() => {
      expect(screen.getByText("Meine Kassa")).toBeInTheDocument();
    });

    const closeBtn = screen.getByRole("button", { name: /Kassenabschluss/i });
    fireEvent.click(closeBtn);

    await waitFor(() => {
      expect(screen.getByText("Bitte zähle dein Bargeld.")).toBeInTheDocument();
    });

    expect(
      screen.queryByTestId("cashier-session-offline-warning"),
    ).not.toBeInTheDocument();

    const input = screen.getByPlaceholderText("z.B. 125.50");
    fireEvent.change(input, { target: { value: "150.00" } });

    const submitBtn = screen.getByRole("button", { name: "Abschließen" });
    expect(submitBtn).not.toBeDisabled();

    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(api.patch).toHaveBeenCalledWith("/sessions/session-1/close", {
        closingBalance: 15000,
      });
    });
  });

  it("warnt vor offenen Vormerkungen auf dem Gerät und verlangt Bestätigung", async () => {
    const db = await getOfflineQueueDB();
    await putOfflineOrderRecord(
      db,
      freshRecord({
        idempotencyKey: "offline-1",
        cashierSessionId: "session-1",
        totalAtCapture: 2500,
      }),
    );
    await putOfflineOrderRecord(
      db,
      freshRecord({
        idempotencyKey: "offline-2",
        cashierSessionId: "session-1",
        totalAtCapture: 1500,
        state: "CONFLICT",
      }),
    );

    vi.mocked(api.patch).mockResolvedValueOnce({
      data: { status: "CLOSED" },
    } as any);

    render(<CashierDashboard />);

    await waitFor(() => {
      expect(screen.getByText("Meine Kassa")).toBeInTheDocument();
    });

    const closeBtn = screen.getByRole("button", { name: /Kassenabschluss/i });
    fireEvent.click(closeBtn);

    await waitFor(() => {
      expect(
        screen.getByTestId("cashier-session-offline-warning"),
      ).toBeInTheDocument();
    });

    expect(
      screen.getByText(
        /Achtung: 2 offene Vormerkungen \(€\s*40,00\) auf diesem Gerät!/i,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /Es werden ausschließlich die offenen Vormerkungen auf diesem Gerät geprüft/i,
      ),
    ).toBeInTheDocument();

    const input = screen.getByPlaceholderText("z.B. 125.50");
    fireEvent.change(input, { target: { value: "150.00" } });

    const submitBtn = screen.getByRole("button", { name: "Abschließen" });
    expect(submitBtn).toBeDisabled();

    const checkbox = screen.getByRole("checkbox");
    expect(checkbox).not.toBeChecked();

    fireEvent.click(checkbox);
    expect(checkbox).toBeChecked();
    expect(submitBtn).not.toBeDisabled();

    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(api.patch).toHaveBeenCalledWith("/sessions/session-1/close", {
        closingBalance: 15000,
        offlineQueueWarning: {
          hasOpenOrders: true,
          openCount: 2,
          openTotalCents: 4000,
          acknowledged: true,
        },
      });
    });
  });
});
