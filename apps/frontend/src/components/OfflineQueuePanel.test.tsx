import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OfflineQueuePanel } from "./OfflineQueuePanel";
import {
  getOfflineQueueDB,
  putOfflineOrderRecord,
  resetOfflineQueueDBForTests,
} from "../lib/offlineQueueDb";
import {
  listOpenOfflineOrders,
  type OfflineOrderRecord,
  type OfflineSyncHttpClient,
} from "../lib/offlineSync";

// Deckt Issue #65 ab: Zustandsdarstellung eines Eintrags, blockiertes
// Verwerfen ohne Serverkontakt, und dass eine Fehleranzeige weder Token
// noch Stacktrace enthält. Fixtures werden — wie bereits in
// lib/offlineSync.test.ts — direkt über offlineQueueDb.putOfflineOrderRecord
// angelegt, um jeden Zustand gezielt herzustellen, ohne die Bibliothek
// selbst zu verändern.

const CURRENT_USER = { userId: "user-1", username: "kellner1", role: "WAITER" };

function freshRecord(
  overrides: Partial<OfflineOrderRecord> = {},
): OfflineOrderRecord {
  return {
    idempotencyKey: "order-1",
    schemaVersion: 2,
    state: "LOCAL_PENDING",
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    userId: CURRENT_USER.userId,
    username: CURRENT_USER.username,
    userRole: CURRENT_USER.role,
    eventId: "event-1",
    eventName: "Sommerfest",
    dataMode: "LIVE",
    cashierSessionId: null,
    items: [
      {
        productId: "product-1",
        quantity: 2,
        optionIds: [],
        productName: "Bier",
        unitPriceAtCapture: 350,
      },
    ],
    payments: [],
    tableName: "Tisch 5",
    areaId: null,
    areaName: null,
    totalAtCapture: 700,
    attempt: 0,
    lastAttemptAt: null,
    nextAttemptAt: null,
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

function makeHttpClient(): OfflineSyncHttpClient & {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
} {
  return { get: vi.fn(), post: vi.fn() };
}

async function seed(record: OfflineOrderRecord) {
  const db = await getOfflineQueueDB();
  await putOfflineOrderRecord(db, record);
}

beforeEach(() => {
  (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB =
    new IDBFactory();
  resetOfflineQueueDBForTests();
});

describe("OfflineQueuePanel – Zustandsdarstellung eines Eintrags", () => {
  it("zeigt einen Konflikt klar unterscheidbar von einer bestätigten Bestellung, mit deutscher Begründung", async () => {
    await seed(
      freshRecord({
        idempotencyKey: "order-conflict",
        state: "CONFLICT",
        conflictKind: "PRODUCT_UNAVAILABLE",
        lastError: {
          at: 1_700_000_001_000,
          kind: "HTTP",
          httpStatus: 400,
          messageForOperator: "Der Server hat die Anfrage abgelehnt.",
        },
      }),
    );
    await seed(
      freshRecord({
        idempotencyKey: "order-confirmed",
        state: "CONFIRMED",
        confirmedAt: 1_700_000_002_000,
        serverOrderNumber: "A-42",
      }),
    );

    render(
      <OfflineQueuePanel
        isOpen={true}
        onClose={vi.fn()}
        httpClient={makeHttpClient()}
        currentUser={CURRENT_USER}
        eventContexts={[]}
      />,
    );

    expect(await screen.findByText("Konflikt")).toBeInTheDocument();

    // Die bestätigte Bestellung erscheint separat unter "Erledigt", nicht in
    // der offenen Liste, und ist nicht mit dem Konflikt verwechselbar.
    fireEvent.click(screen.getByRole("button", { name: /Erledigt/ }));
    expect(await screen.findByText(/Vom Server bestätigt/)).toBeInTheDocument();

    // "Konflikt ansehen" zeigt die verständliche deutsche Ursache.
    fireEvent.click(screen.getByRole("button", { name: "Konflikt ansehen" }));
    expect(screen.getByText(/nicht mehr verfügbar/)).toBeInTheDocument();
  });

  it("zeigt eine lokal vorgemerkte Bestellung nie als bestätigt", async () => {
    await seed(freshRecord({ idempotencyKey: "order-pending" }));

    render(
      <OfflineQueuePanel
        isOpen={true}
        onClose={vi.fn()}
        httpClient={makeHttpClient()}
        currentUser={CURRENT_USER}
        eventContexts={[]}
      />,
    );

    expect(await screen.findByText("Lokal vorgemerkt")).toBeInTheDocument();
    expect(screen.queryByText("Vom Server bestätigt")).not.toBeInTheDocument();
  });
});

describe("OfflineQueuePanel – Verwerfen nur mit Serverkontakt", () => {
  it("blockiert das Verwerfen, wenn der Server nicht erreichbar ist, und der Eintrag bleibt offen", async () => {
    await seed(freshRecord({ idempotencyKey: "order-discard" }));

    const httpClient = makeHttpClient();
    httpClient.get.mockRejectedValue(new Error("Network Error"));

    render(
      <OfflineQueuePanel
        isOpen={true}
        onClose={vi.fn()}
        httpClient={httpClient}
        currentUser={CURRENT_USER}
        eventContexts={[]}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: /Verwerfen/ }));
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /Diese Vormerkung geht nicht an den Server/,
      }),
    );

    const confirmButton = screen.getByRole("button", {
      name: "Endgültig verwerfen",
    });
    expect(confirmButton).not.toBeDisabled();
    fireEvent.click(confirmButton);

    expect(
      await screen.findByText(
        "Verwerfen ist nur mit Serververbindung möglich.",
      ),
    ).toBeInTheDocument();

    const stillOpen = await listOpenOfflineOrders();
    expect(stillOpen.some((r) => r.idempotencyKey === "order-discard")).toBe(
      true,
    );
    expect(httpClient.post).not.toHaveBeenCalled();
  });

  it("lässt den Bestätigen-Knopf deaktiviert, solange das Kästchen nicht bestätigt ist", async () => {
    await seed(freshRecord({ idempotencyKey: "order-checkbox" }));

    render(
      <OfflineQueuePanel
        isOpen={true}
        onClose={vi.fn()}
        httpClient={makeHttpClient()}
        currentUser={CURRENT_USER}
        eventContexts={[]}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: /Verwerfen/ }));
    expect(
      screen.getByRole("button", { name: "Endgültig verwerfen" }),
    ).toBeDisabled();
  });
});

