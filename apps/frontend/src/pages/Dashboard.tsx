import { useEffect, useState, useMemo, useRef } from "react";
import { api } from "../lib/api";
import { useCartStore, CartItem as CartItemType } from "../store/useCartStore";
import { Trash2, Check, LayoutGrid, List, Minus, Bell } from "lucide-react";
import { CheckoutModal } from "../components/CheckoutModal";
import { ProductOptionsModal } from "../components/ProductOptionsModal";
import { TableSelectionModal } from "../components/TableSelectionModal";
import { OfflineQueueIndicator } from "../components/OfflineQueueIndicator";
import { OfflineQueuePanel } from "../components/OfflineQueuePanel";
import { CatalogLoadError } from "../components/CatalogLoadError";
import { useAuthStore } from "../store/useAuthStore";
import {
  countOpenOfflineOrders,
  enqueueOfflineOrder,
  OfflineQueueFullError,
  OfflineQueueUnavailableError,
  recoverInterruptedOfflineSends,
  runOfflineQueueSync,
  type OfflineCaptureContext,
  type OfflineOrderItemInput,
} from "../lib/offlineSync";

const formatPrice = (cents: number) => `€ ${(cents / 100).toFixed(2)}`;

// Der heute geltende Kontext einer Veranstaltung, wie ihn `GET
// /sessions/context` liefert (siehe CashierDashboard.tsx für dasselbe
// Muster). Wird lokal zwischengespeichert, weil `dataMode` und
// `cashierSessionId` offline nicht abfragbar sind (Entwurf Abschnitt 4).
interface EventContextEntry {
  id: string;
  name: string;
  status: string;
  testMode: boolean;
  activeSession: { id: string } | null;
}

// Bildet Veranstaltungsstatus und Testmodus exakt so auf die Betriebsart ab
// wie der Server es beim Anlegen einer Bestellung tut (siehe
// offlineQueueContext.ts, `deriveDataModeFromEventStatus`). Absichtlich hier
// noch einmal definiert statt von dort importiert: Dashboard.tsx bindet
// ausschließlich an `offlineSync.ts`, die öffentliche Fassade der
// Warteschlangen-Bibliothek.
const deriveDataMode = (
  status: unknown,
  testMode: unknown,
): "TEST" | "LIVE" | null => {
  if (status === "ACTIVE" && !testMode) return "LIVE";
  if (status === "TEST_MODE" && testMode) return "TEST";
  return null;
};

// Antworten, bei denen unklar ist, ob der Server die Bestellung bereits
// angelegt hat, gehören vorgemerkt statt in eine Fehlermeldung (Befund B9):
// kein Netz, Zeitüberschreitung, sowie 408/425/429 und jedes 5xx.
const QUEUEABLE_RETRY_STATUSES = new Set([408, 425, 429]);

const shouldQueueOffline = (err: any): boolean => {
  if (!navigator.onLine) return true;
  const code = err?.code;
  if (code === "ERR_NETWORK" || code === "ECONNABORTED") return true;
  const status = err?.response?.status;
  if (typeof status !== "number") return true;
  if (status >= 500) return true;
  return QUEUEABLE_RETRY_STATUSES.has(status);
};

// Wachsender Abstand für den automatischen Neuladeversuch des
// Produktkatalogs, solange dieser leer geblieben ist (Issue #90). Start bei
// 2 s, danach Verdopplung, gedeckelt bei 30 s: kurz genug, dass die Kasse
// nach einer Sekunden-Störung zügig wieder benutzbar wird, lang genug, um
// den Server während eines längeren Ausfalls nicht im Sekundentakt zu
// bestürmen. Die Schaltfläche im Hinweis erlaubt jederzeit einen
// sofortigen Versuch von Hand, unabhängig vom aktuellen Abstand.
const CATALOG_RETRY_BASE_MS = 2_000;
const CATALOG_RETRY_MAX_MS = 30_000;

// Hat ein Produkt eine Pflichtgruppe mit Endpreis (ABSOLUTE), zeigt die Kachel
// den kleinsten Antwortpreis mit dem Zusatz "ab" (Entscheidung 2 der
// Projektleitung). Ohne solche Gruppe bleibt die Kachel unverändert.
const getTilePriceLabel = (product: any) => {
  const absoluteGroup = (product.optionGroups || []).find(
    (g: any) => g.priceMode === "ABSOLUTE",
  );
  if (absoluteGroup) {
    const activeOptions = (absoluteGroup.options || []).filter(
      (o: any) => o.isActive !== false,
    );
    if (activeOptions.length > 0) {
      const min = Math.min(...activeOptions.map((o: any) => o.priceEffect));
      return `ab ${formatPrice(min)}`;
    }
  }
  return formatPrice(product.price);
};

