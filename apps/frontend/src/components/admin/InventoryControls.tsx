import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Archive,
  History,
  Lock,
  PackageCheck,
} from "lucide-react";

import { api } from "../../lib/api";

type DataMode = "TEST" | "LIVE";

export interface InventoryProduct {
  id: string;
  name: string;
  availability?: "AVAILABLE" | "LOW_STOCK" | "OUT_OF_STOCK" | "DISABLED";
  inventoryTracked?: boolean;
  stockQuantity?: number | null;
  lowStockThreshold?: number | null;
}

interface InventoryControlsProps {
  product: InventoryProduct;
  eventId: string;
  dataMode: DataMode;
  onChanged: () => void;
}

const statusLabel = (product: InventoryProduct) => {
  if (product.availability === "DISABLED") return "Manuell deaktiviert";
  if (product.availability === "OUT_OF_STOCK") return "Ausverkauft";
  if (product.availability === "LOW_STOCK") return "Niedriger Bestand";
  return product.inventoryTracked ? "Bestand ausreichend" : "Nicht gezählt";
};

export const InventorySummary = ({
  product,
}: {
  product: InventoryProduct;
}) => {
  const status = statusLabel(product);
  const Icon =
    product.availability === "DISABLED"
      ? Lock
      : product.availability === "OUT_OF_STOCK" ||
          product.availability === "LOW_STOCK"
        ? AlertTriangle
        : PackageCheck;
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-2 py-1 text-xs font-semibold text-slate-200">
      <Icon
        aria-hidden="true"
        className="h-3.5 w-3.5 shrink-0 text-amber-300"
      />
      <span>
        {product.inventoryTracked
          ? `${product.stockQuantity ?? 0} Stk. · Schwelle ${product.lowStockThreshold ?? 0}`
          : "Nicht gezählt"}
      </span>
      <span className="text-slate-400">· {status}</span>
    </span>
  );
};

