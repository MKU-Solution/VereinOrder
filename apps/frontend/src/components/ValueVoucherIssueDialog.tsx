import { Banknote, CreditCard, Ticket, X } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../lib/api";

type FundingMethod = "CASH" | "CARD";

interface Printer {
  id: string;
  name: string;
}

interface ValueVoucherIssueDialogProps {
  isOpen: boolean;
  eventId: string;
  cashierSessionId: string | null;
  dataMode: "TEST" | "LIVE";
  onClose: () => void;
}

const presetAmounts = [1000, 2000, 5000] as const;
const formatCurrency = (amount: number) =>
  (amount / 100).toLocaleString("de-AT", {
    style: "currency",
    currency: "EUR",
  });

const parseEuro = (value: string) => {
  const normalized = value.trim().replace(",", ".");
  if (!/^\d{1,7}(?:\.\d{0,2})?$/.test(normalized)) return null;
  return Math.round(Number(normalized) * 100);
};

/** Eigenständiger Geldfluss: Wertgutscheine werden nie über die Offline-Queue gesendet. */
export const ValueVoucherIssueDialog = ({
  isOpen,
  eventId,
  cashierSessionId,
  dataMode,
  onClose,
}: ValueVoucherIssueDialogProps) => {
  const [amount, setAmount] = useState(1000);
  const [customAmount, setCustomAmount] = useState("");
  const [method, setMethod] = useState<FundingMethod>("CASH");
  const [tendered, setTendered] = useState("");
  const [printerId, setPrinterId] = useState("");
  const [printers, setPrinters] = useState<Printer[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isOpen) return;
    setMessage("");
    setError("");
    void api
      .get<Printer[]>("/print-jobs/active-printers")
      .then((response) => {
        setPrinters(response.data);
        setPrinterId((current) => current || response.data[0]?.id || "");
      })
      .catch(() =>
        setError(
          "Aktive Drucker konnten nicht geladen werden. Wertgutscheine bleiben gesperrt.",
        ),
      );
  }, [isOpen]);

  if (!isOpen) return null;
  const selectedAmount = customAmount ? parseEuro(customAmount) : amount;
  const tenderedAmount = parseEuro(tendered);
  const change =
    method === "CASH" && selectedAmount !== null && tenderedAmount !== null
      ? tenderedAmount - selectedAmount
      : null;

  const submit = async () => {
    if (
      !cashierSessionId ||
      !selectedAmount ||
      selectedAmount <= 0 ||
      !printerId
    ) {
      setError(
        "Aktive Kassensitzung, Betrag und Drucker sind für einen Wertgutschein erforderlich.",
      );
      return;
    }
    if (
      method === "CASH" &&
      (tenderedAmount === null || tenderedAmount < selectedAmount)
    ) {
      setError("Der gegebene Barbetrag muss den Gutscheinwert abdecken.");
      return;
    }
    if (!navigator.onLine) {
      setError(
        "Wertgutscheine werden aus Sicherheitsgründen nicht offline vorgemerkt. Bitte Verbindung wiederherstellen.",
      );
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await api.post<{
        voucherCode: string;
        currentBalance: number;
      }>("/value-vouchers", {
        eventId,
        cashierSessionId,
        printerId,
        amount: selectedAmount,
        fundingMethod: method,
        tenderedAmount: method === "CASH" ? tenderedAmount : undefined,
        idempotencyKey: crypto.randomUUID(),
      });
      setMessage(
        `Wertgutschein ${response.data.voucherCode} über ${formatCurrency(response.data.currentBalance)} wurde gebucht und zum Druck übergeben.`,
      );
    } catch (requestError: any) {
      setError(
        requestError.response?.data?.message ||
          "Die Ausgabe konnte nicht bestätigt werden. Bitte Druckwarteschlange prüfen; nicht blind erneut auslösen.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] overflow-y-auto bg-slate-950/85 p-0 backdrop-blur-sm sm:grid sm:place-items-center sm:p-4">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="value-voucher-issue-title"
        className="min-h-full w-full max-w-[720px] border-x border-[#7f1d3a] bg-slate-900 text-white shadow-2xl sm:min-h-0 sm:rounded-3xl"
      >
        <div
          className="h-3 bg-[radial-gradient(circle_at_6px_-1px,transparent_6px,#881337_6.5px)] bg-[length:12px_12px]"
          aria-hidden="true"
        />
        <div className="p-5 sm:p-7">
          <div className="flex items-start justify-between gap-4">
            <div className="flex gap-3">
              <span className="grid h-12 w-12 place-items-center rounded-xl bg-[#881337] text-rose-100">
                <Ticket />
              </span>
              <div>
                <p className="text-xs font-black uppercase tracking-[.18em] text-rose-300">
                  {dataMode === "TEST" ? "Testbetrieb" : "Echtbetrieb"}
                </p>
                <h2
                  id="value-voucher-issue-title"
                  className="text-2xl font-black"
                >
                  Wertgutschein ausgeben
                </h2>
                <p className="text-sm text-slate-300">
                  Kein Produktbon – der Betrag bleibt als Gutscheinwert
                  erhalten.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Wertgutschein-Ausgabe schließen"
              className="min-h-12 min-w-12 rounded-xl text-slate-300 hover:bg-slate-800 focus-visible:ring-2 focus-visible:ring-rose-300"
            >
              <X className="mx-auto" />
            </button>
          </div>
          <div aria-live="polite" className="mt-5 space-y-3">
            {error && (
              <p
                role="alert"
                className="rounded-xl border border-rose-400/50 bg-rose-950/50 p-3 font-semibold text-rose-100"
              >
                {error}
              </p>
            )}
            {message && (
              <p className="rounded-xl border border-emerald-400/50 bg-emerald-950/40 p-3 font-semibold text-emerald-100">
                {message}
              </p>
            )}
          </div>
          <fieldset className="mt-6">
            <legend className="text-sm font-black uppercase tracking-wider text-slate-300">
              Gutscheinwert
            </legend>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {presetAmounts.map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => {
                    setAmount(value);
                    setCustomAmount("");
                  }}
                  aria-pressed={!customAmount && amount === value}
                  className={`min-h-14 rounded-xl font-mono text-lg font-black focus-visible:ring-2 focus-visible:ring-rose-300 ${!customAmount && amount === value ? "bg-[#9f1239]" : "bg-slate-800 hover:bg-slate-700"}`}
                >
                  {formatCurrency(value)}
                </button>
              ))}
            </div>
            <label className="mt-3 block text-sm font-bold text-slate-300">
              Freier Betrag
              <input
                inputMode="decimal"
                value={customAmount}
                onChange={(event) => setCustomAmount(event.target.value)}
                placeholder="z. B. 25,00"
                className="mt-1 min-h-12 w-full rounded-xl border border-slate-600 bg-slate-950 px-3 font-mono text-lg outline-none focus-visible:ring-2 focus-visible:ring-rose-300"
              />
            </label>
          </fieldset>
          <fieldset className="mt-5">
            <legend className="text-sm font-black uppercase tracking-wider text-slate-300">
              Zahlungsart für den Gutschein
            </legend>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setMethod("CASH")}
                aria-pressed={method === "CASH"}
                className={`min-h-14 rounded-xl font-bold focus-visible:ring-2 focus-visible:ring-rose-300 ${method === "CASH" ? "bg-emerald-700" : "bg-slate-800"}`}
              >
                <Banknote className="mr-2 inline h-5" />
                Bar
              </button>
              <button
                type="button"
                onClick={() => setMethod("CARD")}
                aria-pressed={method === "CARD"}
                className={`min-h-14 rounded-xl font-bold focus-visible:ring-2 focus-visible:ring-rose-300 ${method === "CARD" ? "bg-blue-700" : "bg-slate-800"}`}
              >
                <CreditCard className="mr-2 inline h-5" />
                Karte
              </button>
            </div>
            {method === "CASH" && (
              <label className="mt-3 block text-sm font-bold text-slate-300">
                Bar gegeben
                <input
                  inputMode="decimal"
                  value={tendered}
                  onChange={(event) => setTendered(event.target.value)}
                  className="mt-1 min-h-12 w-full rounded-xl border border-slate-600 bg-slate-950 px-3 font-mono text-lg outline-none focus-visible:ring-2 focus-visible:ring-rose-300"
                />
                <span className="mt-1 block text-sm text-slate-300">
                  Rückgeld:{" "}
                  {change === null || change < 0
                    ? "Betrag fehlt"
                    : formatCurrency(change)}
                </span>
              </label>
            )}
          </fieldset>
          <label className="mt-5 block text-sm font-black uppercase tracking-wider text-slate-300">
            Drucker
            <select
              value={printerId}
              onChange={(event) => setPrinterId(event.target.value)}
              className="mt-1 min-h-12 w-full rounded-xl border border-slate-600 bg-slate-950 px-3 text-base font-bold normal-case"
            >
              <option value="">Aktiven Drucker wählen</option>
              {printers.map((printer) => (
                <option key={printer.id} value={printer.id}>
                  {printer.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={busy || Boolean(message)}
            onClick={() => void submit()}
            className="mt-7 min-h-14 w-full rounded-2xl bg-[#9f1239] px-4 text-lg font-black hover:bg-[#be123c] disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-rose-200"
          >
            {busy ? "Wird sicher gebucht …" : "Wertgutschein buchen & drucken"}
          </button>
        </div>
        <div
          className="h-3 bg-[radial-gradient(circle_at_6px_7px,transparent_6px,#881337_6.5px)] bg-[length:12px_12px]"
          aria-hidden="true"
        />
      </section>
    </div>
  );
};