// Sub-Komponente für Swipe-to-Delete/Reduce
export const CartItem = ({
  item,
  products = [],
  addItem,
  removeItem,
  deleteItem,
  onEditOptions,
}: {
  item: CartItemType;
  // Die lebende Produktliste, über den Ereignisstrom aktuell gehalten.
  // Verfügbarkeit wird zur Anzeigezeit daraus abgeleitet, statt in der
  // Warenkorbzeile nachgeführt zu werden (Entscheidung zu Issue #80).
  // Optional mit Default, damit bestehende Aufrufer ohne Produktliste
  // (z. B. ältere Tests) weiter funktionieren und dann auf die
  // Momentaufnahme der Zeile zurückfallen.
  products?: any[];
  addItem: (
    product: any,
    selectedOptions?: CartItemType["selectedOptions"],
  ) => void;
  removeItem: (id: string) => void;
  deleteItem: (id: string) => void;
  // Öffnet die Auswahlmaske im Änderungsfall, vorbelegt mit der Auswahl
  // dieser Zeile (Issue #82). Optional, damit ältere Aufrufer ohne diese
  // Funktion weiterhin funktionieren — dann bleibt der mittlere Bereich bei
  // Produkten mit Auswahlgruppen inaktiv.
  onEditOptions?: (item: CartItemType) => void;
}) => {
  const [translateX, setTranslateX] = useState(0);
  const [startX, setStartX] = useState(0);

  const onTouchStart = (e: React.TouchEvent) => setStartX(e.touches[0].clientX);

  const onTouchMove = (e: React.TouchEvent) => {
    const currentX = e.touches[0].clientX;
    const diff = currentX - startX;
    if (diff < 0) {
      setTranslateX(Math.max(-140, diff));
    }
  };

  const onTouchEnd = () => {
    if (translateX < -70) {
      setTranslateX(-140);
    } else {
      setTranslateX(0);
    }
  };

  // Produkt zur Zeile anhand der Kennung in der lebenden Liste nachschlagen.
  // Fehlt es dort (z. B. Produkt gelöscht oder Liste noch nicht geladen),
  // gilt die Momentaufnahme der Zeile als Rückfallwert.
  const currentProduct =
    products.find((p) => p.id === item.product?.id) ?? item.product;
  const isOutOfStock = currentProduct?.availability === "OUT_OF_STOCK";
  // Nur mit Auswahlgruppen gibt es überhaupt etwas zu ändern (Issue #82).
  // Ohne sie bleibt der mittlere Bereich ein einfacher Text ohne
  // Schaltflächen-Anmutung, um keine Bedienbarkeit vorzutäuschen.
  const hasOptionGroups = (currentProduct?.optionGroups?.length ?? 0) > 0;

  return (
    <div
      className={`relative overflow-hidden border-b border-slate-200 ${isOutOfStock ? "bg-red-50" : "bg-white"}`}
    >
      <div className="absolute inset-y-0 right-0 w-[140px] flex">
        <button
          onClick={() => {
            removeItem(item.id);
            setTranslateX(0);
          }}
          className="w-[70px] bg-yellow-500 flex items-center justify-center text-white transition-opacity active:opacity-70"
          aria-label="Menge reduzieren"
        >
          <Minus className="w-6 h-6" />
        </button>
        <button
          onClick={() => {
            deleteItem(item.id);
            setTranslateX(0);
          }}
          className="w-[70px] bg-red-500 flex items-center justify-center text-white transition-opacity active:opacity-70"
          aria-label="Position löschen"
        >
          <Trash2 className="w-6 h-6" />
        </button>
      </div>
      <div
        className={`flex justify-between items-center p-3 relative transition-transform ${isOutOfStock ? "bg-red-50" : "bg-white"}`}
        style={{ transform: `translateX(${translateX}px)` }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onClick={() => setTranslateX(0)}
      >
        <button
          type="button"
          disabled={isOutOfStock}
          onClick={(e) => {
            e.stopPropagation();
            if (isOutOfStock) return;
            addItem(item.product, item.selectedOptions);
          }}
          className={`w-12 min-h-[44px] flex items-center justify-center text-center text-lg font-bold ${
            isOutOfStock
              ? "text-slate-400 cursor-not-allowed"
              : "text-slate-800"
          }`}
          aria-label={`Menge von ${item.product.shortName || item.product.name} erhöhen`}
          aria-disabled={isOutOfStock}
        >
          {item.quantity}
        </button>
        <div className="flex-1 truncate pr-2">
          {hasOptionGroups ? (
            // Echte Schaltfläche statt reinem Text: Tippen auf Produktname
            // und Auswahl öffnet die Maske erneut, vorbelegt mit der
            // bereits getroffenen Auswahl (Issue #82). Die Ereignisweitergabe
            // an das onClick der Zeile (Wischverschiebung zurücksetzen) wird
            // unterbunden.
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onEditOptions?.(item);
              }}
              className="w-full min-h-[44px] flex flex-col items-start justify-center text-left truncate rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1"
              aria-label={`Auswahl von ${item.product.shortName || item.product.name} ändern`}
            >
              <span className="flex items-center gap-1.5">
                <span className="text-lg font-semibold text-slate-800">
                  {item.product.shortName || item.product.name}
                </span>
                {isOutOfStock && (
                  <span className="bg-rose-600 text-white text-xs px-1.5 py-0.5 rounded font-bold uppercase">
                    Ausverkauft
                  </span>
                )}
              </span>
              {item.selectedOptions && item.selectedOptions.length > 0 && (
                <span className="block text-sm text-slate-500 leading-tight">
                  {item.selectedOptions.map((o) => o.name).join(", ")}
                </span>
              )}
            </button>
          ) : (
            <>
              <div className="flex items-center gap-1.5">
                <span className="text-lg font-semibold text-slate-800">
                  {item.product.shortName || item.product.name}
                </span>
                {isOutOfStock && (
                  <span className="bg-rose-600 text-white text-xs px-1.5 py-0.5 rounded font-bold uppercase">
                    Ausverkauft
                  </span>
                )}
              </div>
              {item.selectedOptions && item.selectedOptions.length > 0 && (
                <div className="text-sm text-slate-500 leading-tight">
                  {item.selectedOptions.map((o) => o.name).join(", ")}
                </div>
              )}
            </>
          )}
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            removeItem(item.id);
          }}
          className="w-24 min-h-[44px] flex items-center justify-end text-right text-lg font-bold text-slate-800"
          aria-label={`Menge von ${item.product.shortName || item.product.name} verringern`}
        >
          {formatPrice(item.finalPrice * item.quantity)}
        </button>
      </div>
    </div>
  );
};

