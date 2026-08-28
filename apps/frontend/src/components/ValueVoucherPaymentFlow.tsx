import { CreditCard, ScanLine, Ticket } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { api } from "../lib/api";

export interface ValueVoucherPaymentContext {
  eventId: string;
  cashierSessionId: string;
  orderId: string;
  printerId?: string;
}

interface Quote {
  voucherCode: string;
  balance: number;
  outstanding: number;
  redeemable: number;
}

const formatCurrency = (amount: number) =>
  (amount / 100).toLocaleString("de-AT", {
    style: "currency",
    currency: "EUR",
  });
const parseEuro = (value: string) => {
  const normalized = value.trim().replace(",", ".");
  return /^\d{1,7}(?:\.\d{0,2})?$/.test(normalized)
    ? Math.round(Number(normalized) * 100)
    : null;
};

/** Der Server bestimmt Einlösungs- und Restbetrag; das UI sendet bewusst keinen Gutscheinbetrag. */
export const ValueVoucherPaymentFlow = ({
  context,
  onRedeemed,
}: {
  context?: ValueVoucherPaymentContext;
  onRedeemed: () => void;
}) => {
  const [code, setCode] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [remainderMethod, setRemainderMethod] = useState<
    "CASH" | "CARD" | null
  >(null);
  const [tendered, setTendered] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [printerId, setPrinterId] = useState(context?.printerId ?? "");
  const [printers, setPrinters] = useState<Array<{ id: string; name: string }>>(
    [],
  );
  useEffect(() => {
    if (!context) return;
    void api
      .get<Array<{ id: string; name: string }>>("/print-jobs/active-printers")
      .then((response) => {
        setPrinters(response.data);
        setPrinterId((current) => current || response.data[0]?.id || "");
      })
      .catch(() =>
        setError(
          "Aktive Drucker konnten nicht geladen werden. Einlösung bleibt gesperrt.",
        ),
      );
  }, [context]);
  if (!context) return null;

  const findQuote = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!code.trim()) return;
    if (!navigator.onLine) {
      setError(
        "Wertgutscheine dürfen nicht offline eingelöst werden. Bitte Verbindung wiederherstellen.",
      );
      return;
    }
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const response = await api.get<Quote>("/value-vouchers/quote", {
        params: { ...context, code: code.trim() },
      });
      setQuote(response.data);
      setRemainderMethod(null);
      setTendered("");
    } catch (requestError: any) {
      setQuote(null);
      setError(
        requestError.response?.data?.message ||
          "Wertgutschein konnte nicht geprüft werden.",
      );
    } finally {
      setBusy(false);
    }
  };
  const remainder = quote ? quote.outstanding - quote.redeemable : 0;
  const tenderedAmount = parseEuro(tendered);
  const submit = async () => {
    if (!quote) return;
    if (!printerId) {
      setError("Für die Einlösung ist ein aktiver Drucker erforderlich.");
      return;
    }
    if (remainder > 0 && !remainderMethod) {
      setError("Für den Restbetrag bitte Bar oder Karte wählen.");
      return;
    }
    if (
      remainderMethod === "CASH" &&
      (tenderedAmount === null || tenderedAmount < remainder)
    ) {
      setError("Der gegebene Barbetrag deckt den Restbetrag nicht.");
      return;
    }
    if (!navigator.onLine) {
      setError("Wertgutscheine werden nicht offline vorgemerkt.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await api.post<{
        voucherCode: string;
        currentBalance: number;
        printStatus?: string;
      }>("/value-vouchers/redeem", {
        ...context,
        printerId,
        code: code.trim(),
        idempotencyKey: crypto.randomUUID(),
        remainderPayment:
          remainder > 0 && remainderMethod
            ? {
                method: remainderMethod,
                tenderedAmount:
                  remainderMethod === "CASH" ? tenderedAmount : undefined,
              }
            : undefined,
      });
      setSuccess(
        `${response.data.voucherCode} eingelöst. Restwert: ${formatCurrency(response.data.currentBalance)}${response.data.printStatus ? ` · Druck: ${response.data.printStatus}` : ""}`,
      );
      onRedeemed();
    } catch (requestError: any) {
      setError(
        requestError.response?.data?.message ||
          "Einlösung nicht bestätigt. Bitte den Gutschein erneut prüfen, statt blind zu wiederholen.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      className="mt-5 border-t border-dashed border-slate-700 pt-5"
      aria-labelledby="voucher-payment-title"
    >
      <div className="flex items-center gap-2 text-rose-200">
        <Ticket className="h-5" aria-hidden="true" />
        <h3 id="voucher-payment-title" className="font-black">
          Mit Wertgutschein bezahlen
        </h3>
      </div>
      <p className="mt-1 text-sm text-slate-400">
        Wertgutschein scannen oder Code eingeben. Kein Produktbon.
      </p>
      <form
        onSubmit={(event) => void findQuote(event)}
        className="mt-3 flex gap-2"
      >
        <label className="sr-only" htmlFor="voucher-code">
          Wertgutschein-Code
        </label>
        <input
          id="voucher-code"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          placeholder="Code scannen oder eingeben"
          className="min-h-12 min-w-0 flex-1 rounded-xl border border-slate-600 bg-slate-950 px-3 font-mono outline-none focus-visible:ring-2 focus-visible:ring-rose-300"
        />
        <button
          type="submit"
          disabled={busy || !code.trim()}
          className="min-h-12 rounded-xl bg-[#9f1239] px-4 font-bold focus-visible:ring-2 focus-visible:ring-rose-300"
        >
          <ScanLine className="inline h-5" /> Prüfen
        </button>
      </form>
      <div aria-live="polite" className="mt-3">
        {error && (
          <p
            role="alert"
            className="rounded-xl border border-rose-400/50 bg-rose-950/50 p-3 text-sm font-semibold text-rose-100"
          >
            {error}
          </p>
        )}
        {success && (
          <p className="rounded-xl border border-emerald-400/50 bg-emerald-950/40 p-3 text-sm font-semibold text-emerald-100">
            {success}
          </p>
        )}
      </div>
      {quote && !success && (
        <div className="mt-3 rounded-2xl border border-[#9f1239]/70 bg-[#500724]/30 p-4">
          <p className="font-mono font-black text-rose-100">
            {quote.voucherCode}
          </p>
          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-slate-400">Guthaben</dt>
              <dd className="font-mono font-black">
                {formatCurrency(quote.balance)}
              </dd>
            </div>
            <div>
              <dt className="text-slate-400">Für diese Bestellung</dt>
              <dd className="font-mono font-black">
                {formatCurrency(quote.redeemable)}
              </dd>
            </div>
          </dl>
          <label className="mt-3 block text-sm font-bold">
            Drucker
            <select
              value={printerId}
              onChange={(event) => setPrinterId(event.target.value)}
              className="mt-1 min-h-12 w-full rounded-xl border border-slate-600 bg-slate-950 px-3"
            >
              <option value="">Aktiven Drucker wählen</option>
              {printers.map((printer) => (
                <option key={printer.id} value={printer.id}>
                  {printer.name}
                </option>
              ))}
            </select>
          </label>
          {remainder > 0 && (
            <div className="mt-4">
              <p className="font-bold text-amber-200">
                Restzahlung: {formatCurrency(remainder)}
              </p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setRemainderMethod("CASH")}
                  aria-pressed={remainderMethod === "CASH"}
                  className={`min-h-12 rounded-xl font-bold ${remainderMethod === "CASH" ? "bg-emerald-700" : "bg-slate-800"}`}
                >
                  Bar
                </button>
                <button
                  type="button"
                  onClick={() => setRemainderMethod("CARD")}
                  aria-pressed={remainderMethod === "CARD"}
                  className={`min-h-12 rounded-xl font-bold ${remainderMethod === "CARD" ? "bg-blue-700" : "bg-slate-800"}`}
                >
                  <CreditCard className="mr-1 inline h-4" />
                  Karte
                </button>
              </div>
              {remainderMethod === "CASH" && (
                <label className="mt-2 block text-sm font-bold">
                  Bar gegeben
                  <input
                    inputMode="decimal"
                    value={tendered}
                    onChange={(event) => setTendered(event.target.value)}
                    className="mt-1 min-h-12 w-full rounded-xl border border-slate-600 bg-slate-950 px-3 font-mono"
                  />
                </label>
              )}
            </div>
          )}
          <button
            type="button"
            disabled={busy || !printerId || (remainder > 0 && !remainderMethod)}
            onClick={() => void submit()}
            className="mt-4 min-h-14 w-full rounded-2xl bg-[#9f1239] font-black hover:bg-[#be123c] disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-rose-200"
          >
            {busy
              ? "Einlösung wird bestätigt …"
              : remainder > 0
                ? "Gutschein und Restzahlung bestätigen"
                : "Gutschein vollständig einlösen"}
          </button>
        </div>
      )}
    </section>
  );
};
