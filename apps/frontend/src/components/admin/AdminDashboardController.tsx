import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../lib/api";
import { AdminAreaState } from "./AdminAreaState";
import { AdminDashboardShell } from "./AdminDashboardShell";
import { AdminOverviewPage } from "./AdminOverviewPage";
import { AdminEventsView } from "./AdminEventsView";
import { AdminAreasView } from "./AdminAreasView";
import { AdminStationsView } from "./AdminStationsView";
import { AdminCategoriesView } from "./AdminCategoriesView";
import { AdminProductsView } from "./AdminProductsView";
import { AdminUsersView } from "./AdminUsersView";
import { AdminPrintersView } from "./AdminPrintersView";
import { AdminBackupsView } from "./AdminBackupsView";
import { AdminMaintenanceView } from "./AdminMaintenanceView";
import { AdminDiagnosticsView } from "./AdminDiagnosticsView";
import { AdminAuditView } from "./AdminAuditView";
import type { BackupItem, EventItem } from "./adminDomainTypes";
import { backendMessage } from "./adminFormatters";
import { describeJobType, describeUnresolvedReason } from "./printerAdminModel";
import {
  ProductOptionGroupsEditor,
  loadOptionGroupsFromProduct,
  buildOptionGroupsPayload,
  findEmptyGroupIds,
  findFirstDuplicateNameError,
  findFirstInvalidPriceError,
  type OptionGroupFormState,
} from "./ProductOptionGroupsEditor";
import {
  getAdminAreaDefinition,
  getAdminPageDefinition,
  type AdminAreaId,
  type AdminPageId,
} from "./adminAreaRegistry";
import { useAdminAreaData } from "./useAdminAreaData";
import { useAuthStore } from "../../store/useAuthStore";
import { ShieldAlert, AlertTriangle } from "lucide-react";
import { AdminEventCompleteModal } from "./AdminEventCompleteModal";
import {
  getOfflineQueueDB,
  getOpenOfflineQueueSummaryForEvent,
  type OpenOfflineQueueSummary,
} from "../../lib/offlineQueueDb";

type Tab = AdminAreaId;

interface AdminDashboardControllerProps {
  activePage: AdminPageId;
}

