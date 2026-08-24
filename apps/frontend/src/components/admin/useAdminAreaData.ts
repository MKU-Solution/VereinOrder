import { useCallback, useEffect, useState } from "react";

import { api } from "../../lib/api";
import {
  getAdminAreaDefinition,
  getAdminAreaEndpoint,
  type AdminAreaId,
} from "./adminAreaRegistry";

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

  useEffect(() => {
    const fetchInitialData = async () => {
      try {
        const [eventsRes, printersRes] = await Promise.all([
          api.get("/events"),
          api.get("/print-jobs/printers"),
        ]);
        if (eventsRes.data?.length > 0) setEventId(eventsRes.data[0].id);
        if (printersRes.data) setPrintersList(printersRes.data);
      } catch (error) {
        console.error("Failed to load initial admin data", error);
      }
    };
    void fetchInitialData();
  }, []);

  const fetchData = useCallback(async () => {
    const definition = getAdminAreaDefinition(activeArea);
    if (activeArea === "maintenance") {
      setLoadError(null);
      return;
    }
    if (definition.requiresEvent && !eventId) return;

    const endpoint = getAdminAreaEndpoint(
      activeArea,
      eventId,
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
        const operation = await api.get("/backup/restore-operation");
        setRestoreOperation(operation.data || null);
        setRestoreOperationConfirmation("");
      }

      if (activeArea === "printers") setPrintersList(response.data);
    } catch (error) {
      console.error(`Failed to load ${activeArea}`, error);
      setLoadError(describeLoadError(error));
    } finally {
      setIsLoading(false);
    }
  }, [activeArea, auditFilterAction, auditSearch, eventId]);

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
