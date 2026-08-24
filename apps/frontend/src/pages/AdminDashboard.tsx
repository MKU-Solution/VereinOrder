import { useState, useEffect, useCallback, useMemo } from "react";
import { api } from "../lib/api";
import { EventConfigurationActions } from "../components/admin/EventConfigurationActions";
import { MaintenancePanel } from "../components/admin/MaintenancePanel";
import {
  ProductOptionGroupsEditor,
  loadOptionGroupsFromProduct,
  buildOptionGroupsPayload,
  findEmptyGroupIds,
  findFirstDuplicateNameError,
  findFirstInvalidPriceError,
  type OptionGroupFormState,
} from "../components/admin/ProductOptionGroupsEditor";
import { useAuthStore } from "../store/useAuthStore";
import {
  Users,
  Calendar,
  Store,
  Tag,
  Package,
  Plus,
  Edit2,
  Trash2,
  Map,
  ShieldAlert,
  CheckCircle2,
  Play,
  Pause,
  Square,
  Sparkles,
  AlertTriangle,
  Printer,
  HardDrive,
  Download,
  RotateCcw,
  ShieldCheck,
  Search,
  FileSpreadsheet,
  Activity,
  Cpu,
  Database,
  RefreshCw,
  AlertOctagon,
  ArrowRight,
  PowerOff,
} from "lucide-react";

type Tab =
  | "events"
  | "stations"
  | "categories"
  | "products"
  | "users"
  | "areas"
  | "printers"
  | "backups"
  | "audit"
  | "diagnostics"
  | "maintenance";

interface EventItem {
  id: string;
  name: string;
  organizer?: string;
  location?: string;
  startTime?: string;
  endTime?: string;
  timezone: string;
  status:
    | "DRAFT"
    | "PREPARED"
    | "TEST_MODE"
    | "ACTIVE"
    | "PAUSED"
    | "COMPLETED"
    | "ARCHIVED";
  testMode: boolean;
  rksvConfirmedAt?: string;
  rksvConfirmedByUserId?: string;
  rksvDisclaimerVersion?: string;
  _count?: {
    orders: number;
    products: number;
    stations: number;
    areas: number;
  };
}

interface BackupItem {
  format: "POSTGRES_CUSTOM" | "LEGACY_JSON" | "CORRUPT";
  filename: string;
  artifacts: string[];
  sizeBytes: number;
  createdAt: string;
  checksumSha256: string;
  version: string;
  counts: Record<string, number>;
  trigger?: string | null;
  verification?:
    | "STRUCTURE_VERIFIED"
    | "RESTORE_VERIFIED"
    | "LEGACY"
    | "CORRUPT";
  compatibility?: "CURRENT" | "OLDER" | "NEWER" | "DIVERGED" | "UNKNOWN";
  restoreAvailable?: boolean;
  restoreUnavailableReason?: string | null;
  restoreVerificationAvailable?: boolean;
  restoreVerificationUnavailableReason?: string | null;
  downloadFiles?: string[];
}

interface AuditLogItem {
  id: string;
  action: string;
  entityId: string;
  entityType: string;
  userId?: string;
  user?: {
    id: string;
    username: string;
    role: string;
  };
  details?: any;
  createdAt: string;
}

/**
 * Liest die Begründung des Backends aus einem Fehler. Ohne sie bleibt der
 * Anwenderin nur "Fehler", obwohl das Backend genau sagt, was fehlt.
 */
const backendMessage = (error: unknown, fallback: string): string => {
  const message = (error as any)?.response?.data?.message;
  if (typeof message === "string" && message.trim().length > 0) return message;
  if (Array.isArray(message) && typeof message[0] === "string")
    return message[0];
  return fallback;
};

const formatStorageBytes = (value: unknown): string => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    return "unbekannt";
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(1)} GB`;
  if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} kB`;
  return `${value} B`;
};

/**
 * Bekannte Fehlerkennungen von Druckern in Klartext (Konzept 64, Abschnitt
 * 2.3: "kein Fehlercode ohne Übersetzung"). Unbekannte Codes werden roh
 * gezeigt statt verschluckt.
 */
const PRINTER_ERROR_LABELS: Record<string, string> = {
  DNS_ERROR: "Name konnte nicht aufgelöst werden",
  CONNECTION_LOST: "Verbindung während der Übertragung verloren",
  CONNECTION_REFUSED: "Verbindung abgelehnt",
  CUPS_JOB_ABORTED: "Druckwarteschlange hat den Auftrag abgebrochen",
  CUPS_QUEUE_NOT_FOUND: "Warteschlange nicht gefunden",
  LEASE_EXPIRED: "Keine Rückmeldung mehr erhalten",
  REPORT_LOST: "Rückmeldung ist nicht angekommen",
  PRINTER_CONFIG_ERROR: "Druckerkonfiguration ist fehlerhaft",
  OUTPUT_FAILED: "Ausgabe ist fehlgeschlagen",
};

const describePrinterError = (code?: string | null): string =>
  code ? (PRINTER_ERROR_LABELS[code] ?? code) : "unbekannter Fehler";

/** Kurzform "6 Min." für die Diagnose-Kachel (Konzept 64, Abschnitt 1.3). */
const formatMinutesAgoShort = (value?: string | null): string => {
  if (!value) return "unbekannter Zeit";
  const minutes = Math.max(
    0,
    Math.floor((Date.now() - new Date(value).getTime()) / 60000),
  );
  return minutes < 1 ? "< 1 Min." : `${minutes} Min.`;
};

/** Langform "6 Minuten" für die Auftragskarten (Konzept 64, Abschnitt 2.3). */
const formatMinutesAgoLong = (value?: string | null): string => {
  if (!value) return "unbekannter Zeit";
  const minutes = Math.max(
    0,
    Math.floor((Date.now() - new Date(value).getTime()) / 60000),
  );
  if (minutes < 1) return "weniger als einer Minute";
  return `${minutes} ${minutes === 1 ? "Minute" : "Minuten"}`;
};

