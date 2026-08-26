import { useState, useEffect } from "react";
import {
  X,
  Coins,
  CreditCard,
  Plus,
  Minus,
  Check,
  Sparkles,
} from "lucide-react";

interface OrderItemOption {
  id: string;
  name: string;
  price?: number;
}

interface OrderItem {
  id: string;
  quantity: number;
  paidQuantity?: number;
  priceAtTime: number;
  variantName?: string | null;
  extras?: OrderItemOption[] | null;
  product: {
    id: string;
    name: string;
  };
}

interface Order {
  id: string;
  orderNumber: number;
  tableName?: string | null;
  totalAmount: number;
  items: OrderItem[];
  payments?: { amount: number }[];
}

interface OrderSplitModalProps {
  isOpen: boolean;
  order: Order | null;
  onClose: () => void;
  onConfirm: (
    items: { orderItemId: string; quantity: number }[],
    payments: { amount: number; method: "CASH" | "CARD" }[],
  ) => Promise<void>;
}

export const OrderSplitModal = ({
  isOpen,
  order,
  onClose,
  onConfirm,
}: OrderSplitModalProps) => {
  const [selectedQuantities, setSelectedQuantities] = useState<
    Record<string, number>
  >({});
  const [paymentMethod, setPaymentMethod] = useState<"CASH" | "CARD">("CASH");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && order) {
      const initial: Record<string, number> = {};
      for (const item of order.items) {
        initial[item.id] = 0;
      }
      setSelectedQuantities(initial);
      setPaymentMethod("CASH");
      setIsSubmitting(false);
      setErrorMessage(null);
    }
  }, [isOpen, order]);

  if (!isOpen || !order) return null;

  const formatPrice = (cents: number) => `€ ${(cents / 100).toFixed(2)}`;

  const totalPaidSoFar =
    order.payments?.reduce((sum, p) => sum + p.amount, 0) ?? 0;
  const totalRemainingOrder = Math.max(0, order.totalAmount - totalPaidSoFar);

  const selectedItemsPayload = Object.entries(selectedQuantities)
    .filter(([, qty]) => qty > 0)
    .map(([orderItemId, quantity]) => ({ orderItemId, quantity }));

  const selectedTotalCents = Object.entries(selectedQuantities).reduce(
    (sum, [itemId, qty]) => {
      const item = order.items.find((i) => i.id === itemId);
      return sum + (item ? item.priceAtTime * qty : 0);
    },
    0,
  );

  const remainingAfterSplitCents = Math.max(
    0,
    totalRemainingOrder - selectedTotalCents,
  );

  const handleSetQuantity = (itemId: string, qty: number, maxQty: number) => {
    const clamped = Math.max(0, Math.min(qty, maxQty));
    setSelectedQuantities((prev) => ({
      ...prev,
      [itemId]: clamped,
    }));
  };

  const handleSelectAllRemaining = () => {
    const all: Record<string, number> = {};
    for (const item of order.items) {
      const unpaid = item.quantity - (item.paidQuantity ?? 0);
      all[item.id] = Math.max(0, unpaid);
    }
    setSelectedQuantities(all);
  };

  const handleResetSelection = () => {
    const reset: Record<string, number> = {};
    for (const item of order.items) {
      reset[item.id] = 0;
    }
    setSelectedQuantities(reset);
  };

  const handleSubmit = async () => {
    if (selectedItemsPayload.length === 0 || selectedTotalCents <= 0) {
      setErrorMessage("Bitte wähle mindestens eine Position zum Bezahlen aus.");
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      await onConfirm(selectedItemsPayload, [
        { amount: selectedTotalCents, method: paymentMethod },
      ]);
    } catch (err: any) {
      setErrorMessage(
        err.response?.data?.message ||
          "Fehler beim Durchführen der Teilzahlung.",
      );
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-md animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-labelledby="split-modal-title"
    >
      <div className="glass rounded-3xl w-full max-w-2xl p-6 sm:p-8 relative max-h-[90vh] flex flex-col bg-slate-900/95 border border-slate-700/80 shadow-2xl">
        {/* Header */}
        <div className="flex justify-between items-start pb-4 border-b border-slate-800">
          <div>
            <div className="flex items-center gap-3">
              <span className="bg-indigo-500/20 text-indigo-300 font-semibold px-3 py-1 rounded-full text-xs">
                Bestellung #{order.orderNumber}
              </span>
              <span className="text-slate-400 text-sm font-medium">
                {order.tableName || "Ohne Tisch / Theke"}
              </span>
            </div>
            <h2
              id="split-modal-title"
              className="text-2xl font-bold text-slate-100 mt-1"
            >
              Rechnung aufteilen / Teilzahlung
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white rounded-xl hover:bg-slate-800 transition-colors"
            aria-label="Schließen"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Quick Actions */}
        <div className="flex flex-wrap gap-2 py-3">
          <button
            type="button"
            onClick={handleSelectAllRemaining}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-indigo-600/30 text-indigo-200 hover:bg-indigo-600/50 border border-indigo-500/30 transition-all flex items-center gap-1.5"
          >
            <Sparkles className="w-3.5 h-3.5" />
            Alle offenen auswählen
          </button>
          <button
            type="button"
            onClick={handleResetSelection}
            className="text-xs font-medium px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 transition-all"
          >
            Auswahl zurücksetzen
          </button>
        </div>

        {/* Items List */}
        <div className="overflow-y-auto flex-1 py-2 space-y-3 pr-1">
          {order.items.map((item) => {
            const paidQty = item.paidQuantity ?? 0;
            const unpaidQty = Math.max(0, item.quantity - paidQty);
            const isFullyPaid = unpaidQty === 0;
            const currentSelected = selectedQuantities[item.id] || 0;

            return (
              <div
                key={item.id}
                className={`p-4 rounded-2xl border transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                  isFullyPaid
                    ? "bg-slate-950/40 border-slate-800/60 opacity-60"
                    : currentSelected > 0
                      ? "bg-indigo-950/30 border-indigo-500/50 shadow-sm shadow-indigo-950/50"
                      : "bg-slate-800/40 border-slate-700/50 hover:border-slate-600"
                }`}
              >
                {/* Product info */}
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-100 text-base">
                      {item.product.name}
                    </span>
                    {item.variantName && (
                      <span className="text-xs px-2 py-0.5 rounded bg-slate-700/50 text-slate-300">
                        {item.variantName}
                      </span>
                    )}
                  </div>

                  {Array.isArray(item.extras) && item.extras.length > 0 && (
                    <div className="text-xs text-slate-400 mt-0.5">
                      + {item.extras.map((e) => e.name).join(", ")}
                    </div>
                  )}

                  <div className="flex items-center gap-3 text-xs mt-1 text-slate-400">
                    <span>Einzelpreis: {formatPrice(item.priceAtTime)}</span>
                    <span>•</span>
                    <span>
                      Bestellt: {item.quantity} |{" "}
                      <span className={paidQty > 0 ? "text-emerald-400" : ""}>
                        Bezahlt: {paidQty}
                      </span>{" "}
                      |{" "}
                      <span className="text-amber-300 font-medium">
                        Offen: {unpaidQty}
                      </span>
                    </span>
                  </div>
                </div>

                {/* Stepper / Paid state */}
                {isFullyPaid ? (
                  <div className="flex items-center gap-1.5 text-xs text-emerald-400 font-semibold bg-emerald-950/40 px-3 py-1.5 rounded-xl border border-emerald-800/40">
                    <Check className="w-4 h-4" />
                    Vollständig bezahlt
                  </div>
                ) : (
                  <div className="flex items-center gap-3 self-end sm:self-center">
                    <div className="flex items-center gap-1 bg-slate-900 border border-slate-700 rounded-xl p-1">
                      <button
                        type="button"
                        onClick={() =>
                          handleSetQuantity(
                            item.id,
                            currentSelected - 1,
                            unpaidQty,
                          )
                        }
                        disabled={currentSelected === 0}
                        aria-label={`Menge für ${item.product.name} verringern`}
                        className="w-9 h-9 flex items-center justify-center rounded-lg bg-slate-800 text-slate-200 hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      >
                        <Minus className="w-4 h-4" />
                      </button>
                      <span
                        data-testid={`selected-qty-${item.id}`}
                        className="w-10 text-center font-bold text-slate-100 text-base"
                      >
                        {currentSelected}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          handleSetQuantity(
                            item.id,
                            currentSelected + 1,
                            unpaidQty,
                          )
                        }
                        disabled={currentSelected >= unpaidQty}
                        aria-label={`Menge für ${item.product.name} erhöhen`}
                        className="w-9 h-9 flex items-center justify-center rounded-lg bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      >
                        <Plus className="w-4 h-4" />
                      </button>
                    </div>

                    <div className="text-right min-w-[70px]">
                      <div className="text-sm font-bold text-indigo-300">
                        {formatPrice(item.priceAtTime * currentSelected)}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Error message */}
        {errorMessage && (
          <div className="p-3 bg-rose-500/20 border border-rose-500/40 rounded-xl text-rose-300 text-sm font-medium mt-2">
            {errorMessage}
          </div>
        )}

        {/* Summary & Payment selection */}
        <div className="pt-4 border-t border-slate-800 space-y-4">
          <div className="grid grid-cols-2 gap-4 bg-slate-950/60 p-4 rounded-2xl border border-slate-800">
            <div>
              <span className="text-xs text-slate-400 block font-medium">
                Aktueller Teilbetrag:
              </span>
              <span
                data-testid="split-total-cents"
                className="text-2xl font-black text-indigo-400"
              >
                {formatPrice(selectedTotalCents)}
              </span>
            </div>
            <div className="text-right">
              <span className="text-xs text-slate-400 block font-medium">
                Offener Restsaldo am Tisch:
              </span>
              <span className="text-xl font-bold text-slate-300">
                {formatPrice(remainingAfterSplitCents)}
              </span>
            </div>
          </div>

          {/* Payment Method Selector */}
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setPaymentMethod("CASH")}
              className={`flex items-center justify-center gap-3 p-3.5 rounded-2xl font-bold border transition-all ${
                paymentMethod === "CASH"
                  ? "bg-emerald-600/30 border-emerald-500 text-emerald-300 shadow-md shadow-emerald-950/30"
                  : "bg-slate-800/60 border-slate-700 text-slate-400 hover:text-slate-200"
              }`}
            >
              <Coins className="w-5 h-5 text-emerald-400" />
              Barzahlung
            </button>
            <button
              type="button"
              onClick={() => setPaymentMethod("CARD")}
              className={`flex items-center justify-center gap-3 p-3.5 rounded-2xl font-bold border transition-all ${
                paymentMethod === "CARD"
                  ? "bg-blue-600/30 border-blue-500 text-blue-300 shadow-md shadow-blue-950/30"
                  : "bg-slate-800/60 border-slate-700 text-slate-400 hover:text-slate-200"
              }`}
            >
              <CreditCard className="w-5 h-5 text-blue-400" />
              Kartenzahlung
            </button>
          </div>

          {/* Actions */}
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="flex-1 py-3.5 px-4 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-2xl font-semibold transition-colors disabled:opacity-50"
            >
              Abbrechen
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={selectedTotalCents <= 0 || isSubmitting}
              className="flex-[2] py-3.5 px-4 bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 text-white rounded-2xl font-bold transition-all shadow-lg shadow-indigo-950/50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isSubmitting
                ? "Wird verbucht..."
                : `Teilbetrag kassieren (${formatPrice(selectedTotalCents)})`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
