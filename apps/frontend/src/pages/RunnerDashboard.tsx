import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  MapPin,
  PackageCheck,
  RefreshCw,
  Sparkles,
  Truck,
  Volume2,
  VolumeX,
  WifiOff,
} from "lucide-react";
import { api } from "../lib/api";

interface RunnerArea {
  id: string;
  name: string;
}

interface RunnerItem {
  id: string;
  quantity: number;
  status:
    | "PENDING"
    | "PREPARING"
    | "READY"
    | "IN_DELIVERY"
    | "DELIVERED"
    | "CANCELLED";
  variantName?: string | null;
  extras?: { id?: string; name: string }[] | null;
  product: { id: string; name: string; shortName?: string | null };
}

interface RunnerOrder {
  id: string;
  orderNumber: number;
  tableName?: string | null;
  areaId?: string | null;
  area?: RunnerArea | null;
  fulfillmentStatus: string;
  isPriority: boolean;
  createdAt: string;
  claimedAt?: string | null;
  claimedByUserId?: string | null;
  items: RunnerItem[];
}

interface RunnerContext {
  event: {
    id: string;
    name: string;
    status: "ACTIVE" | "TEST_MODE";
    testMode: boolean;
  };
  areas: RunnerArea[];
}

const formatRelativeTime = (value: string) => {
  const minutes = Math.max(
    0,
    Math.floor((Date.now() - new Date(value).getTime()) / 60000),
  );
  if (minutes < 1) return "gerade bereit";
  return `seit ${minutes} Min.`;
};

const itemDetails = (item: RunnerItem) =>
  [
    item.variantName,
    ...(Array.isArray(item.extras)
      ? item.extras.map((extra) => extra.name)
      : []),
  ]
    .filter(Boolean)
    .join(" · ");

interface DeliveryCardProps {
  order: RunnerOrder;
  mode: "ready" | "mine";
  isNew?: boolean;
  busy: boolean;
  error?: string;
  onClaim: () => void;
  onDeliver: () => void;
}

