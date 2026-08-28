import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  Banknote,
  CheckCircle2,
  CreditCard,
  Minus,
  Plus,
  ReceiptText,
  RefreshCw,
  Ticket,
  Trash2,
} from "lucide-react";
import { api } from "../lib/api";
import {
  deriveQuickSaleTiles,
  type QuickSaleProduct,
  type QuickSaleTile,
} from "../lib/quickSaleTiles";
import { resolveProductDeposit } from "../lib/productDeposit";
import { ValueVoucherIssueDialog } from "../components/ValueVoucherIssueDialog";

interface QuickSaleContext {
  id: string;
  name: string;
  status: "ACTIVE" | "TEST_MODE";
  testMode: boolean;
  printingReady: boolean;
  activeSession: {
    id: string;
    startingBalance: number;
    startTime: string;
  } | null;
  products: QuickSaleProduct[];
}

type SaleOption = QuickSaleTile;

interface CartLine extends SaleOption {
  quantity: number;
}

interface SaleResult {
  order: { orderNumber: number };
  vouchersIssued: number;
  changeAmount: number;
}

const quantityOptions = [1, 5, 10] as const;
const formatCurrency = (cents: number) =>
  (cents / 100).toLocaleString("de-AT", { style: "currency", currency: "EUR" });

const parseEuroToCents = (value: string) => {
  const normalized = value.trim().replace(",", ".");
  const match = /^(\d{1,7})(?:\.(\d{0,2}))?$/.exec(normalized);
  if (!match) return null;
  const euros = Number(match[1]);
  const cents = Number((match[2] || "").padEnd(2, "0"));
  const total = euros * 100 + cents;
  return Number.isSafeInteger(total) && total <= 2_147_483_647 ? total : null;
};

