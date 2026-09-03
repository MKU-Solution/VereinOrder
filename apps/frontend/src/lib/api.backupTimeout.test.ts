import type { AxiosAdapter, AxiosResponse } from "axios";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BACKUP_REQUEST_TIMEOUT_MS } from "../components/admin/AdminDashboardController";
import { api, DEFAULT_REQUEST_TIMEOUT_MS } from "./api";

/**
 * #186: Belegt auf Achsen-Ebene, dass ein Sicherungsaufruf mit dem eigenen,
 * längeren Zeitlimit (`BACKUP_REQUEST_TIMEOUT_MS`) eine Antwort, die erst
 * nach den 15 s der Axios-Instanz eintrifft, noch entgegennimmt - und dass
 * ein gewöhnlicher Aufruf ohne diese Überschreibung weiterhin nach 15 s
 * abbricht (Regression zu Issue #65, siehe Kommentar in ./api.ts).
 *
 * Der Fake-Adapter bildet exakt das Zeitverhalten nach, das axios' echte
 * Adapter (XHR im Browser, http in Node) ebenfalls zeigen: Er löst nach
 * `RESPONSE_DELAY_MS` auf oder verwirft vorher mit demselben Fehlercode
 * (`ECONNABORTED`), je nachdem, was zuerst eintritt - gesteuert über
 * gestellte Zeitgeber, ohne real zu warten.
 */
describe("api – eigenes Zeitlimit für Sicherungsaufrufe (#186)", () => {
  // Deutlich > 15s (Standard) und deutlich < BACKUP_REQUEST_TIMEOUT_MS.
  const RESPONSE_DELAY_MS = BACKUP_REQUEST_TIMEOUT_MS - 5 * 60_000;

  let originalAdapter: typeof api.defaults.adapter;

  const fakeAdapter: AxiosAdapter = (config) =>
    new Promise<AxiosResponse>((resolve, reject) => {
      const responseTimer = setTimeout(() => {
        resolve({
          data: {},
          status: 200,
          statusText: "OK",
          headers: {},
          config,
        } as AxiosResponse);
      }, RESPONSE_DELAY_MS);

      if (config.timeout) {
        setTimeout(() => {
          clearTimeout(responseTimer);
          const error = new Error(
            `timeout of ${config.timeout}ms exceeded`,
          ) as Error & { code?: string };
          error.code = "ECONNABORTED";
          reject(error);
        }, config.timeout);
      }
    });

  beforeEach(() => {
    vi.useFakeTimers();
    originalAdapter = api.defaults.adapter;
    api.defaults.adapter = fakeAdapter;
  });

  afterEach(() => {
    api.defaults.adapter = originalAdapter;
    vi.useRealTimers();
  });

  it("bricht einen gewöhnlichen Aufruf weiterhin nach den 15s der Axios-Instanz ab", async () => {
    const pending = api.get("/events");
    const assertion = expect(pending).rejects.toMatchObject({
      code: "ECONNABORTED",
    });

    await vi.advanceTimersByTimeAsync(DEFAULT_REQUEST_TIMEOUT_MS);

    await assertion;
  });

  it("bricht einen Sicherungsaufruf mit BACKUP_REQUEST_TIMEOUT_MS nicht nach 15 Sekunden ab", async () => {
    const pending = api.post("/backup/create", undefined, {
      timeout: BACKUP_REQUEST_TIMEOUT_MS,
    });

    // 15s vergehen - der gewöhnliche Standard wäre hier bereits abgebrochen.
    await vi.advanceTimersByTimeAsync(DEFAULT_REQUEST_TIMEOUT_MS);

    let settled = false;
    pending.then(
      () => (settled = true),
      () => (settled = true),
    );
    await Promise.resolve();
    expect(settled).toBe(false);

    // Bis zur simulierten (verspäteten) Antwort weiterlaufen lassen.
    await vi.advanceTimersByTimeAsync(
      RESPONSE_DELAY_MS - DEFAULT_REQUEST_TIMEOUT_MS,
    );

    await expect(pending).resolves.toMatchObject({ status: 200 });
  });
});
