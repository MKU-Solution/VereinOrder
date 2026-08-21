/* eslint-disable @typescript-eslint/no-var-requires */
import axios from "axios";

import { DeliveryContext, PrinterAdapter } from "./adapters";

// PRINT_WORKER_TOKEN wird beim Laden des Moduls als Konstante ausgelesen –
// deshalb erst hier setzen und das Modul danach per require() laden, statt
// über einen statischen Import (der würde vor dieser Zeile ausgeführt).
process.env.PRINT_WORKER_TOKEN = "x".repeat(40);
process.env.BACKEND_URL = "http://backend.invalid";
const { processJob } = require("./index") as typeof import("./index");

const job = {
  id: "job-1",
  jobType: "STATION_TICKET",
  createdAt: new Date(2026, 7, 21, 18, 5, 9).toISOString(),
  content: { stationName: "Küche", orderNumber: 7, items: [] },
  printer: {
    id: "printer-1",
    name: "Küche",
    type: "CONSOLE",
  },
  leaseId: "lease-1",
  leaseExpiresAt: new Date(Date.now() + 60000).toISOString(),
};

/** Löst 409 Conflict aus, wie ihn axios für eine verlorene Lease liefert. */
function conflictError() {
  return Object.assign(new Error("Conflict"), {
    isAxiosError: true,
    response: { status: 409, data: {} },
  });
}

function fakeAdapter(
  deliver: PrinterAdapter["deliver"],
): Map<string, PrinterAdapter> {
  const registry = new Map<string, PrinterAdapter>();
  registry.set("simulator", { kind: "simulator", deliver });
  return registry;
}

describe("Lease-Protokoll in processJob", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("druckt nicht, wenn die Phasenbestätigung mit 409 abgelehnt wird", async () => {
    const patchSpy = jest
      .spyOn(axios, "patch")
      .mockRejectedValue(conflictError());
    const deliver = jest.fn();
    const registry = fakeAdapter(deliver);

    await processJob(job as any, registry);

    expect(deliver).not.toHaveBeenCalled();
    // Nur der Phasenwechsel wurde versucht, keine Ergebnismeldung.
    expect(patchSpy).toHaveBeenCalledTimes(1);
    expect(patchSpy).toHaveBeenCalledWith(
      expect.stringContaining("/phase"),
      expect.objectContaining({ leaseId: "lease-1", phase: "DELIVERING" }),
      expect.anything(),
    );
  });

  it("druckt nicht, wenn das Backend beim Phasenwechsel nicht erreichbar ist", async () => {
    const patchSpy = jest
      .spyOn(axios, "patch")
      .mockRejectedValue(new Error("ECONNREFUSED"));
    const deliver = jest.fn();
    const registry = fakeAdapter(deliver);

    await processJob(job as any, registry);

    expect(deliver).not.toHaveBeenCalled();
    expect(patchSpy).toHaveBeenCalledTimes(1);
  });

  it("bestätigt die Phase, druckt und meldet PRINTED bei Erfolg", async () => {
    const patchSpy = jest.spyOn(axios, "patch").mockResolvedValue({ data: {} });
    const deliver = jest
      .fn()
      .mockResolvedValue({ transport: "simulator", bytes: 42 });
    const registry = fakeAdapter(deliver);

    await processJob(job as any, registry);

    expect(deliver).toHaveBeenCalledTimes(1);
    // deliver() erhält einen Kontext mit onSpooled/onEvent.
    const context = deliver.mock.calls[0][2] as DeliveryContext;
    expect(context).toBeDefined();

    expect(patchSpy).toHaveBeenCalledTimes(2);
    expect(patchSpy).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("/phase"),
      expect.objectContaining({ phase: "DELIVERING" }),
      expect.anything(),
    );
    expect(patchSpy).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("/status"),
      expect.objectContaining({ leaseId: "lease-1", outcome: "PRINTED" }),
      expect.anything(),
    );
  });

  it("meldet die Fehlerklasse statt PRINTED/FAILED, wenn der Transport scheitert", async () => {
    jest.spyOn(axios, "patch").mockImplementation((url: string) => {
      if (String(url).includes("/phase")) return Promise.resolve({ data: {} });
      return Promise.resolve({ data: {} });
    });
    const { PrintTransportError } = require("./adapters/types");
    const deliver = jest.fn().mockRejectedValue(
      new PrintTransportError("CONNECTION_REFUSED", "Abgelehnt", {
        bytesWritten: 0,
      }),
    );
    const registry = fakeAdapter(deliver);
    const patchSpy = axios.patch as jest.Mock;

    await processJob(job as any, registry);

    expect(patchSpy).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("/status"),
      expect.objectContaining({
        outcome: "NOT_PRINTED",
        errorCode: "CONNECTION_REFUSED",
      }),
      expect.anything(),
    );
  });

  it("bricht still ab, wenn die Lease erst während der Zustellung verloren geht", async () => {
    jest.spyOn(axios, "patch").mockResolvedValue({ data: {} });
    const { LeaseLostError } = require("./lease");
    const deliver = jest.fn().mockRejectedValue(new LeaseLostError());
    const registry = fakeAdapter(deliver);
    const patchSpy = axios.patch as jest.Mock;

    await processJob(job as any, registry);

    // Nur der Phasenwechsel wurde bestätigt; keine Ergebnismeldung, weil die
    // Lease nicht mehr gehalten wird.
    expect(patchSpy).toHaveBeenCalledTimes(1);
  });

  it("wiederholt die Ergebnismeldung mit Rückstaffelung, solange die Lease gehalten wird", async () => {
    jest.useFakeTimers();
    try {
      let phaseConfirmed = false;
      let statusAttempts = 0;
      jest.spyOn(axios, "patch").mockImplementation((url: string) => {
        if (String(url).includes("/phase")) {
          phaseConfirmed = true;
          return Promise.resolve({ data: {} });
        }
        statusAttempts += 1;
        if (statusAttempts < 3) {
          return Promise.reject(new Error("timeout"));
        }
        return Promise.resolve({ data: {} });
      });
      const deliver = jest
        .fn()
        .mockResolvedValue({ transport: "simulator", bytes: 1 });
      const registry = fakeAdapter(deliver);

      const done = processJob(job as any, registry);
      // Zwei Fehlschläge mit Rückstaffelung (1 s, 2 s) durchlaufen lassen.
      await jest.advanceTimersByTimeAsync(1000);
      await jest.advanceTimersByTimeAsync(2000);
      await done;

      expect(phaseConfirmed).toBe(true);
      expect(statusAttempts).toBe(3);
    } finally {
      jest.useRealTimers();
    }
  });
});