export const AdminDashboardController = ({
  activePage,
}: AdminDashboardControllerProps) => {
  const navigate = useNavigate();
  const activeTab: Tab = activePage === "overview" ? "events" : activePage;
  const navigateToArea = useCallback(
    (area: AdminAreaId) => navigate(getAdminAreaDefinition(area).path),
    [navigate],
  );
  const {
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
    diagnosticsLastFetchedAt,
    diagnosticsPollFailed,
    restoreOperation,
    restoreOperationConfirmation,
    setRestoreOperationConfirmation,
    fetchData,
  } = useAdminAreaData(activeTab);
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [overviewRefreshToken, setOverviewRefreshToken] = useState(0);
  const [preparingBackup, setPreparingBackup] = useState<string | null>(null);
  const [restorePreparationTarget, setRestorePreparationTarget] =
    useState<BackupItem | null>(null);
  const [restoreCreatedAtConfirmation, setRestoreCreatedAtConfirmation] =
    useState("");
  const [restoreQueuesConfirmed, setRestoreQueuesConfirmed] = useState(false);
  const [restoreOperationBusy, setRestoreOperationBusy] = useState(false);
  const [isRetryingJobs, setIsRetryingJobs] = useState(false);
  const [eventToComplete, setEventToComplete] = useState<EventItem | null>(
    null,
  );
  const [eventCompleteSummary, setEventCompleteSummary] =
    useState<OpenOfflineQueueSummary>({ count: 0, totalCents: 0 });
  const [isCompletingEvent, setIsCompletingEvent] = useState(false);

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
    depositEuro: string;
    depositCent: string;
  }>({
    name: "",
    shortName: "",
    sortOrder: 0,
    printerId: "",
    role: "WAITER",
    pin: "",
    isActive: true,
    targetStationId: "",
    depositEuro: "0",
    depositCent: "00",
  });
  const [modalError, setModalError] = useState("");
  const [isSavingModal, setIsSavingModal] = useState(false);

  // Product Edit/Create Modal State
  const [isProductModalOpen, setIsProductModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<any>(null);
  const [productCategories, setProductCategories] = useState<any[]>([]);
  const [productStations, setProductStations] = useState<any[]>([]);
  const [productFormData, setProductFormData] = useState({
    name: "",
    euro: "",
    cent: "",
    depositEuro: "0",
    depositCent: "00",
    categoryId: "",
    targetStationId: "",
    sortOrder: "0",
  });

  useEffect(() => {
    if (!eventId) {
      setProductCategories([]);
      setProductStations([]);
      return;
    }
    const loadEventMetadata = async () => {
      try {
        const [categoriesRes, stationsRes] = await Promise.all([
          api.get(`/categories?eventId=${eventId}`),
          api.get(`/stations/admin/all?eventId=${eventId}`),
        ]);
        setProductCategories(categoriesRes.data || []);
        setProductStations(stationsRes.data || []);
      } catch (err) {
        console.error("Failed to load event metadata", err);
      }
    };
    void loadEventMetadata();
  }, [eventId, data]);

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

  const currentUserRole = useAuthStore((s) => s.user?.role);
  // Nur zum Ausblenden von Knöpfen, siehe Konzept 64, Abschnitt 0 und 2.7 -
  // maßgeblich bleibt der RolesGuard im Backend.
  const canDiscardPrintJobs = currentUserRole === "ADMINISTRATOR";

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
      const deposit = Number.isInteger(item?.deposit) ? item.deposit : 0;
      setProductFormData({
        name: item?.name || "",
        euro: String(Math.floor(price / 100)),
        cent: String(Math.abs(price % 100)).padStart(2, "0"),
        depositEuro: String(Math.floor(deposit / 100)),
        depositCent: String(Math.abs(deposit % 100)).padStart(2, "0"),
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
        depositEuro: String(Math.floor((item?.deposit ?? 0) / 100)),
        depositCent: String(Math.abs((item?.deposit ?? 0) % 100)).padStart(
          2,
          "0",
        ),
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
          depositEuro: "0",
          depositCent: "00",
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
          depositEuro: "0",
          depositCent: "00",
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
          const depositEuroInput = formData.depositEuro.trim() || "0";
          const depositCentInput = formData.depositCent.trim() || "0";
          const depositEuro = Number(depositEuroInput);
          const depositCent = Number(depositCentInput);
          if (
            !/^\d+$/.test(depositEuroInput) ||
            !/^\d+$/.test(depositCentInput) ||
            !Number.isSafeInteger(depositEuro) ||
            !Number.isSafeInteger(depositCent) ||
            depositEuro < 0 ||
            depositCent < 0 ||
            depositCent > 99 ||
            depositEuro * 100 + depositCent > 2_147_483_647
          ) {
            setModalError(
              "Pfand: Euro muss eine nichtnegative ganze Zahl und Cent ein Wert von 0 bis 99 sein.",
            );
            return;
          }
          const payload = {
            name: formData.name,
            sortOrder: formData.sortOrder,
            targetStationId: formData.targetStationId || null,
            deposit: depositEuro * 100 + depositCent,
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
    const depositEuroInput = productFormData.depositEuro?.trim() || "0";
    const depositCentInput = productFormData.depositCent?.trim() || "0";
    const depositEuro = Number(depositEuroInput);
    const depositCent = Number(depositCentInput);
    if (
      !/^\d+$/.test(depositEuroInput) ||
      !/^\d+$/.test(depositCentInput) ||
      !Number.isSafeInteger(depositEuro) ||
      depositEuro < 0 ||
      !Number.isSafeInteger(depositCent) ||
      depositCent < 0 ||
      depositCent > 99
    ) {
      setModalError(
        "Pfand: Euro muss eine nichtnegative ganze Zahl und Cent ein Wert von 0 bis 99 sein.",
      );
      return;
    }
    const deposit = depositEuro * 100 + depositCent;

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
        deposit,
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
    }
  };

  const openRestorePreparation = (backup: BackupItem) => {
    setRestorePreparationTarget(backup);
    setRestoreCreatedAtConfirmation("");
    setRestoreQueuesConfirmed(false);
  };

  const closeRestorePreparation = () => {
    if (preparingBackup !== null) return;
    setRestorePreparationTarget(null);
    setRestoreCreatedAtConfirmation("");
    setRestoreQueuesConfirmed(false);
  };

  const handlePrepareRestore = async () => {
    const backup = restorePreparationTarget;
    if (!backup) return;
    setPreparingBackup(backup.filename);
    try {
      const response = await api.post(
        `/backup/native-restore/${backup.filename}`,
        {
          confirmedCreatedAt: restoreCreatedAtConfirmation,
          queuesConfirmed: restoreQueuesConfirmed,
        },
      );
      alert(
        `Wiederherstellung erfolgreich umgeschaltet. Die Sicherheitssicherung bleibt bis zur ausdrücklichen Abnahme erhalten.${response.data.restartScheduled ? " Das Backend startet jetzt kontrolliert neu." : ""}`,
      );
      setRestorePreparationTarget(null);
      fetchData();
    } catch (err) {
      console.error("Failed to prepare backup restoration", err);
      alert(
        backendMessage(
          err,
          "Die Wiederherstellung konnte nicht sicher abgeschlossen werden. Der Wartungsmodus bleibt gesperrt.",
        ),
      );
    } finally {
      setPreparingBackup(null);
    }
  };

  const handleRestoreOperation = async (action: "rollback" | "accept") => {
    if (!restoreOperation) return;
    setRestoreOperationBusy(true);
    try {
      await api.post(`/backup/restore-operation/${action}`, {
        swapId: restoreOperation.swapId,
        confirmedCreatedAt: restoreOperationConfirmation,
      });
      alert(
        action === "rollback"
          ? "Die Wiederherstellung wurde auf die vorherige Datenbank zurückgenommen. Bitte prüfen und anschließend ausdrücklich abnehmen."
          : "Der geprüfte Zustand wurde abgenommen, die Rückfalldatenbank entfernt und der Wartungsmodus beendet.",
      );
      fetchData();
    } catch (err) {
      alert(
        backendMessage(
          err,
          "Die Restore-Entscheidung konnte nicht sicher ausgeführt werden.",
        ),
      );
    } finally {
      setRestoreOperationBusy(false);
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

      const targetPrinterName =
        printersList.find((p) => p.id === resolveTargetPrinterId)?.name ??
        "unbekannt";
      const feedback =
        action === "REPRINTED"
          ? {
              tone: "reprint" as const,
              text: `Neuer Druckauftrag an „${targetPrinterName}" eingereiht.`,
            }
          : action === "CONFIRMED_PRINTED"
            ? { tone: "ok" as const, text: "Als gedruckt bestätigt." }
            : { tone: "discard" as const, text: "Verworfen." };

      setJustResolvedIds((prev) => ({ ...prev, [job.id]: feedback }));
      setResolveDialog(null);
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
    try {
      const db = await getOfflineQueueDB();
      const summary = await getOpenOfflineQueueSummaryForEvent(db, evt.id);
      setEventCompleteSummary(summary);
    } catch (err) {
      console.error(
        "Failed to query open offline queue summary for event",
        err,
      );
      setEventCompleteSummary({ count: 0, totalCents: 0 });
    }
    setEventToComplete(evt);
  };

  const handleConfirmCompleteEvent = async (confirmedWithWarning: boolean) => {
    if (!eventToComplete) return;
    setIsCompletingEvent(true);
    try {
      await api.patch(`/events/${eventToComplete.id}/status`, {
        status: "COMPLETED",
        ...(confirmedWithWarning && eventCompleteSummary.count > 0
          ? {
              offlineQueueWarning: {
                hasOpenOrders: true,
                openCount: eventCompleteSummary.count,
                openTotalCents: eventCompleteSummary.totalCents,
                acknowledged: true,
              },
            }
          : {}),
      });
      setEventToComplete(null);
      fetchData();
    } catch (err) {
      console.error("Failed to complete event", err);
      alert("Fehler beim Abschließen der Veranstaltung.");
    } finally {
      setIsCompletingEvent(false);
    }
  };

  const activePageDefinition = getAdminPageDefinition(activePage);
  const selectedEvent =
    events.find((event) => event.id === eventId) ?? events[0];
  const primaryAction = activePageDefinition.supportsCreate
    ? () => void handleOpenModal()
    : activePage === "overview"
      ? () => setOverviewRefreshToken((token) => token + 1)
      : activePage === "diagnostics"
        ? () => void fetchData()
        : undefined;

  return (
    <div className="space-y-6">
      <AdminDashboardShell
        activePage={activePage}
        unresolvedJobCount={unresolvedJobs.length}
        selectedEvent={selectedEvent}
        events={events}
        selectedEventId={eventId}
        onSelectEvent={setEventId}
        connectionStatus={connectionStatus}
        connectionCheckedAt={connectionCheckedAt}
        showOperatingStatus={activePage !== "overview"}
        onPrimaryAction={primaryAction}
      >
        {activePage === "overview" ? (
          <AdminOverviewPage refreshToken={overviewRefreshToken} />
        ) : (
          <AdminAreaState
            area={activeTab}
            isLoading={isLoading}
            error={loadError}
            onRetry={() => void fetchData()}
          >
            {activeTab === "diagnostics" ? (
              <AdminDiagnosticsView
                diagnosticsData={diagnosticsData}
                pollingError={
                  diagnosticsPollFailed
                    ? "Diagnosedaten konnten nicht aktualisiert werden."
                    : null
                }
                lastUpdated={diagnosticsLastFetchedAt}
                isRetryingFailedJobs={isRetryingJobs}
                onRefresh={() => void fetchData()}
                onRetryFailedJobs={handleRetryFailedJobs}
                onNavigateToArea={(tab) => navigateToArea(tab as Tab)}
              />
            ) : activeTab === "events" ? (
              <AdminEventsView
                events={data as EventItem[]}
                onRefresh={() => void fetchData()}
                onOpenCreate={() => void handleOpenModal()}
                onEdit={(evt) => void handleOpenModal(evt)}
                onDelete={(id) => void handleDelete(id)}
                onActivate={(evt) => handleOpenActivateModal(evt)}
                onSetTestMode={(evt) => void handleSetTestMode(evt)}
                onPause={(evt) => void handlePauseEvent(evt)}
                onComplete={(evt) => void handleCompleteEvent(evt)}
                onConfigurationDone={() => void fetchData()}
                isRefreshing={isLoading}
              />
            ) : activeTab === "printers" ? (
              <AdminPrintersView
                printers={data}
                unresolvedJobs={unresolvedJobs}
                printerTests={printerTests}
                canDiscardPrintJobs={canDiscardPrintJobs}
                justResolvedIds={justResolvedIds}
                isRefreshing={isLoading}
                onRefresh={() => void fetchData()}
                onOpenCreate={() => void handleOpenModal()}
                onEdit={(item) => void handleOpenModal(item)}
                onDelete={(id) => void handleDelete(id)}
                onTestPrint={(id) => void handleTestPrint(id)}
                onOpenResolveDialog={(job, resolution) =>
                  openResolveDialog(job, resolution)
                }
              />
            ) : activeTab === "backups" ? (
              <AdminBackupsView
                backups={data}
                restoreOperation={restoreOperation}
                restoreOperationConfirmation={restoreOperationConfirmation}
                isBackingUp={isBackingUp}
                isRestoring={preparingBackup !== null}
                isRollingBack={restoreOperationBusy}
                isAccepting={restoreOperationBusy}
                isRefreshing={isLoading}
                onRefresh={() => void fetchData()}
                onCreateBackup={handleCreateBackup}
                onVerifyBackup={(b) => void handleVerifyRestore(b.filename)}
                onPrepareRestore={(b) => openRestorePreparation(b)}
                onDownloadBackup={(b, file) =>
                  void handleDownloadBackup(
                    file || b.downloadFiles?.[0] || b.filename,
                  )
                }
                onRollbackRestore={() =>
                  void handleRestoreOperation("rollback")
                }
                onAcceptRestore={() => void handleRestoreOperation("accept")}
                onSetRestoreOperationConfirmation={
                  setRestoreOperationConfirmation
                }
                onOpenDirectRestore={(filename) =>
                  void handleRestoreBackup(filename)
                }
              />
            ) : activeTab === "maintenance" ? (
              <AdminMaintenanceView />
            ) : activeTab === "audit" ? (
              <AdminAuditView
                auditLogs={data}
                auditStats={auditStats}
                isRefreshing={isLoading}
                onRefresh={() => void fetchData()}
                onExportCsv={handleExportAuditCsv}
              />
            ) : activeTab === "areas" ? (
              <AdminAreasView
                areas={data}
                onRefresh={() => void fetchData()}
                onOpenCreate={() => void handleOpenModal()}
                onEdit={(item) => void handleOpenModal(item)}
                onDelete={(id) => void handleDelete(id)}
                isRefreshing={isLoading}
              />
            ) : activeTab === "stations" ? (
              <AdminStationsView
                stations={data}
                printersList={printersList}
                onRefresh={() => void fetchData()}
                onOpenCreate={() => void handleOpenModal()}
                onEdit={(item) => void handleOpenModal(item)}
                onDelete={(id) => void handleDelete(id)}
                isRefreshing={isLoading}
              />
            ) : activeTab === "categories" ? (
              <AdminCategoriesView
                categories={data}
                stationsList={productStations}
                onRefresh={() => void fetchData()}
                onOpenCreate={() => void handleOpenModal()}
                onEdit={(item) => void handleOpenModal(item)}
                onDelete={(id) => void handleDelete(id)}
                isRefreshing={isLoading}
              />
            ) : activeTab === "products" ? (
              <AdminProductsView
                products={data}
                categoriesList={productCategories}
                stationsList={productStations}
                onRefresh={() => void fetchData()}
                onOpenCreate={() => void handleOpenModal()}
                onEdit={(item) => void handleOpenModal(item)}
                onDelete={(id) => void handleDelete(id)}
                isRefreshing={isLoading}
              />
            ) : activeTab === "users" ? (
              <AdminUsersView
                users={data}
                onRefresh={() => void fetchData()}
                onOpenCreate={() => void handleOpenModal()}
                onEdit={(item) => void handleOpenModal(item)}
                onDelete={(id) => void handleDelete(id)}
                isRefreshing={isLoading}
              />
            ) : null}
          </AdminAreaState>
        )}
      </AdminDashboardShell>

      {/* RKSV DISCLAIMER & ACTIVATION MODAL */}
      {rksvModalOpen && rksvTargetEvent && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in"
          onKeyDown={(e) =>
            handleModalEscape(e, () => {
              if (!isActivating) setRksvModalOpen(false);
            })
          }
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="rksv-modal-title"
            className="bg-slate-900 border border-slate-700 p-6 sm:p-8 rounded-3xl max-w-xl w-full shadow-2xl space-y-6 animate-scale-up"
          >
            <div className="flex items-start gap-4">
              <div className="p-3 bg-amber-500/20 text-amber-400 rounded-2xl border border-amber-500/30 shrink-0">
                <ShieldAlert className="w-8 h-8" />
              </div>
              <div>
                <h3
                  id="rksv-modal-title"
                  className="text-xl font-bold text-white"
                >
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

      {/* EVENT COMPLETE WARNING MODAL (Issue #97) */}
      {eventToComplete && (
        <AdminEventCompleteModal
          event={eventToComplete}
          openQueueSummary={eventCompleteSummary}
          isSubmitting={isCompletingEvent}
          onClose={() => {
            if (!isCompletingEvent) setEventToComplete(null);
          }}
          onConfirm={handleConfirmCompleteEvent}
        />
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
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
          onKeyDown={(e) =>
            handleModalEscape(e, () => setIsEventModalOpen(false))
          }
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="event-modal-title"
            className="bg-slate-900 border border-slate-800 p-6 rounded-3xl max-w-lg w-full shadow-2xl space-y-4"
          >
            <h3 id="event-modal-title" className="text-xl font-bold text-white">
              {editingEvent
                ? "Veranstaltung bearbeiten"
                : "Neue Veranstaltung anlegen"}
            </h3>
            {modalError && (
              <p
                role="alert"
                className="rounded-xl border border-rose-500/50 bg-rose-500/10 px-3 py-2 text-sm text-rose-200"
              >
                {modalError}
              </p>
            )}
            <form onSubmit={handleSaveModal} className="space-y-4">
              <div>
                <label
                  htmlFor="event-form-name"
                  className="text-xs font-bold text-slate-400 block mb-1"
                >
                  Name der Veranstaltung
                </label>
                <input
                  id="event-form-name"
                  type="text"
                  required
                  autoFocus
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
                  <label
                    htmlFor="event-form-organizer"
                    className="text-xs font-bold text-slate-400 block mb-1"
                  >
                    Veranstalter
                  </label>
                  <input
                    id="event-form-organizer"
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
                  <label
                    htmlFor="event-form-location"
                    className="text-xs font-bold text-slate-400 block mb-1"
                  >
                    Ort
                  </label>
                  <input
                    id="event-form-location"
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
                  <label
                    htmlFor="event-form-start-time"
                    className="text-xs font-bold text-slate-400 block mb-1"
                  >
                    Startzeit
                  </label>
                  <input
                    id="event-form-start-time"
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
                  <label
                    htmlFor="event-form-end-time"
                    className="text-xs font-bold text-slate-400 block mb-1"
                  >
                    Endzeit
                  </label>
                  <input
                    id="event-form-end-time"
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
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="product-deposit-euro"
                    className="text-xs font-bold text-slate-400 block mb-1"
                  >
                    Pfand in Euro (optional)
                  </label>
                  <input
                    id="product-deposit-euro"
                    type="number"
                    min="0"
                    step="1"
                    inputMode="numeric"
                    value={productFormData.depositEuro}
                    onChange={(e) =>
                      setProductFormData({
                        ...productFormData,
                        depositEuro: e.target.value,
                      })
                    }
                    className="w-full min-h-11 bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-white"
                  />
                </div>
                <div>
                  <label
                    htmlFor="product-deposit-cent"
                    className="text-xs font-bold text-slate-400 block mb-1"
                  >
                    Pfand in Cent
                  </label>
                  <input
                    id="product-deposit-cent"
                    type="number"
                    min="0"
                    max="99"
                    step="1"
                    inputMode="numeric"
                    value={productFormData.depositCent}
                    onChange={(e) =>
                      setProductFormData({
                        ...productFormData,
                        depositCent: e.target.value,
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

      {restorePreparationTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Sicher wiederherstellen"
            aria-labelledby="restore-preparation-title"
            className="max-h-[calc(100vh-2rem)] w-full max-w-xl overflow-y-auto rounded-2xl border border-amber-500/30 bg-slate-900 p-5 shadow-2xl sm:p-6"
          >
            <h2
              id="restore-preparation-title"
              className="text-xl font-black text-white"
            >
              Sicher wiederherstellen
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-300">
              Dieser Schritt erstellt eine geprüfte PRE_RESTORE-Sicherung,
              stellt den Dump in einer Nebendatenbank wieder her und prüft ihn
              vollständig. Erst danach werden die Datenbanken umgeschaltet. Der
              bisherige Stand bleibt als sofortige Rückfallebene erhalten.
            </p>
            <p className="mt-3 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm font-bold text-rose-200">
              Nach der Umschaltung bleibt der Wartungsmodus gesperrt. Du musst
              den neuen Stand anschließend ausdrücklich abnehmen oder die
              Wiederherstellung rückgängig machen.
            </p>
            <div className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-sm">
              <div className="font-bold text-amber-200">
                Sicherungszeitpunkt
              </div>
              <code className="mt-1 block break-all text-amber-100">
                {restorePreparationTarget.createdAt}
              </code>
            </div>
            <label
              htmlFor="restore-created-at-confirmation"
              className="mt-4 block text-sm font-bold text-slate-200"
            >
              Sicherungszeitpunkt exakt eingeben
            </label>
            <input
              id="restore-created-at-confirmation"
              type="text"
              value={restoreCreatedAtConfirmation}
              onChange={(event) =>
                setRestoreCreatedAtConfirmation(event.target.value)
              }
              autoComplete="off"
              spellCheck={false}
              className="mt-2 min-h-11 w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 font-mono text-sm text-white focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400/30"
            />
            <label className="mt-4 flex min-h-11 items-start gap-3 rounded-xl border border-slate-700 bg-slate-800/70 p-3 text-sm text-slate-200">
              <input
                type="checkbox"
                checked={restoreQueuesConfirmed}
                onChange={(event) =>
                  setRestoreQueuesConfirmed(event.target.checked)
                }
                className="mt-0.5 h-5 w-5 shrink-0"
              />
              <span>
                Ich bestätige: Alle Kassen sind online und ihre lokalen
                Warteschlangen sind leer. VereinOrder kann dies nicht über
                andere Geräte hinweg prüfen.
              </span>
            </label>
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={closeRestorePreparation}
                disabled={preparingBackup !== null}
                className="min-h-11 rounded-xl bg-slate-800 px-4 py-2 font-bold text-slate-300 hover:bg-slate-700 disabled:opacity-50"
              >
                Abbrechen
              </button>
              <button
                type="button"
                onClick={handlePrepareRestore}
                disabled={
                  preparingBackup !== null ||
                  restoreCreatedAtConfirmation !==
                    restorePreparationTarget.createdAt ||
                  !restoreQueuesConfirmed
                }
                className="min-h-11 rounded-xl bg-amber-500 px-4 py-2 font-black text-slate-950 hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {preparingBackup !== null
                  ? "Wiederherstellung läuft …"
                  : "Jetzt sicher wiederherstellen"}
              </button>
            </div>
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
                  <fieldset className="mt-4">
                    <legend className="text-xs font-bold text-slate-400 mb-1">
                      Pfandvorgabe der Kategorie
                    </legend>
                    <div className="grid grid-cols-2 gap-3">
                      <label className="text-xs text-slate-400">
                        Euro
                        <input
                          inputMode="numeric"
                          value={formData.depositEuro}
                          onChange={(event) =>
                            setFormData({
                              ...formData,
                              depositEuro: event.target.value,
                            })
                          }
                          className="mt-1 min-h-11 w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 font-mono text-white"
                          aria-label="Kategoriepfand in Euro"
                        />
                      </label>
                      <label className="text-xs text-slate-400">
                        Cent
                        <input
                          inputMode="numeric"
                          value={formData.depositCent}
                          onChange={(event) =>
                            setFormData({
                              ...formData,
                              depositCent: event.target.value,
                            })
                          }
                          className="mt-1 min-h-11 w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 font-mono text-white"
                          aria-label="Kategoriepfand in Cent"
                        />
                      </label>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      Wird bei Produkten ohne eigenen Pfandbetrag verwendet.
                    </p>
                  </fieldset>
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