export const QuickSaleDashboard = () => {
  const navigate = useNavigate();
  const cardDialogRef = useRef<HTMLDivElement>(null);
  const [contexts, setContexts] = useState<QuickSaleContext[]>([]);
  const [selectedEventId, setSelectedEventId] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("Alle");
  const [selectedQuantity, setSelectedQuantity] =
    useState<(typeof quantityOptions)[number]>(1);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [depositRefundCount, setDepositRefundCount] = useState(0);
  const [depositRefundUnitPrice, setDepositRefundUnitPrice] = useState(0);
  const [tenderedInput, setTenderedInput] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState(() =>
    crypto.randomUUID(),
  );
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<SaleResult | null>(null);
  const [cardConfirmationOpen, setCardConfirmationOpen] = useState(false);
  const [voucherDialogOpen, setVoucherDialogOpen] = useState(false);

  const loadContext = async () => {
    setLoading(true);
    setError("");
    try {
      const response = await api.get<QuickSaleContext[]>(
        "/orders/quick-sale/context",
      );
      setContexts(response.data);
      setSelectedEventId((current) =>
        response.data.some((event) => event.id === current)
          ? current
          : response.data[0]?.id || "",
      );
    } catch (requestError: any) {
      setError(
        requestError.response?.data?.message ||
          "Bonkassen-Daten konnten nicht geladen werden.",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadContext();
  }, []);

  useEffect(() => {
    if (!cardConfirmationOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    cardDialogRef.current?.focus();
    const handleDialogKeys = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !submitting) {
        setCardConfirmationOpen(false);
        return;
      }
      if (event.key !== "Tab" || !cardDialogRef.current) return;
      const focusable = Array.from(
        cardDialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleDialogKeys);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleDialogKeys);
    };
  }, [cardConfirmationOpen, submitting]);

  const context =
    contexts.find((event) => event.id === selectedEventId) || null;
  const depositRefundValues = useMemo(
    () =>
      [
        ...new Set(
          (context?.products || [])
            .map((product) => resolveProductDeposit(product))
            .filter(
              (deposit): deposit is number =>
                Number.isInteger(deposit) && (deposit ?? 0) > 0,
            ),
        ),
      ].sort((left, right) => left - right),
    [context],
  );
  useEffect(() => {
    if (depositRefundValues.includes(depositRefundUnitPrice)) return;
    setDepositRefundUnitPrice(depositRefundValues[0] ?? 0);
    setDepositRefundCount(0);
  }, [depositRefundUnitPrice, depositRefundValues]);
  const categories = useMemo(
    () => [
      "Alle",
      ...new Set(
        (context?.products || []).map(
          (product) => product.category?.name || "Ohne Kategorie",
        ),
      ),
    ],
    [context],
  );
  // Kachelableitung ausgelagert nach ../lib/quickSaleTiles.ts (Issue #66,
  // Stationskasse): dieselbe Funktion wird auch von StationSaleDashboard.tsx
  // benutzt, damit beide Kassen bei einer Änderung an den Auswahlgruppen
  // nicht auseinanderlaufen.
  const options = useMemo<SaleOption[]>(
    () => deriveQuickSaleTiles(context?.products || []),
    [context],
  );
  const visibleOptions =
    selectedCategory === "Alle"
      ? options
      : options.filter((option) => option.category === selectedCategory);
  const totalQuantity = cart.reduce((sum, line) => sum + line.quantity, 0);
  const itemsTotal = cart.reduce(
    (sum, line) => sum + line.price * line.quantity,
    0,
  );
  const depositRefundTotal = depositRefundCount * depositRefundUnitPrice;
  const total = Math.max(0, itemsTotal - depositRefundTotal);
  const tenderedAmount = total === 0 ? 0 : parseEuroToCents(tenderedInput);
  const changeAmount =
    tenderedAmount !== null && tenderedAmount >= total
      ? tenderedAmount - total
      : null;

  const cashSuggestions = useMemo(() => {
    if (total <= 0) return [];
    const candidates = [
      total,
      Math.ceil(total / 500) * 500,
      Math.ceil(total / 1000) * 1000,
      Math.ceil(total / 2000) * 2000,
      Math.ceil(total / 5000) * 5000,
      Math.ceil(total / 10000) * 10000,
    ];
    return [...new Set(candidates)]
      .filter((amount) => amount >= total)
      .slice(0, 4);
  }, [total]);

  const addOption = (option: SaleOption) => {
    if (option.availability === "OUT_OF_STOCK") return;
    if (totalQuantity + selectedQuantity > 100) {
      setError(
        "Pro Verkauf können höchstens 100 Produktbons ausgegeben werden.",
      );
      return;
    }
    setError("");
    setResult(null);
    setCart((current) => {
      const existing = current.find((line) => line.key === option.key);
      if (existing) {
        return current.map((line) =>
          line.key === option.key
            ? { ...line, quantity: line.quantity + selectedQuantity }
            : line,
        );
      }
      return [...current, { ...option, quantity: selectedQuantity }];
    });
  };

  const changeLine = (key: string, delta: number) => {
    setCart((current) =>
      current
        .map((line) =>
          line.key === key
            ? { ...line, quantity: line.quantity + delta }
            : line,
        )
        .filter((line) => line.quantity > 0),
    );
    setResult(null);
  };

  const resetSale = () => {
    setCart([]);
    setDepositRefundCount(0);
    setTenderedInput("");
    setIdempotencyKey(crypto.randomUUID());
  };

  const submitSale = async (paymentMethod: "CASH" | "CARD") => {
    if (
      !context?.activeSession ||
      (cart.length === 0 && depositRefundCount === 0) ||
      submitting
    )
      return;
    if (
      paymentMethod === "CASH" &&
      total > 0 &&
      (tenderedAmount === null || tenderedAmount < total)
    ) {
      setError(
        "Der gegebene Barbetrag muss den Gesamtbetrag vollständig abdecken.",
      );
      return;
    }

    setSubmitting(true);
    setError("");
    try {
      const response = await api.post<SaleResult>("/orders/quick-sale", {
        eventId: context.id,
        idempotencyKey,
        items: cart.map((line) => ({
          productId: line.productId,
          quantity: line.quantity,
          optionIds: line.optionIds.length > 0 ? line.optionIds : undefined,
        })),
        paymentMethod,
        tenderedAmount:
          paymentMethod === "CASH" ? (tenderedAmount ?? 0) : undefined,
        depositRefundTotal:
          depositRefundTotal > 0 ? depositRefundTotal : undefined,
      });
      setResult(response.data);
      setCardConfirmationOpen(false);
      resetSale();
    } catch (requestError: any) {
      setError(
        requestError.response?.data?.message ||
          "Verkauf wurde nicht bestätigt. Die Bonkasse prüft denselben Vorgang beim erneuten Versuch sicher.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="py-20 text-center text-slate-400">
        Bonkasse wird vorbereitet …
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1500px] pb-8">
      <header className="mb-4 flex flex-col gap-4 rounded-3xl border border-slate-800 bg-slate-900/80 p-4 shadow-xl sm:p-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-orange-500 text-slate-950 shadow-lg shadow-orange-950/30">
            <Ticket className="h-7 w-7" aria-hidden="true" />
          </div>
          <div>
            <p className="text-xs font-black uppercase tracking-[0.2em] text-orange-300">
              Zentrale Ausgabe
            </p>
            <h1 className="text-2xl font-black tracking-tight text-white sm:text-3xl">
              Bonkasse
            </h1>
            <p className="text-sm text-slate-400">
              Menge wählen, Produkte antippen, Zahlung bestätigen.
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <label className="text-xs font-bold uppercase tracking-wider text-slate-400">
            Veranstaltung
            <select
              value={selectedEventId}
              disabled={cart.length > 0}
              onChange={(event) => {
                setSelectedEventId(event.target.value);
                setSelectedCategory("Alle");
              }}
              className="mt-1 min-h-12 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-base font-bold normal-case tracking-normal text-white outline-none focus-visible:ring-2 focus-visible:ring-orange-400 sm:w-64"
            >
              {contexts.map((event) => (
                <option key={event.id} value={event.id}>
                  {event.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => void loadContext()}
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-800 px-4 font-bold text-slate-200 hover:bg-slate-700 focus-visible:ring-2 focus-visible:ring-orange-400"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" /> Aktualisieren
          </button>
          <button
            type="button"
            disabled={!context?.activeSession}
            onClick={() => setVoucherDialogOpen(true)}
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-rose-500/50 bg-rose-950/50 px-4 font-bold text-rose-100 hover:bg-rose-900/70 disabled:opacity-45 focus-visible:ring-2 focus-visible:ring-rose-300"
          >
            <Ticket className="h-4 w-4" aria-hidden="true" /> Wertgutschein
          </button>
        </div>
      </header>

      {context?.testMode && (
        <div
          className="mb-4 flex items-center gap-3 rounded-2xl border border-amber-400/50 bg-amber-400/10 px-4 py-3 font-bold text-amber-200"
          role="status"
        >
          <AlertTriangle className="h-5 w-5 shrink-0" aria-hidden="true" />
          Testbetrieb – diese Verkäufe bleiben von echten Festabrechnungen
          getrennt.
        </div>
      )}

      {context && !context.printingReady && (
        <div
          className="mb-4 flex items-center gap-3 rounded-2xl border border-rose-500/50 bg-rose-500/10 px-4 py-3 font-bold text-rose-200"
          role="alert"
        >
          <AlertTriangle className="h-5 w-5 shrink-0" aria-hidden="true" />
          Kein aktiver Drucker. Verkäufe bleiben gesperrt, bis die
          Druckbereitschaft hergestellt ist.
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="mb-4 rounded-2xl border border-rose-500/50 bg-rose-500/10 px-4 py-3 font-semibold text-rose-200"
        >
          {error}
        </div>
      )}
      {result && (
        <div
          role="status"
          className="mb-4 flex items-center gap-3 rounded-2xl border border-emerald-400/50 bg-emerald-400/10 px-4 py-3 font-bold text-emerald-200"
        >
          <CheckCircle2 className="h-5 w-5 shrink-0" aria-hidden="true" />
          Verkauf #{result.order.orderNumber} gebucht · {result.vouchersIssued}{" "}
          {result.vouchersIssued === 1 ? "Produktbon" : "Produktbons"} in der
          Druckwarteschlange
          {result.changeAmount > 0
            ? ` · ${formatCurrency(result.changeAmount)} Rückgeld`
            : ""}
        </div>
      )}

      {!context ? (
        <div className="rounded-3xl border border-dashed border-slate-700 p-10 text-center text-slate-300">
          Keine aktive Veranstaltung für die Bonkasse vorhanden.
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_24rem]">
          <section
            className="min-w-0 rounded-3xl border border-slate-800 bg-slate-900/65 p-3 sm:p-4"
            aria-labelledby="quick-products-title"
          >
            <div className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">
                  Schnellmenge
                </p>
                <div
                  className="mt-2 flex gap-2"
                  aria-label="Menge pro Produkttaste"
                >
                  {quantityOptions.map((quantity) => (
                    <button
                      key={quantity}
                      type="button"
                      aria-pressed={selectedQuantity === quantity}
                      onClick={() => setSelectedQuantity(quantity)}
                      className={`min-h-14 min-w-20 rounded-2xl px-4 font-mono text-xl font-black transition active:scale-95 focus-visible:ring-2 focus-visible:ring-orange-300 ${selectedQuantity === quantity ? "bg-orange-500 text-slate-950 shadow-lg shadow-orange-950/30" : "bg-slate-800 text-slate-200 hover:bg-slate-700"}`}
                    >
                      {quantity}×
                    </button>
                  ))}
                </div>
              </div>
              <div
                className="flex max-w-full gap-2 overflow-x-auto pb-1"
                aria-label="Produktkategorien"
              >
                {categories.map((category) => (
                  <button
                    key={category}
                    type="button"
                    aria-pressed={selectedCategory === category}
                    onClick={() => setSelectedCategory(category)}
                    className={`min-h-11 shrink-0 rounded-xl px-4 text-sm font-bold focus-visible:ring-2 focus-visible:ring-indigo-300 ${selectedCategory === category ? "bg-indigo-500 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700"}`}
                  >
                    {category}
                  </button>
                ))}
              </div>
            </div>

            <h2 id="quick-products-title" className="sr-only">
              Produkte für den Schnellverkauf
            </h2>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
              {visibleOptions.map((option) => {
                const disabled = option.availability === "OUT_OF_STOCK";
                return (
                  <button
                    key={option.key}
                    type="button"
                    disabled={disabled}
                    onClick={() => addOption(option)}
                    style={{
                      backgroundColor: disabled
                        ? "#1e293b"
                        : option.color || "#334155",
                    }}
                    className="relative min-h-28 rounded-2xl border border-white/10 p-3 text-left text-white shadow-sm transition hover:-translate-y-0.5 hover:brightness-110 active:translate-y-0 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45 focus-visible:ring-2 focus-visible:ring-white sm:min-h-32"
                  >
                    <span className="block text-2xl font-black leading-none">
                      {selectedQuantity}×
                    </span>
                    <span className="mt-3 block text-base font-black leading-tight">
                      {option.label}
                    </span>
                    {option.detail && (
                      <span className="block text-xs font-semibold text-white/75">
                        {option.detail}
                      </span>
                    )}
                    {option.hint && (
                      <span className="mt-1 block text-[10px] font-semibold text-white/60">
                        {option.hint}
                      </span>
                    )}
                    <span className="mt-2 block font-mono text-sm font-bold text-white/90">
                      {formatCurrency(option.price * selectedQuantity)}
                    </span>
                    {disabled && (
                      <span className="absolute right-2 top-2 rounded-lg bg-rose-600 px-2 py-1 text-[10px] font-black uppercase">
                        Ausverkauft
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </section>

          <aside
            className="relative overflow-hidden rounded-[1.75rem] bg-[#fff8e7] text-slate-950 shadow-2xl shadow-black/30 lg:sticky lg:top-24 lg:self-start"
            aria-labelledby="sale-strip-title"
          >
            <div
              className="h-3 bg-[radial-gradient(circle_at_6px_-1px,transparent_6px,#fff8e7_6.5px)] bg-[length:12px_12px]"
              aria-hidden="true"
            />
            <div className="px-4 pb-5 pt-3 sm:px-5">
              <div className="flex items-center justify-between border-b-2 border-dashed border-slate-300 pb-3">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">
                    Aktueller Bonstreifen
                  </p>
                  <h2 id="sale-strip-title" className="text-xl font-black">
                    {totalQuantity} {totalQuantity === 1 ? "Bon" : "Bons"}
                  </h2>
                </div>
                <ReceiptText
                  className="h-7 w-7 text-slate-500"
                  aria-hidden="true"
                />
              </div>

              <div className="max-h-64 min-h-24 overflow-y-auto py-2">
                {cart.length === 0 ? (
                  <p className="py-8 text-center text-sm font-semibold text-slate-500">
                    Produkte antippen, um Bons hinzuzufügen.
                  </p>
                ) : (
                  cart.map((line) => (
                    <div
                      key={line.key}
                      className="grid grid-cols-[auto_1fr_auto] items-center gap-2 border-b border-dashed border-slate-300 py-3"
                    >
                      <div className="flex items-center rounded-xl border border-slate-300 bg-white/60">
                        <button
                          type="button"
                          onClick={() => changeLine(line.key, -1)}
                          className="min-h-11 min-w-10 rounded-l-xl hover:bg-slate-200 focus-visible:ring-2 focus-visible:ring-slate-600"
                          aria-label={`${line.label} reduzieren`}
                        >
                          <Minus className="mx-auto h-4 w-4" />
                        </button>
                        <span className="min-w-9 text-center font-mono text-sm font-black">
                          {line.quantity}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            totalQuantity < 100 && changeLine(line.key, 1)
                          }
                          className="min-h-11 min-w-10 rounded-r-xl hover:bg-slate-200 focus-visible:ring-2 focus-visible:ring-slate-600"
                          aria-label={`${line.label} erhöhen`}
                        >
                          <Plus className="mx-auto h-4 w-4" />
                        </button>
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-black">
                          {line.label}
                        </p>
                        {line.detail && (
                          <p className="truncate text-xs text-slate-500">
                            {line.detail}
                          </p>
                        )}
                        {line.hint && (
                          <p className="truncate text-[10px] italic text-slate-400">
                            {line.hint}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="font-mono text-sm font-black">
                          {formatCurrency(line.price * line.quantity)}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setCart((current) =>
                              current.filter((item) => item.key !== line.key),
                            )
                          }
                          className="min-h-10 min-w-10 rounded-lg text-rose-700 hover:bg-rose-100 focus-visible:ring-2 focus-visible:ring-rose-500"
                          aria-label={`${line.label} entfernen`}
                        >
                          <Trash2 className="mx-auto h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Pfandrückgabe-Steuerung (Issue #137) */}
              <div className="border-t border-dashed border-slate-300 py-3 bg-amber-50/60 rounded-xl px-2 my-2 flex items-center justify-between gap-2">
                <div>
                  <p className="text-xs font-black text-amber-950">
                    Pfandrückgabe
                  </p>
                  {depositRefundValues.length > 0 ? (
                    <label className="mt-1 block text-[10px] font-bold text-amber-700">
                      Pfandwert
                      <select
                        value={depositRefundUnitPrice}
                        onChange={(event) => {
                          setDepositRefundUnitPrice(Number(event.target.value));
                          setDepositRefundCount(0);
                        }}
                        className="ml-1 min-h-9 rounded-lg border border-amber-300 bg-white px-2 font-mono text-xs font-black text-amber-950"
                        aria-label="Pfandwert für Rückgabe"
                      >
                        {depositRefundValues.map((value) => (
                          <option key={value} value={value}>
                            {formatCurrency(value)} / Stk.
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : (
                    <p className="text-[10px] font-bold text-amber-700">
                      Noch kein Pfandwert im Sortiment hinterlegt
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() =>
                      setDepositRefundCount(Math.max(0, depositRefundCount - 1))
                    }
                    disabled={
                      depositRefundCount <= 0 || depositRefundUnitPrice <= 0
                    }
                    className="min-h-10 min-w-9 rounded-lg border border-amber-300 bg-amber-200 text-amber-950 font-bold hover:bg-amber-300 disabled:opacity-40"
                    aria-label="Pfandrückgabe reduzieren"
                  >
                    <Minus className="mx-auto h-4 w-4" />
                  </button>
                  <span className="min-w-8 text-center font-mono text-sm font-black text-amber-950">
                    {depositRefundCount}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setDepositRefundCount(depositRefundCount + 1)
                    }
                    disabled={depositRefundUnitPrice <= 0}
                    className="min-h-10 min-w-9 rounded-lg border border-amber-300 bg-amber-200 text-amber-950 font-bold hover:bg-amber-300 disabled:opacity-40"
                    aria-label="Pfandrückgabe erhöhen"
                  >
                    <Plus className="mx-auto h-4 w-4" />
                  </button>
                  {depositRefundCount > 0 && (
                    <span className="font-mono text-sm font-black text-rose-600 ml-1">
                      - {formatCurrency(depositRefundTotal)}
                    </span>
                  )}
                </div>
              </div>

              <div className="border-y-2 border-dashed border-slate-400 py-3">
                <div className="flex items-end justify-between gap-3">
                  <span className="text-sm font-black uppercase tracking-wider">
                    Gesamt
                  </span>
                  <span className="font-mono text-3xl font-black">
                    {formatCurrency(total)}
                  </span>
                </div>
              </div>

              {!context.printingReady ? (
                <div className="mt-4 rounded-2xl border-2 border-rose-600 bg-rose-100 p-4 text-rose-950">
                  <p className="font-black">Drucker nicht bereit</p>
                  <p className="mt-1 text-sm">
                    Produktbons müssen unmittelbar gedruckt werden. Bitte
                    Drucker aktivieren und anschließend aktualisieren.
                  </p>
                </div>
              ) : !context.activeSession ? (
                <div className="mt-4 rounded-2xl border-2 border-amber-600 bg-amber-100 p-4 text-amber-950">
                  <p className="font-black">Keine aktive Kassensitzung</p>
                  <p className="mt-1 text-sm">
                    Vor dem ersten Verkauf Startgeld erfassen.
                  </p>
                  <button
                    type="button"
                    onClick={() => navigate("/cashier")}
                    className="mt-3 min-h-12 w-full rounded-xl bg-amber-700 px-4 font-black text-white hover:bg-amber-800 focus-visible:ring-2 focus-visible:ring-amber-500"
                  >
                    Kassensitzung öffnen
                  </button>
                </div>
              ) : (
                <div className="mt-4 space-y-3">
                  <div>
                    <label
                      className="text-xs font-black uppercase tracking-wider text-slate-600"
                      htmlFor="tendered-amount"
                    >
                      Bar gegeben
                    </label>
                    <input
                      id="tendered-amount"
                      inputMode="decimal"
                      value={tenderedInput}
                      onChange={(event) => setTenderedInput(event.target.value)}
                      placeholder="z. B. 50,00"
                      className="mt-1 min-h-14 w-full rounded-xl border-2 border-slate-300 bg-white px-4 font-mono text-2xl font-black outline-none focus-visible:border-emerald-600 focus-visible:ring-2 focus-visible:ring-emerald-300"
                    />
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      {cashSuggestions.map((amount) => (
                        <button
                          key={amount}
                          type="button"
                          onClick={() =>
                            setTenderedInput(
                              (amount / 100).toFixed(2).replace(".", ","),
                            )
                          }
                          className="min-h-11 rounded-xl border border-slate-300 bg-white/70 font-mono text-sm font-black hover:bg-white focus-visible:ring-2 focus-visible:ring-emerald-500"
                        >
                          {formatCurrency(amount)}
                        </button>
                      ))}
                    </div>
                    <div className="mt-2 flex min-h-10 items-center justify-between rounded-xl bg-slate-200 px-3 text-sm font-bold">
                      <span>Rückgeld</span>
                      <span
                        className={`font-mono text-lg font-black ${changeAmount === null ? "text-rose-700" : "text-emerald-800"}`}
                      >
                        {changeAmount === null
                          ? "Betrag fehlt"
                          : formatCurrency(changeAmount)}
                      </span>
                    </div>
                  </div>

                  <button
                    type="button"
                    disabled={
                      (cart.length === 0 && depositRefundCount === 0) ||
                      submitting ||
                      (total > 0 && changeAmount === null)
                    }
                    onClick={() => void submitSale("CASH")}
                    className="inline-flex min-h-14 w-full items-center justify-center gap-3 rounded-2xl bg-emerald-600 px-4 text-lg font-black text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-45 focus-visible:ring-2 focus-visible:ring-emerald-400"
                  >
                    <Banknote className="h-5 w-5" aria-hidden="true" />{" "}
                    {submitting
                      ? "Wird gebucht …"
                      : total === 0 && depositRefundCount > 0
                        ? `Pfand bar auszahlen (${formatCurrency(depositRefundTotal)})`
                        : "Bar kassieren"}
                  </button>
                  <button
                    type="button"
                    disabled={cart.length === 0 || submitting || total === 0}
                    onClick={() => setCardConfirmationOpen(true)}
                    className="inline-flex min-h-14 w-full items-center justify-center gap-3 rounded-2xl bg-blue-700 px-4 text-lg font-black text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-45 focus-visible:ring-2 focus-visible:ring-blue-400"
                  >
                    <CreditCard className="h-5 w-5" aria-hidden="true" /> Karte
                    extern bestätigt
                  </button>
                </div>
              )}

              <p className="mt-4 text-center text-[10px] font-bold uppercase tracking-wider text-slate-500">
                VereinOrder ist keine RKSV-Registrierkasse.
              </p>
            </div>
          </aside>
        </div>
      )}

      {cardConfirmationOpen && (
        <div className="fixed inset-0 z-[90] grid place-items-center bg-slate-950/85 p-4 backdrop-blur-sm">
          <div
            ref={cardDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="card-confirm-title"
            tabIndex={-1}
            className="w-full max-w-md rounded-3xl border border-blue-400/30 bg-slate-900 p-6 shadow-2xl outline-none"
          >
            <CreditCard
              className="h-10 w-10 text-blue-300"
              aria-hidden="true"
            />
            <h2
              id="card-confirm-title"
              className="mt-4 text-2xl font-black text-white"
            >
              Terminalzahlung bestätigt?
            </h2>
            <p className="mt-2 text-slate-300">
              Erst bestätigen, nachdem das externe Kartenterminal{" "}
              {formatCurrency(total)} erfolgreich angenommen hat.
            </p>
            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row">
              <button
                type="button"
                disabled={submitting}
                onClick={() => setCardConfirmationOpen(false)}
                className="min-h-12 flex-1 rounded-xl bg-slate-800 px-4 font-bold text-slate-200 hover:bg-slate-700 focus-visible:ring-2 focus-visible:ring-slate-400"
              >
                Abbrechen
              </button>
              <button
                type="button"
                autoFocus
                disabled={submitting}
                onClick={() => void submitSale("CARD")}
                className="min-h-12 flex-1 rounded-xl bg-blue-600 px-4 font-black text-white hover:bg-blue-500 disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-blue-300"
              >
                Ja, Karte buchen
              </button>
            </div>
          </div>
        </div>
      )}
      {context && (
        <ValueVoucherIssueDialog
          isOpen={voucherDialogOpen}
          eventId={context.id}
          cashierSessionId={context.activeSession?.id ?? null}
          dataMode={context.testMode ? "TEST" : "LIVE"}
          onClose={() => setVoucherDialogOpen(false)}
        />
      )}
    </div>
  );
};