const DeliveryCard = ({
  order,
  mode,
  isNew,
  busy,
  error,
  onClaim,
  onDeliver,
}: DeliveryCardProps) => {
  const readyItems = order.items.filter((item) => item.status === "READY");
  const carryingItems = order.items.filter(
    (item) => item.status === "IN_DELIVERY",
  );
  const shownItems =
    mode === "ready" ? readyItems : [...carryingItems, ...readyItems];
  const timeValue =
    mode === "mine" && order.claimedAt ? order.claimedAt : order.createdAt;

  return (
    <article
      className={`overflow-hidden rounded-3xl border bg-slate-900/90 shadow-xl shadow-black/20 transition-colors ${isNew ? "border-amber-400 ring-2 ring-amber-400/30" : mode === "mine" ? "border-indigo-400/40" : "border-slate-700"}`}
    >
      <div
        className={`grid grid-cols-[minmax(0,1fr)_auto] gap-3 px-5 py-4 ${mode === "mine" ? "bg-indigo-500/15" : "bg-slate-800/80"}`}
      >
        <div className="min-w-0">
          <div className="mb-1 flex flex-wrap items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-slate-400">
            <MapPin className="h-4 w-4" aria-hidden="true" />
            <span>{order.area?.name || "Ohne Bereich"}</span>
            {isNew && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-400 px-2 py-1 text-slate-950">
                <Sparkles className="h-3 w-3" /> Neu
              </span>
            )}
          </div>
          <h3 className="truncate text-3xl font-black tracking-tight text-white">
            {order.tableName || "Ohne Tisch"}
          </h3>
        </div>
        <div className="text-right">
          <div className="font-mono text-xl font-black text-indigo-300">
            #{order.orderNumber}
          </div>
          <time
            dateTime={timeValue}
            className="mt-1 inline-flex items-center gap-1 text-sm font-semibold text-slate-400"
          >
            <Clock3 className="h-4 w-4" aria-hidden="true" />{" "}
            {formatRelativeTime(timeValue)}
          </time>
        </div>
      </div>

      <div className="space-y-3 px-5 py-4">
        {order.isPriority && (
          <p className="rounded-xl border border-rose-400/50 bg-rose-500/10 px-3 py-2 text-sm font-bold text-rose-200">
            Priorisierte Bestellung
          </p>
        )}
        <ul
          className="divide-y divide-slate-800"
          aria-label={`Positionen der Bestellung ${order.orderNumber}`}
        >
          {shownItems.map((item) => (
            <li key={item.id} className="flex gap-3 py-3 first:pt-0 last:pb-0">
              <span className="w-10 shrink-0 text-2xl font-black tabular-nums text-white">
                {item.quantity}×
              </span>
              <div className="min-w-0 flex-1">
                <div className="font-bold text-slate-100">
                  {item.product.shortName || item.product.name}
                </div>
                {itemDetails(item) && (
                  <div className="mt-0.5 text-sm text-slate-400">
                    {itemDetails(item)}
                  </div>
                )}
                {item.status === "READY" && mode === "mine" && (
                  <span className="mt-1 inline-block text-xs font-bold text-amber-300">
                    Neu bereit – noch übernehmen
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>

        {error && (
          <p
            role="alert"
            className="rounded-xl border border-rose-500/50 bg-rose-500/10 px-3 py-2 text-sm text-rose-200"
          >
            {error}
          </p>
        )}

        {mode === "ready" ? (
          <button
            type="button"
            disabled={busy}
            onClick={onClaim}
            className="min-h-12 w-full rounded-2xl bg-amber-400 px-4 py-3 text-lg font-black text-slate-950 transition hover:bg-amber-300 active:scale-[0.99] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-200 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900"
            aria-label={`Bestellung ${order.orderNumber} übernehmen`}
          >
            {busy ? "Wird übernommen …" : "Bestellung übernehmen"}
          </button>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {readyItems.length > 0 && (
              <button
                type="button"
                disabled={busy}
                onClick={onClaim}
                className="min-h-12 rounded-2xl border border-amber-400/60 bg-amber-400/10 px-4 py-3 font-black text-amber-200 hover:bg-amber-400/20 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
                aria-label={`Weitere Positionen der Bestellung ${order.orderNumber} übernehmen`}
              >
                Weitere übernehmen
              </button>
            )}
            {carryingItems.length > 0 && (
              <button
                type="button"
                disabled={busy}
                onClick={onDeliver}
                className="min-h-12 rounded-2xl bg-emerald-500 px-4 py-3 text-lg font-black text-slate-950 hover:bg-emerald-400 active:scale-[0.99] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-200"
                aria-label={`Bestellung ${order.orderNumber} als zugestellt markieren`}
              >
                {busy ? "Wird gespeichert …" : "Als zugestellt markieren"}
              </button>
            )}
          </div>
        )}
      </div>
    </article>
  );
};

export const RunnerDashboard = () => {
  const [context, setContext] = useState<RunnerContext | null>(null);
  const [readyOrders, setReadyOrders] = useState<RunnerOrder[]>([]);
  const [myOrders, setMyOrders] = useState<RunnerOrder[]>([]);
  const [selectedArea, setSelectedArea] = useState("all");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [pageError, setPageError] = useState("");
  const [actionErrors, setActionErrors] = useState<Record<string, string>>({});
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null);
  const [newOrderIds, setNewOrderIds] = useState<Set<string>>(new Set());
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [liveMessage, setLiveMessage] = useState("");
  const seenReadyItemIds = useRef<Set<string> | null>(null);
  const soundEnabledRef = useRef(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const newMarkerTimeoutRef = useRef<number | null>(null);

  const playSignal = useCallback(() => {
    const audioContext = audioContextRef.current;
    if (!audioContext || !soundEnabledRef.current) return;
    void audioContext.resume().then(() => {
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(740, audioContext.currentTime);
      gain.gain.setValueAtTime(0.0001, audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(
        0.16,
        audioContext.currentTime + 0.02,
      );
      gain.gain.exponentialRampToValueAtTime(
        0.0001,
        audioContext.currentTime + 0.24,
      );
      oscillator.connect(gain).connect(audioContext.destination);
      oscillator.start();
      oscillator.stop(audioContext.currentTime + 0.25);
    });
  }, []);

  const fetchQueue = useCallback(
    async (eventId: string, foreground = false) => {
      if (foreground) setRefreshing(true);
      try {
        const [readyResponse, mineResponse] = await Promise.all([
          api.get("/runner/orders", { params: { eventId } }),
          api.get("/runner/orders/mine", { params: { eventId } }),
        ]);
        const nextReady = (readyResponse.data || []) as RunnerOrder[];
        const readyItemIds = new Set(
          nextReady.flatMap((order) =>
            order.items
              .filter((item) => item.status === "READY")
              .map((item) => item.id),
          ),
        );

        if (seenReadyItemIds.current) {
          const newItems = [...readyItemIds].filter(
            (id) => !seenReadyItemIds.current?.has(id),
          );
          if (newItems.length > 0) {
            const affectedOrders = new Set(
              nextReady
                .filter((order) =>
                  order.items.some((item) => newItems.includes(item.id)),
                )
                .map((order) => order.id),
            );
            setNewOrderIds(affectedOrders);
            const firstNew = nextReady.find((order) =>
              affectedOrders.has(order.id),
            );
            if (firstNew)
              setLiveMessage(
                `Neue Bestellung für ${firstNew.area?.name || "ohne Bereich"}, ${firstNew.tableName || "ohne Tisch"}`,
              );
            playSignal();
            if (newMarkerTimeoutRef.current !== null)
              window.clearTimeout(newMarkerTimeoutRef.current);
            newMarkerTimeoutRef.current = window.setTimeout(() => {
              setNewOrderIds(new Set());
              newMarkerTimeoutRef.current = null;
            }, 8000);
          }
        }
        seenReadyItemIds.current = readyItemIds;
        setReadyOrders(nextReady);
        setMyOrders(mineResponse.data || []);
        setLastUpdated(new Date());
        setOnline(true);
        setPageError("");
      } catch (error) {
        console.error("Runner queue could not be loaded", error);
        setOnline(false);
        setPageError(
          "Die Zustellliste konnte nicht aktualisiert werden. Verbindung prüfen und erneut versuchen.",
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [playSignal],
  );

  useEffect(() => {
    let active = true;
    api
      .get("/runner/context")
      .then((response) => {
        if (active) setContext(response.data);
      })
      .catch((error) => {
        console.error("Runner context could not be loaded", error);
        if (active) {
          setPageError(
            "Keine aktive Veranstaltung für die Zustellung gefunden.",
          );
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!context?.event.id) return;
    void fetchQueue(context.event.id);
    const interval = window.setInterval(
      () => void fetchQueue(context.event.id),
      5000,
    );
    return () => window.clearInterval(interval);
  }, [context?.event.id, fetchQueue]);

  useEffect(() => {
    const handleOnline = () => {
      setOnline(true);
      if (context?.event.id) void fetchQueue(context.event.id, true);
    };
    const handleOffline = () => setOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [context?.event.id, fetchQueue]);

  useEffect(
    () => () => {
      if (newMarkerTimeoutRef.current !== null)
        window.clearTimeout(newMarkerTimeoutRef.current);
      void audioContextRef.current?.close();
    },
    [],
  );

  const toggleSound = async () => {
    const nextEnabled = !soundEnabled;
    if (nextEnabled && !audioContextRef.current)
      audioContextRef.current = new AudioContext();
    if (nextEnabled) await audioContextRef.current?.resume();
    soundEnabledRef.current = nextEnabled;
    setSoundEnabled(nextEnabled);
    setLiveMessage(
      nextEnabled
        ? "Akustisches Signal aktiviert"
        : "Akustisches Signal deaktiviert",
    );
  };

  const runAction = async (orderId: string, action: "claim" | "deliver") => {
    if (!context?.event.id || busyOrderId) return;
    setBusyOrderId(orderId);
    setActionErrors((current) => ({ ...current, [orderId]: "" }));
    try {
      await api.patch(`/runner/orders/${orderId}/${action}`);
      setLiveMessage(
        action === "claim"
          ? "Bestellung übernommen"
          : "Bestellung als zugestellt markiert",
      );
      await fetchQueue(context.event.id);
    } catch (error: any) {
      const status = error.response?.status;
      const message =
        status === 404
          ? "Diese Bestellung wurde bereits übernommen oder hat sich geändert. Liste aktualisieren."
          : status === 403
            ? "Diese Aktion ist für den angemeldeten Benutzer nicht erlaubt."
            : "Aktion fehlgeschlagen. Verbindung prüfen und erneut versuchen.";
      setActionErrors((current) => ({ ...current, [orderId]: message }));
      await fetchQueue(context.event.id);
    } finally {
      setBusyOrderId(null);
    }
  };

  const matchesArea = useCallback(
    (order: RunnerOrder) =>
      selectedArea === "all" ||
      (selectedArea === "none" ? !order.areaId : order.areaId === selectedArea),
    [selectedArea],
  );
  const filteredReady = useMemo(
    () => readyOrders.filter(matchesArea),
    [readyOrders, matchesArea],
  );
  const filteredMine = useMemo(
    () => myOrders.filter(matchesArea),
    [myOrders, matchesArea],
  );
  const areaCount = (areaId: string) =>
    readyOrders.filter((order) =>
      areaId === "none" ? !order.areaId : order.areaId === areaId,
    ).length;

  if (loading) {
    return (
      <div
        className="grid gap-4 md:grid-cols-2"
        aria-label="Zustellliste wird geladen"
      >
        {[0, 1, 2, 3].map((key) => (
          <div
            key={key}
            className="h-64 animate-pulse rounded-3xl border border-slate-800 bg-slate-900"
          />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <p className="sr-only" aria-live="polite">
        {liveMessage}
      </p>

      <header className="sticky top-24 z-20 space-y-3 rounded-3xl border border-slate-800 bg-slate-950/95 p-4 shadow-xl shadow-black/20 backdrop-blur md:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="mb-1 flex items-center gap-2 text-sm font-bold uppercase tracking-[0.16em] text-indigo-300">
              <Truck className="h-5 w-5" /> Zustellspur
            </div>
            <h1 className="text-3xl font-black tracking-tight text-white">
              {context?.event.name || "Zustellung"}
            </h1>
            <p className="mt-1 text-sm text-slate-400">
              Fertige Bestellungen sicher übernehmen und zum richtigen Tisch
              bringen.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={toggleSound}
              aria-pressed={soundEnabled}
              className={`min-h-11 rounded-xl border px-3 py-2 text-sm font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 ${soundEnabled ? "border-emerald-400/50 bg-emerald-500/15 text-emerald-200" : "border-slate-700 bg-slate-900 text-slate-300"}`}
            >
              {soundEnabled ? (
                <Volume2 className="mr-2 inline h-4 w-4" />
              ) : (
                <VolumeX className="mr-2 inline h-4 w-4" />
              )}
              {soundEnabled ? "Signal an" : "Signal aus"}
            </button>
            <button
              type="button"
              disabled={refreshing || !context?.event.id}
              onClick={() =>
                context?.event.id && void fetchQueue(context.event.id, true)
              }
              className="min-h-11 min-w-11 rounded-xl border border-slate-700 bg-slate-900 p-2 text-slate-200 hover:bg-slate-800 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
              aria-label="Zustellliste aktualisieren"
            >
              <RefreshCw
                className={`mx-auto h-5 w-5 ${refreshing ? "animate-spin" : ""}`}
              />
            </button>
          </div>
        </div>

        <div
          className="flex items-center gap-2 overflow-x-auto pb-1"
          aria-label="Nach Bereich filtern"
        >
          <button
            type="button"
            onClick={() => setSelectedArea("all")}
            aria-pressed={selectedArea === "all"}
            className={`min-h-11 shrink-0 rounded-xl px-4 py-2 text-sm font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 ${selectedArea === "all" ? "bg-indigo-500 text-white" : "bg-slate-900 text-slate-300"}`}
          >
            Alle{" "}
            <span className="ml-1 tabular-nums opacity-80">
              {readyOrders.length}
            </span>
          </button>
          {context?.areas.map((area) => (
            <button
              key={area.id}
              type="button"
              onClick={() => setSelectedArea(area.id)}
              aria-pressed={selectedArea === area.id}
              className={`min-h-11 shrink-0 rounded-xl px-4 py-2 text-sm font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 ${selectedArea === area.id ? "bg-indigo-500 text-white" : "bg-slate-900 text-slate-300"}`}
            >
              {area.name}{" "}
              <span className="ml-1 tabular-nums opacity-80">
                {areaCount(area.id)}
              </span>
            </button>
          ))}
          <button
            type="button"
            onClick={() => setSelectedArea("none")}
            aria-pressed={selectedArea === "none"}
            className={`min-h-11 shrink-0 rounded-xl px-4 py-2 text-sm font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 ${selectedArea === "none" ? "bg-indigo-500 text-white" : "bg-slate-900 text-slate-300"}`}
          >
            Ohne Bereich{" "}
            <span className="ml-1 tabular-nums opacity-80">
              {areaCount("none")}
            </span>
          </button>
        </div>
      </header>

      {!online && (
        <div
          role="alert"
          className="flex items-center gap-3 rounded-2xl border border-amber-400/50 bg-amber-400/10 px-4 py-3 text-amber-100"
        >
          <WifiOff className="h-5 w-5 shrink-0" />
          <div>
            <strong>Verbindung unterbrochen.</strong> Stand{" "}
            {lastUpdated?.toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            }) || "unbekannt"}{" "}
            – Zustellaktionen sind bis zur Verbindung nicht verlässlich.
          </div>
        </div>
      )}
      {pageError && (
        <div
          role="alert"
          className="flex items-center gap-3 rounded-2xl border border-rose-500/50 bg-rose-500/10 px-4 py-3 text-rose-100"
        >
          <AlertTriangle className="h-5 w-5 shrink-0" />
          {pageError}
        </div>
      )}

      <div className="grid items-start gap-5 md:grid-cols-2 xl:grid-cols-[minmax(0,2fr)_minmax(340px,1fr)]">
        <section aria-labelledby="ready-heading" className="space-y-3">
          <div className="flex items-end justify-between gap-3">
            <div>
              <div className="text-xs font-bold uppercase tracking-[0.18em] text-amber-300">
                Abholspur
              </div>
              <h2 id="ready-heading" className="text-2xl font-black text-white">
                Bereit zur Übernahme
              </h2>
            </div>
            <span className="rounded-full bg-amber-400/15 px-3 py-1 font-mono text-lg font-black text-amber-200">
              {filteredReady.length}
            </span>
          </div>
          {filteredReady.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-slate-700 bg-slate-900/50 px-6 py-12 text-center">
              <PackageCheck className="mx-auto mb-3 h-12 w-12 text-slate-600" />
              <p className="text-lg font-bold text-slate-300">
                In diesem Bereich ist nichts bereit.
              </p>
              {selectedArea !== "all" && (
                <button
                  type="button"
                  onClick={() => setSelectedArea("all")}
                  className="mt-3 min-h-11 rounded-xl bg-slate-800 px-4 py-2 font-bold text-indigo-200 focus-visible:ring-2 focus-visible:ring-indigo-300"
                >
                  Filter zurücksetzen
                </button>
              )}
            </div>
          ) : (
            filteredReady.map((order) => (
              <DeliveryCard
                key={order.id}
                order={order}
                mode="ready"
                isNew={newOrderIds.has(order.id)}
                busy={busyOrderId === order.id}
                error={actionErrors[order.id]}
                onClaim={() => void runAction(order.id, "claim")}
                onDeliver={() => undefined}
              />
            ))
          )}
        </section>

        <section
          aria-labelledby="mine-heading"
          className="space-y-3 xl:sticky xl:top-[19rem]"
        >
          <div className="flex items-end justify-between gap-3">
            <div>
              <div className="text-xs font-bold uppercase tracking-[0.18em] text-indigo-300">
                Unterwegs-Spur
              </div>
              <h2 id="mine-heading" className="text-2xl font-black text-white">
                Von mir übernommen
              </h2>
            </div>
            <span className="rounded-full bg-indigo-400/15 px-3 py-1 font-mono text-lg font-black text-indigo-200">
              {filteredMine.length}
            </span>
          </div>
          {filteredMine.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-slate-700 bg-slate-900/50 px-6 py-10 text-center">
              <CheckCircle2 className="mx-auto mb-3 h-11 w-11 text-slate-600" />
              <p className="font-bold text-slate-300">
                Du hast derzeit keine Bestellung unterwegs.
              </p>
            </div>
          ) : (
            filteredMine.map((order) => (
              <DeliveryCard
                key={order.id}
                order={order}
                mode="mine"
                busy={busyOrderId === order.id}
                error={actionErrors[order.id]}
                onClaim={() => void runAction(order.id, "claim")}
                onDeliver={() => void runAction(order.id, "deliver")}
              />
            ))
          )}
        </section>
      </div>
    </div>
  );
};
