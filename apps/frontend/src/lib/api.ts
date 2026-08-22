import axios from "axios";
import { useAuthStore } from "../store/useAuthStore";
import { OFFLINE_SYNC_HEADER } from "./offlineSync";

// Ohne Timeout hängt eine Anfrage, deren Antwort nie ankommt, für immer —
// dann gibt es auch nie einen Zustandswechsel (Issue #65,
// docs/development/offline-warteschlange.md Abschnitt 2). 15 s deckt sich
// mit OFFLINE_SYNC_REQUEST_TIMEOUT_MS, das die Warteschlange je Anfrage
// zusätzlich selbst setzt.
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;

export const api = axios.create({
  baseURL: "/api",
  timeout: DEFAULT_REQUEST_TIMEOUT_MS,
  headers: {
    "Content-Type": "application/json",
  },
});

api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

/**
 * Erkennt, ob eine fehlgeschlagene Anfrage vom Hintergrundversand der
 * Offline-Warteschlange stammt (markiert mit `OFFLINE_SYNC_HEADER`, siehe
 * `offlineQueueContext.ts`). `error.config.headers` ist bei axios 1.x eine
 * `AxiosHeaders`-Instanz mit eigenem `.get()`; ein einfaches Objekt (z. B. in
 * Tests) wird zusätzlich unterstützt.
 */
function isOfflineQueueSyncRequest(headers: unknown): boolean {
  if (!headers || typeof headers !== "object") return false;
  const withGetter = headers as { get?: (name: string) => unknown };
  if (typeof withGetter.get === "function") {
    return withGetter.get(OFFLINE_SYNC_HEADER) != null;
  }
  return (headers as Record<string, unknown>)[OFFLINE_SYNC_HEADER] != null;
}

api.interceptors.response.use(
  (response) => response,
  (error) => {
    // Eine 401-Antwort auf eine Anfrage der Offline-Sendeschleife meldet
    // nicht die gerade arbeitende Person ab (Antwort auf B4 im Entwurf):
    // ein einzelner alter Eintrag mit abgelaufener Anmeldung darf niemanden
    // mitten im Betrieb aus der Anwendung werfen. Der Aufrufer (die
    // Warteschlange) bekommt den Fehler unverändert und stuft ihn als
    // Konflikt `AUTH_EXPIRED` ein.
    if (
      error.response?.status === 401 &&
      !isOfflineQueueSyncRequest(error.config?.headers)
    ) {
      useAuthStore.getState().logout();
    }
    return Promise.reject(error);
  },
);