const formatClockTime = (value?: string | null): string =>
  value
    ? new Date(value).toLocaleTimeString("de-AT", {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "unbekannt";

/** Auftragsart für die Kartenkopfzeile (Konzept 64, Abschnitt 2.3). */
const JOB_TYPE_FALLBACK_LABELS: Record<string, string> = {
  STATION_TICKET: "Abhol-/Küchenbon",
  PRODUCT_VOUCHER: "Produktbon",
  RECEIPT: "Kassenbeleg",
};
const KNOWN_JOB_TITLES: Record<string, string> = {
  "ABHOL-/KÜCHENBON": "Abhol-/Küchenbon",
  PRODUKTBON: "Produktbon",
  KASSENBELEG: "Kassenbeleg",
};
const describeJobType = (job: any): string => {
  const title =
    typeof job?.content?.title === "string" ? job.content.title.trim() : "";
  if (title) return KNOWN_JOB_TITLES[title.toUpperCase()] ?? title;
  return JOB_TYPE_FALLBACK_LABELS[job?.jobType] ?? "Druckauftrag";
};

/**
 * Klartext je unresolvedReason (Konzept 64, Abschnitt 2.3, Wortlaut laut
 * Vorgabe). bytesWritten wird nur bei TRANSPORT und nur, wenn > 0, genannt.
 */
const describeUnresolvedReason = (job: any): string => {
  const bytes = typeof job?.bytesWritten === "number" ? job.bytesWritten : null;
  switch (job?.unresolvedReason) {
    case "TRANSPORT":
      return bytes && bytes > 0
        ? `Verbindung nach ${bytes} Byte abgebrochen — auf dem Papier kann ein Teilbon liegen.`
        : "Verbindung während der Übertragung abgebrochen — ob und wie viel gedruckt wurde, ist nicht bekannt.";
    case "LEASE_EXPIRED":
      return "Der Druck-Dienst hat sich seit Beginn der Übertragung nicht mehr gemeldet — ob gedruckt wurde, ist nicht bekannt.";
    case "REPORT_LOST":
      return "Der Bon wurde vermutlich gedruckt, aber die Bestätigung ist nicht beim Server angekommen.";
    case "CUPS_ABORTED":
      return "Die Druckwarteschlange hat den Auftrag abgebrochen, möglicherweise während er schon lief.";
    case "CUPS_CANCELED":
      return "Der Auftrag wurde in der Warteschlange abgebrochen, während er möglicherweise schon lief.";
    default:
      return "Das Ergebnis dieses Druckauftrags ist unklar.";
  }
};

type PrinterDiagRowState = {
  Icon: typeof CheckCircle2;
  colorClass: string;
  text: string;
};

/**
 * Zustand einer Druckerzeile in der Diagnose-Kachel (Konzept 64, Abschnitt
 * 1.3). Zustand 2 ("Warteschlange angehalten") und die per-Drucker-Variante
 * von Zustand 6 sind hier bewusst NICHT abgebildet: der eingefrorene
 * Feldvertrag liefert weder ein aggregiertes cupsJobState/SPOOLED-Signal je
 * Drucker noch ein per-Drucker cupsReachable-Feld, sondern nur den globalen
 * cupsHostReachable-Wert (siehe Banner in der Kachel). Eine Erfindung dieser
 * Signale würde eine Genauigkeit vortäuschen, die die Daten nicht hergeben.
 */
const getPrinterDiagState = (
  printer: any,
  printersById: Record<string, any>,
): PrinterDiagRowState => {
  if (!printer.isActive) {
    return {
      Icon: PowerOff,
      colorClass: "text-slate-400",
      text: "Manuell deaktiviert",
    };
  }
  if (printer.bypassed) {
    const errorLabel = describePrinterError(printer.lastErrorCode);
    if (printer.fallbackPrinterId) {
      const fallbackName =
        printersById[printer.fallbackPrinterId]?.name ?? "unbekannt";
      return {
        Icon: AlertTriangle,
        colorClass: "text-rose-400",
        text: `Automatisch umgangen – Fehler vor ${formatMinutesAgoShort(printer.lastErrorAt)}: ${errorLabel}. Aufträge gehen aktuell an „${fallbackName}".`,
      };
    }
    return {
      Icon: AlertOctagon,
      colorClass: "text-rose-400",
      text: `Fehler seit ${formatMinutesAgoShort(printer.lastErrorAt)}: ${errorLabel}. Kein Ersatzdrucker hinterlegt.`,
    };
  }
  return { Icon: CheckCircle2, colorClass: "text-emerald-400", text: "Bereit" };
};

export const AdminDashboard = () => {
  const [activeTab, setActiveTab] = useState<Tab>("events");
  const [data, setData] = useState<any[]>([]);
  const [diagnosticsData, setDiagnosticsData] = useState<any>(null);
  const [printersList, setPrintersList] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [verifyingBackup, setVerifyingBackup] = useState<string | null>(null);
  const [isRetryingJobs, setIsRetryingJobs] = useState(false);
  const [eventId, setEventId] = useState<string>("");

  // Audit state
  const [auditStats, setAuditStats] = useState<any>(null);
  const [auditFilterAction, setAuditFilterAction] = useState<string>("");
  const [auditSearch, setAuditSearch] = useState<string>("");

  // Generic Modal State (for Areas / Simple Items)
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<any>(null);
  const [formData, setFormData] = useState<{
    name: string;
    shortName?: string;
    sortOrder: number;
    printerId?: string;
    role: string;
    pin: string;
    isActive: boolean;
    // Zielstation der Kategorie (Issue #84) - gilt für alle Produkte der
    // Kategorie ohne eigene Ausnahme. Nur für activeTab === "categories".
    targetStationId?: string;
  }>({
    name: "",
    shortName: "",
    sortOrder: 0,
    printerId: "",
    role: "WAITER",
    pin: "",
    isActive: true,
    targetStationId: "",
  });
  const [modalError, setModalError] = useState("");
  const [isSavingModal, setIsSavingModal] = useState(false);

  // Product Modal State
  const [isProductModalOpen, setIsProductModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<any>(null);
  const [productFormData, setProductFormData] = useState({
    name: "",
    euro: "",
    cent: "",
    categoryId: "",
    targetStationId: "",
    sortOrder: "0",
  });
  const [productCategories, setProductCategories] = useState<any[]>([]);
  const [productStations, setProductStations] = useState<any[]>([]);
  // Auswahlgruppen (Issue #75) — Formularzustand im Produktmodal
  const [optionGroups, setOptionGroups] = useState<OptionGroupFormState[]>([]);
  const [optionGroupsValidationAttempted, setOptionGroupsValidationAttempted] =
    useState(false);

  // Printer Modal State
  const [isPrinterModalOpen, setIsPrinterModalOpen] = useState(false);
  const [editingPrinter, setEditingPrinter] = useState<any>(null);
  const [printerFormData, setPrinterFormData] = useState({
    name: "",
    type: "CONSOLE",
    ipAddress: "",
    port: 9100,
    paperWidth: 80,
    codepage: "CP858",
    cutMode: "PARTIAL",
    copies: 1,
    timeoutMs: 5000,
    queueName: "",
    fallbackPrinterId: "",
  });
  const [printerTests, setPrinterTests] = useState<
    Record<string, { state: "running" | "ok" | "error"; message: string }>
  >({});

  // Unklare Druckaufträge (Issue #64 / Admin-Entscheidung)
  const [unresolvedJobs, setUnresolvedJobs] = useState<any[]>([]);
  const [resolveDialog, setResolveDialog] = useState<{
    job: any;
    action: "REPRINTED" | "CONFIRMED_PRINTED" | "DISCARDED";
  } | null>(null);
  const [resolveTargetPrinterId, setResolveTargetPrinterId] = useState("");
  const [resolveChecked, setResolveChecked] = useState(false);
  const [resolveComment, setResolveComment] = useState("");
  const [resolveError, setResolveError] = useState("");
  const [isResolving, setIsResolving] = useState(false);
  const [justResolvedIds, setJustResolvedIds] = useState<
    Record<string, { tone: "ok" | "reprint" | "discard"; text: string }>
  >({});

  // Diagnose-Kachel: Hintergrund-Poll-Zustand (Issue #64, Abschnitt 1.4/1.7)
  const [diagnosticsLastFetchedAt, setDiagnosticsLastFetchedAt] =
    useState<Date | null>(null);
  const [diagnosticsPollFailed, setDiagnosticsPollFailed] = useState(false);

  const currentUserRole = useAuthStore((s) => s.user?.role);
  // Nur zum Ausblenden von Knöpfen, siehe Konzept 64, Abschnitt 0 und 2.7 -
  // maßgeblich bleibt der RolesGuard im Backend.
  const canDiscardPrintJobs = currentUserRole === "ADMINISTRATOR";

  const printersById = useMemo(() => {
    const map: Record<string, any> = {};
    for (const p of printersList) map[p.id] = p;
    return map;
  }, [printersList]);

  // Issue #84: Anzeige im Produktmodal, welche Station ohne eigene
  // Ausnahme gilt - die Zielstation der gewählten Kategorie, sonst die
  // zentrale Ausgabe. Berechnet aus den ohnehin geladenen Listen
  // (productCategories, productStations), siehe handleOpenModal.
  const inheritedStationLabel = useMemo(() => {
    const selectedCategory = productCategories.find(
      (c: any) => c.id === productFormData.categoryId,
    );
    if (!selectedCategory) return null;
    if (!selectedCategory.targetStationId) return "Zentrale Ausgabe";
    const station = productStations.find(
      (s: any) => s.id === selectedCategory.targetStationId,
    );
    return station?.name || "Zentrale Ausgabe";
  }, [productCategories, productStations, productFormData.categoryId]);

  // Event Modal State
  const [isEventModalOpen, setIsEventModalOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<EventItem | null>(null);
  const [eventFormData, setEventFormData] = useState({
    name: "",
    organizer: "",
    location: "",
    startTime: "",
    endTime: "",
    status: "DRAFT",
    testMode: false,
  });

  // RKSV Disclaimer Modal State
  const [rksvModalOpen, setRksvModalOpen] = useState(false);
  const [rksvTargetEvent, setRksvTargetEvent] = useState<EventItem | null>(
    null,
  );
  const [rksvConfirmed, setRksvConfirmed] = useState(false);
  const [isActivating, setIsActivating] = useState(false);

  // Fetch a valid eventId and printers list on mount
  useEffect(() => {
    const fetchInitialData = async () => {
      try {
        const [eventsRes, printersRes] = await Promise.all([
          api.get("/events"),
          api.get("/print-jobs/printers"),
        ]);
        if (eventsRes.data && eventsRes.data.length > 0) {
          setEventId(eventsRes.data[0].id);
        }
        if (printersRes.data) {
          setPrintersList(printersRes.data);
        }
      } catch (err) {
        console.error("Failed to load initial data", err);
      }
    };
    fetchInitialData();
  }, []);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      let endpoint = "";
      if (activeTab === "events") endpoint = "/events";
      if (activeTab === "stations")
        endpoint = `/stations/admin/all?eventId=${eventId}`;
      if (activeTab === "categories")
        endpoint = `/categories?eventId=${eventId}`;
      if (activeTab === "products")
        endpoint = `/products/admin?eventId=${eventId}`;
      if (activeTab === "users") endpoint = "/users";
      if (activeTab === "areas") endpoint = `/areas?eventId=${eventId}`;
      if (activeTab === "printers") endpoint = "/print-jobs/printers";
      if (activeTab === "backups") endpoint = "/backup/list";
      if (activeTab === "diagnostics") endpoint = "/diagnostics/status";
      if (activeTab === "audit") {
        const queryParams = new URLSearchParams();
        if (auditFilterAction) queryParams.set("action", auditFilterAction);
        if (auditSearch) queryParams.set("search", auditSearch);
        endpoint = `/audit/logs?${queryParams.toString()}`;

        const statsRes = await api.get("/audit/stats");
        setAuditStats(statsRes.data);
      }

      const res = await api.get(endpoint);
      if (activeTab === "audit") {
        setData(res.data.logs || []);
      } else if (activeTab === "diagnostics") {
        setDiagnosticsData(res.data);
        setDiagnosticsLastFetchedAt(new Date());
        setDiagnosticsPollFailed(false);
      } else {
        setData(res.data);
      }

      if (activeTab === "printers") {
        setPrintersList(res.data);
      }
    } catch (err) {
      console.error(`Failed to load ${activeTab}`, err);
    } finally {
      setIsLoading(false);
    }
  }, [activeTab, eventId, auditFilterAction, auditSearch]);

  /**
   * Unklare Druckaufträge (Konzept 64, Abschnitt 2.1/2.2). Läuft
   * unabhängig vom aktiven Tab, weil sowohl das Tab-Abzeichen als auch die
   * Diagnose-Kennzahl "Unklar" jederzeit stimmen müssen, nicht nur wenn der
   * Tab "Drucker & Bon-Routing" offen ist.
   */
  const fetchUnresolvedJobs = useCallback(async () => {
    try {
      const res = await api.get("/print-jobs/unresolved");
      setUnresolvedJobs(res.data || []);
    } catch (err) {
      console.error("Failed to load unresolved print jobs", err);
    }
  }, []);

  useEffect(() => {
    fetchUnresolvedJobs();
    const interval = setInterval(fetchUnresolvedJobs, 10000);
    return () => clearInterval(interval);
  }, [fetchUnresolvedJobs]);

  useEffect(() => {
    if (
      activeTab === "events" ||
      activeTab === "printers" ||
      activeTab === "backups" ||
      activeTab === "audit" ||
      activeTab === "diagnostics" ||
      eventId
    ) {
      fetchData();
    }
  }, [activeTab, eventId, fetchData]);

  /**
   * Hintergrund-Poll der Diagnose-Kachel: läuft ohne den globalen
   * Ladezustand zu berühren, damit die Anzeige nicht alle 10 s zum
   * "Lade Daten…"-Bildschirm zurückspringt (Konzept 64, Abschnitt 1.7). Bei
   * Fehlschlag bleiben die zuletzt bekannten Werte sichtbar und Banner
   * 1.4(b) erscheint.
   */
  const pollDiagnosticsSilently = useCallback(async () => {
    try {
      const res = await api.get("/diagnostics/status");
      setDiagnosticsData(res.data);
      setDiagnosticsLastFetchedAt(new Date());
      setDiagnosticsPollFailed(false);
    } catch (err) {
      console.error("Background diagnostics poll failed", err);
      setDiagnosticsPollFailed(true);
    }
  }, []);

  // Periodic poll for diagnostics tab
  useEffect(() => {
    if (activeTab !== "diagnostics") return;
    const interval = setInterval(() => {
      pollDiagnosticsSilently();
    }, 10000);
    return () => clearInterval(interval);
  }, [activeTab, pollDiagnosticsSilently]);

  const tabs = [
    { id: "events", label: "Veranstaltungen & Lifecycle", icon: Calendar },
    { id: "diagnostics", label: "System-Status & Diagnose", icon: Activity },
    { id: "areas", label: "Bereiche", icon: Map },
    { id: "stations", label: "Stationen", icon: Store },
    { id: "printers", label: "Drucker & Bon-Routing", icon: Printer },
    { id: "backups", label: "Backups & Datensicherung", icon: HardDrive },
    { id: "maintenance", label: "Wartungsmodus", icon: PowerOff },
    { id: "audit", label: "Audit-Protokoll & Sicherheit", icon: ShieldAlert },
    { id: "categories", label: "Kategorien", icon: Tag },
    { id: "products", label: "Produkte", icon: Package },
    { id: "users", label: "Mitarbeiter", icon: Users },
  ] as const;

  const handleModalEscape = (
    e: React.KeyboardEvent,
    closeModal: () => void,
  ) => {
    if (e.key === "Escape" && !isSavingModal) {
      e.preventDefault();
      closeModal();
    }
  };

  const handleOpenModal = async (item?: any) => {
    if (activeTab === "events") {
      if (item) {
        setEditingEvent(item);
        setEventFormData({
          name: item.name || "",
          organizer: item.organizer || "",
          location: item.location || "",
          startTime: item.startTime ? item.startTime.slice(0, 16) : "",
          endTime: item.endTime ? item.endTime.slice(0, 16) : "",
          status: item.status || "DRAFT",
          testMode: item.testMode || false,
        });
      } else {
        setEditingEvent(null);
        setEventFormData({
          name: "",
          organizer: "",
          location: "",
          startTime: "",
          endTime: "",
          status: "DRAFT",
          testMode: false,
        });
      }
      setIsEventModalOpen(true);
    } else if (activeTab === "printers") {
      setModalError("");
      if (item) {
        setEditingPrinter(item);
        setPrinterFormData({
          name: item.name || "",
          type: item.type || "CONSOLE",
          ipAddress: item.ipAddress || "",
          port: item.port || 9100,
          paperWidth: item.paperWidth || 80,
          codepage: item.codepage || "CP858",
          cutMode: item.cutMode || "PARTIAL",
          copies: item.copies || 1,
          timeoutMs: item.timeoutMs || 5000,
          queueName: item.queueName || "",
          fallbackPrinterId: item.fallbackPrinterId || "",
        });
      } else {
        setEditingPrinter(null);
        setPrinterFormData({
          name: "",
          type: "CONSOLE",
          ipAddress: "",
          port: 9100,
          paperWidth: 80,
          codepage: "CP858",
          cutMode: "PARTIAL",
          copies: 1,
          timeoutMs: 5000,
          queueName: "",
          fallbackPrinterId: "",
        });
      }
      setIsPrinterModalOpen(true);
    } else if (activeTab === "products") {
      setModalError("");
      setEditingProduct(item || null);
      const price = Number.isInteger(item?.price) ? item.price : 0;
      setProductFormData({
        name: item?.name || "",
        euro: String(Math.floor(price / 100)),
        cent: String(Math.abs(price % 100)).padStart(2, "0"),
        categoryId: item?.categoryId || "",
        targetStationId: item?.targetStationId || "",
        sortOrder: String(item?.sortOrder ?? 0),
      });
      setOptionGroups(loadOptionGroupsFromProduct(item));
      setOptionGroupsValidationAttempted(false);
      setIsProductModalOpen(true);
      if (!eventId) {
        setModalError("Bitte wähle zuerst eine Veranstaltung aus.");
        return;
      }
      try {
        const [categoriesRes, stationsRes] = await Promise.all([
          api.get(`/categories?eventId=${eventId}`),
          api.get(`/stations/admin/all?eventId=${eventId}`),
        ]);
        setProductCategories(categoriesRes.data || []);
        setProductStations(stationsRes.data || []);
      } catch (err) {
        console.error("Failed to load product modal options", err);
        setModalError(
          "Kategorien oder Stationen konnten nicht geladen werden. Bitte erneut versuchen.",
        );
      }
    } else if (activeTab === "categories") {
      setModalError("");
      setEditingItem(item || null);
      setFormData({
        name: item?.name || "",
        shortName: "",
        sortOrder: item?.sortOrder ?? 0,
        printerId: "",
        role: "WAITER",
        pin: "",
        isActive: true,
        targetStationId: item?.targetStationId || "",
      });
      setIsModalOpen(true);
      if (!eventId) {
        setModalError("Bitte wähle zuerst eine Veranstaltung aus.");
        return;
      }
      try {
        const stationsRes = await api.get(
          `/stations/admin/all?eventId=${eventId}`,
        );
        setProductStations(stationsRes.data || []);
      } catch (err) {
        console.error("Failed to load stations for category modal", err);
        setModalError(
          "Stationen konnten nicht geladen werden. Bitte erneut versuchen.",
        );
      }
    } else {
      setModalError("");
      if (item) {
        setEditingItem(item);
        setFormData({
          name: item.name || item.username || "",
          shortName: item.shortName || "",
          sortOrder: item.sortOrder ?? 0,
          printerId: item.printerId || "",
          role: item.role || "WAITER",
          pin: "",
          isActive: item.isActive ?? true,
          targetStationId: "",
        });
      } else {
        setEditingItem(null);
        setFormData({
          name: "",
          shortName: "",
          sortOrder: 0,
          printerId: "",
          role: "WAITER",
          pin: "",
          isActive: true,
          targetStationId: "",
        });
      }
      setIsModalOpen(true);
    }
  };

  /**
   * Schließt das Produktmodal und verwirft den Auswahlgruppen-Formularzustand,
   * damit beim nächsten Öffnen nicht die Gruppen des zuvor bearbeiteten
   * Produkts hängen bleiben (siehe handleOpenModal, das ohnehin neu lädt —
   * dies ist die zusätzliche Absicherung beim Abbrechen).
   */
  const closeProductModal = () => {
    setIsProductModalOpen(false);
    setOptionGroups([]);
    setOptionGroupsValidationAttempted(false);
  };

  const handleSaveModal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSavingModal) return;
    setModalError("");

    if (activeTab === "stations") {
      const name = formData.name.trim();
      const shortName = (formData.shortName || "").trim();
      if (!name) {
        setModalError("Bitte gib einen Namen für die Station ein.");
        return;
      }
      if (shortName.length > 12) {
        setModalError(
          "Die Kurzbezeichnung darf höchstens 12 Zeichen lang sein.",
        );
        return;
      }
      if (!Number.isInteger(formData.sortOrder)) {
        setModalError("Die Sortierung muss eine ganze Zahl sein.");
        return;
      }
    }

    setIsSavingModal(true);
    try {
      if (activeTab === "printers") {
        // fallbackPrinterId ist eine Fremdschlüssel-Spalte im Backend - eine
        // leere Zeichenkette wäre dort kein gültiger Wert, sondern muss
        // explizit null bedeuten. queueName wird nur bei CUPS_IPP befüllt,
        // sonst bewusst mitgeschickt als null, damit ein Typwechsel weg von
        // CUPS_IPP die Warteschlange auch serverseitig aufräumt.
        const printerPayload = {
          ...printerFormData,
          fallbackPrinterId: printerFormData.fallbackPrinterId || null,
          queueName:
            printerFormData.type === "CUPS_IPP"
              ? printerFormData.queueName.trim()
              : null,
        };
        if (editingPrinter) {
          await api.patch(
            `/print-jobs/printers/${editingPrinter.id}`,
            printerPayload,
          );
        } else {
          await api.post("/print-jobs/printers", printerPayload);
        }
        setIsPrinterModalOpen(false);
      } else if (activeTab === "events") {
        const payload = {
          name: eventFormData.name,
          organizer: eventFormData.organizer,
          location: eventFormData.location,
          startTime: eventFormData.startTime
            ? new Date(eventFormData.startTime).toISOString()
            : undefined,
          endTime: eventFormData.endTime
            ? new Date(eventFormData.endTime).toISOString()
            : undefined,
        };

        if (editingEvent) {
          await api.patch(`/events/${editingEvent.id}`, payload);
        } else {
          const res = await api.post("/events", payload);
          if (!eventId) setEventId(res.data.id);
        }
        setIsEventModalOpen(false);
      } else {
        let endpoint = "";
        if (activeTab === "areas") endpoint = "/areas";
        if (activeTab === "stations") endpoint = "/stations";
        if (activeTab === "categories") endpoint = "/categories";
        if (activeTab === "users") endpoint = "/users";

        if (activeTab === "stations") {
          const payload = {
            name: formData.name.trim(),
            shortName: (formData.shortName || "").trim() || null,
            printerId: formData.printerId || null,
            sortOrder: formData.sortOrder,
          };
          if (editingItem) {
            await api.patch(`${endpoint}/${editingItem.id}`, payload);
          } else {
            await api.post(endpoint, { ...payload, eventId });
          }
        } else if (activeTab === "categories") {
          const payload = {
            name: formData.name,
            sortOrder: formData.sortOrder,
            targetStationId: formData.targetStationId || null,
          };
          if (editingItem) {
            await api.patch(`${endpoint}/${editingItem.id}`, payload);
          } else {
            await api.post(endpoint, { ...payload, eventId });
          }
        } else if (activeTab === "areas") {
          const payload = {
            name: formData.name,
            sortOrder: formData.sortOrder,
          };
          if (editingItem) {
            await api.patch(`${endpoint}/${editingItem.id}`, payload);
          } else {
            await api.post(endpoint, { ...payload, eventId });
          }
        } else {
          const username = formData.name.trim();
          if (!username) {
            setModalError("Bitte gib einen Benutzernamen ein.");
            return;
          }
          if (!editingItem && !/^\d{4,12}$/.test(formData.pin)) {
            setModalError("Die PIN muss aus 4 bis 12 Ziffern bestehen.");
            return;
          }
          const payload = editingItem
            ? {
                username,
                role: formData.role,
                isActive: formData.isActive,
              }
            : {
                username,
                pin: formData.pin,
                role: formData.role,
              };
          if (editingItem) {
            await api.patch(`${endpoint}/${editingItem.id}`, payload);
          } else {
            await api.post(endpoint, payload);
          }
        }
        setIsModalOpen(false);
      }
      fetchData();
    } catch (err) {
      console.error("Failed to save item", err);
      if (activeTab === "printers") {
        // Das Backend begründet abgelehnte Druckerdaten; diese Begründung
        // gehört direkt in das Formular.
        setModalError(
          backendMessage(
            err,
            "Speichern fehlgeschlagen. Bitte prüfe die Eingaben und versuche es erneut.",
          ),
        );
      } else if (activeTab === "events") {
        alert("Fehler beim Speichern");
      } else {
        setModalError(
          "Speichern fehlgeschlagen. Bitte prüfe die Eingaben und versuche es erneut.",
        );
      }
    } finally {
      setIsSavingModal(false);
    }
  };

  const handleSaveProductModal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSavingModal) return;
    setModalError("");
    setOptionGroupsValidationAttempted(false);

    const name = productFormData.name.trim();
    const euroInput = productFormData.euro.trim();
    const centInput = productFormData.cent.trim();
    const sortOrderInput = productFormData.sortOrder.trim();
    const euro = Number(euroInput);
    const cent = Number(centInput);
    const sortOrder = Number(sortOrderInput);
    if (!eventId) {
      setModalError("Bitte wähle zuerst eine Veranstaltung aus.");
      return;
    }
    if (!name) {
      setModalError("Bitte gib einen Produktnamen ein.");
      return;
    }
    if (!productFormData.categoryId) {
      // Wortlaut deckungsgleich mit der Backend-Ablehnung
      // (PRODUCT_CATEGORY_REQUIRED_MESSAGE in products.service.ts), damit
      // dieselbe Regel nicht mit zwei verschiedenen Texten auftritt.
      setModalError(
        "Jedes Produkt braucht eine Kategorie. Bitte eine Kategorie auswählen.",
      );
      return;
    }
    if (
      !/^\d+$/.test(euroInput) ||
      !/^\d+$/.test(centInput) ||
      !Number.isSafeInteger(euro) ||
      euro < 0 ||
      !Number.isSafeInteger(cent) ||
      cent < 0 ||
      cent > 99
    ) {
      setModalError(
        "Euro muss eine nichtnegative ganze Zahl und Cent ein Wert von 0 bis 99 sein.",
      );
      return;
    }
    if (!/^-?\d+$/.test(sortOrderInput) || !Number.isInteger(sortOrder)) {
      setModalError("Die Sortierung muss eine ganze Zahl sein.");
      return;
    }
    const price = euro * 100 + cent;
    if (!Number.isSafeInteger(price) || price > 2_147_483_647) {
      setModalError(
        "Der Preis ist zu hoch. Maximal erlaubt sind 21.474.836,47 Euro.",
      );
      return;
    }
    if (findEmptyGroupIds(optionGroups).size > 0) {
      setOptionGroupsValidationAttempted(true);
      setModalError(
        "Bitte ergänze fehlende Antworten in den markierten Gruppen.",
      );
      return;
    }
    const invalidPriceError = findFirstInvalidPriceError(optionGroups);
    if (invalidPriceError) {
      setOptionGroupsValidationAttempted(true);
      setModalError(invalidPriceError);
      return;
    }
    const duplicateNameError = findFirstDuplicateNameError(optionGroups);
    if (duplicateNameError) {
      setOptionGroupsValidationAttempted(true);
      setModalError(duplicateNameError);
      return;
    }

    setIsSavingModal(true);
    try {
      const payload = {
        name,
        price,
        categoryId: productFormData.categoryId,
        targetStationId: productFormData.targetStationId || null,
        sortOrder,
        optionGroups: buildOptionGroupsPayload(optionGroups),
      };
      if (editingProduct) {
        await api.patch(`/products/${editingProduct.id}`, payload);
      } else {
        await api.post("/products", { ...payload, eventId });
      }
      closeProductModal();
      fetchData();
    } catch (err) {
      console.error("Failed to save product", err);
      setModalError(
        backendMessage(
          err,
          "Speichern fehlgeschlagen. Bitte prüfe die Eingaben und versuche es erneut.",
        ),
      );
    } finally {
      setIsSavingModal(false);
    }
  };

  /**
   * Wartet auf den Ausgang eines Druckauftrags. Der Worker meldet erst nach
   * dem Transport zurück, deshalb wird der Auftrag kurz abgefragt.
   */
  const waitForPrintJob = async (
    jobId: string,
  ): Promise<{ state: "ok" | "error"; message: string }> => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      try {
        const { data } = await api.get(`/print-jobs/${jobId}/status`);
        if (data.status === "PRINTED") {
          return { state: "ok", message: "Testbon wurde gedruckt." };
        }
        if (data.status === "FAILED") {
          return {
            state: "error",
            message: data.errorMessage || "Der Druck ist fehlgeschlagen.",
          };
        }
      } catch (err) {
        console.error("Failed to read print job status", err);
        return {
          state: "error",
          message: backendMessage(
            err,
            "Der Auftragsstatus konnte nicht gelesen werden.",
          ),
        };
      }
    }
    return {
      state: "error",
      message:
        "Keine Rückmeldung innerhalb von 20 Sekunden. Läuft der Print-Worker?",
    };
  };

  const handleTestPrint = async (printerId: string) => {
    setPrinterTests((prev) => ({
      ...prev,
      [printerId]: {
        state: "running",
        message: "Testbon eingereiht, warte auf den Drucker …",
      },
    }));

    try {
      const { data: job } = await api.post(
        `/print-jobs/printers/${printerId}/test`,
      );
      const result = await waitForPrintJob(job.id);
      setPrinterTests((prev) => ({ ...prev, [printerId]: result }));
    } catch (err) {
      console.error("Failed to test print", err);
      setPrinterTests((prev) => ({
        ...prev,
        [printerId]: {
          state: "error",
          message: backendMessage(
            err,
            "Der Testdruck konnte nicht gestartet werden.",
          ),
        },
      }));
    }
  };

  // --- BACKUP ACTIONS ---
  const handleCreateBackup = async () => {
    setIsBackingUp(true);
    try {
      await api.post("/backup/create");
      alert("Datensicherung erfolgreich erstellt!");
      fetchData();
    } catch (err) {
      console.error("Failed to create backup", err);
      alert("Fehler bei der Erstellung des Backups");
    } finally {
      setIsBackingUp(false);
    }
  };

  const handleDownloadBackup = async (filename: string) => {
    try {
      const response = await api.get(`/backup/download/${filename}`, {
        responseType: "blob",
      });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", filename);
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (err) {
      console.error("Failed to download backup", err);
      alert("Fehler beim Herunterladen des Backups");
    }
  };

  const handleRestoreBackup = async (filename: string) => {
    if (
      !confirm(
        `⚠️ ACHTUNG: Möchtest du wirklich den Zustand aus "${filename}" wiederherstellen?\n\nEs wird vorab automatisch ein Sicherheits-Backup des aktuellen Zustands angelegt.`,
      )
    ) {
      return;
    }
    try {
      const res = await api.post(`/backup/restore/${filename}`);
      alert(`Wiederherstellung erfolgreich!\n\n${res.data.message || ""}`);
      fetchData();
    } catch (err) {
      console.error("Failed to restore backup", err);
      alert("Fehler bei der Wiederherstellung des Backups");
    }
  };

  const handleVerifyRestore = async (filename: string) => {
    setVerifyingBackup(filename);
    try {
      await api.post(`/backup/verify-restore/${filename}`);
      alert(
        "Wiederherstellungsprüfung erfolgreich. Der Dump wurde vollständig in eine isolierte Nebendatenbank eingespielt, fachlich verglichen und anschließend wieder entfernt. Die Festdatenbank blieb unverändert.",
      );
      fetchData();
    } catch (err) {
      console.error("Failed to verify backup restoration", err);
      alert(
        "Die Wiederherstellungsprüfung ist fehlgeschlagen. Die Festdatenbank wurde nicht verändert.",
      );
    } finally {
      setVerifyingBackup(null);
    }
  };

  // --- AUDIT ACTIONS ---
  const handleExportAuditCsv = async () => {
    try {
      const res = await api.get("/audit/export", { responseType: "blob" });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute(
        "download",
        `vereinorder_audit_log_${new Date().toISOString().slice(0, 10)}.csv`,
      );
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (err) {
      console.error("Failed to export audit log", err);
      alert("Fehler beim Exportieren des Audit-Logs");
    }
  };

  // --- DIAGNOSTICS ACTIONS ---
  const handleRetryFailedJobs = async () => {
    setIsRetryingJobs(true);
    try {
      const res = await api.post("/diagnostics/retry-failed-print-jobs");
      alert(res.data.message);
      fetchData();
    } catch (err) {
      console.error("Failed to retry print jobs", err);
      alert("Fehler beim Wiederholen der Druckaufträge");
    } finally {
      setIsRetryingJobs(false);
    }
  };

  // --- ADMIN-ENTSCHEIDUNG BEI UNKLAREM DRUCKERGEBNIS (Konzept 64, Abschnitt 2.5) ---
  const openResolveDialog = (
    job: any,
    action: "REPRINTED" | "CONFIRMED_PRINTED" | "DISCARDED",
  ) => {
    setResolveDialog({ job, action });
    setResolveTargetPrinterId("");
    setResolveChecked(false);
    setResolveComment("");
    setResolveError("");
  };

  const closeResolveDialog = () => {
    setResolveDialog(null);
    setResolveError("");
    // Auch nach einem Abbruch (z. B. nach einer 409-Meldung) neu laden,
    // damit die Liste den tatsächlichen Stand zeigt (Konzept 64, 2.8).
    fetchUnresolvedJobs();
  };

  const canConfirmResolve = resolveDialog
    ? resolveDialog.action === "REPRINTED"
      ? Boolean(resolveTargetPrinterId) && resolveChecked
      : resolveDialog.action === "CONFIRMED_PRINTED"
        ? resolveChecked
        : resolveComment.trim().length > 0
    : false;

  const handleResolveSubmit = async () => {
    if (!resolveDialog || !canConfirmResolve || isResolving) return;
    const { job, action } = resolveDialog;
    setIsResolving(true);
    setResolveError("");
    try {
      const payload: Record<string, unknown> = { resolution: action };
      if (action === "REPRINTED")
        payload.targetPrinterId = resolveTargetPrinterId;
      if (resolveComment.trim()) payload.comment = resolveComment.trim();

      await api.post(`/print-jobs/${job.id}/resolve`, payload);

      const feedback =
        action === "REPRINTED"
          ? {
              tone: "reprint" as const,
              text: `Neuer Druckauftrag an „${
                printersById[resolveTargetPrinterId]?.name ?? "unbekannt"
              }" eingereiht.`,
            }
          : action === "CONFIRMED_PRINTED"
            ? { tone: "ok" as const, text: "Als gedruckt bestätigt." }
            : { tone: "discard" as const, text: "Verworfen." };

      setJustResolvedIds((prev) => ({ ...prev, [job.id]: feedback }));
      setResolveDialog(null);
      // Zähler sofort nachziehen (2.8, Punkt 3); die anschließende
      // Verzögerung erlaubt, dass die Inline-Bestätigung an Ort und Stelle
      // sichtbar bleibt, bevor die Karte aus der Liste verschwindet.
      setTimeout(() => {
        setJustResolvedIds((prev) => {
          const rest = { ...prev };
          delete rest[job.id];
          return rest;
        });
        fetchUnresolvedJobs();
      }, 2600);
    } catch (err) {
      console.error("Failed to resolve print job", err);
      setResolveError(
        backendMessage(
          err,
          "Die Entscheidung konnte nicht gespeichert werden.",
        ),
      );
    } finally {
      setIsResolving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Diesen Eintrag wirklich unwiderruflich löschen?")) return;
    try {
      let endpoint = "";
      if (activeTab === "events") endpoint = `/events/${id}`;
      if (activeTab === "areas") endpoint = `/areas/${id}`;
      if (activeTab === "stations") endpoint = `/stations/${id}`;
      if (activeTab === "categories") endpoint = `/categories/${id}`;
      if (activeTab === "products") endpoint = `/products/${id}`;
      if (activeTab === "users") endpoint = `/users/${id}`;

      await api.delete(endpoint);
      fetchData();
    } catch (err) {
      console.error("Failed to delete item", err);
      alert("Fehler beim Löschen");
    }
  };

  // --- EVENT LIFECYCLE HANDLERS ---
  const handleOpenActivateModal = (evt: EventItem) => {
    setRksvTargetEvent(evt);
    setRksvConfirmed(false);
    setRksvModalOpen(true);
  };

  const handleConfirmActivation = async () => {
    if (!rksvTargetEvent || !rksvConfirmed) return;
    setIsActivating(true);
    try {
      await api.post(`/events/${rksvTargetEvent.id}/activate`, {
        confirmed: true,
      });
      setRksvModalOpen(false);
      fetchData();
    } catch (err) {
      console.error("Activation failed", err);
      alert("Fehler bei der Aktivierung der Veranstaltung!");
    } finally {
      setIsActivating(false);
    }
  };

  const handleSetTestMode = async (evt: EventItem) => {
    try {
      await api.patch(`/events/${evt.id}/status`, { status: "TEST_MODE" });
      fetchData();
    } catch (err) {
      console.error("Failed to set test mode", err);
      alert("Fehler beim Aktivieren des Testmodus");
    }
  };

  const handlePauseEvent = async (evt: EventItem) => {
    try {
      await api.patch(`/events/${evt.id}/status`, { status: "PAUSED" });
      fetchData();
    } catch (err) {
      console.error("Failed to pause event", err);
    }
  };

  const handleCompleteEvent = async (evt: EventItem) => {
    if (
      !confirm(
        `Möchtest du "${evt.name}" wirklich abschließen? Es können danach keine neuen Bestellungen mehr erfasst werden.`,
      )
    )
      return;
    try {
      await api.patch(`/events/${evt.id}/status`, { status: "COMPLETED" });
      fetchData();
    } catch (err) {
      console.error("Failed to complete event", err);
    }
  };

  const formatUptime = (seconds: number) => {
    const d = Math.floor(seconds / (3600 * 24));
    const h = Math.floor((seconds % (3600 * 24)) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);

    const parts = [];
    if (d > 0) parts.push(`${d}d`);
    if (h > 0 || d > 0) parts.push(`${h}h`);
    parts.push(`${m}m`);
    parts.push(`${s}s`);
    return parts.join(" ");
  };

  const getStatusBadge = (status: string, rksvConfirmedAt?: string) => {
    switch (status) {
      case "ACTIVE":
        return (
          <div className="flex flex-col items-start gap-1">
            <span className="bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-2.5 py-1 rounded-full text-xs font-bold flex items-center gap-1.5 shadow-sm shadow-emerald-500/20">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              Echtbetrieb (Aktiv)
            </span>
            {rksvConfirmedAt && (
              <span className="text-[10px] text-emerald-300/80 font-medium">
                ✓ RKSV-Ausschluss bestätigt
              </span>
            )}
          </div>
        );
      case "TEST_MODE":
        return (
          <span className="bg-amber-500/20 text-amber-300 border border-amber-500/30 px-2.5 py-1 rounded-full text-xs font-bold flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5" />
            Testmodus (Schulung)
          </span>
        );
      case "PAUSED":
        return (
          <span className="bg-slate-700 text-slate-300 px-2.5 py-1 rounded-full text-xs font-bold flex items-center gap-1.5">
            <Pause className="w-3.5 h-3.5" />
            Pausiert
          </span>
        );
      case "COMPLETED":
        return (
          <span className="bg-indigo-500/20 text-indigo-300 px-2.5 py-1 rounded-full text-xs font-bold flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5" />
            Abgeschlossen
          </span>
        );
      default:
        return (
          <span className="bg-slate-800 text-slate-400 px-2.5 py-1 rounded-full text-xs font-medium">
            Entwurf (DRAFT)
          </span>
        );
    }
  };

  const getActionBadge = (action?: string) => {
    if (!action)
      return (
        <span className="bg-slate-800 text-slate-500 px-2.5 py-0.5 rounded-full text-xs font-medium">
          Unbekannt
        </span>
      );
    if (action.includes("CANCEL")) {
      return (
        <span className="bg-rose-500/20 text-rose-300 border border-rose-500/30 px-2.5 py-0.5 rounded-full text-xs font-bold">
          Storno
        </span>
      );
    }
    if (action.includes("PRICE")) {
      return (
        <span className="bg-amber-500/20 text-amber-300 border border-amber-500/30 px-2.5 py-0.5 rounded-full text-xs font-bold">
          Preisänderung
        </span>
      );
    }
    if (action.includes("PAYMENT")) {
      return (
        <span className="bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-2.5 py-0.5 rounded-full text-xs font-bold">
          Zahlung
        </span>
      );
    }
    if (action === "LOGIN") {
      return (
        <span className="bg-blue-500/20 text-blue-300 border border-blue-500/30 px-2.5 py-0.5 rounded-full text-xs font-bold">
          Login
        </span>
      );
    }
    if (action === "FAILED_LOGIN") {
      return (
        <span className="bg-red-600/30 text-red-300 border border-red-500/50 px-2.5 py-0.5 rounded-full text-xs font-bold">
          Fehlversuch
        </span>
      );
    }
    if (action.includes("RKSV")) {
      return (
        <span className="bg-purple-500/20 text-purple-300 border border-purple-500/30 px-2.5 py-0.5 rounded-full text-xs font-bold">
          RKSV-Erklärung
        </span>
      );
    }
    if (action.includes("BACKUP")) {
      return (
        <span className="bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 px-2.5 py-0.5 rounded-full text-xs font-bold">
          Datensicherung
        </span>
      );
    }
    return (
      <span className="bg-slate-800 text-slate-300 px-2.5 py-0.5 rounded-full text-xs font-medium">
        {action}
      </span>
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold">Administration & Stammdaten</h1>
          <p className="text-slate-400 text-sm mt-1">
            Veranstaltungssteuerung, Systemstatus, Druck-Routing, Backups &
            Audit-Log
          </p>
        </div>
        {activeTab !== "backups" &&
          activeTab !== "audit" &&
          activeTab !== "diagnostics" &&
          activeTab !== "maintenance" && (
            <button
              onClick={() => handleOpenModal()}
              className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2.5 px-5 rounded-2xl flex items-center gap-2 shadow-lg shadow-indigo-600/30 transition-all active:scale-95 shrink-0"
            >
              <Plus className="w-5 h-5" />
              Neu anlegen
            </button>
          )}
      </div>

      {/* Tabs */}
      <div className="flex gap-2 overflow-x-auto pb-2 border-b border-slate-800 scrollbar-hide">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as Tab)}
              className={`flex items-center gap-2.5 px-4 py-2.5 rounded-2xl font-bold text-sm transition-all whitespace-nowrap ${
                isActive
                  ? "bg-indigo-600 text-white shadow-lg shadow-indigo-600/30"
                  : "bg-slate-850 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
              }`}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
              {tab.id === "printers" && (
                <span
                  className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-bold ${
                    unresolvedJobs.length > 0
                      ? "bg-amber-500 text-slate-950"
                      : "bg-slate-800 text-slate-500"
                  }`}
                >
                  {unresolvedJobs.length > 0 && (
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-950 animate-pulse" />
                  )}
                  {unresolvedJobs.length}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Content Area */}
      <div className="glass p-6 rounded-3xl">
        {isLoading ? (
          <div className="text-center py-12 text-slate-400 animate-pulse">
            Lade Daten...
          </div>
        ) : activeTab === "diagnostics" ? (
          /* DIAGNOSTICS & SYSTEM STATUS */
          <div className="space-y-6">
            {/* Top Bar: Overall Health & Actions */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-slate-900/80 border border-slate-800 p-5 rounded-2xl">
              <div className="flex min-w-0 flex-col items-start gap-3 sm:flex-row sm:items-center">
                <div
                  className={`shrink-0 p-3 rounded-2xl border ${
                    diagnosticsData?.overallHealth === "GREEN"
                      ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
                      : diagnosticsData?.overallHealth === "YELLOW"
                        ? "bg-amber-500/20 text-amber-400 border-amber-500/30"
                        : "bg-rose-500/20 text-rose-400 border-rose-500/30"
                  }`}
                >
                  <Activity className="w-7 h-7" />
                </div>
                <div className="min-w-0 w-full">
                  <div className="flex min-w-0 flex-col items-start gap-2 sm:flex-row sm:items-center">
                    <h3 className="text-xl font-bold text-white">
                      Systemgesundheit:
                    </h3>
                    <span
                      className={`max-w-full px-3 py-1 rounded-full text-center text-xs font-extrabold uppercase tracking-wide border ${
                        diagnosticsData?.overallHealth === "GREEN"
                          ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
                          : diagnosticsData?.overallHealth === "YELLOW"
                            ? "bg-amber-500/20 text-amber-300 border-amber-500/30"
                            : "bg-rose-500/20 text-rose-300 border-rose-500/30"
                      }`}
                    >
                      {diagnosticsData?.overallHealth === "GREEN"
                        ? "● Bereit für Festbetrieb"
                        : diagnosticsData?.overallHealth === "YELLOW"
                          ? "▲ Handlung empfohlen"
                          : "✖ Systemstörung"}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-1 break-words">
                    Serverzeit:{" "}
                    {new Date(
                      diagnosticsData?.serverTime || Date.now(),
                    ).toLocaleString("de-AT")}{" "}
                    • Automatische Prüfung alle 10s
                  </p>
                </div>
              </div>

              <button
                onClick={() => fetchData()}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs rounded-xl transition flex items-center gap-2 border border-slate-700 self-stretch sm:self-auto justify-center"
              >
                <RefreshCw className="w-4 h-4" />
                Jetzt aktualisieren
              </button>
            </div>

            {/* Smart Health Recommendations */}
            {diagnosticsData?.recommendations &&
              diagnosticsData.recommendations.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                    Handlungsempfehlungen & Hinweise
                  </h4>
                  <div className="grid grid-cols-1 gap-2.5">
                    {diagnosticsData.recommendations.map(
                      (rec: any, idx: number) => (
                        <div
                          key={idx}
                          className={`p-4 rounded-2xl border flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 ${
                            rec.level === "SUCCESS"
                              ? "bg-emerald-950/30 border-emerald-800/40 text-emerald-300"
                              : rec.level === "WARNING"
                                ? "bg-amber-950/30 border-amber-800/40 text-amber-300"
                                : rec.level === "ERROR"
                                  ? "bg-rose-950/30 border-rose-800/40 text-rose-300"
                                  : "bg-indigo-950/30 border-indigo-800/40 text-indigo-300"
                          }`}
                        >
                          <div className="flex items-start gap-3">
                            {rec.level === "SUCCESS" ? (
                              <CheckCircle2 className="w-5 h-5 mt-0.5 shrink-0 text-emerald-400" />
                            ) : rec.level === "ERROR" ? (
                              <AlertOctagon className="w-5 h-5 mt-0.5 shrink-0 text-rose-400" />
                            ) : (
                              <AlertTriangle className="w-5 h-5 mt-0.5 shrink-0 text-amber-400" />
                            )}
                            <div>
                              <div className="font-bold text-sm text-slate-100">
                                {rec.title}
                              </div>
                              <div className="text-xs text-slate-300/90 mt-0.5">
                                {rec.message}
                              </div>
                            </div>
                          </div>

                          {rec.actionTab && (
                            <button
                              onClick={() => setActiveTab(rec.actionTab as Tab)}
                              className="px-3.5 py-1.5 rounded-xl bg-slate-900/80 hover:bg-slate-900 text-white text-xs font-bold transition flex items-center gap-1.5 border border-slate-700/80 shrink-0"
                            >
                              Öffnen <ArrowRight className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      ),
                    )}
                  </div>
                </div>
              )}

            {/* 4 Detail Grid Tiles */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
              {/* 1. Backend & Host */}
              <div className="bg-slate-900/70 border border-slate-800 p-5 rounded-2xl space-y-4">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 bg-blue-500/20 text-blue-400 rounded-xl">
                    <Cpu className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="font-bold text-slate-100">
                      Backend & Host-System
                    </h4>
                    <span className="text-xs text-slate-400">
                      Node.js Runtime & Speicherauslastung
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="bg-slate-800/50 p-3 rounded-xl">
                    <span className="text-slate-400 block mb-1">
                      Betriebsbereit seit (Uptime)
                    </span>
                    <span className="text-slate-200 font-bold font-mono">
                      {diagnosticsData
                        ? formatUptime(diagnosticsData.backend.uptimeSeconds)
                        : "-"}
                    </span>
                  </div>
                  <div className="bg-slate-800/50 p-3 rounded-xl">
                    <span className="text-slate-400 block mb-1">
                      Node & App Version
                    </span>
                    <span className="text-slate-200 font-bold font-mono">
                      {diagnosticsData?.backend.nodeVersion} (v
                      {diagnosticsData?.backend.appVersion})
                    </span>
                  </div>
                  <div className="bg-slate-800/50 p-3 rounded-xl">
                    <span className="text-slate-400 block mb-1">
                      RAM Belegung (RSS)
                    </span>
                    <span className="text-slate-200 font-bold font-mono">
                      {diagnosticsData?.backend.memory.rssMb} MB
                    </span>
                  </div>
                  <div className="bg-slate-800/50 p-3 rounded-xl">
                    <span className="text-slate-400 block mb-1">
                      Node.js Heap
                    </span>
                    <span className="text-slate-200 font-bold font-mono">
                      {diagnosticsData?.backend.memory.heapUsedMb} MB /{" "}
                      {diagnosticsData?.backend.memory.heapTotalMb} MB
                    </span>
                  </div>
                </div>
              </div>

              {/* 2. Database (PostgreSQL) */}
              <div className="bg-slate-900/70 border border-slate-800 p-5 rounded-2xl space-y-4">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 bg-emerald-500/20 text-emerald-400 rounded-xl">
                    <Database className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="font-bold text-slate-100">
                      PostgreSQL Datenbank
                    </h4>
                    <span className="text-xs text-slate-400">
                      Verbindungsstatus & Tabellenumfang
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="bg-slate-800/50 p-3 rounded-xl">
                    <span className="text-slate-400 block mb-1">
                      Status & Ping-Latenz
                    </span>
                    <span className="text-emerald-400 font-bold font-mono flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                      ONLINE ({diagnosticsData?.database.latencyMs} ms)
                    </span>
                  </div>
                  <div className="bg-slate-800/50 p-3 rounded-xl">
                    <span className="text-slate-400 block mb-1">
                      Bestellungen erfasst
                    </span>
                    <span className="text-slate-200 font-bold font-mono">
                      {diagnosticsData?.database.counts.orders || 0}
                    </span>
                  </div>
                  <div className="bg-slate-800/50 p-3 rounded-xl">
                    <span className="text-slate-400 block mb-1">
                      Produkte / Artikel
                    </span>
                    <span className="text-slate-200 font-bold font-mono">
                      {diagnosticsData?.database.counts.products || 0}
                    </span>
                  </div>
                  <div className="bg-slate-800/50 p-3 rounded-xl">
                    <span className="text-slate-400 block mb-1">
                      Mitarbeiter & Benutzer
                    </span>
                    <span className="text-slate-200 font-bold font-mono">
                      {diagnosticsData?.database.counts.users || 0}
                    </span>
                  </div>
                </div>
              </div>

              {/* 3. Printers & Queue */}
              <div className="bg-slate-900/70 border border-slate-800 p-5 rounded-2xl space-y-4">
                <div className="flex justify-between items-start">
                  <div className="flex items-center gap-3">
                    <div className="p-2.5 bg-indigo-500/20 text-indigo-400 rounded-xl">
                      <Printer className="w-5 h-5" />
                    </div>
                    <div>
                      <h4 className="font-bold text-slate-100">
                        Drucker & Warteschlange
                      </h4>
                      <span className="text-xs text-slate-400 block">
                        {diagnosticsData?.printers.active || 0} von{" "}
                        {diagnosticsData?.printers.total || 0} Druckern aktiv
                      </span>
                      <span className="text-[11px] text-slate-500 block">
                        Stand:{" "}
                        {diagnosticsLastFetchedAt
                          ? diagnosticsLastFetchedAt.toLocaleTimeString("de-AT")
                          : "–"}{" "}
                        Uhr
                      </span>
                    </div>
                  </div>

                  {diagnosticsData?.printers.queue.failed > 0 && (
                    <button
                      disabled={isRetryingJobs}
                      onClick={handleRetryFailedJobs}
                      className="px-3 py-1.5 bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold rounded-xl transition flex items-center gap-1.5 shrink-0"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      {isRetryingJobs
                        ? "Wiederhole..."
                        : "Fehlgeschlagene wiederholen"}
                    </button>
                  )}
                </div>

                {diagnosticsData?.printers.cupsHostReachable === false && (
                  <div
                    role="alert"
                    className="bg-rose-500/10 border border-rose-500/30 text-rose-300 rounded-xl px-4 py-3 text-sm flex gap-2 items-start"
                  >
                    <AlertOctagon className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>
                      CUPS-Dienst auf dem Host ist nicht erreichbar
                      (Portprüfung, Port 631). Angezeigte Werte sind der zuletzt
                      bekannte Stand
                      {diagnosticsData?.printers.cupsCheckedAt
                        ? `: ${new Date(
                            diagnosticsData.printers.cupsCheckedAt,
                          ).toLocaleTimeString("de-AT", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })} Uhr.`
                        : "."}
                    </span>
                  </div>
                )}

                {!isLoading && diagnosticsPollFailed && (
                  <div
                    role="alert"
                    className="bg-rose-500/10 border border-rose-500/30 text-rose-300 rounded-xl px-4 py-3 text-sm flex gap-2 items-start"
                  >
                    <RefreshCw className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>
                      Diagnosedaten konnten nicht aktualisiert werden. Letzter
                      erfolgreicher Abruf:{" "}
                      {diagnosticsLastFetchedAt
                        ? diagnosticsLastFetchedAt.toLocaleTimeString("de-AT")
                        : "unbekannt"}{" "}
                      Uhr.
                    </span>
                  </div>
                )}

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                  <div className="bg-slate-800/50 p-3 rounded-xl">
                    <span className="text-slate-400 block mb-1">
                      Wartend (Pending)
                    </span>
                    <span className="text-amber-300 font-bold font-mono">
                      {diagnosticsData?.printers.queue.pending || 0}
                    </span>
                  </div>
                  <div className="bg-slate-800/50 p-3 rounded-xl">
                    <span className="text-slate-400 block mb-1">Gedruckt</span>
                    <span className="text-emerald-400 font-bold font-mono">
                      {diagnosticsData?.printers.queue.printed || 0}
                    </span>
                  </div>
                  <div className="bg-slate-800/50 p-3 rounded-xl">
                    <span className="text-slate-400 block mb-1">
                      Fehlgeschlagen
                    </span>
                    <span
                      className={`font-bold font-mono ${diagnosticsData?.printers.queue.failed > 0 ? "text-rose-400 font-extrabold" : "text-slate-500"}`}
                    >
                      {diagnosticsData?.printers.queue.failed || 0}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveTab("printers")}
                    className="bg-slate-800/50 hover:bg-slate-800 p-3 rounded-xl text-left transition"
                  >
                    <span className="text-slate-400 block mb-1">Unklar</span>
                    <span className="text-indigo-300 font-bold font-mono">
                      {diagnosticsData?.printers.queue.unclear || 0}
                    </span>
                  </button>
                </div>

                {diagnosticsData?.printers.list &&
                  diagnosticsData.printers.list.length > 0 && (
                    <div className="border-t border-slate-800 pt-1">
                      {diagnosticsData.printers.list.map((printer: any) => {
                        const state = getPrinterDiagState(
                          printer,
                          printersById,
                        );
                        const StateIcon = state.Icon;
                        const showCupsBadge =
                          printer.type === "CUPS_IPP" &&
                          diagnosticsData?.printers.cupsHostReachable === false;
                        return (
                          <div
                            key={printer.id}
                            className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-3 py-2.5 border-b border-slate-800/60 last:border-b-0"
                          >
                            <div className="flex items-center gap-2 sm:w-40 shrink-0">
                              <StateIcon
                                className={`w-4 h-4 shrink-0 ${state.colorClass}`}
                              />
                              <span className="text-slate-200 font-bold text-xs truncate">
                                {printer.name}
                              </span>
                            </div>
                            <div
                              className={`flex-1 min-w-0 text-xs sm:max-w-sm md:max-w-md ${state.colorClass}`}
                            >
                              {state.text}
                            </div>
                            {showCupsBadge && (
                              <span
                                title="TCP-Portprüfung gegen Port 631 – kein Nachweis, dass der Druckdienst selbst funktioniert."
                                className="text-[11px] font-bold text-rose-400 sm:ml-auto shrink-0"
                              >
                                CUPS-Dienst: nicht erreichbar
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
              </div>

              {/* 4. Backup & Storage */}
              <div className="bg-slate-900/70 border border-slate-800 p-5 rounded-2xl space-y-4">
                <div className="flex justify-between items-start">
                  <div className="flex items-center gap-3">
                    <div className="p-2.5 bg-emerald-500/20 text-emerald-400 rounded-xl">
                      <HardDrive className="w-5 h-5" />
                    </div>
                    <div>
                      <h4 className="font-bold text-slate-100">
                        Datensicherung & Snapshots
                      </h4>
                      <span className="text-xs text-slate-400">
                        {diagnosticsData?.backup.totalBackups || 0} Sicherungen
                        vorhanden
                      </span>
                    </div>
                  </div>

                  <button
                    onClick={() => setActiveTab("backups")}
                    className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold rounded-xl transition flex items-center gap-1"
                  >
                    Backups <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="bg-slate-800/50 p-3 rounded-xl text-xs space-y-1">
                  {diagnosticsData?.backup.latestBackup ? (
                    <>
                      <div className="text-slate-400">Letztes Backup:</div>
                      <div className="text-slate-200 font-bold">
                        {new Date(
                          diagnosticsData.backup.latestBackup.createdAt,
                        ).toLocaleString("de-AT")}
                      </div>
                      <div className="font-mono text-slate-500 text-[11px]">
                        {diagnosticsData.backup.latestBackup.filename} (
                        {(
                          diagnosticsData.backup.latestBackup.sizeBytes / 1024
                        ).toFixed(1)}{" "}
                        kB)
                      </div>
                    </>
                  ) : (
                    <div className="text-amber-400 font-medium py-1">
                      Noch kein Backup vorhanden.
                    </div>
                  )}
                </div>

                {diagnosticsData?.backup.storage && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                    <div className="bg-slate-800/50 p-3 rounded-xl">
                      <div className="text-slate-400">Freier Speicher</div>
                      <div
                        className={`font-bold ${
                          diagnosticsData.backup.storage.creationAllowed
                            ? "text-emerald-400"
                            : "text-rose-400"
                        }`}
                      >
                        {formatStorageBytes(
                          diagnosticsData.backup.storage.freeBytes,
                        )}
                      </div>
                      <div className="text-slate-500 text-[11px]">
                        Rücklage:{" "}
                        {formatStorageBytes(
                          diagnosticsData.backup.storage.retention
                            ?.minFreeBytes,
                        )}
                      </div>
                    </div>
                    <div className="bg-slate-800/50 p-3 rounded-xl">
                      <div className="text-slate-400">Backup-Bestand</div>
                      <div className="text-slate-200 font-bold">
                        {formatStorageBytes(
                          diagnosticsData.backup.storage.backupBytes,
                        )}
                      </div>
                      <div className="text-slate-500 text-[11px]">
                        {diagnosticsData.backup.storage.backupCount} geprüfte
                        oder sichtbare Sicherungen
                      </div>
                    </div>
                    <div className="sm:col-span-2 bg-slate-800/50 p-3 rounded-xl text-slate-400">
                      Letzte Wiederherstellungsprüfung:{" "}
                      <span className="text-slate-200 font-medium">
                        {diagnosticsData.backup.storage.latestRestoredBackup
                          ? new Date(
                              diagnosticsData.backup.storage.latestRestoredBackup.createdAt,
                            ).toLocaleString("de-AT")
                          : "noch nicht durchgeführt"}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : activeTab === "events" ? (
          /* Events Lifecycle Cards */
          <div className="space-y-4">
            {data.map((evt: EventItem) => (
              <div
                key={evt.id}
                className="bg-slate-900/60 border border-slate-800/80 p-5 rounded-2xl flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 hover:border-slate-700 transition"
              >
                <div className="space-y-2">
                  <div className="flex items-center gap-3">
                    <h3 className="text-xl font-bold text-slate-100">
                      {evt.name}
                    </h3>
                    {getStatusBadge(evt.status, evt.rksvConfirmedAt)}
                  </div>
                  <div className="flex flex-wrap gap-4 text-xs text-slate-400">
                    {evt.organizer && <span>🏛️ {evt.organizer}</span>}
                    {evt.location && <span>📍 {evt.location}</span>}
                    {evt.startTime && (
                      <span>
                        📅 {new Date(evt.startTime).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                  {evt._count && (
                    <div className="flex gap-4 text-xs text-slate-500 pt-1">
                      <span>{evt._count.orders} Bestellungen</span>
                      <span>•</span>
                      <span>{evt._count.products} Artikel</span>
                      <span>•</span>
                      <span>{evt._count.stations} Stationen</span>
                      <span>•</span>
                      <span>{evt._count.areas} Bereiche</span>
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-2 lg:pt-0 w-full lg:w-auto justify-end">
                  {/* Status Actions */}
                  {evt.status !== "ACTIVE" && (
                    <button
                      onClick={() => handleOpenActivateModal(evt)}
                      className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition flex items-center gap-1.5 shadow-md shadow-emerald-600/30"
                    >
                      <Play className="w-3.5 h-3.5" />
                      Scharf schalten (Echtbetrieb)
                    </button>
                  )}

                  {evt.status !== "TEST_MODE" && evt.status !== "ACTIVE" && (
                    <button
                      onClick={() => handleSetTestMode(evt)}
                      className="px-3 py-2 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 text-xs font-bold transition flex items-center gap-1.5 border border-amber-500/30"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      Testmodus
                    </button>
                  )}

                  {evt.status === "ACTIVE" && (
                    <button
                      onClick={() => handlePauseEvent(evt)}
                      className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold transition flex items-center gap-1.5"
                    >
                      <Pause className="w-3.5 h-3.5" />
                      Pausieren
                    </button>
                  )}

                  {evt.status !== "COMPLETED" && evt.status !== "ARCHIVED" && (
                    <button
                      onClick={() => handleCompleteEvent(evt)}
                      className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold transition flex items-center gap-1.5"
                    >
                      <Square className="w-3.5 h-3.5" />
                      Abschließen
                    </button>
                  )}

                  <EventConfigurationActions
                    event={evt}
                    events={data as EventItem[]}
                    onDone={() => fetchData()}
                  />

                  <button
                    onClick={() => handleOpenModal(evt)}
                    className="p-2 bg-slate-800 hover:bg-slate-700 rounded-xl text-slate-300 transition-colors inline-flex"
                    title="Bearbeiten"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>

                  <button
                    onClick={() => handleDelete(evt.id)}
                    className="p-2 bg-rose-500/20 hover:bg-rose-500/40 rounded-xl text-rose-400 transition-colors inline-flex"
                    title="Löschen"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
            {data.length === 0 && (
              <div className="text-center py-12 text-slate-500">
                Noch keine Veranstaltungen angelegt.
              </div>
            )}
          </div>
        ) : activeTab === "printers" ? (
          /* Printers Table */
          <div className="space-y-6">
            {/* Unklare Druckaufträge (Konzept 64, Abschnitt 2.2) */}
            {unresolvedJobs.length === 0 ? (
              <div className="text-sm text-slate-500 flex items-center gap-2 py-2">
                <CheckCircle2 className="w-4 h-4" />
                Keine unklaren Druckaufträge.
              </div>
            ) : (
              <div className="bg-amber-500/5 border border-amber-500/30 rounded-2xl p-5 space-y-4">
                <div className="flex items-center gap-2 text-amber-300 font-bold">
                  <AlertTriangle className="w-5 h-5" />
                  Unklare Druckaufträge ({unresolvedJobs.length})
                </div>
                <p className="text-xs text-slate-400">
                  Diese Aufträge brauchen eine Entscheidung, bevor sie aus der
                  Warteschlange verschwinden. Bitte am Drucker nachsehen.
                </p>
                <div className="space-y-3">
                  {unresolvedJobs.map((job: any) => {
                    const feedback = justResolvedIds[job.id];
                    return (
                      <div
                        key={job.id}
                        className="bg-slate-900/70 border border-slate-800 rounded-xl p-4 space-y-3"
                      >
                        {feedback ? (
                          <div
                            role="status"
                            className={`text-sm font-bold rounded-xl px-3 py-2 border ${
                              feedback.tone === "ok"
                                ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
                                : feedback.tone === "reprint"
                                  ? "bg-indigo-500/15 text-indigo-300 border-indigo-500/30"
                                  : "bg-slate-800 text-slate-300 border-slate-700"
                            }`}
                          >
                            {feedback.text}
                          </div>
                        ) : (
                          <>
                            <div>
                              <div className="text-sm font-bold text-slate-100">
                                {describeJobType(job)} · Bestellung #
                                {job.content?.orderNumber ?? "?"} ·{" "}
                                {job.printerName}
                              </div>
                              <div className="text-xs text-slate-500 mt-0.5">
                                vor {formatMinutesAgoLong(job.unresolvedAt)} (
                                {formatClockTime(job.unresolvedAt)} Uhr)
                              </div>
                            </div>
                            <p className="text-sm text-slate-300 sm:max-w-prose">
                              {describeUnresolvedReason(job)}
                            </p>
                            <details className="text-xs text-slate-500">
                              <summary className="cursor-pointer select-none">
                                Details
                              </summary>
                              <div className="mt-1 space-y-0.5 font-mono">
                                <div>Versuche: {job.attemptCount ?? "–"}</div>
                                <div>Failover: {job.failoverCount ?? "–"}</div>
                                {job.cupsJobState && (
                                  <div>CUPS-Status: {job.cupsJobState}</div>
                                )}
                              </div>
                            </details>
                            <div className="flex flex-col sm:flex-row sm:items-center gap-2 pt-2 border-t border-slate-800">
                              <button
                                type="button"
                                onClick={() =>
                                  openResolveDialog(job, "CONFIRMED_PRINTED")
                                }
                                className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-100 text-sm font-bold border border-slate-700 flex items-center justify-center gap-2"
                              >
                                <CheckCircle2 className="w-4 h-4" />
                                Als gedruckt bestätigen
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  openResolveDialog(job, "REPRINTED")
                                }
                                className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-100 text-sm font-bold border border-slate-700 flex items-center justify-center gap-2"
                              >
                                <RotateCcw className="w-4 h-4" />
                                Erneut drucken
                              </button>
                              {canDiscardPrintJobs && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    openResolveDialog(job, "DISCARDED")
                                  }
                                  className="sm:ml-auto text-xs font-bold text-rose-400 hover:text-rose-300 underline underline-offset-2 self-start sm:self-auto pl-1 py-1"
                                >
                                  Verwerfen
                                </button>
                              )}
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="flex justify-between items-center text-sm text-slate-400 pb-2 border-b border-slate-800">
              <span>
                Konfigurierte Beleg- und Küchenbondrucker (ESC/POS & Konsole)
              </span>
              <span>
                Aktive Drucker: {data.filter((p: any) => p.isActive).length}
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {data.map((printer: any) => (
                <div
                  key={printer.id}
                  className="bg-slate-900/70 border border-slate-800 p-5 rounded-2xl space-y-3"
                >
                  <div className="flex justify-between items-start">
                    <div className="flex items-center gap-3">
                      <div className="p-2.5 bg-indigo-500/20 text-indigo-400 rounded-xl">
                        <Printer className="w-6 h-6" />
                      </div>
                      <div>
                        <h4 className="text-lg font-bold text-slate-100">
                          {printer.name}
                        </h4>
                        <span className="text-xs text-slate-400 font-mono block">
                          Typ: {printer.type}{" "}
                          {printer.ipAddress
                            ? `(${printer.ipAddress}:${printer.port || 9100})`
                            : ""}
                        </span>
                        <span className="text-xs text-slate-500 font-mono block">
                          {printer.paperWidth || 80} mm ·{" "}
                          {printer.codepage || "CP858"} · Schnitt:{" "}
                          {printer.cutMode || "PARTIAL"} · {printer.copies || 1}
                          x · {printer.timeoutMs || 5000} ms
                        </span>
                      </div>
                    </div>
                    <span
                      className={`text-xs px-2.5 py-1 rounded-full font-bold ${printer.isActive ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30" : "bg-slate-800 text-slate-500"}`}
                    >
                      {printer.isActive ? "Bereit" : "Inaktiv"}
                    </span>
                  </div>

                  {printerTests[printer.id] && (
                    <div
                      role="status"
                      className={`text-xs font-bold rounded-xl px-3 py-2 border ${
                        printerTests[printer.id].state === "ok"
                          ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
                          : printerTests[printer.id].state === "error"
                            ? "bg-rose-500/15 text-rose-300 border-rose-500/30"
                            : "bg-slate-800 text-slate-300 border-slate-700"
                      }`}
                    >
                      {printerTests[printer.id].message}
                    </div>
                  )}

                  <div className="pt-2 flex justify-between items-center border-t border-slate-800">
                    <button
                      onClick={() => handleTestPrint(printer.id)}
                      disabled={printerTests[printer.id]?.state === "running"}
                      className="px-3 py-1.5 rounded-xl bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 text-xs font-bold transition flex items-center gap-1.5 border border-indigo-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Printer className="w-3.5 h-3.5" />
                      {printerTests[printer.id]?.state === "running"
                        ? "Testbon läuft …"
                        : "Testbon drucken"}
                    </button>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleOpenModal(printer)}
                        className="p-2 bg-slate-800 hover:bg-slate-700 rounded-lg text-slate-300 transition-colors"
                        title="Bearbeiten"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
              {data.length === 0 && (
                <div className="col-span-2 text-center py-12 text-slate-500">
                  Keine Drucker konfiguriert.
                </div>
              )}
            </div>
          </div>
        ) : activeTab === "backups" ? (
          /* Backups & Data Protection */
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-slate-900/80 border border-slate-800 p-5 rounded-2xl">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-emerald-500/20 text-emerald-400 rounded-2xl border border-emerald-500/30">
                  <ShieldCheck className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white">
                    Automatische & Manuelle Datensicherung
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Stündliche PostgreSQL-Sicherung unabhängig vom
                    Veranstaltungsstatus. Custom-Dump und Manifest werden mit
                    SHA-256 und pg_restore geprüft.
                  </p>
                </div>
              </div>

              <button
                disabled={isBackingUp}
                onClick={handleCreateBackup}
                className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold text-sm rounded-xl shadow-lg shadow-emerald-600/30 transition flex items-center gap-2 shrink-0"
              >
                <HardDrive className="w-4 h-4" />
                {isBackingUp
                  ? "Sicherung läuft..."
                  : "Jetzt sichern (Manuelles Backup)"}
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="text-slate-400 border-b border-slate-700/50 text-xs uppercase font-semibold">
                    <th className="pb-3">Backup-Datei</th>
                    <th className="pb-3">Erstellt am</th>
                    <th className="pb-3">Größe</th>
                    <th className="pb-3">Umfang</th>
                    <th className="pb-3">Integrität (SHA256)</th>
                    <th className="pb-3 text-right">Aktionen</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700/50 text-sm">
                  {data.map((b: BackupItem) => (
                    <tr
                      key={b.filename}
                      className="hover:bg-slate-800/30 transition-colors"
                    >
                      <td className="py-4 font-mono font-medium text-indigo-300">
                        <div>{b.filename}</div>
                        <div className="mt-1 font-sans text-[11px] text-slate-500">
                          {b.format === "POSTGRES_CUSTOM"
                            ? "PostgreSQL Custom-Dump"
                            : b.format === "LEGACY_JSON"
                              ? "Altbestand (JSON)"
                              : "Beschädigt oder unvollständig"}
                          {b.trigger && b.trigger !== "LEGACY"
                            ? ` · ${b.trigger}`
                            : ""}
                        </div>
                      </td>
                      <td className="py-4 text-slate-300">
                        {new Date(b.createdAt).toLocaleString("de-AT")}
                      </td>
                      <td className="py-4 text-slate-400">
                        {(b.sizeBytes / 1024).toFixed(1)} kB
                      </td>
                      <td className="py-4 text-xs text-slate-400">
                        {b.counts ? (
                          <span>
                            {b.counts.Order || b.counts.orders || 0}{" "}
                            Bestellungen,{" "}
                            {b.counts.Product || b.counts.products || 0} Artikel
                          </span>
                        ) : (
                          "-"
                        )}
                      </td>
                      <td
                        className="py-4 font-mono text-xs text-slate-500"
                        title={b.checksumSha256}
                      >
                        <div>
                          {b.verification === "RESTORE_VERIFIED"
                            ? "Wiederherstellungsgeprüft"
                            : b.verification === "STRUCTURE_VERIFIED"
                              ? "Strukturgeprüft"
                              : b.verification === "LEGACY"
                                ? "Legacy-Prüfsumme"
                                : "Nicht verwendbar"}
                        </div>
                        {b.checksumSha256 && (
                          <div title={b.checksumSha256}>
                            {b.checksumSha256.slice(0, 12)}...
                          </div>
                        )}
                      </td>
                      <td className="py-4 text-right">
                        <div className="flex justify-end gap-2">
                          {(b.downloadFiles || []).map((downloadFile) => (
                            <button
                              key={downloadFile}
                              onClick={() => handleDownloadBackup(downloadFile)}
                              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 rounded-lg text-slate-300 transition text-xs font-bold flex items-center gap-1.5 border border-slate-700"
                              title={`${downloadFile} herunterladen`}
                            >
                              <Download className="w-3.5 h-3.5" />
                              {downloadFile.endsWith(".manifest.json")
                                ? "Manifest"
                                : downloadFile.endsWith(".dump")
                                  ? "Dump"
                                  : "Download"}
                            </button>
                          ))}
                          {b.restoreVerificationAvailable && (
                            <button
                              onClick={() => handleVerifyRestore(b.filename)}
                              disabled={verifyingBackup !== null}
                              className="px-3 py-1.5 bg-sky-500/20 hover:bg-sky-500/30 text-sky-300 rounded-lg transition text-xs font-bold flex items-center gap-1.5 border border-sky-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
                              title="Vollständig in einer isolierten Nebendatenbank prüfen; die Festdatenbank bleibt unverändert"
                            >
                              <ShieldCheck className="w-3.5 h-3.5" />
                              {verifyingBackup === b.filename
                                ? "Prüfung läuft …"
                                : "Wiederherstellung prüfen"}
                            </button>
                          )}
                          {b.restoreAvailable ? (
                            <button
                              onClick={() => handleRestoreBackup(b.filename)}
                              className="px-3 py-1.5 bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 rounded-lg transition text-xs font-bold flex items-center gap-1.5 border border-rose-500/30"
                              title="Nur im gesperrten Wartungsmodus wiederherstellen"
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                              Legacy wiederherstellen
                            </button>
                          ) : !b.restoreVerificationAvailable ? (
                            <span
                              className="max-w-52 text-left text-[11px] leading-snug text-slate-500"
                              title={b.restoreUnavailableReason || undefined}
                            >
                              {b.restoreVerificationUnavailableReason ||
                                b.restoreUnavailableReason ||
                                "Wiederherstellung nicht verfügbar"}
                            </span>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {data.length === 0 && (
                    <tr>
                      <td
                        colSpan={6}
                        className="text-center py-12 text-slate-500"
                      >
                        Noch keine Datensicherungen vorhanden. Erstelle jetzt
                        ein manuelles Backup.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ) : activeTab === "maintenance" ? (
          /* Wartungsmodus (Issue #67) - eigenständige Komponente, holt und
             ändert ihren Zustand selbst über GET/POST /maintenance/*, statt
             sich in den generischen Listen-Ladepfad (fetchData/data) dieser
             Datei einzuklinken, der für paginierte Ressourcenlisten gebaut
             ist. */
          <MaintenancePanel />
        ) : activeTab === "audit" ? (
          /* Audit-Log & Security */
          <div className="space-y-6">
            {/* KPI Summary Cards */}
            {auditStats && (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                <div className="bg-slate-900/80 border border-slate-800 p-4 rounded-2xl">
                  <span className="text-xs text-slate-400 font-medium">
                    Gesamt-Aktionen
                  </span>
                  <div className="text-2xl font-bold text-white mt-1">
                    {auditStats.totalCount}
                  </div>
                </div>
                <div className="bg-slate-900/80 border border-slate-800 p-4 rounded-2xl">
                  <span className="text-xs text-slate-400 font-medium">
                    Heute
                  </span>
                  <div className="text-2xl font-bold text-indigo-400 mt-1">
                    {auditStats.todayCount}
                  </div>
                </div>
                <div className="bg-slate-900/80 border border-slate-800 p-4 rounded-2xl">
                  <span className="text-xs text-slate-400 font-medium">
                    Stornierungen
                  </span>
                  <div className="text-2xl font-bold text-rose-400 mt-1">
                    {auditStats.cancellationsCount}
                  </div>
                </div>
                <div className="bg-slate-900/80 border border-slate-800 p-4 rounded-2xl">
                  <span className="text-xs text-slate-400 font-medium">
                    Preisänderungen
                  </span>
                  <div className="text-2xl font-bold text-amber-400 mt-1">
                    {auditStats.priceChangesCount}
                  </div>
                </div>
                <div className="bg-slate-900/80 border border-slate-800 p-4 rounded-2xl">
                  <span className="text-xs text-slate-400 font-medium">
                    Login-Fehlversuche
                  </span>
                  <div className="text-2xl font-bold text-red-500 mt-1">
                    {auditStats.failedLoginsCount}
                  </div>
                </div>
                <div className="bg-slate-900/80 border border-slate-800 p-4 rounded-2xl">
                  <span className="text-xs text-slate-400 font-medium">
                    RKSV-Bestätigungen
                  </span>
                  <div className="text-2xl font-bold text-purple-400 mt-1">
                    {auditStats.rksvConfirmationsCount}
                  </div>
                </div>
              </div>
            )}

            {/* Filter Bar & Export */}
            <div className="flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-3 bg-slate-900/80 border border-slate-800 p-4 rounded-2xl">
              <div className="flex flex-wrap items-center gap-3 flex-1">
                <div className="relative flex-1 min-w-[200px]">
                  <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={auditSearch}
                    onChange={(e) => setAuditSearch(e.target.value)}
                    placeholder="Benutzer, Aktion oder Detail durchsuchen..."
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl pl-9 pr-4 py-2 text-sm text-white placeholder-slate-500"
                  />
                </div>

                <select
                  value={auditFilterAction}
                  onChange={(e) => setAuditFilterAction(e.target.value)}
                  className="bg-slate-800 border border-slate-700 rounded-xl px-4 py-2 text-sm text-white font-medium"
                >
                  <option value="">Alle Aktionen</option>
                  <option value="LOGIN">Anmeldung (Login)</option>
                  <option value="FAILED_LOGIN">Fehlgeschlagene Logins</option>
                  <option value="CANCEL_ORDER">Bestellstorno</option>
                  <option value="CANCEL_ORDER_ITEM">Positionstorno</option>
                  <option value="PRICE_CHANGED">Preisänderung</option>
                  <option value="PAYMENT_RECEIVED">Zahlung</option>
                  <option value="ACTIVATE_EVENT_RKSV">RKSV-Bestätigung</option>
                  <option value="CREATE_BACKUP">Datensicherung</option>
                </select>
              </div>

              <button
                onClick={handleExportAuditCsv}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs rounded-xl shadow-md shadow-indigo-600/30 transition flex items-center gap-2 shrink-0 justify-center"
              >
                <FileSpreadsheet className="w-4 h-4" />
                Audit-Log als CSV exportieren
              </button>
            </div>

            {/* Audit Log Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="text-slate-400 border-b border-slate-700/50 text-xs uppercase font-semibold">
                    <th className="pb-3">Zeitpunkt</th>
                    <th className="pb-3">Aktion</th>
                    <th className="pb-3">Benutzer</th>
                    <th className="pb-3">Entität</th>
                    <th className="pb-3">Details & Begründung</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700/50 text-sm">
                  {data.map((log: AuditLogItem) => (
                    <tr
                      key={log.id}
                      className="hover:bg-slate-800/30 transition-colors"
                    >
                      <td className="py-3.5 whitespace-nowrap text-slate-300 font-mono text-xs">
                        {new Date(log.createdAt).toLocaleString("de-AT")}
                      </td>
                      <td className="py-3.5">{getActionBadge(log.action)}</td>
                      <td className="py-3.5 text-slate-200">
                        {log.user ? (
                          <div className="flex items-center gap-2">
                            <span className="font-semibold">
                              {log.user.username}
                            </span>
                            <span className="text-[10px] bg-slate-800 px-1.5 py-0.5 rounded text-slate-400">
                              {log.user.role}
                            </span>
                          </div>
                        ) : (
                          <span className="text-slate-500 italic">System</span>
                        )}
                      </td>
                      <td className="py-3.5 font-mono text-xs text-slate-400">
                        {log.entityType}
                      </td>
                      <td className="py-3.5 text-xs text-slate-300 font-mono max-w-md truncate">
                        {log.details ? (
                          <span title={JSON.stringify(log.details, null, 2)}>
                            {log.details.reason ? (
                              <span className="text-rose-300 font-semibold mr-2">
                                Grund: „{log.details.reason}“
                              </span>
                            ) : null}
                            {log.details.previousPrice ? (
                              <span className="text-amber-300 font-semibold mr-2">
                                € {(log.details.previousPrice / 100).toFixed(2)}{" "}
                                ➔ € {(log.details.newPrice / 100).toFixed(2)}
                              </span>
                            ) : null}
                            {JSON.stringify(log.details)}
                          </span>
                        ) : (
                          "-"
                        )}
                      </td>
                    </tr>
                  ))}
                  {data.length === 0 && (
                    <tr>
                      <td
                        colSpan={5}
                        className="text-center py-12 text-slate-500"
                      >
                        Keine Audit-Einträge für die gewählten Filter gefunden.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          /* Standard Tables (Areas, Stations, Categories, etc.) */
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="text-slate-400 border-b border-slate-700/50">
                  <th className="pb-3 font-medium">Name</th>
                  <th className="pb-3 font-medium">Status / Info</th>
                  <th className="pb-3 font-medium text-right">Aktionen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/50">
                {data.map((item: any) => (
                  <tr
                    key={item.id}
                    className="hover:bg-slate-800/30 transition-colors"
                  >
                    <td className="py-4 font-semibold">
                      <div>{item.name || item.username}</div>
                      {item.printer && (
                        <span className="text-xs text-indigo-400 font-normal flex items-center gap-1 mt-0.5">
                          🖨️ Drucker: {item.printer.name}
                        </span>
                      )}
                    </td>
                    <td className="py-4 text-sm text-slate-400">
                      {item.role && (
                        <span className="bg-indigo-500/20 text-indigo-300 px-2 py-1 rounded-md mr-2">
                          {item.role}
                        </span>
                      )}
                      {item.status && (
                        <span className="bg-slate-800 px-2 py-1 rounded-md">
                          {item.status}
                        </span>
                      )}
                      {item.isActive !== undefined && (
                        <span
                          className={
                            item.isActive
                              ? "text-emerald-400"
                              : "text-slate-500"
                          }
                        >
                          {item.isActive ? "Aktiv" : "Inaktiv"}
                        </span>
                      )}
                      {item.price !== undefined &&
                        `€ ${(item.price / 100).toFixed(2)}`}
                      {item.sortOrder !== undefined &&
                        `Sortierung: ${item.sortOrder}`}
                    </td>
                    <td className="py-4 text-right">
                      <button
                        onClick={() => handleOpenModal(item)}
                        className="p-2 bg-slate-800 hover:bg-slate-700 rounded-lg text-slate-300 transition-colors inline-flex mr-2"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(item.id)}
                        className="p-2 bg-rose-500/20 hover:bg-rose-500/40 rounded-lg text-rose-400 transition-colors inline-flex"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
                {data.length === 0 && (
                  <tr>
                    <td colSpan={3} className="text-center py-8 text-slate-500">
                      Keine Einträge vorhanden.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* RKSV DISCLAIMER & ACTIVATION MODAL */}
      {rksvModalOpen && rksvTargetEvent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
          <div className="bg-slate-900 border border-slate-700 p-6 sm:p-8 rounded-3xl max-w-xl w-full shadow-2xl space-y-6 animate-scale-up">
            <div className="flex items-start gap-4">
              <div className="p-3 bg-amber-500/20 text-amber-400 rounded-2xl border border-amber-500/30 shrink-0">
                <ShieldAlert className="w-8 h-8" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-white">
                  Rechtlicher Hinweis: RKSV-Konformität
                </h3>
                <p className="text-sm text-slate-400 mt-1">
                  Veranstaltung:{" "}
                  <span className="text-slate-200 font-semibold">
                    {rksvTargetEvent.name}
                  </span>
                </p>
              </div>
            </div>

            <div className="bg-slate-950/80 border border-slate-800 p-4 rounded-2xl text-xs sm:text-sm text-slate-300 space-y-3 leading-relaxed">
              <div className="font-semibold text-amber-300 flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>Wichtige rechtliche Erklärung vor dem Echtbetrieb:</span>
              </div>
              <p className="border-l-2 border-amber-500/50 pl-3 py-1 font-medium text-slate-200">
                „VereinOrder ist <strong>keine RKSV-Registrierkasse</strong> im
                Sinne der österreichischen
                Registrierkassensicherheitsverordnung. Der Veranstalter ist
                selbst dafür verantwortlich zu prüfen, ob für diese
                Veranstaltung gesetzliche Einzelaufzeichnungs-, Belegerteilungs-
                oder Registrierkassenpflichten bestehen.“
              </p>
              <div className="text-slate-400 text-[11px] pt-1">
                Dieser Vorgang wird revisionssicher mit Zeitstempel, Benutzer-ID
                und Versionsnummer im Audit-Log archiviert.
              </div>
            </div>

            <label className="flex items-start gap-3 p-3 bg-slate-800/40 hover:bg-slate-800/70 rounded-2xl border border-slate-700/50 cursor-pointer transition">
              <input
                type="checkbox"
                checked={rksvConfirmed}
                onChange={(e) => setRksvConfirmed(e.target.checked)}
                className="w-5 h-5 mt-0.5 rounded border-slate-600 text-indigo-600 focus:ring-indigo-500"
              />
              <span className="text-xs sm:text-sm text-slate-200 font-medium select-none">
                Ich habe diesen Hinweis zur Kenntnis genommen und bestätige,
                dass VereinOrder für diese Veranstaltung unter
                Eigenverantwortung des Veranstalters eingesetzt wird.
              </span>
            </label>

            <div className="flex gap-3 justify-end pt-2">
              <button
                type="button"
                onClick={() => setRksvModalOpen(false)}
                className="px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-sm transition"
              >
                Abbrechen
              </button>
              <button
                type="button"
                disabled={!rksvConfirmed || isActivating}
                onClick={handleConfirmActivation}
                className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-sm shadow-lg shadow-emerald-600/30 transition flex items-center gap-2"
              >
                {isActivating
                  ? "Aktivierung läuft..."
                  : "Bestätigen & Scharf schalten"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PRINTER MODAL */}
      {isPrinterModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 p-6 rounded-3xl max-w-md w-full shadow-2xl space-y-4">
            <h3 className="text-xl font-bold text-white">
              {editingPrinter ? "Drucker bearbeiten" : "Neuen Drucker anlegen"}
            </h3>
            {modalError && (
              <p
                role="alert"
                className="text-sm font-bold text-rose-300 bg-rose-500/15 border border-rose-500/30 rounded-xl px-3 py-2"
              >
                {modalError}
              </p>
            )}
            <form onSubmit={handleSaveModal} className="space-y-4">
              <div>
                <label className="text-xs font-bold text-slate-400 block mb-1">
                  Druckername
                </label>
                <input
                  type="text"
                  required
                  value={printerFormData.name}
                  onChange={(e) =>
                    setPrinterFormData({
                      ...printerFormData,
                      name: e.target.value,
                    })
                  }
                  placeholder="z. B. Küchen-Bon-Drucker 1"
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-white"
                />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-400 block mb-1">
                  Druckertyp
                </label>
                <select
                  value={printerFormData.type}
                  onChange={(e) => {
                    const nextType = e.target.value;
                    setPrinterFormData((prev) => ({
                      ...prev,
                      type: nextType,
                      // Port-Vorgabe je Typ (Konzept 64: 631 für CUPS_IPP).
                      // Ein bereits bewusst gesetzter Port wird nicht
                      // überschrieben, nur der jeweilige Vorgabewert.
                      port:
                        nextType === "CUPS_IPP"
                          ? 631
                          : nextType === "ESC_POS_NETWORK" && prev.port === 631
                            ? 9100
                            : prev.port,
                    }));
                  }}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-white"
                >
                  <option value="CONSOLE">
                    Simulator / Konsole (Test und Entwicklung)
                  </option>
                  <option value="ESC_POS_NETWORK">
                    ESC/POS-Netzwerkdrucker (LAN / WLAN)
                  </option>
                  <option value="CUPS_IPP">CUPS-Warteschlange (IPP)</option>
                </select>
                <p className="text-xs text-slate-500 mt-1">
                  USB- und Treiberdrucker werden nicht unterstützt.
                </p>
              </div>
              {printerFormData.type === "ESC_POS_NETWORK" && (
                <div className="grid grid-cols-3 gap-2">
                  <div className="col-span-2">
                    <label className="text-xs font-bold text-slate-400 block mb-1">
                      IP-Adresse
                    </label>
                    <input
                      type="text"
                      value={printerFormData.ipAddress}
                      onChange={(e) =>
                        setPrinterFormData({
                          ...printerFormData,
                          ipAddress: e.target.value,
                        })
                      }
                      placeholder="192.168.1.100"
                      className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-white"
                    />
                  </div>
                  <div>
                    <label
                      className="text-xs font-bold text-slate-400 block mb-1"
                      htmlFor="printer-port"
                    >
                      Port
                    </label>
                    <input
                      id="printer-port"
                      type="number"
                      value={printerFormData.port}
                      onChange={(e) =>
                        setPrinterFormData({
                          ...printerFormData,
                          port: Number(e.target.value),
                        })
                      }
                      className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-white"
                    />
                  </div>
                </div>
              )}
              {printerFormData.type === "CUPS_IPP" && (
                <>
                  <div className="grid grid-cols-3 gap-2">
                    <div className="col-span-2">
                      <label
                        className="text-xs font-bold text-slate-400 block mb-1"
                        htmlFor="printer-cups-host"
                      >
                        CUPS-Host (optional)
                      </label>
                      <input
                        id="printer-cups-host"
                        type="text"
                        value={printerFormData.ipAddress}
                        onChange={(e) =>
                          setPrinterFormData({
                            ...printerFormData,
                            ipAddress: e.target.value,
                          })
                        }
                        placeholder="cups.verein.local (leer = Standardhost)"
                        className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-white"
                      />
                    </div>
                    <div>
                      <label
                        className="text-xs font-bold text-slate-400 block mb-1"
                        htmlFor="printer-cups-port"
                      >
                        Port
                      </label>
                      <input
                        id="printer-cups-port"
                        type="number"
                        value={printerFormData.port}
                        onChange={(e) =>
                          setPrinterFormData({
                            ...printerFormData,
                            port: Number(e.target.value),
                          })
                        }
                        className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-white"
                      />
                    </div>
                  </div>
                  <div>
                    <label
                      className="text-xs font-bold text-slate-400 block mb-1"
                      htmlFor="printer-queue-name"
                    >
                      Warteschlangenname (Pflichtfeld)
                    </label>
                    <input
                      id="printer-queue-name"
                      type="text"
                      required
                      value={printerFormData.queueName}
                      onChange={(e) =>
                        setPrinterFormData({
                          ...printerFormData,
                          queueName: e.target.value,
                        })
                      }
                      placeholder="z. B. theke1-raw"
                      className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-white"
                    />
                    <p className="text-xs text-slate-500 mt-1">
                      Muss eine Raw-Warteschlange sein; der Worker liefert
                      fertige ESC/POS-Bytes.
                    </p>
                  </div>
                </>
              )}

              <div>
                <label
                  className="text-xs font-bold text-slate-400 block mb-1"
                  htmlFor="printer-fallback"
                >
                  Ersatzdrucker bei Ausfall (optional)
                </label>
                <select
                  id="printer-fallback"
                  value={printerFormData.fallbackPrinterId}
                  onChange={(e) =>
                    setPrinterFormData({
                      ...printerFormData,
                      fallbackPrinterId: e.target.value,
                    })
                  }
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-white"
                >
                  <option value="">– Kein Ersatzdrucker –</option>
                  {printersList
                    .filter(
                      (p: any) => p.isActive && p.id !== editingPrinter?.id,
                    )
                    .map((p: any) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                </select>
                <p className="text-xs text-slate-500 mt-1">
                  Übernimmt Aufträge automatisch, wenn dieser Drucker Fehler
                  meldet.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label
                    className="text-xs font-bold text-slate-400 block mb-1"
                    htmlFor="printer-paper-width"
                  >
                    Papierbreite
                  </label>
                  <select
                    id="printer-paper-width"
                    value={printerFormData.paperWidth}
                    onChange={(e) =>
                      setPrinterFormData({
                        ...printerFormData,
                        paperWidth: Number(e.target.value),
                      })
                    }
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-white"
                  >
                    <option value={58}>58 mm (32 Zeichen)</option>
                    <option value={80}>80 mm (48 Zeichen)</option>
                  </select>
                </div>
                <div>
                  <label
                    className="text-xs font-bold text-slate-400 block mb-1"
                    htmlFor="printer-codepage"
                  >
                    Zeichensatz
                  </label>
                  <select
                    id="printer-codepage"
                    value={printerFormData.codepage}
                    onChange={(e) =>
                      setPrinterFormData({
                        ...printerFormData,
                        codepage: e.target.value,
                      })
                    }
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-white"
                  >
                    <option value="CP858">CP858 (Umlaute und Euro)</option>
                    <option value="CP850">CP850 (Umlaute)</option>
                    <option value="CP437">CP437 (ältere Geräte)</option>
                  </select>
                </div>
                <div>
                  <label
                    className="text-xs font-bold text-slate-400 block mb-1"
                    htmlFor="printer-cut-mode"
                  >
                    Schnitt
                  </label>
                  <select
                    id="printer-cut-mode"
                    value={printerFormData.cutMode}
                    onChange={(e) =>
                      setPrinterFormData({
                        ...printerFormData,
                        cutMode: e.target.value,
                      })
                    }
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-white"
                  >
                    <option value="PARTIAL">Teilschnitt</option>
                    <option value="FULL">Vollschnitt</option>
                    <option value="NONE">Kein Schnitt</option>
                  </select>
                </div>
                <div>
                  <label
                    className="text-xs font-bold text-slate-400 block mb-1"
                    htmlFor="printer-copies"
                  >
                    Ausfertigungen
                  </label>
                  <input
                    id="printer-copies"
                    type="number"
                    min={1}
                    max={9}
                    value={printerFormData.copies}
                    onChange={(e) =>
                      setPrinterFormData({
                        ...printerFormData,
                        copies: Number(e.target.value),
                      })
                    }
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-white"
                  />
                </div>
                {printerFormData.type === "ESC_POS_NETWORK" && (
                  <div className="col-span-2">
                    <label
                      className="text-xs font-bold text-slate-400 block mb-1"
                      htmlFor="printer-timeout"
                    >
                      Zeitlimit in Millisekunden
                    </label>
                    <input
                      id="printer-timeout"
                      type="number"
                      min={250}
                      max={120000}
                      step={250}
                      value={printerFormData.timeoutMs}
                      onChange={(e) =>
                        setPrinterFormData({
                          ...printerFormData,
                          timeoutMs: Number(e.target.value),
                        })
                      }
                      className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-white"
                    />
                  </div>
                )}
              </div>
              <div className="flex gap-2 justify-end pt-2">
                <button
                  type="button"
                  onClick={() => setIsPrinterModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold"
                >
                  Abbrechen
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold"
                >
                  Speichern
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* RESOLVE MODAL (Konzept 64, Abschnitt 2.5) */}
      {resolveDialog && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
          onKeyDown={(e) => {
            if (e.key === "Escape" && !isResolving) {
              e.preventDefault();
              closeResolveDialog();
            }
          }}
        >
          <div className="bg-slate-900 border border-slate-800 p-6 rounded-3xl max-w-md w-full shadow-2xl space-y-4">
            <h3 className="text-xl font-bold text-white">
              {resolveDialog.action === "REPRINTED"
                ? "Erneut drucken"
                : resolveDialog.action === "CONFIRMED_PRINTED"
                  ? "Als gedruckt bestätigen"
                  : "Druckauftrag verwerfen"}
            </h3>

            <div className="text-sm text-slate-300">
              {describeJobType(resolveDialog.job)} · Bestellung #
              {resolveDialog.job.content?.orderNumber ?? "?"} ·{" "}
              {resolveDialog.action === "REPRINTED"
                ? `zuletzt: ${resolveDialog.job.printerName}`
                : resolveDialog.job.printerName}
            </div>

            {resolveDialog.action !== "DISCARDED" && (
              <p className="text-sm text-slate-400 sm:max-w-prose">
                {describeUnresolvedReason(resolveDialog.job)}
              </p>
            )}

            {resolveDialog.action === "DISCARDED" && (
              <p className="text-sm text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-xl px-3 py-2">
                Dieser Auftrag wird endgültig nicht mehr gedruckt und nicht als
                gedruckt gebucht. Das kann nicht rückgängig gemacht werden.
              </p>
            )}

            {resolveError && (
              <p
                role="alert"
                className="text-sm font-bold text-rose-300 bg-rose-500/15 border border-rose-500/30 rounded-xl px-3 py-2"
              >
                {resolveError}
              </p>
            )}

            {resolveDialog.action === "REPRINTED" && (
              <div>
                <label
                  className="text-xs font-bold text-slate-400 block mb-1"
                  htmlFor="resolve-target-printer"
                >
                  Zieldrucker
                </label>
                <select
                  id="resolve-target-printer"
                  value={resolveTargetPrinterId}
                  onChange={(e) => setResolveTargetPrinterId(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-white"
                >
                  <option value="">– Zieldrucker wählen –</option>
                  {printersList
                    .filter((p: any) => p.isActive)
                    .map((p: any) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                </select>
              </div>
            )}

            {(resolveDialog.action === "REPRINTED" ||
              resolveDialog.action === "CONFIRMED_PRINTED") && (
              <label className="flex items-start gap-2.5 text-sm text-slate-300">
                <input
                  type="checkbox"
                  checked={resolveChecked}
                  onChange={(e) => setResolveChecked(e.target.checked)}
                  className="mt-1"
                />
                <span>
                  {resolveDialog.action === "REPRINTED"
                    ? "Ich habe am Drucker nachgesehen: dort liegt kein vollständiger Bon."
                    : "Ich habe am Drucker nachgesehen: der vollständige Bon liegt dort vor."}
                </span>
              </label>
            )}

            {resolveDialog.action === "REPRINTED" && (
              <div>
                <label
                  className="text-xs font-bold text-slate-400 block mb-1"
                  htmlFor="resolve-comment"
                >
                  Anmerkung (optional)
                </label>
                <input
                  id="resolve-comment"
                  type="text"
                  value={resolveComment}
                  onChange={(e) => setResolveComment(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-white"
                />
              </div>
            )}

            {resolveDialog.action === "DISCARDED" && (
              <div>
                <label
                  className="text-xs font-bold text-slate-400 block mb-1"
                  htmlFor="resolve-discard-comment"
                >
                  Begründung (Pflichtfeld)
                </label>
                <input
                  id="resolve-discard-comment"
                  type="text"
                  value={resolveComment}
                  onChange={(e) => setResolveComment(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-white"
                />
              </div>
            )}

            <div className="flex gap-2 justify-end pt-2">
              <button
                type="button"
                onClick={closeResolveDialog}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold"
              >
                Abbrechen
              </button>
              <button
                type="button"
                disabled={!canConfirmResolve || isResolving}
                onClick={handleResolveSubmit}
                className={`px-5 py-2 rounded-xl font-bold text-white disabled:opacity-40 disabled:cursor-not-allowed ${
                  resolveDialog.action === "DISCARDED"
                    ? "bg-rose-600 hover:bg-rose-500"
                    : "bg-indigo-600 hover:bg-indigo-500"
                }`}
              >
                {isResolving
                  ? "Wird gespeichert …"
                  : resolveDialog.action === "REPRINTED"
                    ? "Erneut drucken"
                    : resolveDialog.action === "CONFIRMED_PRINTED"
                      ? "Als gedruckt bestätigen"
                      : "Verwerfen"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* EVENT MODAL */}
      {isEventModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 p-6 rounded-3xl max-w-lg w-full shadow-2xl space-y-4">
            <h3 className="text-xl font-bold text-white">
              {editingEvent
                ? "Veranstaltung bearbeiten"
                : "Neue Veranstaltung anlegen"}
            </h3>
            <form onSubmit={handleSaveModal} className="space-y-4">
              <div>
                <label className="text-xs font-bold text-slate-400 block mb-1">
                  Name der Veranstaltung
                </label>
                <input
                  type="text"
                  required
                  value={eventFormData.name}
                  onChange={(e) =>
                    setEventFormData({ ...eventFormData, name: e.target.value })
                  }
                  placeholder="z. B. Feuerwehrfest 2026"
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-white"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-400 block mb-1">
                    Veranstalter
                  </label>
                  <input
                    type="text"
                    value={eventFormData.organizer}
                    onChange={(e) =>
                      setEventFormData({
                        ...eventFormData,
                        organizer: e.target.value,
                      })
                    }
                    placeholder="Freiwillige Feuerwehr"
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-white"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-400 block mb-1">
                    Ort
                  </label>
                  <input
                    type="text"
                    value={eventFormData.location}
                    onChange={(e) =>
                      setEventFormData({
                        ...eventFormData,
                        location: e.target.value,
                      })
                    }
                    placeholder="Festzelt Sportplatz"
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-white"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-400 block mb-1">
                    Startzeit
                  </label>
                  <input
                    type="datetime-local"
                    value={eventFormData.startTime}
                    onChange={(e) =>
                      setEventFormData({
                        ...eventFormData,
                        startTime: e.target.value,
                      })
                    }
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-white text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-400 block mb-1">
                    Endzeit
                  </label>
                  <input
                    type="datetime-local"
                    value={eventFormData.endTime}
                    onChange={(e) =>
                      setEventFormData({
                        ...eventFormData,
                        endTime: e.target.value,
                      })
                    }
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-white text-sm"
                  />
                </div>
              </div>
              <div className="flex gap-2 justify-end pt-2">
                <button
                  type="button"
                  onClick={() => setIsEventModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold"
                >
                  Abbrechen
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold"
                >
                  Speichern
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* PRODUCT MODAL */}
      {isProductModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="product-modal-title"
            onKeyDown={(e) => handleModalEscape(e, closeProductModal)}
            // Breiter als die uebrigen Modale: Seit Issue #75 werden hier auch
            // Auswahlgruppen gepflegt. Deren Antwortzeilen tragen Bezeichnung,
            // Vorzeichen, Euro, Cent, zwei Sortierpfeile und "Entfernen"; bei
            // max-w-lg bricht jede Zeile mehrfach um. Handy und Tablet bleiben
            // unveraendert, dort ist die Breite ohnehin vom Bildschirm begrenzt.
            className="bg-slate-900 border border-slate-800 p-6 rounded-3xl max-w-lg md:max-w-2xl lg:max-w-4xl w-full max-h-[calc(100vh-2rem)] overflow-y-auto shadow-2xl space-y-4"
          >
            <h3
              id="product-modal-title"
              className="text-xl font-bold text-white"
            >
              {editingProduct ? "Produkt bearbeiten" : "Neues Produkt anlegen"}
            </h3>
            <form onSubmit={handleSaveProductModal} className="space-y-4">
              {modalError && (
                <p
                  role="alert"
                  className="rounded-xl border border-rose-500/50 bg-rose-500/10 px-3 py-2 text-sm text-rose-200"
                >
                  {modalError}
                </p>
              )}
              <div>
                <label
                  htmlFor="product-name"
                  className="text-xs font-bold text-slate-400 block mb-1"
                >
                  Produktname
                </label>
                <input
                  id="product-name"
                  type="text"
                  required
                  autoFocus
                  value={productFormData.name}
                  onChange={(e) =>
                    setProductFormData({
                      ...productFormData,
                      name: e.target.value,
                    })
                  }
                  className="w-full min-h-11 bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-white"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="product-euro"
                    className="text-xs font-bold text-slate-400 block mb-1"
                  >
                    Preis in Euro
                  </label>
                  <input
                    id="product-euro"
                    type="number"
                    min="0"
                    step="1"
                    inputMode="numeric"
                    required
                    value={productFormData.euro}
                    onChange={(e) =>
                      setProductFormData({
                        ...productFormData,
                        euro: e.target.value,
                      })
                    }
                    className="w-full min-h-11 bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-white"
                  />
                </div>
                <div>
                  <label
                    htmlFor="product-cent"
                    className="text-xs font-bold text-slate-400 block mb-1"
                  >
                    Preis in Cent
                  </label>
                  <input
                    id="product-cent"
                    type="number"
                    min="0"
                    max="99"
                    step="1"
                    inputMode="numeric"
                    required
                    value={productFormData.cent}
                    onChange={(e) =>
                      setProductFormData({
                        ...productFormData,
                        cent: e.target.value,
                      })
                    }
                    className="w-full min-h-11 bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-white"
                  />
                </div>
              </div>
              <div>
                <label
                  htmlFor="product-category"
                  className="text-xs font-bold text-slate-400 block mb-1"
                >
                  Kategorie (Pflichtfeld)
                </label>
                <select
                  id="product-category"
                  required
                  aria-required="true"
                  value={productFormData.categoryId}
                  onChange={(e) =>
                    setProductFormData({
                      ...productFormData,
                      categoryId: e.target.value,
                    })
                  }
                  className="w-full min-h-11 bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-white"
                >
                  <option value="" disabled>
                    Bitte Kategorie wählen …
                  </option>
                  {productCategories.map((category: any) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label
                  htmlFor="product-station"
                  className="text-xs font-bold text-slate-400 block mb-1"
                >
                  Ausnahme-Zielstation (abweichend von der Kategorie)
                </label>
                <select
                  id="product-station"
                  value={productFormData.targetStationId}
                  onChange={(e) =>
                    setProductFormData({
                      ...productFormData,
                      targetStationId: e.target.value,
                    })
                  }
                  className="w-full min-h-11 bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-white"
                >
                  <option value="">Keine Ausnahme</option>
                  {productStations.map((station: any) => (
                    <option key={station.id} value={station.id}>
                      {station.name}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-slate-500 mt-1">
                  {inheritedStationLabel
                    ? `Ohne eigene Auswahl gilt die Station der Kategorie: ${inheritedStationLabel}.`
                    : "Bitte zuerst eine Kategorie wählen, um die geltende Station zu sehen."}
                </p>
              </div>
              <div>
                <label
                  htmlFor="product-sort-order"
                  className="text-xs font-bold text-slate-400 block mb-1"
                >
                  Sortierung
                </label>
                <input
                  id="product-sort-order"
                  type="number"
                  step="1"
                  required
                  value={productFormData.sortOrder}
                  onChange={(e) =>
                    setProductFormData({
                      ...productFormData,
                      sortOrder: e.target.value,
                    })
                  }
                  className="w-full min-h-11 bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-white"
                />
              </div>

              <div className="space-y-3 border-t border-slate-800 pt-4">
                <h4 className="text-sm font-bold text-white">Auswahlgruppen</h4>
                <ProductOptionGroupsEditor
                  groups={optionGroups}
                  onChange={setOptionGroups}
                  disabled={isSavingModal}
                  validationAttempted={optionGroupsValidationAttempted}
                />
              </div>

              <div className="flex gap-2 justify-end pt-2">
                <button
                  type="button"
                  onClick={closeProductModal}
                  className="min-h-11 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold"
                >
                  Abbrechen
                </button>
                <button
                  type="submit"
                  disabled={isSavingModal}
                  className="min-h-11 px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60 text-white font-bold"
                >
                  {isSavingModal ? "Speichert …" : "Speichern"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* GENERIC ITEM MODAL (Areas, Stations, etc.) */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="item-modal-title"
            onKeyDown={(e) => handleModalEscape(e, () => setIsModalOpen(false))}
            className="bg-slate-900 border border-slate-800 p-6 rounded-3xl max-w-md w-full max-h-[calc(100vh-2rem)] overflow-y-auto shadow-2xl space-y-4"
          >
            <h3 id="item-modal-title" className="text-xl font-bold text-white">
              {editingItem ? "Eintrag bearbeiten" : "Neu anlegen"}
            </h3>
            <form onSubmit={handleSaveModal} className="space-y-4">
              {modalError && (
                <p
                  role="alert"
                  className="rounded-xl border border-rose-500/50 bg-rose-500/10 px-3 py-2 text-sm text-rose-200"
                >
                  {modalError}
                </p>
              )}
              <div>
                <label
                  htmlFor="item-name"
                  className="text-xs font-bold text-slate-400 block mb-1"
                >
                  {activeTab === "users" ? "Benutzername" : "Bezeichnung"}
                </label>
                <input
                  id="item-name"
                  type="text"
                  required
                  autoFocus={activeTab === "stations"}
                  value={formData.name}
                  onChange={(e) =>
                    setFormData({ ...formData, name: e.target.value })
                  }
                  placeholder={
                    activeTab === "users" ? "Benutzername..." : "Name..."
                  }
                  className="w-full min-h-11 bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-white"
                />
              </div>

              {activeTab === "stations" && (
                <>
                  <div>
                    <label
                      htmlFor="station-short-name"
                      className="text-xs font-bold text-slate-400 block mb-1"
                    >
                      Kurzbezeichnung
                    </label>
                    <input
                      id="station-short-name"
                      type="text"
                      maxLength={12}
                      value={formData.shortName || ""}
                      onChange={(e) =>
                        setFormData({ ...formData, shortName: e.target.value })
                      }
                      className="w-full min-h-11 bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-white"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="station-printer"
                      className="text-xs font-bold text-slate-400 block mb-1"
                    >
                      Zugewiesener Bondrucker
                    </label>
                    <select
                      id="station-printer"
                      value={formData.printerId || ""}
                      onChange={(e) =>
                        setFormData({ ...formData, printerId: e.target.value })
                      }
                      className="w-full min-h-11 bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-white text-sm"
                    >
                      <option value="">Standard-Drucker verwenden</option>
                      {printersList.map((p: any) => (
                        <option key={p.id} value={p.id}>
                          {p.name} ({p.type})
                        </option>
                      ))}
                    </select>
                  </div>
                </>
              )}

              {activeTab === "categories" && (
                <div>
                  <label
                    htmlFor="category-target-station"
                    className="text-xs font-bold text-slate-400 block mb-1"
                  >
                    Zielstation der Kategorie
                  </label>
                  <select
                    id="category-target-station"
                    value={formData.targetStationId || ""}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        targetStationId: e.target.value,
                      })
                    }
                    className="w-full min-h-11 bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-white text-sm"
                  >
                    <option value="">Keine Zielstation</option>
                    {productStations.map((station: any) => (
                      <option key={station.id} value={station.id}>
                        {station.name}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-slate-500 mt-1">
                    Gilt für alle Produkte dieser Kategorie, sofern ein Produkt
                    keine eigene abweichende Station hat. Ohne Auswahl leiten
                    Bons dieser Kategorie an die zentrale Ausgabe.
                  </p>
                </div>
              )}

              {activeTab === "users" && (
                <>
                  <div>
                    <label
                      htmlFor="user-role"
                      className="text-xs font-bold text-slate-400 block mb-1"
                    >
                      Rolle
                    </label>
                    <select
                      id="user-role"
                      value={formData.role}
                      onChange={(e) =>
                        setFormData({ ...formData, role: e.target.value })
                      }
                      className="w-full min-h-11 bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-white"
                    >
                      <option value="ADMINISTRATOR">Administrator</option>
                      <option value="EVENT_MANAGER">
                        Veranstaltungsleitung
                      </option>
                      <option value="WAITER">Kellner</option>
                      <option value="CASHIER">Kasse</option>
                      <option value="STATION">Station</option>
                      <option value="RUNNER">Läufer</option>
                      <option value="REVISION">Revision</option>
                    </select>
                  </div>
                  {!editingItem && (
                    <div>
                      <label
                        htmlFor="user-pin"
                        className="text-xs font-bold text-slate-400 block mb-1"
                      >
                        PIN (4–12 Ziffern)
                      </label>
                      <input
                        id="user-pin"
                        type="password"
                        inputMode="numeric"
                        required
                        minLength={4}
                        maxLength={12}
                        value={formData.pin}
                        onChange={(e) =>
                          setFormData({ ...formData, pin: e.target.value })
                        }
                        className="w-full min-h-11 bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-white"
                      />
                    </div>
                  )}
                  {editingItem && (
                    <label className="flex min-h-11 items-center gap-3 text-sm text-slate-200">
                      <input
                        type="checkbox"
                        checked={formData.isActive}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            isActive: e.target.checked,
                          })
                        }
                      />
                      Benutzer ist aktiv
                    </label>
                  )}
                </>
              )}

              {activeTab !== "users" && (
                <div>
                  <label
                    htmlFor="item-sort-order"
                    className="text-xs font-bold text-slate-400 block mb-1"
                  >
                    Sortierung
                  </label>
                  <input
                    id="item-sort-order"
                    type="number"
                    step="1"
                    value={formData.sortOrder}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        sortOrder: Number(e.target.value),
                      })
                    }
                    className="w-full min-h-11 bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-white"
                  />
                </div>
              )}
              <div className="flex gap-2 justify-end pt-2">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="min-h-11 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold"
                >
                  Abbrechen
                </button>
                <button
                  type="submit"
                  disabled={isSavingModal}
                  className="min-h-11 px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60 text-white font-bold"
                >
                  {isSavingModal ? "Speichert …" : "Speichern"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