describe("OfflineQueuePanel – Fehleranzeige ohne Token oder Stacktrace", () => {
  it("zeigt ausschließlich den bereinigten Servertext, nie Rohobjekte oder technische Kopf-/Stackdaten", async () => {
    await seed(
      freshRecord({
        idempotencyKey: "order-error",
        state: "FAILED",
        lastError: {
          at: 1_700_000_003_000,
          kind: "HTTP",
          httpStatus: 503,
          messageForOperator: "Der Server hat die Anfrage abgelehnt.",
        },
        // Zusätzliche, in `OfflineOrderRecord` nicht vorgesehene Felder, wie
        // sie bei einem fehlerhaften Aufrufer entstehen könnten — die
        // Komponente liest nur benannte Felder und darf so etwas nie
        // ungefiltert ausgeben.
        ...({
          stack: "Error: boom\n    at Object.<anonymous> (file.ts:1:1)",
        } as unknown as Partial<OfflineOrderRecord>),
      }),
    );

    render(
      <OfflineQueuePanel
        isOpen={true}
        onClose={vi.fn()}
        httpClient={makeHttpClient()}
        currentUser={CURRENT_USER}
        eventContexts={[]}
      />,
    );

    await waitFor(() =>
      expect(screen.getByText("Gescheitert")).toBeInTheDocument(),
    );

    expect(
      screen.getByText("Der Server hat die Anfrage abgelehnt."),
    ).toBeInTheDocument();

    const panelText = document.body.textContent ?? "";
    expect(panelText).not.toMatch(/Bearer\s+[A-Za-z0-9._-]+/);
    expect(panelText).not.toMatch(
      /[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
    );
    expect(panelText).not.toMatch(/\bat Object\./);
    expect(panelText).not.toContain("Error: boom");
  });
});
