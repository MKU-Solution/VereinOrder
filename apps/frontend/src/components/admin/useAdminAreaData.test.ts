import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "../../lib/api";
import type { AdminAreaId } from "./adminAreaRegistry";
import { useAdminAreaData } from "./useAdminAreaData";

vi.mock("../../lib/api", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

const mockedApi = api as unknown as { get: ReturnType<typeof vi.fn> };

interface Deferred {
  promise: Promise<{ data: unknown }>;
  resolve: (value: { data: unknown }) => void;
  reject: (reason?: unknown) => void;
}

const createDeferred = (): Deferred => {
  let resolve!: (value: { data: unknown }) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<{ data: unknown }>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

/**
 * Endpunkte, deren Antwort der Test von Hand auflöst. Damit entsteht der
 * Wettlauf aus Issue #212 deterministisch: Die Reihenfolge des Eintreffens
 * bestimmt der Test, nicht das Zeitverhalten der Umgebung. Es kommen deshalb
 * weder Wartezeiten noch echte Zeitgeber vor.
 */
const deferredUrls = new Set<string>();
const openRequests = new Map<string, Deferred[]>();
const immediateData = new Map<string, unknown>();

/** Greift die n-te noch offene Anfrage eines Endpunkts ab (0-basiert). */
const openRequest = (url: string, index: number): Deferred => {
  const request = openRequests.get(url)?.[index];
  if (!request) throw new Error(`Keine offene Anfrage ${index} für ${url}`);
  return request;
};

/**
 * Arbeitet die Mikrotask-Warteschlange innerhalb von `act` ab. Alle Antworten
 * sind aufgelöste Zusagen, deshalb genügen Mikrotasks – kein `setTimeout`.
 */
const settle = async (): Promise<void> => {
  await act(async () => {
    for (let step = 0; step < 5; step += 1) await Promise.resolve();
  });
};

const renderAreaData = (area: AdminAreaId) =>
  renderHook(({ activeArea }) => useAdminAreaData(activeArea), {
    initialProps: { activeArea: area },
  });

const PRINTER = { id: "printer-1", name: "Hauptkasse Drucker" };
const EVENT = { id: "event-1", name: "Sommerfest 2026" };

beforeEach(() => {
  deferredUrls.clear();
  openRequests.clear();
  immediateData.clear();
  mockedApi.get.mockImplementation((url: string) => {
    if (deferredUrls.has(url)) {
      const deferred = createDeferred();
      const queue = openRequests.get(url) ?? [];
      queue.push(deferred);
      openRequests.set(url, queue);
      return deferred.promise;
    }
    return Promise.resolve({ data: immediateData.get(url) ?? [] });
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useAdminAreaData bei gleichzeitigen Bereichsabfragen", () => {
  it("verwirft die verspätete Antwort eines nicht mehr aktiven Bereichs", async () => {
    // "/events" bleibt offen: einmal für den Startabruf, einmal für den beim
    // Mounten geladenen Bereich "events" (Zielbereich der /admin-Weiterleitung).
    deferredUrls.add("/events");
    immediateData.set("/print-jobs/printers", [PRINTER]);

    const { result, rerender } = renderAreaData("events");
    expect(openRequests.get("/events")).toHaveLength(2);

    rerender({ activeArea: "printers" });
    await settle();

    expect(result.current.data).toEqual([PRINTER]);
    expect(result.current.printersList).toEqual([PRINTER]);
    expect(result.current.isLoading).toBe(false);

    // Erst jetzt antwortet der längst verlassene Bereich.
    openRequest("/events", 1).resolve({ data: [EVENT] });
    openRequest("/events", 0).resolve({ data: [EVENT] });
    await settle();

    expect(result.current.data).toEqual([PRINTER]);
    expect(result.current.printersList).toEqual([PRINTER]);
    expect(result.current.loadError).toBeNull();
  });

  it("lässt die Ladeanzeige des neuen Bereichs von der alten Antwort unberührt", async () => {
    deferredUrls.add("/events");
    deferredUrls.add("/print-jobs/printers");

    const { result, rerender } = renderAreaData("events");

    rerender({ activeArea: "printers" });
    await settle();
    expect(result.current.isLoading).toBe(true);

    openRequest("/events", 1).resolve({ data: [EVENT] });
    await settle();

    expect(result.current.isLoading).toBe(true);
    expect(result.current.data).toEqual([]);

    // Anfrage 0 gehört zum Startabruf, Anfrage 1 zum Druckerbereich.
    openRequest("/print-jobs/printers", 1).resolve({ data: [PRINTER] });
    await settle();

    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toEqual([PRINTER]);
  });

  it("verwirft die verspätete Antwort auch beim Wechsel in einen Bereich ohne eigene Abfrage", async () => {
    // Der Wartungsmodus bricht in fetchData vor jeder Anfrage ab. Die
    // Anforderungskennung muss trotzdem weiterzählen, sonst dürfte die noch
    // laufende Abfrage des vorherigen Bereichs weiterhin schreiben.
    deferredUrls.add("/events");

    const { result, rerender } = renderAreaData("events");

    rerender({ activeArea: "maintenance" });
    await settle();

    openRequest("/events", 1).resolve({ data: [EVENT] });
    await settle();

    expect(result.current.data).toEqual([]);
    expect(result.current.isLoading).toBe(false);
  });

  it("verwirft die Antwort der stillen Diagnoseabfrage nach einem Bereichswechsel", async () => {
    vi.useFakeTimers();
    deferredUrls.add("/diagnostics/status");

    const { result, rerender } = renderAreaData("diagnostics");

    openRequest("/diagnostics/status", 0).resolve({ data: { status: "ok" } });
    await settle();
    expect(result.current.diagnosticsData).toEqual({ status: "ok" });

    // Der Zeitgeber startet die Hintergrundabfrage; sie bleibt offen.
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(openRequests.get("/diagnostics/status")).toHaveLength(2);

    rerender({ activeArea: "printers" });
    await settle();

    openRequest("/diagnostics/status", 1).resolve({
      data: { status: "veraltet" },
    });
    await settle();

    expect(result.current.diagnosticsData).toEqual({ status: "ok" });
    expect(result.current.diagnosticsPollFailed).toBe(false);
  });
});
