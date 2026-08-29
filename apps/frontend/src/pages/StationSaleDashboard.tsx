import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Banknote,
  CheckCircle2,
  MapPin,
  Minus,
  Play,
  Plus,
  Printer,
  ReceiptText,
  RefreshCw,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { api } from "../lib/api";
import {
  deriveQuickSaleTiles,
  type QuickSaleProduct,
  type QuickSaleTile,
} from "../lib/quickSaleTiles";

// Stationskasse (Issue #66, docs/development/stationskasse.md). Ablauf laut
// Abschnitt 4 des Entwurfs: Veranstaltung -> Station -> Kassensitzung ->
// Sortiment -> Warenkorb -> Barzahlung -> Buchung -> Rückmeldung mit großer
// Abholnummer -> Wiederholungsdruck. Die Kachelableitung selbst liegt in
// ../lib/quickSaleTiles.ts und wird unverändert von der zentralen Bonkasse
// (QuickSaleDashboard.tsx) mitbenutzt.

interface StationSaleStation {
  id: string;
  name: string;
  shortName: string | null;
  color: string | null;
  sortOrder: number;
  eventId: string;
}

// ACHTUNG (siehe Bericht): GET /orders/station-sale/context liefert die
// Zielstation eines Produkts und seiner Kategorie heute NICHT mit - weder
// `targetStationId` am Produkt noch an `category`. Die Felder sind hier
// dennoch als optional deklariert, EXAKT nach dem Vertrag
// (apps/backend/src/common/target-station.ts, resolveTargetStationId:
// Produkt vor Kategorie, sonst null), damit die Filterung korrekt
// funktioniert, sobald das Backend sie ergänzt. Bis dahin resolvieren beide
// Felder zu `undefined` -> `null`, und kein Produkt löst auf irgendeine
// konkrete Station auf. Das ist eine bewusste Fail-closed-Entscheidung
// (lieber keine Kachel zeigen als die falscher Station), keine
// Bequemlichkeitslösung - siehe Bericht Punkt 4.
interface StationSaleProduct extends QuickSaleProduct {
  targetStationId?: string | null;
  category?:
    | (NonNullable<QuickSaleProduct["category"]> & {
        targetStationId?: string | null;
      })
    | null;
}

interface StationSaleContext {
  id: string;
  name: string;
  status: "ACTIVE" | "TEST_MODE";
  testMode: boolean;
  printingReady: boolean;
  activeSession: {
    id: string;
    eventId: string;
    startingBalance: number;
    startTime: string;
  } | null;
  products: StationSaleProduct[];
  stations: StationSaleStation[];
}

interface CartLine extends QuickSaleTile {
  quantity: number;
}