/** Dialog für die wenigen Eingriffe, die einen Bestand tatsächlich verändern. */
export const InventoryControls = ({
  product,
  eventId,
  dataMode,
  onChanged,
}: InventoryControlsProps) => {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<any>(null);
  const [quantity, setQuantity] = useState("");
  const [threshold, setThreshold] = useState("");
  const [reason, setReason] = useState("");
  const [manualBlocked, setManualBlocked] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const query = `eventId=${encodeURIComponent(eventId)}&dataMode=${dataMode}`;
  const load = async () => {
    const response = await api.get(
      `/inventory/products/${product.id}?${query}`,
    );
    setDetail(response.data);
    setQuantity(String(response.data.stockQuantity ?? 0));
    setThreshold(String(response.data.lowStockThreshold ?? 0));
    setManualBlocked(response.data.manualBlocked === true);
  };
  useEffect(() => {
    if (open)
      void load().catch(() =>
        setError("Bestandsdaten konnten nicht geladen werden."),
      );
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const asNonNegativeInt = (value: string) =>
    /^\d+$/.test(value) ? Number(value) : null;
  const saveInitial = async () => {
    const count = asNonNegativeInt(quantity);
    const low = asNonNegativeInt(threshold);
    if (count === null || low === null)
      return setError(
        "Bestand und Warnschwelle müssen ganze, nichtnegative Zahlen sein.",
      );
    setSaving(true);
    setError("");
    try {
      await api.post(`/inventory/products/${product.id}/initialize`, {
        eventId,
        dataMode,
        quantity: count,
        lowStockThreshold: low,
        trackingEnabled: true,
        manualBlocked,
        idempotencyKey: crypto.randomUUID(),
      });
      onChanged();
      setOpen(false);
    } catch (err: any) {
      setError(
        err.response?.data?.message || "Initialisierung fehlgeschlagen.",
      );
    } finally {
      setSaving(false);
    }
  };
  const saveSettings = async () => {
    const low = asNonNegativeInt(threshold);
    if (low === null)
      return setError(
        "Die Warnschwelle muss eine ganze, nichtnegative Zahl sein.",
      );
    setSaving(true);
    setError("");
    try {
      await api.patch(`/inventory/products/${product.id}/settings`, {
        eventId,
        dataMode,
        lowStockThreshold: low,
        manualBlocked,
      });
      await load();
      onChanged();
    } catch (err: any) {
      setError(
        err.response?.data?.message ||
          "Einstellungen konnten nicht gespeichert werden.",
      );
    } finally {
      setSaving(false);
    }
  };
  const correct = async () => {
    const count = asNonNegativeInt(quantity);
    if (count === null)
      return setError(
        "Der gezählte Bestand muss eine ganze, nichtnegative Zahl sein.",
      );
    if (!reason.trim())
      return setError("Bitte begründe die Bestandskorrektur.");
    setSaving(true);
    setError("");
    try {
      await api.post(`/inventory/products/${product.id}/correction`, {
        eventId,
        dataMode,
        quantity: count,
        reason: reason.trim(),
        idempotencyKey: crypto.randomUUID(),
      });
      await load();
      setReason("");
      onChanged();
    } catch (err: any) {
      setError(
        err.response?.data?.message || "Bestandskorrektur fehlgeschlagen.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-indigo-400/40 bg-indigo-500/15 px-3 text-xs font-bold text-indigo-100 hover:bg-indigo-500/25 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-200"
      >
        <Archive aria-hidden="true" className="h-4 w-4" /> Bestand
      </button>
      {open && (
        <div
          className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-950/75 p-3 sm:items-center"
          role="presentation"
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="inventory-title"
            className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-3xl border border-slate-700 bg-slate-900 p-5 shadow-2xl sm:p-6"
          >
            <div className="mb-5 flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-indigo-300">
                  {dataMode === "TEST" ? "Testbetrieb" : "Echtbetrieb"}
                </p>
                <h2
                  id="inventory-title"
                  className="text-xl font-black text-white"
                >
                  Bestand: {product.name}
                </h2>
                <p className="mt-1 text-sm text-slate-400">
                  Manuelle Sperre und automatischer Warnstatus bleiben getrennt.
                </p>
              </div>
              <InventorySummary product={{ ...product, ...detail }} />
            </div>
            {error && (
              <p
                role="alert"
                className="mb-4 rounded-xl border border-rose-400/40 bg-rose-500/15 p-3 text-sm font-semibold text-rose-100"
              >
                {error}
              </p>
            )}
            {!detail?.inventoryTracked ? (
              <div className="space-y-4">
                <p className="rounded-xl border border-sky-400/30 bg-sky-500/10 p-3 text-sm text-sky-100">
                  Dieser Bestand wird noch nicht mitgezählt. Die Initialisierung
                  gilt nur für den oben angezeigten Betrieb.
                </p>
                <Field
                  label="Anfangsbestand"
                  value={quantity}
                  onChange={setQuantity}
                />
                <Field
                  label="Warnschwelle"
                  value={threshold}
                  onChange={setThreshold}
                />
                <BlockToggle
                  value={manualBlocked}
                  onChange={setManualBlocked}
                />
                <Action onClick={saveInitial} busy={saving}>
                  Bestand mitzählen
                </Action>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field
                    label="Aktuell gezählt"
                    value={quantity}
                    onChange={setQuantity}
                  />
                  <Field
                    label="Warnschwelle"
                    value={threshold}
                    onChange={setThreshold}
                  />
                </div>
                <BlockToggle
                  value={manualBlocked}
                  onChange={setManualBlocked}
                />
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <Action onClick={saveSettings} busy={saving}>
                    Schwelle/Sperre speichern
                  </Action>
                  <button
                    type="button"
                    onClick={() => void load()}
                    className="min-h-12 rounded-xl border border-slate-600 px-4 text-sm font-bold text-slate-200 hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-200"
                  >
                    Neu laden
                  </button>
                </div>
                <div className="border-t border-slate-700 pt-4">
                  <label
                    className="block text-sm font-bold text-slate-100"
                    htmlFor="inventory-reason"
                  >
                    Bestandskorrektur begründen
                  </label>
                  <textarea
                    id="inventory-reason"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    maxLength={500}
                    className="mt-2 min-h-20 w-full rounded-xl border border-slate-600 bg-slate-950 p-3 text-sm text-white focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-400/30"
                    placeholder="z. B. Nachzählung am Getränkestand"
                  />
                  <Action onClick={correct} busy={saving}>
                    Gezählten Bestand übernehmen
                  </Action>
                </div>
                <HistoryList productId={product.id} query={query} />
              </div>
            )}
            <button
              type="button"
              disabled={saving}
              onClick={() => setOpen(false)}
              className="mt-5 min-h-11 w-full rounded-xl border border-slate-600 text-sm font-bold text-slate-200 hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-200"
            >
              Schließen
            </button>
          </section>
        </div>
      )}
    </>
  );
};

const Field = ({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) => (
  <label className="block text-sm font-bold text-slate-100">
    {label}
    <input
      inputMode="numeric"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="mt-2 min-h-12 w-full rounded-xl border border-slate-600 bg-slate-950 px-3 text-base text-white focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-400/30"
    />
  </label>
);
const BlockToggle = ({
  value,
  onChange,
}: {
  value: boolean;
  onChange: (value: boolean) => void;
}) => (
  <label className="flex min-h-12 items-center gap-3 rounded-xl border border-slate-700 bg-slate-800/70 p-3 text-sm text-slate-100">
    <input
      type="checkbox"
      checked={value}
      onChange={(e) => onChange(e.target.checked)}
      className="h-5 w-5 accent-amber-400"
    />
    <span>
      <strong>Manuell sperren</strong>
      <span className="block text-xs text-slate-400">
        Stoppt den Verkauf unabhängig vom gezählten Bestand.
      </span>
    </span>
  </label>
);
const Action = ({
  onClick,
  busy,
  children,
}: {
  onClick: () => void;
  busy: boolean;
  children: string;
}) => (
  <button
    type="button"
    disabled={busy}
    onClick={onClick}
    className="mt-3 min-h-12 w-full rounded-xl bg-indigo-600 px-4 text-sm font-bold text-white hover:bg-indigo-500 disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-200"
  >
    {busy ? "Wird gespeichert …" : children}
  </button>
);
const HistoryList = ({
  productId,
  query,
}: {
  productId: string;
  query: string;
}) => {
  const [history, setHistory] = useState<any[] | null>(null);
  useEffect(() => {
    void api
      .get(`/inventory/products/${productId}/history?${query}`)
      .then((r) => setHistory(r.data))
      .catch(() => setHistory([]));
  }, [productId, query]);
  return (
    <div className="border-t border-slate-700 pt-4">
      <h3 className="flex items-center gap-2 text-sm font-bold text-slate-100">
        <History className="h-4 w-4 text-indigo-300" /> Verlauf
      </h3>
      {history === null ? (
        <p className="mt-2 text-xs text-slate-400">Lade Verlauf …</p>
      ) : history.length === 0 ? (
        <p className="mt-2 text-xs text-slate-400">
          Noch keine Bestandsbewegung.
        </p>
      ) : (
        <ol className="mt-2 space-y-2">
          {history.slice(0, 10).map((entry) => (
            <li
              key={entry.id}
              className="rounded-lg bg-slate-800 p-2 text-xs text-slate-200"
            >
              <strong>{entry.type}</strong> · {entry.quantityBefore} →{" "}
              {entry.quantityAfter}
              {entry.reason ? ` · ${entry.reason}` : ""}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
};
