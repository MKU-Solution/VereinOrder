import { useEffect, useState } from "react";
import { api } from "../lib/api";
import {
  Clock,
  RefreshCw,
  CheckCircle,
  Settings2,
  Printer,
  SplitSquareHorizontal,
} from "lucide-react";
import { CheckoutModal } from "../components/CheckoutModal";
import { OrderDetailsModal } from "../components/OrderDetailsModal";
import { OrderSplitModal } from "../components/OrderSplitModal";

export const UnpaidOrders = () => {
  const [orders, setOrders] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<any | null>(null);
  const [splittingOrder, setSplittingOrder] = useState<any | null>(null);
  const [editingOrder, setEditingOrder] = useState<any | null>(null);

  const fetchOrders = async () => {
    try {
      const productsRes = await api.get("/products");
      if (productsRes.data.length > 0) {
        const eId = productsRes.data[0].eventId;
        const res = await api.get(`/orders/unpaid?eventId=${eId}`);
        setOrders(res.data);
      }
    } catch (err) {
      console.error("Failed to load unpaid orders", err);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    fetchOrders();
    const interval = setInterval(() => {
      fetchOrders();
    }, 10000); // Poll every 10s
    return () => clearInterval(interval);
  }, []);

  const handleRefresh = () => {
    setIsRefreshing(true);
    fetchOrders();
  };

  const handlePaymentConfirm = async (
    payments: { amount: number; method: "CASH" | "CARD" | "VOUCHER" }[],
  ) => {
    if (!selectedOrder || payments.length === 0) {
      setSelectedOrder(null);
      return;
    }

    try {
      await api.post(`/orders/${selectedOrder.id}/payments`, { payments });
      setSelectedOrder(null);
      fetchOrders();
    } catch (err: any) {
      console.error("Payment failed", err);
      alert(err.response?.data?.message || "Fehler bei der Zahlung!");
    }
  };

  const handleSplitPaymentConfirm = async (
    items: { orderItemId: string; quantity: number }[],
    payments: { amount: number; method: "CASH" | "CARD" }[],
  ) => {
    if (!splittingOrder) return;
    await api.post(`/orders/${splittingOrder.id}/split-payment`, {
      items,
      payments,
    });
    setSplittingOrder(null);
    fetchOrders();
  };

  const handleReprintOrder = async (orderId: string) => {
    try {
      await api.post(`/orders/${orderId}/reprint`);
      alert("Nachdruckauftrag erfolgreich an die Drucker gesendet!");
    } catch (err) {
      console.error("Reprint failed", err);
      alert("Fehler beim Nachdrucken!");
    }
  };

  const formatPrice = (cents: number) => `€ ${(cents / 100).toFixed(2)}`;

  if (isLoading)
    return (
      <div className="text-center py-20 animate-pulse text-slate-400">
        Lade offene Bestellungen...
      </div>
    );

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold flex items-center gap-2">
          <Clock className="w-6 h-6 text-orange-400" />
          Offene Bestellungen
        </h2>
        <button
          onClick={handleRefresh}
          className={`p-2 glass rounded-xl hover:bg-slate-700 transition-colors ${isRefreshing ? "animate-spin" : ""}`}
        >
          <RefreshCw className="w-5 h-5 text-slate-300" />
        </button>
      </div>

      <div className="space-y-10">
        {Object.entries(
          orders.reduce((acc: any, order: any) => {
            const key = order.tableName || "Ohne Tisch / Theke";
            if (!acc[key]) acc[key] = [];
            acc[key].push(order);
            return acc;
          }, {}),
        ).map(([tableName, groupOrders]: [string, any]) => (
          <div key={tableName} className="space-y-4">
            <h3 className="text-xl font-bold text-slate-200 border-b border-slate-700/50 pb-2">
              {tableName}
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {groupOrders.map((order: any) => {
                const totalPaid = order.payments.reduce(
                  (sum: number, p: any) => sum + p.amount,
                  0,
                );
                const remainingAmount = Math.max(
                  0,
                  order.totalAmount - totalPaid,
                );
                const isPartiallyPaid =
                  order.paymentStatus === "PARTIALLY_PAID" || totalPaid > 0;

                return (
                  <div
                    key={order.id}
                    className="glass p-6 rounded-3xl flex flex-col gap-4 border border-slate-700/50"
                  >
                    <div className="flex justify-between items-start">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="bg-slate-800 text-slate-300 px-3 py-1 rounded-full text-sm font-medium">
                          #{order.orderNumber}
                        </span>
                        <span className="text-xs font-medium text-slate-500 bg-slate-800/50 px-2 py-1 rounded-md">
                          {order.lifecycleStatus}
                        </span>
                        {isPartiallyPaid && (
                          <span className="text-xs font-semibold text-amber-300 bg-amber-950/60 border border-amber-700/50 px-2 py-0.5 rounded-full">
                            Teilweise bezahlt
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-lg font-bold mr-2">
                          {formatPrice(order.totalAmount)}
                        </span>
                        <button
                          onClick={() => handleReprintOrder(order.id)}
                          title="Bons/Beleg nachdrucken"
                          className="p-2 hover:bg-slate-700 rounded-xl transition-colors text-indigo-400 hover:text-indigo-300"
                        >
                          <Printer className="w-5 h-5" />
                        </button>
                        <button
                          onClick={() => setEditingOrder(order)}
                          title="Bestellung bearbeiten / stornieren"
                          className="p-2 hover:bg-slate-700 rounded-xl transition-colors text-slate-400"
                        >
                          <Settings2 className="w-5 h-5" />
                        </button>
                      </div>
                    </div>

                    {/* Positions */}
                    <div className="flex-1 space-y-2">
                      {order.items.map((item: any) => {
                        const paidQty = item.paidQuantity ?? 0;
                        const unpaidQty = Math.max(0, item.quantity - paidQty);
                        const isDone = unpaidQty === 0;

                        return (
                          <div
                            key={item.id}
                            className={`flex justify-between text-sm items-center ${
                              item.status === "CANCELLED"
                                ? "text-slate-600 line-through"
                                : isDone
                                  ? "text-slate-500"
                                  : "text-slate-300"
                            }`}
                          >
                            <div className="flex items-center gap-2">
                              <span>
                                {item.quantity}x {item.product.name}{" "}
                                {item.variantName
                                  ? `(${item.variantName})`
                                  : ""}
                              </span>
                              {paidQty > 0 && !isDone && (
                                <span className="text-[11px] bg-slate-800 text-amber-300 px-1.5 py-0.5 rounded">
                                  {paidQty} bezahlt, {unpaidQty} offen
                                </span>
                              )}
                              {isDone && (
                                <span className="text-[11px] bg-emerald-950/60 text-emerald-400 px-1.5 py-0.5 rounded">
                                  Bezahlt
                                </span>
                              )}
                            </div>
                            <span className="font-medium">
                              {formatPrice(item.priceAtTime * item.quantity)}
                            </span>
                          </div>
                        );
                      })}
                    </div>

                    {totalPaid > 0 && (
                      <div className="pt-3 border-t border-slate-700/50 space-y-1">
                        <div className="flex justify-between text-sm text-slate-400">
                          <span>Bereits bezahlt:</span>
                          <span className="text-emerald-400 font-semibold">
                            {formatPrice(totalPaid)}
                          </span>
                        </div>
                        {order.payments.map((p: any) => (
                          <div
                            key={p.id}
                            className="flex justify-between text-xs text-slate-500"
                          >
                            <span>
                              {p.method === "CASH"
                                ? "Bar"
                                : p.method === "REFUND"
                                  ? "Erstattung"
                                  : "Karte"}
                            </span>
                            <span>
                              {p.method === "REFUND" ? "-" : ""}
                              {formatPrice(Math.abs(p.amount))}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Footer Actions */}
                    <div className="pt-4 border-t border-slate-700/50 flex flex-col sm:flex-row justify-between sm:items-center gap-3">
                      <div>
                        <div className="text-xs text-slate-400 font-medium">
                          Noch offen
                        </div>
                        <div
                          className={`text-2xl font-bold ${remainingAmount > 0 ? "text-orange-400" : "text-emerald-400"}`}
                        >
                          {formatPrice(remainingAmount)}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          disabled={remainingAmount <= 0}
                          onClick={() => setSplittingOrder(order)}
                          className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 bg-slate-800/80 hover:bg-slate-700 text-purple-300 border border-purple-500/30 px-3.5 py-2.5 rounded-xl font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          <SplitSquareHorizontal className="w-4 h-4 text-purple-400" />
                          Splitten
                        </button>
                        <button
                          type="button"
                          disabled={remainingAmount <= 0}
                          onClick={() =>
                            setSelectedOrder({ ...order, remainingAmount })
                          }
                          className="flex-1 sm:flex-none bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white px-4 py-2.5 rounded-xl font-bold transition-all shadow-md shadow-indigo-950/30"
                        >
                          Voll abkassieren
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        {orders.length === 0 && (
          <div className="col-span-full py-20 text-center text-slate-500 glass rounded-3xl">
            <CheckCircle className="w-12 h-12 mx-auto mb-4 text-emerald-500/50" />
            <p className="text-xl">Keine offenen Bestellungen</p>
          </div>
        )}
      </div>

      <CheckoutModal
        isOpen={selectedOrder !== null}
        total={selectedOrder ? selectedOrder.remainingAmount : 0}
        onClose={() => setSelectedOrder(null)}
        onConfirm={handlePaymentConfirm}
      />

      <OrderSplitModal
        isOpen={splittingOrder !== null}
        order={splittingOrder}
        onClose={() => setSplittingOrder(null)}
        onConfirm={handleSplitPaymentConfirm}
      />

      <OrderDetailsModal
        order={editingOrder}
        isOpen={editingOrder !== null}
        onClose={() => setEditingOrder(null)}
        onRefresh={fetchOrders}
      />
    </div>
  );
};
