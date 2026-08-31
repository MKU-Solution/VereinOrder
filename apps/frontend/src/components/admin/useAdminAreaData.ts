import { useCallback, useEffect, useRef, useState } from "react";

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

  // Nebenläufigkeit dieses Hooks (Issue #212): Antworten treffen nicht in der
  // Reihenfolge ein, in der sie angefordert wurden. Ohne Abgleich gewinnt
  // schlicht die letzte Antwort — eine verspätete Abfrage eines längst
  // verlassenen Bereichs überschreibt dann die bereits angezeigten Daten des
  // aktuellen Bereichs (sichtbar geworden als Veranstaltungsname auf der
  // Druckerkarte). Jede Antwort wird deshalb beim Eintreffen gegen eine
  // Anforderungskennung geprüft, bevor sie irgendeinen Zustand schreiben darf.

  /** Läuft je `fetchData`-Aufruf hoch; nur die zuletzt gestartete Abfrage darf schreiben. */
  const fetchRequestIdRef = useRef(0);
  /**
   * Steigt bei jedem Bereichswechsel. Die stille Diagnoseabfrage prüft
   * bewusst diese Kennung statt `fetchRequestIdRef`: Sie läuft parallel zum
   * regulären Laden desselben Bereichs und dürfte es sonst gegenseitig
   * entwerten — mit einer Ladeanzeige, die nie wieder ausgeht.
   */
  const areaGenerationRef = useRef(0);
  /** Wird beim Aushängen falsch; danach schreibt keine Antwort mehr. */
  const isMountedRef = useRef(true);
  /**
   * Der Startabruf holt die Druckerliste nur als Ausgangswert. Hat der
   * Druckerbereich inzwischen eine eigene, neuere Antwort geliefert, darf die
   * verspätete Startantwort sie nicht wieder ersetzen.
   */
  const printersListFromAreaRef = useRef(false);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    areaGenerationRef.current += 1;
  }, [activeArea]);

  useEffect(() => {
    const fetchInitialData = async () => {
      try {
        const [eventsRes, printersRes] = await Promise.all([
          api.get("/events"),
          api.get("/print-jobs/printers"),
        ]);
        if (!isMountedRef.current) return;
        setEvents(eventsRes.data || []);
        if (eventsRes.data?.length > 0) setEventId(eventsRes.data[0].id);
        if (printersRes.data && !printersListFromAreaRef.current)
          setPrintersList(printersRes.data);
        setConnectionStatus("connected");
        setConnectionCheckedAt(new Date());
      } catch (error) {
        console.error("Failed to load initial admin data", error);
        if (!isMountedRef.current) return;
        setConnectionStatus("error");
        setConnectionCheckedAt(new Date());
      }
    };
    void fetchInitialData();
  }, []);

  const fetchData = useCallback(async () => {
    // Die Kennung wird VOR den frühen Abbrüchen vergeben. Sonst bliebe ein
    // Wechsel in einen Bereich ohne eigene Abfrage (Wartungsmodus, oder ein
    // Bereich ohne gewählte Veranstaltung) ungezählt — und die noch laufende
    // Abfrage des vorherigen Bereichs dürfte weiterhin schreiben.
    const requestId = ++fetchRequestIdRef.current;
    const isCurrentRequest = () =>
      isMountedRef.current && fetchRequestIdRef.current === requestId;

    if (activeArea === "maintenance") {
      setIsLoading(false);
      setLoadError(null);
      return;
    }
    if (activeAreaRequiresEvent && !endpointEventId) {
      setIsLoading(false);
      return;
    }

    const endpoint = getAdminAreaEndpoint(
      activeArea,
      endpointEventId,
      auditFilterAction,
      auditSearch,
    );
    if (!endpoint) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setLoadError(null);
    try {
      if (activeArea === "audit") {
        const statsRes = await api.get("/audit/stats");
        if (!isCurrentRequest()) return;
        setAuditStats(statsRes.data);
      }

      const response = await api.get(endpoint);
      if (!isCurrentRequest()) return;
      if (activeArea === "audit") {
        setData(response.data.logs || []);
      } else if (activeArea === "diagnostics") {
        setDiagnosticsData(response.data);
        setDiagnosticsLastFetchedAt(new Date());
        setDiagnosticsPollFailed(false);
      } else {
        setData(response.data);
      }

      if (activeArea === "printers") {
        printersListFromAreaRef.current = true;
        setPrintersList(response.data);
      }

      if (activeArea === "backups") {
        let operation: RestoreOperation | null = null;
        try {
          const operationRes = await api.get("/backup/restore-operation");
          operation =
            operationRes.data &&
            typeof operationRes.data === "object" &&
            !Array.isArray(operationRes.data) &&
            (operationRes.data.swapId || operationRes.data.phase)
              ? operationRes.data
              : null;
        } catch {
          operation = null;
        }
        if (!isCurrentRequest()) return;
        setRestoreOperation(operation);
        setRestoreOperationConfirmation("");
      }
    } catch (error) {
      console.error(`Failed to load ${activeArea}`, error);
      if (!isCurrentRequest()) return;
      setLoadError(describeLoadError(error));
    } finally {
      // Nur die aktuelle Abfrage darf die Ladeanzeige beenden: Sonst nähme
      // eine verspätete Antwort dem gerade laufenden Bereich die Anzeige weg.
      if (isCurrentRequest()) setIsLoading(false);
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
    // Der Zeitgeber wird beim Bereichswechsel abgeräumt, eine bereits
    // laufende Abfrage liefert ihre Antwort aber trotzdem noch ab.
    const generation = areaGenerationRef.current;
    const isCurrentPoll = () =>
      isMountedRef.current && areaGenerationRef.current === generation;
    try {
      const response = await api.get("/diagnostics/status");
      if (!isCurrentPoll()) return;
      setDiagnosticsData(response.data);
      setDiagnosticsLastFetchedAt(new Date());
      setDiagnosticsPollFailed(false);
    } catch (error) {
      console.error("Background diagnostics poll failed", error);
      if (!isCurrentPoll()) return;
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
