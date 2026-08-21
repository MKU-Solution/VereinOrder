import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  Play,
  Star,
  Layers,
  AlertCircle,
  CheckCircle,
  XCircle,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

interface StationProduct {
  id: string;
  name: string;
  availability: "AVAILABLE" | "LOW_STOCK" | "OUT_OF_STOCK" | "DISABLED";
  price: number;
}

export const StationView = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [items, setItems] = useState<any[]>([]);
  const [stationProducts, setStationProducts] = useState<StationProduct[]>([]);
  const [showStockPanel, setShowStockPanel] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(new Date());

  const fetchItems = useCallback(async () => {
    try {
      const res = await api.get(`/stations/${id}/items`);
      setItems(res.data);
      setLastUpdated(new Date());
    } catch (err) {
      console.error("Failed to fetch station items", err);
    }
  }, [id]);

  const fetchStationProducts = useCallback(async () => {
    try {
      const res = await api.get(`/products/station/${id}`);
      setStationProducts(res.data);
    } catch (err) {
      console.error("Failed to fetch station products", err);
    }
  }, [id]);

  // Polling every 5 seconds for orders
  useEffect(() => {
    fetchItems();
    fetchStationProducts();
    const interval = setInterval(fetchItems, 5000);
    return () => clearInterval(interval);
  }, [fetchItems, fetchStationProducts]);

  const handleSetAvailability = async (
    productId: string,
    availability: "AVAILABLE" | "LOW_STOCK" | "OUT_OF_STOCK",
  ) => {
    setStationProducts((prev) =>
      prev.map((p) => (p.id === productId ? { ...p, availability } : p)),
    );
    try {
      await api.patch(`/products/${productId}/availability`, { availability });
    } catch (err) {
      console.error("Failed to update availability", err);
      fetchStationProducts();
    }
  };

  const startPreparing = async (itemId: string) => {
    setItems((prev) =>
      prev.map((i) => (i.id === itemId ? { ...i, status: "PREPARING" } : i)),
    );
    try {
      await api.patch(`/stations/items/${itemId}/status`, {
        status: "PREPARING",
      });
    } catch (err) {
      console.error("Failed to start preparing", err);
      fetchItems();
    }
  };

  const markAsReady = async (itemId: string) => {
    setItems((prev) => prev.filter((i) => i.id !== itemId));
    try {
      await api.patch(`/stations/items/${itemId}/status`, { status: "READY" });
    } catch (err) {
      console.error("Failed to mark as ready", err);
      fetchItems();
    }
  };

  const togglePriority = async (orderId: string, currentPriority: boolean) => {
    const newPriority = !currentPriority;
    setItems((prev) =>
      prev.map((i) =>
        i.order.id === orderId
          ? { ...i, order: { ...i.order, isPriority: newPriority } }
          : i,
      ),
    );
    try {
      await api.patch(`/orders/${orderId}/priority`, {
        isPriority: newPriority,
      });
    } catch (err) {
      console.error("Failed to toggle priority", err);
      fetchItems();
    }
  };

  const formatTime = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  const getWaitTime = (createdAt: string) => {
    const diff = new Date().getTime() - new Date(createdAt).getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return "Gerade eben";
    return `vor ${minutes} Min`;
  };

  return (
    <div className="space-y-6">
      {/* Header Bar */}
      <div className="flex items-center justify-between glass p-4 rounded-2xl sticky top-24 z-10">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate("/stations")}
            className="p-2 hover:bg-slate-800 rounded-xl transition-colors"
          >
            <ArrowLeft className="w-6 h-6 text-slate-300" />
          </button>
          <h1 className="text-2xl font-bold">Küchenmonitor</h1>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowStockPanel((prev) => !prev)}
            className={`px-4 py-2 rounded-xl font-bold text-sm flex items-center gap-2 transition-all border ${
              showStockPanel
                ? "bg-indigo-600 border-indigo-500 text-white shadow-lg shadow-indigo-600/30"
                : "bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700"
            }`}
          >
            <Layers className="w-4 h-4 text-amber-400" />
            <span>Artikel-Verfügbarkeit ({stationProducts.length})</span>
            {showStockPanel ? (
              <ChevronUp className="w-4 h-4" />
            ) : (
              <ChevronDown className="w-4 h-4" />
            )}
          </button>

          <div className="text-sm text-slate-400 hidden sm:flex items-center gap-2 pl-2">
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
            </span>
            Live (Aktualisiert: {lastUpdated.toLocaleTimeString()})
          </div>
        </div>
      </div>

      {/* Stock / Availability Control Panel */}
      {showStockPanel && (
        <div className="glass p-5 rounded-3xl animate-slide-up border-amber-500/30 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-amber-400 font-bold">
              <AlertCircle className="w-5 h-5" />
              <span>Ausverkauft- und Bestandssteuerung für diese Station</span>
            </div>
            <span className="text-xs text-slate-400">
              Änderungen werden sofort live an alle Kellner übertragen
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {stationProducts.map((p) => (
              <div
                key={p.id}
                className="bg-slate-900/80 border border-slate-800 p-3.5 rounded-2xl space-y-2.5"
              >
                <div className="flex justify-between items-start">
                  <span className="font-bold text-slate-200 text-base leading-tight">
                    {p.name}
                  </span>
                  <span
                    className={`text-xs px-2 py-0.5 rounded-md font-bold ${
                      p.availability === "AVAILABLE"
                        ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                        : p.availability === "LOW_STOCK"
                          ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                          : "bg-rose-500/20 text-rose-400 border border-rose-500/30"
                    }`}
                  >
                    {p.availability === "AVAILABLE"
                      ? "Verfügbar"
                      : p.availability === "LOW_STOCK"
                        ? "Knapp"
                        : "Ausverkauft"}
                  </span>
                </div>

                <div className="flex gap-1.5 pt-1">
                  <button
                    onClick={() => handleSetAvailability(p.id, "AVAILABLE")}
                    className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1 ${
                      p.availability === "AVAILABLE"
                        ? "bg-emerald-600 text-white shadow-md shadow-emerald-600/30"
                        : "bg-slate-800 text-slate-400 hover:text-emerald-400"
                    }`}
                  >
                    <CheckCircle className="w-3.5 h-3.5" />
                    OK
                  </button>

                  <button
                    onClick={() => handleSetAvailability(p.id, "LOW_STOCK")}
                    className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1 ${
                      p.availability === "LOW_STOCK"
                        ? "bg-amber-500 text-slate-950 font-black shadow-md shadow-amber-500/30"
                        : "bg-slate-800 text-slate-400 hover:text-amber-300"
                    }`}
                  >
                    <AlertCircle className="w-3.5 h-3.5" />
                    Knapp
                  </button>

                  <button
                    onClick={() => handleSetAvailability(p.id, "OUT_OF_STOCK")}
                    className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1 ${
                      p.availability === "OUT_OF_STOCK"
                        ? "bg-rose-600 text-white shadow-md shadow-rose-600/30"
                        : "bg-slate-800 text-slate-400 hover:text-rose-400"
                    }`}
                  >
                    <XCircle className="w-3.5 h-3.5" />
                    Aus
                  </button>
                </div>
              </div>
            ))}
            {stationProducts.length === 0 && (
              <p className="text-slate-500 text-sm col-span-3 py-2">
                Dieser Station sind noch keine Produkte zugeordnet.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Orders Grid */}
      {items.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-64 text-slate-500 space-y-4">
          <CheckCircle2 className="w-16 h-16 text-slate-700" />
          <p className="text-xl">Keine offenen Bestellungen</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {items.map((item) => (
            <div
              key={item.id}
              className={`glass border-l-4 p-6 rounded-2xl flex flex-col justify-between animate-slide-up shadow-xl shadow-black/50 ${item.order?.isPriority ? "border-l-rose-500 bg-rose-950/20" : item.status === "PREPARING" ? "border-l-amber-500 bg-amber-950/10" : "border-l-indigo-500"}`}
            >
              <div className="flex justify-between items-start mb-4">
                <div>
                  <div className="text-5xl font-black text-white mb-2">
                    {item.quantity}x
                  </div>
                  <div className="text-2xl font-bold text-slate-200">
                    {item.product.name}
                  </div>
                  {(item.variantName ||
                    (item.extras && item.extras.length > 0)) && (
                    <div className="text-sm text-slate-400 mt-2 font-medium bg-slate-800/50 p-2 rounded-lg inline-block">
                      {item.variantName && <div>• {item.variantName}</div>}
                      {item.extras?.map((e: any) => (
                        <div key={e.id}>+ {e.name}</div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="text-right flex flex-col items-end">
                  <div className="flex items-center gap-2 mb-2">
                    <button
                      onClick={() =>
                        togglePriority(item.order.id, item.order.isPriority)
                      }
                      className={`p-2 rounded-full transition-colors ${item.order?.isPriority ? "text-rose-400 bg-rose-400/20" : "text-slate-500 hover:text-slate-300 hover:bg-slate-700"}`}
                      aria-label="Priorität umschalten"
                    >
                      <Star
                        className={`w-6 h-6 ${item.order?.isPriority ? "fill-current" : ""}`}
                      />
                    </button>
                  </div>
                  <div className="text-xs text-slate-400 uppercase font-semibold">
                    Bestellung
                  </div>
                  <div className="text-xl font-mono text-indigo-400 font-bold">
                    #{item.order?.orderNumber}
                  </div>
                  <div className="text-sm text-slate-500 mt-1">
                    {formatTime(item.order?.createdAt)}
                  </div>
                  <div className="flex items-center gap-1 text-sm font-semibold mt-2 text-slate-300">
                    <Clock className="w-4 h-4" />
                    {getWaitTime(item.order?.createdAt)}
                  </div>
                </div>
              </div>

              <div className="mt-4 flex gap-2">
                {item.status === "PENDING" ? (
                  <button
                    onClick={() => startPreparing(item.id)}
                    className="flex-1 bg-amber-600/20 hover:bg-amber-600/30 text-amber-500 border border-amber-500/50 font-bold py-4 rounded-xl transition-all active:scale-95 flex justify-center items-center gap-2 text-lg"
                  >
                    <Play className="w-6 h-6" />
                    Zubereitung starten
                  </button>
                ) : (
                  <button
                    onClick={() => markAsReady(item.id)}
                    className="flex-1 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 border border-emerald-500/50 font-bold py-4 rounded-xl transition-all active:scale-95 flex justify-center items-center gap-2 text-lg"
                  >
                    <CheckCircle2 className="w-6 h-6" />
                    Erledigt
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