const categoryColors = [
  "#3b82f6", // blue
  "#ef4444", // red
  "#10b981", // emerald
  "#f59e0b", // amber
  "#8b5cf6", // violet
  "#ec4899", // pink
  "#06b6d4", // cyan
];

export const Dashboard = () => {
  const [products, setProducts] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  // Eigener Zustand für "Katalog konnte nicht geladen werden" (Issue #90),
  // getrennt von isLoading: isLoading beschreibt nur den allerersten
  // Ladevorgang, catalogError bleibt auch danach bestehen, solange kein
  // Versuch mehr Erfolg hatte. Ein gescheiterter Versuch setzt `products`
  // nie zurück (siehe fetchProducts unten) — ein bereits angezeigter
  // Katalog bleibt also stehen, auch wenn catalogError zwischenzeitlich
  // wahr wird.
  const [catalogError, setCatalogError] = useState(false);
  // Verhindert, dass die Schaltfläche im Hinweis einen zweiten Versuch
  // parallel zu einem laufenden auslöst (siehe auch catalogFetchInFlightRef,
  // der zusätzlich automatische Versuche und Handauslöser gegeneinander
  // absichert).
  const [isCatalogRetrying, setIsCatalogRetrying] = useState(false);
  const catalogFetchInFlightRef = useRef(false);
  const catalogRetryTimeoutRef = useRef<number | null>(null);
  const catalogRetryDelayRef = useRef(CATALOG_RETRY_BASE_MS);
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
  const [isTableModalOpen, setIsTableModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");
  const [tableName, setTableName] = useState("");
  const [areaId, setAreaId] = useState<string | undefined>();
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedProductForOptions, setSelectedProductForOptions] = useState<
    any | null
  >(null);
  // Warenkorbzeile, deren Auswahl gerade geändert wird (Issue #82). Getrennt
  // von selectedProductForOptions oben: jenes ist der Anlegefall (Kachel
  // angetippt, Maske startet ohne Vorauswahl), dies hier der Änderungsfall
  // (Zeile angetippt, Maske startet mit deren bisheriger Auswahl). Beide
  // teilen sich dieselbe ProductOptionsModal-Instanz unten.
  const [editingCartItem, setEditingCartItem] = useState<CartItemType | null>(
    null,
  );
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");

  // Realtime Toast State
  const [toastMessage, setToastMessage] = useState<{
    text: string;
    type: "warning" | "info";
  } | null>(null);

  // Offline-Warteschlange (Issue #65): der zuletzt bekannte Betriebskontext
  // je Veranstaltung, sichtbarer Verbindungszustand und Anzahl offener
  // Vormerkungen, sowie die Warteschlangenansicht selbst.
  const { user } = useAuthStore();
  const [eventContexts, setEventContexts] = useState<EventContextEntry[]>([]);
  const [openQueueCount, setOpenQueueCount] = useState(0);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [isQueuePanelOpen, setIsQueuePanelOpen] = useState(false);

  const {
    items,
    addItem,
    updateItemOptions,
    removeItem,
    deleteItem,
    clearCart,
    total,
  } = useCartStore();

  // Merkt einen erneuten Versuch mit wachsendem Abstand vor, solange der
  // Katalog leer geblieben ist (Issue #90). Wird von fetchProducts unten nur
  // aufgerufen, wenn nach einem Fehlschlag noch keine Produkte vorliegen —
  // ein Ladefehler nach bereits erfolgreich gefülltem Katalog löst keine
  // weiteren automatischen Versuche aus, da dort kein leerer Bildschirm
  // droht.
  const scheduleCatalogRetry = () => {
    if (catalogRetryTimeoutRef.current != null) return; // schon vorgemerkt
    const delay = catalogRetryDelayRef.current;
    catalogRetryTimeoutRef.current = window.setTimeout(() => {
      catalogRetryTimeoutRef.current = null;
      catalogRetryDelayRef.current = Math.min(
        catalogRetryDelayRef.current * 2,
        CATALOG_RETRY_MAX_MS,
      );
      void fetchProducts();
    }, delay);
  };

  const clearScheduledCatalogRetry = () => {
    if (catalogRetryTimeoutRef.current != null) {
      window.clearTimeout(catalogRetryTimeoutRef.current);
      catalogRetryTimeoutRef.current = null;
    }
  };

  const fetchProducts = async () => {
    // Schützt gegen parallele Versuche: automatischer Zeitgeber, "online"
    // -Ereignis und die Schaltfläche im Hinweis können gleichzeitig auslösen
    // wollen, es darf aber immer nur eine Anfrage unterwegs sein.
    if (catalogFetchInFlightRef.current) return;
    catalogFetchInFlightRef.current = true;
    setIsCatalogRetrying(true);
    try {
      const res = await api.get("/products");
      setProducts(res.data);
      setCatalogError(false);
      catalogRetryDelayRef.current = CATALOG_RETRY_BASE_MS;
      clearScheduledCatalogRetry();
    } catch (err) {
      console.error("Failed to load products", err);
      setCatalogError(true);
      // setProducts wird hier absichtlich nicht mit einem leeren Ergebnis
      // aufgerufen: ein bereits angezeigter Katalog bleibt bei einem
      // gescheiterten Versuch unverändert stehen (Akzeptanzkriterium aus
      // Issue #90). Der functional-update-Aufruf dient nur dem Lesen des
      // aktuellen Bestands, ohne eine weitere Abhängigkeit einzuführen.
      setProducts((prev) => {
        if (prev.length === 0) scheduleCatalogRetry();
        return prev;
      });
    } finally {
      setIsLoading(false);
      catalogFetchInFlightRef.current = false;
      setIsCatalogRetrying(false);
    }
  };

  const handleCatalogRetryClick = () => {
    clearScheduledCatalogRetry();
    void fetchProducts();
  };

  // Aktualisiert den zwischengespeicherten Betriebskontext je Veranstaltung
  // über `GET /sessions/context` (Entwurf Abschnitt 4, Muster aus
  // CashierDashboard.tsx). Das ist die einzige Stelle, an der Dashboard.tsx
  // diesen Endpunkt selbst abfragt — die Warteschlangen-Bibliothek fragt ihn
  // für ihre eigene Kontextprüfung unabhängig davon noch einmal ab.
  const fetchSessionContexts = async () => {
    try {
      const res = await api.get("/sessions/context");
      if (Array.isArray(res.data)) setEventContexts(res.data);
    } catch (err) {
      console.error("Failed to load session context", err);
    }
  };

  const refreshOpenQueueCount = async () => {
    try {
      setOpenQueueCount(await countOpenOfflineOrders());
    } catch (err) {
      console.error("Failed to count offline queue", err);
    }
  };

  useEffect(() => {
    fetchProducts();
    fetchSessionContexts();
    refreshOpenQueueCount();

    // Ein vollständiger Sendeschleifen-Lauf (Abschnitt 7): Wiederherstellung
    // unterbrochener Übertragungen, aktuellen Betriebskontext laden, dann
    // `runOfflineQueueSync`. Die Bibliothek selbst sorgt für die
    // anwendungsweite Sperre (Antwort auf B5) — mehrere Aufrufe hier
    // (Start, "online", Intervall) überlappen sich also nie.
    const runSync = async () => {
      await recoverInterruptedOfflineSends();
      await fetchSessionContexts();
      await runOfflineQueueSync({
        httpClient: api,
        currentUserId: useAuthStore.getState().user?.userId ?? null,
      });
      await refreshOpenQueueCount();
    };

    void runSync();

    const handleOnline = () => {
      setIsOnline(true);
      // Wiederkehr der Verbindung soll den Katalog ohne Neuladen der Seite
      // nachladen (Issue #90). Kein zweiter "online"-Behandler: dieser hier
      // bediente bereits die Sendeschleife, der Katalogversuch hängt sich
      // nur an. fetchProducts schützt selbst gegen Überlappung mit einem
      // gerade laufenden automatischen oder von Hand ausgelösten Versuch.
      clearScheduledCatalogRetry();
      void fetchProducts();
      void runSync();
    };
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    // Zusätzlich zu "online": abgelaufene Wartezeiten (`nextAttemptAt`)
    // werden nur erreicht, wenn überhaupt erneut versucht wird, während die
    // Anwendung offen bleibt (Entwurf Abschnitt 7, Auslöser).
    const intervalId = window.setInterval(runSync, 60_000);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      window.clearInterval(intervalId);
      clearScheduledCatalogRetry();
    };
    // fetchProducts, fetchSessionContexts und refreshOpenQueueCount sind wie
    // schon vor Issue #90 absichtlich nicht in den Abhängigkeiten: Dieser
    // Effekt läuft bewusst nur beim Aufbau der Seite, alle erneuten Aufrufe
    // laufen über die hier verdrahteten Auslöser ("online", Zeitgeber,
    // Schaltfläche) statt über einen erneuten Lauf des Effekts selbst.
    // fetchProducts bleibt zwischen Aufrufen inhaltlich stabil (berührt nur
    // Refs, Zustandssetter und den unveränderlichen `api`-Client) — die Regel
    // kann das aber nicht erkennen, sobald es intern clearScheduledCatalogRetry
    // aufruft, und verlangt es deshalb hier zusätzlich als Abhängigkeit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Realtime SSE Connection for Stock & Availability Updates
  useEffect(() => {
    const eventId = products[0]?.eventId;
    const streamUrl = eventId
      ? `/realtime/stream?eventId=${eventId}`
      : "/realtime/stream";

    let eventSource: EventSource | null = null;
    try {
      eventSource = new EventSource(streamUrl);

      eventSource.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload.type === "PRODUCT_AVAILABILITY_CHANGED") {
            const { productId, productName, availability } = payload.data;

            setProducts((prev) =>
              prev.map((p) =>
                p.id === productId ? { ...p, availability } : p,
              ),
            );

            if (availability === "OUT_OF_STOCK") {
              setToastMessage({
                text: `⚠️ Achtung: ${productName} ist soeben AUSVERKAUFT!`,
                type: "warning",
              });
            } else if (availability === "LOW_STOCK") {
              setToastMessage({
                text: `⚡ Hinweis: ${productName} ist fast ausverkauft (Knapp)!`,
                type: "info",
              });
            }

            setTimeout(() => {
              setToastMessage(null);
            }, 4500);
          }
        } catch (e) {
          console.error("Error parsing realtime message", e);
        }
      };

      eventSource.onerror = () => {
        // SSE handles reconnection automatically
      };
    } catch (err) {
      console.warn(
        "Realtime EventSource not available, falling back to polling",
        err,
      );
    }

    return () => {
      if (eventSource) eventSource.close();
    };
  }, [products]);

  const categories = useMemo(() => {
    const cats = new Set<string>();
    products.forEach((p) => {
      if (p.category?.name) cats.add(p.category.name);
    });
    return Array.from(cats);
  }, [products]);

  const filteredProducts = useMemo(() => {
    if (!selectedCategory) return products;
    return products.filter((p) => p.category?.name === selectedCategory);
  }, [products, selectedCategory]);

  const handleProductClick = (product: any) => {
    if (
      product.availability === "OUT_OF_STOCK" ||
      product.availability === "DISABLED"
    ) {
      return; // Do not allow adding out-of-stock products
    }

    if (product.optionGroups && product.optionGroups.length > 0) {
      setSelectedProductForOptions(product);
    } else {
      addItem(product);
    }
  };

  // Öffnet die Auswahlmaske im Änderungsfall für eine bestehende
  // Warenkorbzeile (Issue #82). Der mittlere Bereich der Zeile ruft dies nur
  // auf, wenn das Produkt Auswahlgruppen hat — bei Produkten ohne
  // Auswahlgruppen wird die Schaltfläche gar nicht erst angezeigt.
  const handleEditOptions = (item: CartItemType) => {
    setEditingCartItem(item);
  };

  // Anlege- und Änderungsfall teilen sich dieselbe ProductOptionsModal.
  // Welcher Fall aktiv ist, entscheidet ausschließlich, welcher der beiden
  // States oben gesetzt ist — nie ein und derselbe State für beides.
  const isOptionsModalOpen = !!selectedProductForOptions || !!editingCartItem;
  const optionsModalProduct = editingCartItem
    ? (products.find((p) => p.id === editingCartItem.product?.id) ??
      editingCartItem.product)
    : selectedProductForOptions;

  const closeOptionsModal = () => {
    setSelectedProductForOptions(null);
    setEditingCartItem(null);
  };

  const handleOptionsSubmit = (
    product: any,
    selectedOptions: NonNullable<CartItemType["selectedOptions"]>,
  ) => {
    if (editingCartItem) {
      // Änderungsfall: Auswahl der Zeile ersetzen, Menge bleibt erhalten und
      // wird mit einer eventuell bereits vorhandenen gleichen Zeile
      // verschmolzen (im Store gelöst, siehe useCartStore.updateItemOptions).
      updateItemOptions(editingCartItem.id, selectedOptions);
    } else {
      // Anlegefall: neue Zeile hinzufügen bzw. mit bestehender gleicher
      // Zeile verschmelzen (unverändertes Verhalten aus addItem).
      addItem(product, selectedOptions);
    }
  };

  const handleCheckoutSubmit = async (
    payments?: { amount: number; method: "CASH" | "CARD" | "VOUCHER" }[],
    checkoutTableName?: string,
  ) => {
    if (items.length === 0) return;

    // Check if any cart items are out of stock. Verfügbarkeit wird aus der
    // lebenden Produktliste abgeleitet, nicht aus der Momentaufnahme der
    // Zeile (Issue #80) — sonst greift diese Prüfung bei einer
    // zwischenzeitlichen Meldung nicht mehr.
    const outOfStockItems = items.filter((i) => {
      const currentProduct = products.find((p) => p.id === i.product?.id);
      const availability =
        currentProduct?.availability ?? i.product?.availability;
      return availability === "OUT_OF_STOCK";
    });
    if (outOfStockItems.length > 0) {
      alert(
        `Folgende Artikel sind ausverkauft und können nicht bestellt werden: ${outOfStockItems.map((i) => i.product.name).join(", ")}`,
      );
      return;
    }

    setIsSubmitting(true);
    const idempotencyKey = crypto.randomUUID();
    const normalizedCheckoutTable = checkoutTableName?.trim();
    const nameToUse = normalizedCheckoutTable || tableName || "Unbekannt";
    const areaToUse =
      normalizedCheckoutTable && normalizedCheckoutTable !== tableName.trim()
        ? undefined
        : areaId;

    try {
      const orderItems = items.map((i) => ({
        productId: i.product.id,
        quantity: i.quantity,
        optionIds:
          i.selectedOptions && i.selectedOptions.length > 0
            ? i.selectedOptions.map((o) => o.id)
            : undefined,
      }));

      const eventId = items[0].product.eventId;

      await api.post("/orders", {
        eventId,
        items: orderItems,
        payments,
        idempotencyKey,
        tableName: nameToUse,
        areaId: areaToUse,
      });

      setSuccessMsg("Gesendet!");
      clearCart();
      setTableName("");
      setAreaId(undefined);
      setTimeout(() => setSuccessMsg(""), 2000);
    } catch (err: any) {
      console.error("Order submission failed", err);

      if (!shouldQueueOffline(err)) {
        alert(
          "Fehler bei der Buchung: " +
            (err.response?.data?.message || err.message),
        );
        return;
      }

      // Kein Kontext, keine Vormerkung (Kernpunkt des Issues, Befund B2):
      // ohne Benutzer und ohne verlässlich bekannte Betriebsart der
      // Veranstaltung wird nichts lokal gespeichert. `dataMode` ist offline
      // nicht abfragbar, deshalb der zuletzt bekannte, online geladene Wert
      // aus `eventContexts` (Entwurf Abschnitt 4).
      const eventId = items[0].product.eventId;
      const eventEntry = eventContexts.find((e) => e.id === eventId);
      const dataMode = eventEntry
        ? deriveDataMode(eventEntry.status, eventEntry.testMode)
        : null;

      if (!user || !dataMode) {
        alert(
          "Die Bestellung konnte nicht gesendet werden, und die Betriebsart (Test-/Echtbetrieb) dieser Veranstaltung ist gerade nicht bekannt. Bitte kurz auf eine Verbindung warten und danach erneut versuchen.",
        );
        return;
      }

      const context: OfflineCaptureContext = {
        userId: user.userId,
        username: user.username,
        userRole: user.role,
        eventId,
        eventName: eventEntry?.name ?? null,
        dataMode,
        cashierSessionId: eventEntry?.activeSession?.id ?? null,
      };

      const orderItems: OfflineOrderItemInput[] = items.map((i) => ({
        productId: i.product.id,
        quantity: i.quantity,
        optionIds:
          i.selectedOptions && i.selectedOptions.length > 0
            ? i.selectedOptions.map((o) => o.id)
            : [],
        productName: i.product.shortName || i.product.name || null,
        unitPriceAtCapture: i.finalPrice ?? null,
      }));

      try {
        await enqueueOfflineOrder({
          idempotencyKey,
          context,
          items: orderItems,
          payments: payments || [],
          tableName: nameToUse,
          areaId: areaToUse ?? null,
          totalAtCapture: total,
        });

        setSuccessMsg("Lokal vorgemerkt");
        clearCart();
        setTableName("");
        setAreaId(undefined);
        setTimeout(() => setSuccessMsg(""), 3000);
        void refreshOpenQueueCount();
      } catch (queueErr) {
        if (
          queueErr instanceof OfflineQueueFullError ||
          queueErr instanceof OfflineQueueUnavailableError
        ) {
          alert(queueErr.message);
        } else {
          console.error("Failed to enqueue offline order", queueErr);
          alert(
            "Die Bestellung konnte weder gesendet noch lokal vorgemerkt werden.",
          );
        }
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleTableClick = () => {
    setIsTableModalOpen(true);
  };

  const getProductColor = (p: any) => {
    if (p.color) return p.color;
    if (p.category?.name) {
      const idx = categories.indexOf(p.category.name);
      if (idx !== -1) return categoryColors[idx % categoryColors.length];
    }
    return "#334155";
  };

  if (isLoading)
    return (
      <div className="text-center py-20 animate-pulse text-slate-400">
        Lade Produkte...
      </div>
    );

  return (
    <div className="fixed inset-0 top-[64px] bg-white flex flex-col z-50 overflow-hidden">
      {/* Live Toast Notification */}
      {toastMessage && (
        <div
          className={`fixed top-20 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-2xl shadow-2xl flex items-center gap-3 animate-bounce border text-sm font-bold ${
            toastMessage.type === "warning"
              ? "bg-rose-600 border-rose-400 text-white shadow-rose-600/50"
              : "bg-amber-500 border-amber-300 text-slate-950 shadow-amber-500/50"
          }`}
        >
          <Bell className="w-5 h-5 animate-pulse" />
          <span>{toastMessage.text}</span>
        </div>
      )}

      {/* Dauerhafter Hinweis auf Verbindungszustand und offene Vormerkungen
          (Issue #65). Nie mit einer bestätigten Bestellung verwechselbar:
          eigener Wortlaut "vorgemerkt" statt "gesendet"/"bestätigt". */}
      <OfflineQueueIndicator
        openCount={openQueueCount}
        isOnline={isOnline}
        onOpen={() => setIsQueuePanelOpen(true)}
      />

      {/* Cart List (White background) */}
      <div className="flex-1 overflow-y-auto bg-white pb-2 touch-pan-y">
        {items.length === 0 ? (
          <div className="text-center text-slate-400 mt-10">
            Warenkorb ist leer
          </div>
        ) : (
          <div className="divide-y divide-slate-200">
            {items.map((item) => (
              <CartItem
                key={item.id}
                item={item}
                products={products}
                addItem={addItem}
                removeItem={removeItem}
                deleteItem={deleteItem}
                onEditOptions={handleEditOptions}
              />
            ))}
          </div>
        )}
      </div>

      {/* Category Slider & View Toggle */}
      <div className="shrink-0 bg-slate-900 flex items-center border-t-4 border-slate-800 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.1)]">
        <div className="flex-1 overflow-x-auto whitespace-nowrap scrollbar-hide">
          <div className="flex p-2 gap-2">
            <button
              onClick={() => setSelectedCategory(null)}
              className={`px-4 py-2 rounded-xl font-bold transition-colors ${!selectedCategory ? "bg-orange-500 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700"}`}
            >
              Alle
            </button>
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`px-4 py-2 rounded-xl font-bold transition-colors ${selectedCategory === cat ? "bg-orange-500 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700"}`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>
        <button
          onClick={() =>
            setViewMode((prev) => (prev === "grid" ? "list" : "grid"))
          }
          className="p-3 mr-2 bg-slate-800 text-slate-300 rounded-xl hover:bg-slate-700 transition-colors"
          aria-label="Ansicht umschalten"
        >
          {viewMode === "grid" ? (
            <List className="w-5 h-5" />
          ) : (
            <LayoutGrid className="w-5 h-5" />
          )}
        </button>
      </div>

      {/* Product List/Grid */}
      <div className="h-[40vh] bg-slate-800 overflow-y-auto shrink-0 overscroll-contain">
        {catalogError && products.length === 0 ? (
          // Ersetzt die leere Kachelfläche durch einen verständlichen
          // Hinweis mit Handauslöser (Issue #90) — statt der Kategorieleiste
          // ohne jede Erklärung, wie es bei der Abnahme zu #65 auffiel.
          <CatalogLoadError
            onRetry={handleCatalogRetryClick}
            isRetrying={isCatalogRetrying}
          />
        ) : viewMode === "grid" ? (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-1 p-1">
            {filteredProducts.map((p) => {
              const isOut = p.availability === "OUT_OF_STOCK";
              const isLow = p.availability === "LOW_STOCK";

              return (
                <button
                  key={p.id}
                  disabled={isOut}
                  onClick={() => handleProductClick(p)}
                  style={{
                    backgroundColor: isOut ? "#1e293b" : getProductColor(p),
                  }}
                  className={`aspect-square flex flex-col justify-center items-center text-center p-2 transition-all rounded-md relative overflow-hidden ${
                    isOut
                      ? "opacity-40 cursor-not-allowed border border-rose-500/60"
                      : "hover:opacity-85 active:scale-95"
                  }`}
                >
                  {isOut && (
                    <div className="absolute inset-0 bg-black/60 backdrop-blur-[1px] flex items-center justify-center p-1">
                      <span className="bg-rose-600 text-white font-black text-[10px] sm:text-xs px-1.5 py-0.5 rounded shadow-lg uppercase tracking-wider text-center">
                        Ausverkauft
                      </span>
                    </div>
                  )}

                  {isLow && (
                    <div className="absolute top-1 right-1">
                      <span className="bg-amber-400 text-slate-950 font-black text-[9px] px-1 py-0.5 rounded shadow-md uppercase">
                        Knapp
                      </span>
                    </div>
                  )}

                  <span
                    className={`font-bold drop-shadow-md text-sm md:text-base leading-tight ${isOut ? "line-through text-slate-400" : "text-white"}`}
                  >
                    {p.shortName || p.name}
                  </span>
                  <span
                    className={`text-xs mt-1 drop-shadow-md ${isOut ? "text-slate-500" : "text-white/80"}`}
                  >
                    {getTilePriceLabel(p)}
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="flex flex-col gap-1 p-1">
            {filteredProducts.map((p) => {
              const isOut = p.availability === "OUT_OF_STOCK";
              const isLow = p.availability === "LOW_STOCK";

              return (
                <button
                  key={p.id}
                  disabled={isOut}
                  onClick={() => handleProductClick(p)}
                  style={{
                    backgroundColor: isOut ? "#1e293b" : getProductColor(p),
                  }}
                  className={`flex justify-between items-center text-left p-4 transition-all rounded-md relative ${
                    isOut
                      ? "opacity-40 cursor-not-allowed border border-rose-500/60"
                      : "hover:opacity-85 active:scale-98"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`font-bold text-lg drop-shadow-md ${isOut ? "line-through text-slate-400" : "text-white"}`}
                    >
                      {p.name}
                    </span>
                    {isOut && (
                      <span className="bg-rose-600 text-white text-xs px-2 py-0.5 rounded font-black uppercase">
                        Ausverkauft
                      </span>
                    )}
                    {isLow && (
                      <span className="bg-amber-400 text-slate-950 text-xs px-2 py-0.5 rounded font-black uppercase">
                        Knapp
                      </span>
                    )}
                  </div>
                  <span
                    className={`font-bold text-lg drop-shadow-md ${isOut ? "text-slate-500" : "text-white"}`}
                  >
                    {getTilePriceLabel(p)}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Bottom Action Bar (Orange) */}
      <div className="bg-orange-500 text-white p-3 flex justify-between items-center shadow-[0_-4px_10px_rgba(0,0,0,0.2)] shrink-0 h-[72px] pb-safe">
        <button
          onClick={clearCart}
          className="p-3 hover:bg-orange-600 rounded-full transition-colors"
          aria-label="Warenkorb leeren"
        >
          <Trash2 className="w-6 h-6" />
        </button>

        <div
          className="flex-1 flex justify-center items-center gap-2 sm:gap-4 text-lg font-bold cursor-pointer hover:bg-orange-600 p-2 rounded-lg transition-colors mx-2"
          onClick={handleTableClick}
        >
          <span>{tableName ? tableName : "Tisch?"}</span>
          <span className="opacity-60">|</span>
          <span>{formatPrice(total)}</span>
        </div>

        <button
          onClick={() => setIsCheckoutOpen(true)}
          disabled={items.length === 0 || isSubmitting}
          className="flex items-center gap-2 font-bold tracking-wide bg-white text-orange-600 hover:bg-orange-100 px-5 py-3 rounded-xl transition-colors disabled:opacity-50 disabled:bg-white/50"
        >
          {isSubmitting ? "..." : successMsg ? "OK" : "Zahlen"}
          {!isSubmitting && !successMsg && <Check className="w-5 h-5" />}
        </button>
      </div>

      <CheckoutModal
        isOpen={isCheckoutOpen}
        total={total}
        initialTableName={tableName}
        onClose={() => setIsCheckoutOpen(false)}
        onConfirm={handleCheckoutSubmit}
      />

      <ProductOptionsModal
        product={optionsModalProduct}
        isOpen={isOptionsModalOpen}
        onClose={closeOptionsModal}
        onAdd={handleOptionsSubmit}
        mode={editingCartItem ? "edit" : "add"}
        initialSelectedOptions={editingCartItem?.selectedOptions}
      />

      <TableSelectionModal
        isOpen={isTableModalOpen}
        onClose={() => setIsTableModalOpen(false)}
        onSelect={(table, selectedAreaId) => {
          setTableName(table);
          setAreaId(selectedAreaId);
        }}
        eventId={products.length > 0 ? products[0].eventId : null}
      />

      <OfflineQueuePanel
        isOpen={isQueuePanelOpen}
        onClose={() => setIsQueuePanelOpen(false)}
        httpClient={api}
        currentUser={
          user
            ? { userId: user.userId, username: user.username, role: user.role }
            : null
        }
        eventContexts={eventContexts}
        onQueueChanged={refreshOpenQueueCount}
      />
    </div>
  );
};
