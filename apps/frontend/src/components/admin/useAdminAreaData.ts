import { useCallback, useEffect, useState } from "react";

import { api } from "../../lib/api";
import {
  getAdminAreaDefinition,
  getAdminAreaEndpoint,
  type AdminAreaId,
} from "./adminAreaRegistry";
import type { EventItem } from "./adminDomainTypes";

export interface RestoreOperation {
  swapId: string;
  phase: string;
  backupFilename: string;
  backupCreatedAt: string;
  safetyBackupFilename: string;
  activeCashierSessions: number;
  requestedAt: string;
  requestedByUsername: string;
  rollbackAvailable: boolean;
  acceptanceAvailable: boolean;
}

const describeLoadError = (error: unknown): string => {
  const message = (error as { response?: { data?: { message?: unknown } } })
    ?.response?.data?.message;
  if (typeof message === "string" && message.trim()) return message;
  return "Die Daten dieses Verwaltungsbereichs konnten nicht geladen werden.";
};

/**
 * Orchestriert ausschließlich den gemeinsamen Datenvertrag der Adminbereiche.
 * Fachaktionen und Formulare bleiben in ihren Bereichsmodulen.
 */
export const useAdminAreaData = (activeArea: AdminAreaId) => {
  const [data, setData] = useState<any[]>([]);
  const [diagnosticsData, setDiagnosticsData] = useState<any>(null);
  const [printersList, setPrintersList] = useState<any[]>([]);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<
    "checking" | "connected" | "error"
  >("checking");
  const [connectionCheckedAt, setConnectionCheckedAt] = useState<Date | null>(
    null,
  );
  const [eventId, setEventId] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [auditStats, setAuditStats] = useState<any>(null);
  const [auditFilterAction, setAuditFilterAction] = useState("");
  const [auditSearch, setAuditSearch] = useState("");
  const [diagnosticsLastFetchedAt, setDiagnosticsLastFetchedAt] =
    useState<Date | null>(null);
  const [diagnosticsPollFailed, setDiagnosticsPollFailed] = useState(false);
  const [restoreOperation, setRestoreOperation] =
    useState<RestoreOperation | null>(null);
  const [restoreOperationConfirmation, setRestoreOperationConfirmation] =
    useState("");
  const activeAreaRequiresEvent =
    getAdminAreaDefinition(activeArea).requiresEvent;
  const endpointEventId = activeAreaRequiresEvent ? eventId : "";

  useEffect(() => {
    const fetchInitialData = async () => {
      try {
        const [eventsRes, printersRes] = await Promise.all([
          api.get("/events"),
          api.get("/print-jobs/printers"),
        ]);
        setEvents(eventsRes.data || []);
        if (eventsRes.data?.length > 0) setEventId(eventsRes.data[0].id);
        if (printersRes.data) setPrintersList(printersRes.data);
        setConnectionStatus("connected");
        setConnectionCheckedAt(new Date());
      } catch (error) {
        console.error("Failed to load initial admin data", error);
        setConnectionStatus("error");
        setConnectionCheckedAt(new Date());
      }
    };
    void fetchInitialData();
  }, []);

  const fetchData = useCallback(async () => {
    if (activeArea === "maintenance") {
      setLoadError(null);
      return;
    }
    if (activeAreaRequiresEvent && !endpointEventId) return;

    const endpoint = getAdminAreaEndpoint(
      activeArea,
      endpointEventId,
      auditFilterAction,
      auditSearch,
    );
    if (!endpoint) return;

    setIsLoading(true);
    setLoadError(null);
    try {
      if (activeArea === "audit") {
        const statsRes = await api.get("/audit/stats");
        setAuditStats(statsRes.data);
      }

      const response = await api.get(endpoint);
      if (activeArea === "audit") {
        setData(response.data.logs || []);
      } else if (activeArea === "diagnostics") {
        setDiagnosticsData(response.data);
        setDiagnosticsLastFetchedAt(new Date());
        setDiagnosticsPollFailed(false);
      } else {
        setData(response.data);
      }

      if (activeArea === "backups") {
        try {
          const operation = await api.get("/backup/restore-operation");
          setRestoreOperation(
            operation.data &&
              typeof operation.data === "object" &&
              !Array.isArray(operation.data) &&
              (operation.data.swapId || operation.data.phase)
              ? operation.data
              : null,
          );
        } catch {
          setRestoreOperation(null);
        }
        setRestoreOperationConfirmation("");
      }

      if (activeArea === "printers") setPrintersList(response.data);
    } catch (error) {
      console.error(`Failed to load ${activeArea}`, error);
      setLoadError(describeLoadError(error));
    } finally {
      setIsLoading(false);
    }
  }, [
    activeArea,
    activeAreaRequiresEvent,
    auditFilterAction,
    auditSearch,
    endpointEventId,
  ]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const pollDiagnosticsSilently = useCallback(async () => {
    try {
      const response = await api.get("/diagnostics/status");
      setDiagnosticsData(response.data);
      setDiagnosticsLastFetchedAt(new Date());
      setDiagnosticsPollFailed(false);
    } catch (error) {
      console.error("Background diagnostics poll failed", error);
      setDiagnosticsPollFailed(true);
    }
  }, []);

  useEffect(() => {
    if (activeArea !== "diagnostics") return;
    const interval = window.setInterval(() => {
      void pollDiagnosticsSilently();
    }, 10_000);
    return () => window.clearInterval(interval);
  }, [activeArea, pollDiagnosticsSilently]);

  return {
    data,
    diagnosticsData,
    printersList,
    events,
    connectionStatus,
    connectionCheckedAt,
    eventId,
    setEventId,
    isLoading,
    loadError,
    auditStats,
    auditFilterAction,
    setAuditFilterAction,
    auditSearch,
    setAuditSearch,
    diagnosticsLastFetchedAt,
    diagnosticsPollFailed,
    restoreOperation,
    restoreOperationConfirmation,
    setRestoreOperationConfirmation,
    fetchData,
  };
};