interface SaleResult {
  order: {
    id: string;
    orderNumber: number;
    pickupNumber: number | null;
    stationId: string | null;
  };
  vouchersIssued: number;
  tenderedAmount: number;
  changeAmount: number;
  pickupNumber: number;
  idempotentReplay: boolean;
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

// Einzige Auflösung der Zielstation eines Produkts auf der Anzeigeseite,
// wörtlich nach apps/backend/src/common/target-station.ts
// (resolveTargetStationId): Station des Produkts, sonst Station seiner
// Kategorie, sonst null (zentrale Ausgabe, in der Stationskasse also
// "keine Station"). Diese Filterung ist reine Anzeige - die Verkaufstransaktion
// prüft Station und Sortiment serverseitig eigenständig noch einmal
// (apps/backend/src/orders/orders.service.ts, productAtStationFilter).
const resolveProductStationId = (product: StationSaleProduct): string | null =>
  product.targetStationId ?? product.category?.targetStationId ?? null;

const filterProductsForStation = (
  products: StationSaleProduct[],
  stationId: string,
): StationSaleProduct[] =>
  products.filter((product) => resolveProductStationId(product) === stationId);

export const StationSaleDashboard = () => {
  const [contexts, setContexts] = useState<StationSaleContext[]>([]);
  const [selectedEventId, setSelectedEventId] = useState("");
  const [selectedStationId, setSelectedStationId] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("Alle");
  const [selectedQuantity, setSelectedQuantity] =
    useState<(typeof quantityOptions)[number]>(1);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [tenderedInput, setTenderedInput] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState(() =>
    crypto.randomUUID(),
  );
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<SaleResult | null>(null);

  const [startingBalanceInput, setStartingBalanceInput] = useState("");
  const [startingSession, setStartingSession] = useState(false);

  const [reprinting, setReprinting] = useState(false);
  const [reprintMessage, setReprintMessage] = useState("");

  const loadContext = async () => {
    setLoading(true);
    setError("");
    try {
      const response = await api.get<StationSaleContext[]>(
        "/orders/station-sale/context",
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
          "Stationskassen-Daten konnten nicht geladen werden.",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadContext();
  }, []);

  useEffect(() => {
    if (!selectedEventId) return;
    // EventSource-Konstruktor gekapselt (analog Dashboard.tsx /
    // TableSelectionModal.tsx): schlägt er fehl (z. B. Endgerät ohne
    // EventSource-Unterstützung), darf das die Kasse nicht in der
    // React-Commit-Phase zum Absturz bringen - sonst bleibt kein Produkt
    // mehr sichtbar. Ohne Live-Push bleiben die zuletzt geladenen Bestände
    // stehen, bis "Aktualisieren" oder der nächste Verkauf neu lädt.
    let source: EventSource | null = null;
    try {
      source = new EventSource(`/realtime/stream?eventId=${selectedEventId}`);
      source.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (
            payload.type !== "PRODUCT_INVENTORY_CHANGED" &&
            payload.type !== "PRODUCT_AVAILABILITY_CHANGED"
          )
            return;
          setContexts((current) =>
            current.map((context) =>
              context.id !== selectedEventId
                ? context
                : {
                    ...context,
                    products: context.products.map((product) =>
                      product.id === payload.data.productId
                        ? {
                            ...product,
                            availability: payload.data.availability,
                            ...(payload.data.stockQuantity !== undefined
                              ? {
                                  inventoryTracked: true,
                                  stockQuantity: payload.data.stockQuantity,
                                  lowStockThreshold:
                                    payload.data.lowStockThreshold,
                                  inventoryVersion: payload.data.version,
                                }
                              : {}),
                          }
                        : product,
                    ),
                  },
            ),
          );
        } catch {
          /* ungültige Fremdnachrichten werden ignoriert */
        }
      };
    } catch (err) {
      console.warn(
        "Realtime EventSource not available, falling back to polling",
        err,
      );
    }
    return () => {
      if (source) source.close();
    };
  }, [selectedEventId]);

  const context =
    contexts.find((event) => event.id === selectedEventId) || null;
  const stations = context?.stations || [];

