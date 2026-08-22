import { useEffect, useState, useMemo } from "react";
import { api } from "../lib/api";
import { useCartStore, CartItem as CartItemType } from "../store/useCartStore";
import { Trash2, Check, LayoutGrid, List, Minus, Bell } from "lucide-react";
import { CheckoutModal } from "../components/CheckoutModal";
import { ProductOptionsModal } from "../components/ProductOptionsModal";
import { TableSelectionModal } from "../components/TableSelectionModal";

const formatPrice = (cents: number) => `€ ${(cents / 100).toFixed(2)}`;

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
  addItem,
  removeItem,
  deleteItem,
}: {
  item: CartItemType;
  addItem: (
    product: any,
    selectedOptions?: CartItemType["selectedOptions"],
  ) => void;
  removeItem: (id: string) => void;
  deleteItem: (id: string) => void;
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

  const isOutOfStock = item.product?.availability === "OUT_OF_STOCK";

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
          onClick={(e) => {
            e.stopPropagation();
            addItem(item.product, item.selectedOptions);
          }}
          className="w-12 min-h-[44px] flex items-center justify-center text-center text-lg font-bold text-slate-800"
          aria-label={`Menge von ${item.product.shortName || item.product.name} erhöhen`}
        >
          {item.quantity}
        </button>
        <div className="flex-1 truncate pr-2">
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
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");

  // Realtime Toast State
  const [toastMessage, setToastMessage] = useState<{
    text: string;
    type: "warning" | "info";
  } | null>(null);

  const { items, addItem, removeItem, deleteItem, clearCart, total } =
    useCartStore();

  const fetchProducts = async () => {
    try {
      const res = await api.get("/products");
      setProducts(res.data);
    } catch (err) {
      console.error("Failed to load products", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchProducts();

    const syncOffline = async () => {
      try {
        const { getOfflineOrders, removeOfflineOrder } = await import(
          "../lib/offlineSync"
        );
        const offlineOrders = await getOfflineOrders();
        for (const order of offlineOrders) {
          try {
            await api.post("/orders", {
              eventId: order.eventId,
              items: order.items,
              payments: order.payments,
              idempotencyKey: order.idempotencyKey,
              tableName: order.tableName,
              areaId: order.areaId,
            });
            await removeOfflineOrder(order.idempotencyKey);
          } catch (e) {
            console.error("Failed to sync offline order", e);
          }
        }
      } catch (err) {
        console.error("Offline sync error", err);
      }
    };

    syncOffline();
    window.addEventListener("online", syncOffline);
    return () => window.removeEventListener("online", syncOffline);
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

  const handleCheckoutSubmit = async (
    payments?: { amount: number; method: "CASH" | "CARD" | "VOUCHER" }[],
    checkoutTableName?: string,
  ) => {
    if (items.length === 0) return;

    // Check if any cart items are out of stock
    const outOfStockItems = items.filter(
      (i) => i.product?.availability === "OUT_OF_STOCK",
    );
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
      console.error("Order submission failed, saving offline", err);

      if (!navigator.onLine || err.code === "ERR_NETWORK") {
        const { saveOrderOffline } = await import("../lib/offlineSync");
        const orderItems = items.map((i) => ({
          productId: i.product.id,
          quantity: i.quantity,
          optionIds:
            i.selectedOptions && i.selectedOptions.length > 0
              ? i.selectedOptions.map((o) => o.id)
              : undefined,
        }));
        const eventId = items[0].product.eventId;

        await saveOrderOffline({
          idempotencyKey,
          eventId,
          items: orderItems,
          payments: payments || [],
          tableName: nameToUse,
          areaId: areaToUse,
          createdAt: Date.now(),
        });

        setSuccessMsg("Offline gespeichert!");
        clearCart();
        setTableName("");
        setAreaId(undefined);
        setTimeout(() => setSuccessMsg(""), 3000);
      } else {
        alert(
          "Fehler bei der Buchung: " +
            (err.response?.data?.message || err.message),
        );
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
                addItem={addItem}
                removeItem={removeItem}
                deleteItem={deleteItem}
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
        {viewMode === "grid" ? (
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
        product={selectedProductForOptions}
        isOpen={!!selectedProductForOptions}
        onClose={() => setSelectedProductForOptions(null)}
        onAdd={addItem}
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
    </div>
  );
};
