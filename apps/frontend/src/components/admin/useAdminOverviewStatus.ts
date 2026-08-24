import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "../../lib/api";
import type { MaintenanceStatus } from "../../lib/maintenance";
import type { EventItem } from "./adminDomainTypes";

export interface AdminOverviewDiagnostics {
  overallHealth: "GREEN" | "YELLOW" | "RED";
  serverTime: string;
  backend: { appVersion: string; uptimeSeconds: number };
  database: { status: string; latencyMs: number };
  printers: {
    total: number;
    active: number;
    queue: {
      pending: number;
      failed: number;
      printed: number;
      unclear: number;
    };
  };
  backup: {
    totalBackups: number;
    latestBackup: {
      filename: string;
      createdAt: string;
      verification?:
        | "STRUCTURE_VERIFIED"
        | "RESTORE_VERIFIED"
        | "LEGACY"
        | "CORRUPT";
    } | null;
    toolStatus: { enabled: boolean; message: string };
    storage: { creationAllowed: boolean };
  };
  recommendations: Array<{
    level: "SUCCESS" | "INFO" | "WARNING" | "ERROR";
    title: string;
    message: string;
    actionTab?: string;
  }>;
}

export interface OverviewStatusSlice<T> {
  state: "loading" | "ready" | "empty" | "error";
  data: T | null;
  error: string | null;
  checkedAt: Date | null;
}

export interface AdminOverviewStatus {
  events: OverviewStatusSlice<EventItem[]>;
  diagnostics: OverviewStatusSlice<AdminOverviewDiagnostics>;
  maintenance: OverviewStatusSlice<MaintenanceStatus>;
  isRefreshing: boolean;
}

const loadingSlice = <T>(): OverviewStatusSlice<T> => ({
  state: "loading",
  data: null,
  error: null,
  checkedAt: null,
});

const errorMessage = (area: string, error: unknown) => {
  const detail = (error as { response?: { data?: { message?: unknown } } })
    ?.response?.data?.message;
  return typeof detail === "string" && detail.trim()
    ? `${area}: ${detail}`
    : `${area} konnte nicht geladen werden. Öffne den zugehörigen Bereich und prüfe die lokale Verbindung.`;
};

export const useAdminOverviewStatus = (
  refreshToken = 0,
): AdminOverviewStatus => {
  const mounted = useRef(true);
  const [events, setEvents] =
    useState<OverviewStatusSlice<EventItem[]>>(loadingSlice);
  const [diagnostics, setDiagnostics] =
    useState<OverviewStatusSlice<AdminOverviewDiagnostics>>(loadingSlice);
  const [maintenance, setMaintenance] =
    useState<OverviewStatusSlice<MaintenanceStatus>>(loadingSlice);
  const [isRefreshing, setIsRefreshing] = useState(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    setIsRefreshing(true);
    const [eventsResult, diagnosticsResult, maintenanceResult] =
      await Promise.allSettled([
        api.get<EventItem[]>("/events"),
        api.get<AdminOverviewDiagnostics>("/diagnostics/status"),
        api.get<MaintenanceStatus>("/maintenance"),
      ]);

    if (!mounted.current) return;
    const checkedAt = new Date();

    if (eventsResult.status === "fulfilled") {
      const loadedEvents = eventsResult.value.data ?? [];
      setEvents({
        state: loadedEvents.length > 0 ? "ready" : "empty",
        data: loadedEvents,
        error: null,
        checkedAt,
      });
    } else {
      setEvents((previous) => ({
        state: "error",
        data: previous.data,
        error: errorMessage("Veranstaltungsstatus", eventsResult.reason),
        checkedAt,
      }));
    }

    if (diagnosticsResult.status === "fulfilled") {
      setDiagnostics({
        state: "ready",
        data: diagnosticsResult.value.data,
        error: null,
        checkedAt,
      });
    } else {
      setDiagnostics((previous) => ({
        state: "error",
        data: previous.data,
        error: errorMessage("Lokaler Systemstatus", diagnosticsResult.reason),
        checkedAt,
      }));
    }

    if (maintenanceResult.status === "fulfilled") {
      setMaintenance({
        state: "ready",
        data: maintenanceResult.value.data,
        error: null,
        checkedAt,
      });
    } else {
      setMaintenance((previous) => ({
        state: "error",
        data: previous.data,
        error: errorMessage("Wartungsstatus", maintenanceResult.reason),
        checkedAt,
      }));
    }

    setIsRefreshing(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshToken]);

  return { events, diagnostics, maintenance, isRefreshing };
};