  // Eine Station, die nach einem Aktualisieren nicht mehr zur Veranstaltung
  // gehört (deaktiviert, Veranstaltung gewechselt), darf nicht stillschweigend
  // gewählt bleiben - sonst filtert die Kasse gegen eine Station, die es aus
  // Sicht der Oberfläche nicht mehr gibt.
  useEffect(() => {
    if (
      selectedStationId &&
      !stations.some((s) => s.id === selectedStationId)
    ) {
      setSelectedStationId("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEventId, stations.map((s) => s.id).join(",")]);

  const selectedStation =
    stations.find((s) => s.id === selectedStationId) || null;

  const stationProducts = useMemo(
    () =>
      selectedStation
        ? filterProductsForStation(context?.products || [], selectedStation.id)
        : [],
    [context, selectedStation],
  );

  const categories = useMemo(
    () => [
      "Alle",
      ...new Set(
        stationProducts.map(
          (product) => product.category?.name || "Ohne Kategorie",
        ),
      ),
    ],
    [stationProducts],
  );

  // Dieselbe Kachelableitung wie die zentrale Bonkasse (Issue #66,
  // docs/development/stationskasse.md, "Notwendige Änderungen" / Oberfläche):
  // damit laufen beide Kassen bei einer Änderung an den Auswahlgruppen nicht
  // auseinander.
  const options = useMemo<QuickSaleTile[]>(
    () => deriveQuickSaleTiles(stationProducts),
    [stationProducts],
  );
  const visibleOptions =
    selectedCategory === "Alle"
      ? options
      : options.filter((option) => option.category === selectedCategory);

  const totalQuantity = cart.reduce((sum, line) => sum + line.quantity, 0);
  const total = cart.reduce((sum, line) => sum + line.price * line.quantity, 0);
  const tenderedAmount = parseEuroToCents(tenderedInput);
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

  const addOption = (option: QuickSaleTile) => {
    if (option.availability === "OUT_OF_STOCK") return;
    if (totalQuantity + selectedQuantity > 100) {
      setError(
        "Pro Verkauf können höchstens 100 Produktbons ausgegeben werden.",
      );
      return;
    }
    setError("");
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
  };

  // Abbruch leert den Warenkorb UND zieht einen neuen Idempotenzschlüssel
  // (docs/development/stationskasse.md, Abschnitt 4, Punkt 6) - sonst gälte
  // der nächste Verkauf als Wiederholung des abgebrochenen.
  const resetCart = () => {
    setCart([]);
    setTenderedInput("");
    setIdempotencyKey(crypto.randomUUID());
  };

  const abortSale = () => {
    if (cart.length === 0) return;
    if (!window.confirm("Warenkorb wirklich leeren?")) return;
    resetCart();
    setError("");
  };

  const startSession = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!context) return;
    const amount = parseEuroToCents(startingBalanceInput);
    if (amount === null) {
      setError("Ungültiges Startgeld. Bitte einen Betrag in Euro angeben.");
      return;
    }
    setStartingSession(true);
    setError("");
    try {
      await api.post("/sessions", {
        eventId: context.id,
        startingBalance: amount,
      });
      setStartingBalanceInput("");
      await loadContext();
    } catch (requestError: any) {
      setError(
        requestError.response?.data?.message ||
          "Kassensitzung konnte nicht gestartet werden.",
      );
    } finally {
      setStartingSession(false);
    }
  };

  const submitSale = async () => {
    if (
      !context?.activeSession ||
      !selectedStation ||
      cart.length === 0 ||
      submitting
    )
      return;
    if (tenderedAmount === null || tenderedAmount < total) {
      setError(
        "Der gegebene Barbetrag muss den Gesamtbetrag vollständig abdecken.",
      );
      return;
    }

    setSubmitting(true);
    setError("");
    try {
      const response = await api.post<SaleResult>("/orders/station-sale", {
        eventId: context.id,
        idempotencyKey,
        items: cart.map((line) => ({
          productId: line.productId,
          quantity: line.quantity,
          optionIds: line.optionIds.length > 0 ? line.optionIds : undefined,
        })),
        paymentMethod: "CASH",
        tenderedAmount,
        stationId: selectedStation.id,
      });
      setResult(response.data);
      setReprintMessage("");
      resetCart();
    } catch (requestError: any) {
      setError(
        requestError.response?.data?.message ||
          "Verkauf wurde nicht bestätigt. Die Stationskasse prüft denselben Vorgang beim erneuten Versuch sicher.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const reprintVouchers = async () => {
    if (!result) return;
    setReprinting(true);
    setReprintMessage("");
    try {
      // ACHTUNG (siehe Bericht): der Entwurf sieht einen Rumpf
      // { scope: "VOUCHERS" } vor, damit nur die Produktbons erneut gedruckt
      // werden. POST /orders/:id/reprint nimmt heute keinen Rumpf entgegen
      // (orders.controller.ts) und druckt immer Beleg + Produktbons (nie
      // erneut den Arbeitsbon der Station) - das ist der abgenommene Stand.
      await api.post(`/orders/${result.order.id}/reprint`);
      setReprintMessage(
        "Nachdruck wurde in die Druckwarteschlange eingereiht.",
      );
    } catch (requestError: any) {
      setReprintMessage(
        requestError.response?.data?.message || "Nachdruck ist fehlgeschlagen.",
      );
    } finally {
      setReprinting(false);
    }
  };

  if (loading) {
    return (
      <div className="py-20 text-center text-slate-400">
        Stationskasse wird vorbereitet …
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1500px] pb-8">
      <header className="mb-4 flex flex-col gap-4 rounded-3xl border border-slate-800 bg-slate-900/80 p-4 shadow-xl sm:p-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-teal-500 text-slate-950 shadow-lg shadow-teal-950/30">
            <MapPin className="h-7 w-7" aria-hidden="true" />
          </div>
          <div>
            <p className="text-xs font-black uppercase tracking-[0.2em] text-teal-300">
              Abholung an der Station
            </p>
            <h1 className="text-2xl font-black tracking-tight text-white sm:text-3xl">
              Stationskasse
            </h1>
            <p className="text-sm text-slate-400">
              Station wählen, Produkte antippen, bar kassieren.
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
                setSelectedStationId("");
                setSelectedCategory("Alle");
                setResult(null);
                setError("");
              }}
              className="mt-1 min-h-12 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-base font-bold normal-case tracking-normal text-white outline-none focus-visible:ring-2 focus-visible:ring-teal-400 sm:w-64"
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
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-800 px-4 font-bold text-slate-200 hover:bg-slate-700 focus-visible:ring-2 focus-visible:ring-teal-400"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" /> Aktualisieren
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
          Kein aktiver Drucker. Ein Stationsverkauf ohne Bon ist wertlos —
          Verkäufe bleiben gesperrt, bis die Druckbereitschaft hergestellt ist.
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

      {!context ? (
        <div className="rounded-3xl border border-dashed border-slate-700 p-10 text-center text-slate-300">
          Keine aktive Veranstaltung für die Stationskasse vorhanden.
        </div>
      ) : result ? (
        <div className="mx-auto flex max-w-2xl flex-col items-center gap-6 rounded-3xl border border-emerald-500/40 bg-slate-900/80 p-8 text-center shadow-2xl">
          <CheckCircle2
            className="h-12 w-12 text-emerald-400"
            aria-hidden="true"
          />
          <div>
            <p className="text-sm font-black uppercase tracking-[0.25em] text-emerald-300">
              Abholnummer
            </p>
            <p
              className="font-mono text-8xl font-black leading-none text-white"
              aria-label={`Abholnummer ${result.pickupNumber}`}
            >
              {result.pickupNumber}
            </p>
          </div>
          <div>
            <p className="text-sm font-black uppercase tracking-[0.25em] text-slate-400">
              Rückgeld
            </p>
            <p className="font-mono text-5xl font-black text-white">
              {formatCurrency(result.changeAmount)}
            </p>
          </div>
          {result.idempotentReplay && (
            <p className="rounded-xl bg-amber-400/10 px-4 py-2 text-sm font-bold text-amber-200">
              Dieser Verkauf war bereits gebucht und wird nicht doppelt gezählt.
            </p>
          )}
          <div className="flex w-full flex-col gap-3 sm:flex-row">
            <button
              type="button"
              onClick={() => void reprintVouchers()}
              disabled={reprinting}
              className="inline-flex min-h-14 flex-1 items-center justify-center gap-3 rounded-2xl bg-slate-800 px-4 text-base font-black text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-45 focus-visible:ring-2 focus-visible:ring-slate-400"
            >
              <Printer className="h-5 w-5" aria-hidden="true" />
              {reprinting ? "Wird gedruckt …" : "Bon erneut drucken"}
            </button>
            <button
              type="button"
              onClick={() => setResult(null)}
              className="inline-flex min-h-14 flex-1 items-center justify-center gap-3 rounded-2xl bg-teal-500 px-4 text-base font-black text-slate-950 hover:bg-teal-400 focus-visible:ring-2 focus-visible:ring-teal-300"
            >
              Nächster Verkauf
            </button>
          </div>
          {reprintMessage && (
            <p role="status" className="text-sm font-semibold text-slate-300">
              {reprintMessage}
            </p>
          )}
        </div>
      ) : (
        <>
          <section
            className="mb-4 rounded-3xl border border-slate-800 bg-slate-900/65 p-4"
            aria-labelledby="station-picker-title"
          >
            <h2
              id="station-picker-title"
              className="mb-3 text-xs font-black uppercase tracking-[0.18em] text-slate-500"
            >
              Station
            </h2>
            {stations.length === 0 ? (
              <p className="text-sm font-semibold text-slate-400">
                Für diese Veranstaltung ist keine aktive Station hinterlegt.
              </p>
            ) : (
              // Name zuerst, Kürzel als Nebenzeile darunter - dasselbe Muster
              // wie StationSelection.tsx. Diese Wahl trifft jemand zu
              // Schichtbeginn, oft in fremder Umgebung und in Eile; ein
              // Kürzel allein (z. B. "GR1" gegen "GR2") ist dafür zu knapp.
              // Ein Raster mit einer Spalte auf schmalen Bildschirmen gibt
              // jedem Namen die volle Breite, sodass er umbrechen statt
              // überlaufen oder abgeschnitten werden kann.
              <div
                className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3"
                role="group"
                aria-label="Station wählen"
              >
                {stations.map((station) => (
                  <button
                    key={station.id}
                    type="button"
                    disabled={cart.length > 0}
                    aria-pressed={selectedStationId === station.id}
                    onClick={() => {
                      setSelectedStationId(station.id);
                      setSelectedCategory("Alle");
                      setError("");
                    }}
                    style={{
                      backgroundColor:
                        selectedStationId === station.id
                          ? station.color || "#0d9488"
                          : undefined,
                    }}
                    className={`min-h-16 w-full rounded-2xl border px-5 py-3 text-left transition disabled:cursor-not-allowed disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-teal-300 ${
                      selectedStationId === station.id
                        ? "border-transparent text-white shadow-lg"
                        : "border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700"
                    }`}
                  >
                    <span className="block break-words text-base font-black leading-tight">
                      {station.name}
                    </span>
                    {station.shortName && (
                      <span className="mt-0.5 block text-xs font-bold uppercase tracking-wider opacity-70">
                        {station.shortName}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
            {cart.length > 0 && (
              <p className="mt-2 text-xs font-semibold text-slate-500">
                Die Station lässt sich erst nach Leeren des Warenkorbs wechseln.
              </p>
            )}
          </section>

          {!selectedStation ? (
            <div className="rounded-3xl border border-dashed border-slate-700 p-10 text-center text-slate-300">
              Bitte zuerst eine Station wählen.
            </div>
          ) : !context.printingReady ? (
            <div className="rounded-3xl border-2 border-rose-600 bg-rose-500/10 p-10 text-center text-rose-100">
              <Printer className="mx-auto mb-3 h-10 w-10" aria-hidden="true" />
              <p className="text-lg font-black">Verkauf gesperrt</p>
              <p className="mt-1 text-sm">
                Kein aktiver Drucker. Bitte Drucker aktivieren und anschließend
                aktualisieren.
              </p>
            </div>
          ) : !context.activeSession ? (
            <div className="mx-auto max-w-md rounded-3xl border-2 border-amber-600 bg-amber-500/10 p-6 text-center text-amber-100">
              <Play className="mx-auto mb-3 h-10 w-10" aria-hidden="true" />
              <p className="text-lg font-black">Keine aktive Kassensitzung</p>
              <p className="mt-1 text-sm">
                Vor dem ersten Verkauf an dieser Station Startgeld erfassen.
              </p>
              <form
                onSubmit={(event) => void startSession(event)}
                className="mt-4 space-y-3 text-left"
              >
                <label
                  className="block text-xs font-black uppercase tracking-wider text-amber-200"
                  htmlFor="station-starting-balance"
                >
                  Startgeld
                  <input
                    id="station-starting-balance"
                    inputMode="decimal"
                    required
                    value={startingBalanceInput}
                    onChange={(event) =>
                      setStartingBalanceInput(event.target.value)
                    }
                    placeholder="z. B. 50,00"
                    className="mt-1 min-h-12 w-full rounded-xl border-2 border-amber-500/50 bg-slate-950 px-4 font-mono text-lg font-black normal-case tracking-normal text-white outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
                  />
                </label>
                <button
                  type="submit"
                  disabled={startingSession}
                  className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-amber-600 px-4 font-black text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-amber-400"
                >
                  <Play className="h-4 w-4" aria-hidden="true" />
                  {startingSession
                    ? "Wird gestartet …"
                    : "Kassensitzung öffnen"}
                </button>
              </form>
            </div>
          ) : (
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_24rem]">
              <section
                className="min-w-0 rounded-3xl border border-slate-800 bg-slate-900/65 p-3 sm:p-4"
                aria-labelledby="station-products-title"
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
                          className={`min-h-14 min-w-20 rounded-2xl px-4 font-mono text-xl font-black transition active:scale-95 focus-visible:ring-2 focus-visible:ring-teal-300 ${selectedQuantity === quantity ? "bg-teal-500 text-slate-950 shadow-lg shadow-teal-950/30" : "bg-slate-800 text-slate-200 hover:bg-slate-700"}`}
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

                <h2 id="station-products-title" className="sr-only">
                  Sortiment der Station {selectedStation.name}
                </h2>
                {visibleOptions.length === 0 ? (
                  <p className="py-10 text-center text-sm font-semibold text-slate-400">
                    Diese Station führt derzeit kein Produkt.
                  </p>
                ) : (
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
                    {visibleOptions.map((option) => {
                      const disabled = option.availability === "OUT_OF_STOCK";
                      const isLow = option.availability === "LOW_STOCK";
                      return (
                        <button
                          key={option.key}
                          type="button"
                          disabled={disabled}
                          onClick={() => addOption(option)}
                          style={{
                            backgroundColor: disabled
                              ? "#1e293b"
                              : option.color || "#0f766e",
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
                          {isLow && (
                            <div className="absolute top-1 right-1">
                              <span className="bg-amber-400 text-slate-950 font-black text-[9px] px-1 py-0.5 rounded shadow-md uppercase">
                                Knapp
                              </span>
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </section>

              <aside
                className="relative overflow-hidden rounded-[1.75rem] bg-[#fff8e7] text-slate-950 shadow-2xl shadow-black/30 lg:sticky lg:top-24 lg:self-start"
                aria-labelledby="station-cart-title"
              >
                <div
                  className="h-3 bg-[radial-gradient(circle_at_6px_-1px,transparent_6px,#fff8e7_6.5px)] bg-[length:12px_12px]"
                  aria-hidden="true"
                />
                <div className="px-4 pb-5 pt-3 sm:px-5">
                  <div className="flex items-center justify-between border-b-2 border-dashed border-slate-300 pb-3">
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">
                        {selectedStation.name}
                      </p>
                      <h2
                        id="station-cart-title"
                        className="text-xl font-black"
                      >
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
                                  current.filter(
                                    (item) => item.key !== line.key,
                                  ),
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

                  <div className="mt-4 space-y-3">
                    <div>
                      <label
                        className="text-xs font-black uppercase tracking-wider text-slate-600"
                        htmlFor="station-tendered-amount"
                      >
                        Bar gegeben
                      </label>
                      <input
                        id="station-tendered-amount"
                        inputMode="decimal"
                        value={tenderedInput}
                        onChange={(event) =>
                          setTenderedInput(event.target.value)
                        }
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
                        cart.length === 0 || submitting || changeAmount === null
                      }
                      onClick={() => void submitSale()}
                      className="inline-flex min-h-14 w-full items-center justify-center gap-3 rounded-2xl bg-emerald-600 px-4 text-lg font-black text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-45 focus-visible:ring-2 focus-visible:ring-emerald-400"
                    >
                      <Banknote className="h-5 w-5" aria-hidden="true" />{" "}
                      {submitting ? "Wird gebucht …" : "Bar kassieren"}
                    </button>
                    <button
                      type="button"
                      disabled={cart.length === 0}
                      onClick={abortSale}
                      className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl border-2 border-slate-400 bg-transparent px-4 text-sm font-black text-slate-700 hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-slate-500"
                    >
                      <RotateCcw className="h-4 w-4" aria-hidden="true" />{" "}
                      Warenkorb abbrechen
                    </button>
                  </div>

                  <p className="mt-4 text-center text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    VereinOrder ist keine RKSV-Registrierkasse.
                  </p>
                </div>
              </aside>
            </div>
          )}
        </>
      )}
    </div>
  );
};
