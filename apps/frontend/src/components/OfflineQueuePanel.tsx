import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Loader2,
  RefreshCw,
  Trash2,
  UserCheck,
  X,
} from "lucide-react";
import {
  adoptLegacyOfflineOrder,
  canAdoptLegacyOfflineOrder,
  canDiscardOfflineOrder,
  discardOfflineOrder,
  listConfirmedOfflineOrders,
  listOpenOfflineOrders,
  retryOfflineOrder,
  type ConflictKind,
  type DiscardReasonCategory,
  type OfflineDataMode,
  type OfflineOrderRecord,
  type OfflineOrderState,
  type OfflinePayment,
  type OfflineSyncHttpClient,
} from "../lib/offlineSync";

// Warteschlangenansicht (Issue #65, Abschnitt 7). Baut ausschließlich auf den
// Exporten von `offlineSync.ts` auf — dieser Datei ist es untersagt, die
// internen `offlineQueue*`-Module direkt anzufassen.

export interface OfflineQueuePanelEventContext {
  id: string;
  status: unknown;
  testMode: unknown;
  activeSession: { id: string } | null;
}

export interface OfflineQueuePanelCurrentUser {
  userId: string;
  username: string;
  role: string;
}

export interface OfflineQueuePanelProps {
  isOpen: boolean;
  onClose: () => void;
  httpClient: OfflineSyncHttpClient;
  currentUser: OfflineQueuePanelCurrentUser | null;
  eventContexts: OfflineQueuePanelEventContext[];
  /** Wird nach jeder Handlung aufgerufen, die den Bestand ändert (Retry, Verwerfen, Übernehmen). */
  onQueueChanged?: () => void;
}

// Dieselbe Ableitung wie in offlineQueueContext.ts, hier bewusst noch einmal
// definiert statt importiert (siehe Kopfkommentar oben).
function deriveDataMode(
  status: unknown,
  testMode: unknown,
): "TEST" | "LIVE" | null {
  if (status === "ACTIVE" && !testMode) return "LIVE";
  if (status === "TEST_MODE" && testMode) return "TEST";
  return null;
}

const formatDateTime = (ms: number) =>
  new Date(ms).toLocaleString("de-AT", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

const formatAmount = (cents: number) => `€ ${(cents / 100).toFixed(2)}`;

const sumPayments = (payments: OfflinePayment[]) =>
  payments.reduce((sum, p) => sum + p.amount, 0);

const DATA_MODE_LABELS: Record<OfflineDataMode, string> = {
  TEST: "Testbetrieb",
  LIVE: "Echtbetrieb",
  UNKNOWN: "Betriebsart unbekannt",
};

const STATE_META: Record<
  OfflineOrderState,
  { label: string; hint: string; badgeClass: string }
> = {
  LOCAL_PENDING: {
    label: "Lokal vorgemerkt",
    hint: "Noch nicht an den Server gesendet.",
    badgeClass: "bg-slate-700 text-slate-100",
  },
  SENDING: {
    label: "Wird gesendet",
    hint: "Übertragung läuft gerade.",
    badgeClass: "bg-indigo-600 text-white",
  },
  CONFIRMED: {
    label: "Vom Server bestätigt",
    hint: "Diese Bestellung ist beim Server angekommen.",
    badgeClass: "bg-emerald-600 text-white",
  },
  CONFLICT: {
    label: "Konflikt",
    hint: "Kein automatischer Versuch mehr, bis eine Person entscheidet.",
    badgeClass: "bg-rose-600 text-white",
  },
  FAILED: {
    label: "Gescheitert",
    hint: "Automatische Versuche sind aufgebraucht.",
    badgeClass: "bg-amber-500 text-slate-950",
  },
};

const CONFLICT_LABELS: Record<ConflictKind, string> = {
  AUTH_EXPIRED: "Die Anmeldung war beim Senden abgelaufen.",
  FORBIDDEN: "Keine Berechtigung für diese Aktion.",
  CONTEXT_UNKNOWN:
    "Altbestand ohne bekannten Benutzer, Betriebsart oder Kassensitzung.",
  EVENT_MODE: "Die Betriebsart der Veranstaltung weicht von der Erfassung ab.",
  SESSION_CLOSED:
    "Die erfasste Kassensitzung ist geschlossen oder wurde ausgetauscht.",
  PRODUCT_UNAVAILABLE: "Ein Produkt ist inzwischen nicht mehr verfügbar.",
  PRICE_OR_OPTION: "Preise oder Auswahlmöglichkeiten haben sich geändert.",
  VALIDATION: "Die Bestellung entspricht nicht mehr den aktuellen Regeln.",
  DUPLICATE_KEY_MISMATCH:
    "Die Antwort gehört laut Server zu einer anderen Bestellung.",
  UNKNOWN_4XX: "Der Server hat die Bestellung abgelehnt.",
};

const DISCARD_REASONS: { value: DiscardReasonCategory; label: string }[] = [
  { value: "DUPLICATE", label: "Doppelerfassung" },
  { value: "GUEST_CANCELLED", label: "Gast hat storniert" },
  { value: "TEST_ENTRY", label: "Testeingabe" },
  { value: "OTHER", label: "Sonstiges" },
];

type Banner = { tone: "info" | "error"; text: string };

export const OfflineQueuePanel = ({
  isOpen,
  onClose,
  httpClient,
  currentUser,
  eventContexts,
  onQueueChanged,
}: OfflineQueuePanelProps) => {
  const [openEntries, setOpenEntries] = useState<OfflineOrderRecord[]>([]);
  const [confirmedEntries, setConfirmedEntries] = useState<
    OfflineOrderRecord[]
  >([]);
  const [loading, setLoading] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);

  const [discardTarget, setDiscardTarget] = useState<OfflineOrderRecord | null>(
    null,
  );
  const [discardCategory, setDiscardCategory] =
    useState<DiscardReasonCategory>("DUPLICATE");
  const [discardNote, setDiscardNote] = useState("");
  const [discardChecked, setDiscardChecked] = useState(false);
  const [discardBusy, setDiscardBusy] = useState(false);
  const [discardBanner, setDiscardBanner] = useState<Banner | null>(null);

  const [adoptTarget, setAdoptTarget] = useState<OfflineOrderRecord | null>(
    null,
  );
  const [adoptBusy, setAdoptBusy] = useState(false);
  const [adoptBanner, setAdoptBanner] = useState<Banner | null>(null);

  const loadEntries = useCallback(async () => {
    setLoading(true);
    try {
      const [open, confirmed] = await Promise.all([
        listOpenOfflineOrders(),
        listConfirmedOfflineOrders(),
      ]);
      setOpenEntries(open);
      setConfirmedEntries(confirmed);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) void loadEntries();
  }, [isOpen, loadEntries]);

  if (!isOpen) return null;

  const notifyChanged = () => {
    onQueueChanged?.();
  };

  const handleRetry = async (record: OfflineOrderRecord) => {
    setBusyKey(record.idempotencyKey);
    try {
      await retryOfflineOrder(record.idempotencyKey, {
        httpClient,
        currentUserId: currentUser?.userId ?? null,
      });
    } finally {
      setBusyKey(null);
      await loadEntries();
      notifyChanged();
    }
  };

  const openDiscardDialog = (record: OfflineOrderRecord) => {
    setDiscardTarget(record);
    setDiscardCategory("DUPLICATE");
    setDiscardNote("");
    setDiscardChecked(false);
    setDiscardBanner(null);
  };

  const confirmDiscard = async () => {
    if (!discardTarget || !discardChecked) return;
    setDiscardBusy(true);
    setDiscardBanner(null);
    try {
      const result = await discardOfflineOrder(
        discardTarget.idempotencyKey,
        { category: discardCategory, note: discardNote.trim() || undefined },
        { httpClient },
      );

      if (
        result.outcome === "DISCARDED" ||
        result.outcome === "ALREADY_DELETED"
      ) {
        setDiscardTarget(null);
        await loadEntries();
        notifyChanged();
        return;
      }
      if (result.outcome === "ALREADY_ON_SERVER") {
        setDiscardBanner({
          tone: "info",
          text: `Diese Bestellung liegt bereits beim Server${
            result.serverOrderNumber ? ` (Nr. ${result.serverOrderNumber})` : ""
          } und wurde nicht gelöscht.`,
        });
        await loadEntries();
        notifyChanged();
        return;
      }
      const text =
        result.reason === "AUTH_REQUIRED"
          ? "Verwerfen wurde abgelehnt. Bitte neu anmelden."
          : result.reason === "CONFLICT"
            ? "Verwerfen wurde vom Server abgelehnt."
            : "Verwerfen ist nur mit Serververbindung möglich.";
      setDiscardBanner({ tone: "error", text });
    } finally {
      setDiscardBusy(false);
    }
  };

  const openAdoptDialog = (record: OfflineOrderRecord) => {
    setAdoptTarget(record);
    setAdoptBanner(null);
  };

  const confirmAdopt = async () => {
    if (!adoptTarget || !currentUser) return;
    const eventEntry = eventContexts.find((e) => e.id === adoptTarget.eventId);
    const dataMode = eventEntry
      ? deriveDataMode(eventEntry.status, eventEntry.testMode)
      : null;
    if (!dataMode) {
      setAdoptBanner({
        tone: "error",
        text: "Die heutige Betriebsart dieser Veranstaltung ist nicht bekannt. Bitte online gehen und erneut versuchen.",
      });
      return;
    }
    setAdoptBusy(true);
    try {
      await adoptLegacyOfflineOrder(
        adoptTarget.idempotencyKey,
        {
          userId: currentUser.userId,
          username: currentUser.username,
          dataMode,
          cashierSessionId: eventEntry?.activeSession?.id ?? null,
        },
        { isEventCurrentlyRunning: !!eventEntry },
      );
      setAdoptTarget(null);
      await loadEntries();
      notifyChanged();
    } catch (err) {
      setAdoptBanner({
        tone: "error",
        text:
          err instanceof Error ? err.message : "Übernahme ist fehlgeschlagen.",
      });
    } finally {
      setAdoptBusy(false);
    }
  };

  const renderRow = (record: OfflineOrderRecord) => {
    const meta = STATE_META[record.state];
    const isBusy = busyKey === record.idempotencyKey;
    const isExpanded = expandedKey === record.idempotencyKey;
    const amount = record.totalAtCapture ?? sumPayments(record.payments);

    const waitingHint =
      record.state === "LOCAL_PENDING" &&
      record.userId !== null &&
      currentUser &&
      currentUser.userId !== record.userId
        ? `Wartet auf Anmeldung von ${record.username ?? "unbekannt"}.`
        : null;

    const isEventRunning = eventContexts.some((e) => e.id === record.eventId);
    const canRetry =
      !record.legacy &&
      (record.state === "CONFLICT" || record.state === "FAILED");
    const canDiscard =
      !!currentUser && canDiscardOfflineOrder(record, currentUser);
    const canAdopt =
      !!currentUser &&
      canAdoptLegacyOfflineOrder(record, currentUser, isEventRunning);

    return (
      <li
        key={record.idempotencyKey}
        className="rounded-2xl border border-slate-800 bg-slate-900 p-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm text-slate-400">
            {formatDateTime(record.createdAt)}
          </span>
          <span
            className={`rounded-full px-2 py-1 text-xs font-bold ${meta.badgeClass}`}
          >
            {meta.label}
          </span>
        </div>

        <div className="mt-2 flex flex-wrap items-baseline justify-between gap-2">
          <div className="text-lg font-semibold text-slate-100">
            {record.tableName || "Unbekannt"}
            {record.areaName ? ` · ${record.areaName}` : ""}
          </div>
          <div className="text-lg font-bold text-slate-100">
            {formatAmount(amount)}
          </div>
        </div>

        <div className="mt-1 text-xs text-slate-400">
          {record.username ?? "Unbekannter Benutzer"} ·{" "}
          {record.eventName ?? record.eventId} ·{" "}
          {DATA_MODE_LABELS[record.dataMode]}
        </div>

        <p className="mt-2 text-xs text-slate-500">{meta.hint}</p>
        {waitingHint && (
          <p className="mt-1 text-xs font-medium text-amber-400">
            {waitingHint}
          </p>
        )}

        {record.state === "CONFLICT" && (
          <div className="mt-2">
            <button
              type="button"
              onClick={() =>
                setExpandedKey(isExpanded ? null : record.idempotencyKey)
              }
              className="flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-sm font-semibold text-rose-300 hover:text-rose-200"
            >
              <AlertTriangle className="h-4 w-4" aria-hidden="true" />
              {isExpanded ? "Details verbergen" : "Konflikt ansehen"}
            </button>
            {isExpanded && (
              <div className="mt-2 space-y-1 rounded-xl bg-slate-950/60 p-3 text-xs text-slate-300">
                <div>
                  <span className="font-semibold text-slate-200">
                    Ursache:{" "}
                  </span>
                  {record.conflictKind
                    ? CONFLICT_LABELS[record.conflictKind]
                    : "Unbekannt"}
                </div>
                {record.lastError && (
                  <div>{record.lastError.messageForOperator}</div>
                )}
                <div className="pt-1 text-slate-500">
                  Erfasst als {record.username ?? "unbekannt"} ·{" "}
                  {DATA_MODE_LABELS[record.dataMode]}
                  {record.cashierSessionId
                    ? " · mit Kassensitzung"
                    : " · ohne Kassensitzung"}
                </div>
              </div>
            )}
          </div>
        )}

        {record.state === "FAILED" && record.lastError && (
          <div className="mt-2 rounded-xl bg-slate-950/60 p-3 text-xs text-slate-300">
            {record.lastError.messageForOperator}
          </div>
        )}

        <div className="mt-3 flex flex-wrap gap-2">
          {canRetry && (
            <button
              type="button"
              disabled={isBusy}
              onClick={() => handleRetry(record)}
              className="flex min-h-11 items-center gap-1.5 rounded-xl bg-indigo-600 px-3 py-2 text-sm font-bold text-white transition-colors hover:bg-indigo-500 disabled:opacity-50"
            >
              {isBusy ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
              )}
              Erneut versuchen
            </button>
          )}
          {canAdopt && (
            <button
              type="button"
              onClick={() => openAdoptDialog(record)}
              className="flex min-h-11 items-center gap-1.5 rounded-xl bg-slate-700 px-3 py-2 text-sm font-bold text-white transition-colors hover:bg-slate-600"
            >
              <UserCheck className="h-4 w-4" aria-hidden="true" />
              Übernehmen und senden
            </button>
          )}
          {canDiscard && (
            <button
              type="button"
              onClick={() => openDiscardDialog(record)}
              className="flex min-h-11 items-center gap-1.5 rounded-xl border border-rose-500/50 px-3 py-2 text-sm font-bold text-rose-300 transition-colors hover:bg-rose-500/10"
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
              Verwerfen
            </button>
          )}
        </div>
      </li>
    );
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Offline-Warteschlange"
      className="fixed inset-0 z-[100] flex flex-col bg-slate-950/95 backdrop-blur-sm"
    >
      <div className="flex items-center justify-between border-b border-slate-800 p-4">
        <h2 className="text-xl font-bold text-white">Offline-Warteschlange</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Schließen"
          className="flex min-h-11 min-w-11 items-center justify-center rounded-full bg-slate-800 text-slate-300 hover:text-white"
        >
          <X className="h-6 w-6" aria-hidden="true" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {loading && openEntries.length === 0 && (
          <p className="text-slate-400">Lade Warteschlange…</p>
        )}
        {!loading && openEntries.length === 0 && (
          <p className="text-slate-400">
            Keine offenen Vormerkungen. Alle Bestellungen sind gesendet oder
            bestätigt.
          </p>
        )}
        <ul className="space-y-3">{openEntries.map(renderRow)}</ul>

        <div className="border-t border-slate-800 pt-4">
          <button
            type="button"
            onClick={() => setShowDone((v) => !v)}
            className="flex min-h-11 items-center text-sm font-bold uppercase tracking-wider text-slate-400 hover:text-slate-200"
          >
            Erledigt ({confirmedEntries.length}){showDone ? " ▲" : " ▼"}
          </button>
          {showDone && (
            <ul className="mt-3 space-y-3">
              {confirmedEntries.length === 0 && (
                <li className="text-sm text-slate-500">
                  Noch keine bestätigten Bestellungen in den letzten 24 Stunden.
                </li>
              )}
              {confirmedEntries.map((record) => (
                <li
                  key={record.idempotencyKey}
                  className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm text-slate-400">
                      {formatDateTime(record.createdAt)}
                    </span>
                    <span className="rounded-full bg-emerald-600 px-2 py-1 text-xs font-bold text-white">
                      Vom Server bestätigt
                      {record.serverOrderNumber
                        ? ` · Nr. ${record.serverOrderNumber}`
                        : ""}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-baseline justify-between gap-2">
                    <div className="font-semibold text-slate-200">
                      {record.tableName || "Unbekannt"}
                      {record.areaName ? ` · ${record.areaName}` : ""}
                    </div>
                    <div className="font-bold text-slate-200">
                      {formatAmount(
                        record.totalAtCapture ?? sumPayments(record.payments),
                      )}
                    </div>
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    {record.username ?? "Unbekannter Benutzer"} ·{" "}
                    {record.eventName ?? record.eventId}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {discardTarget && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-6">
            <h3 className="text-lg font-bold text-white">
              Vormerkung endgültig verwerfen?
            </h3>
            <div className="mt-3 space-y-1 rounded-xl bg-slate-950/60 p-3 text-sm text-slate-300">
              <div>{formatDateTime(discardTarget.createdAt)}</div>
              <div>
                {discardTarget.tableName || "Unbekannt"}
                {discardTarget.areaName ? ` · ${discardTarget.areaName}` : ""}
              </div>
              <ul className="list-disc pl-5">
                {discardTarget.items.map((item, idx) => (
                  <li key={idx}>
                    {item.quantity}× {item.productName ?? item.productId}
                  </li>
                ))}
              </ul>
              <div className="font-bold text-slate-100">
                Gesamtbetrag:{" "}
                {formatAmount(
                  discardTarget.totalAtCapture ??
                    sumPayments(discardTarget.payments),
                )}
              </div>
              {discardTarget.payments.length > 0 && (
                <div className="rounded-lg bg-rose-500/10 p-2 font-semibold text-rose-300">
                  Bereits kassiert:{" "}
                  {discardTarget.payments
                    .map((p) => `${formatAmount(p.amount)} (${p.method})`)
                    .join(", ")}
                </div>
              )}
            </div>

            <label className="mt-4 block text-sm font-medium text-slate-300">
              Grund
              <select
                value={discardCategory}
                onChange={(e) =>
                  setDiscardCategory(e.target.value as DiscardReasonCategory)
                }
                className="mt-1 block min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-white"
              >
                {DISCARD_REASONS.map((reason) => (
                  <option key={reason.value} value={reason.value}>
                    {reason.label}
                  </option>
                ))}
              </select>
            </label>

            {discardCategory === "OTHER" && (
              <label className="mt-3 block text-sm font-medium text-slate-300">
                Freitext
                <textarea
                  value={discardNote}
                  onChange={(e) => setDiscardNote(e.target.value)}
                  className="mt-1 block w-full rounded-xl border border-slate-700 bg-slate-950 p-3 text-white"
                  rows={2}
                />
              </label>
            )}

            <label className="mt-4 flex min-h-11 cursor-pointer items-center gap-2 text-sm text-slate-200">
              <input
                type="checkbox"
                checked={discardChecked}
                onChange={(e) => setDiscardChecked(e.target.checked)}
                className="h-5 w-5"
              />
              Diese Vormerkung geht nicht an den Server. Ich bestätige das
              Verwerfen.
            </label>

            {discardBanner && (
              <p
                className={`mt-3 rounded-lg p-2 text-sm ${
                  discardBanner.tone === "error"
                    ? "bg-rose-500/10 text-rose-300"
                    : "bg-slate-800 text-slate-200"
                }`}
              >
                {discardBanner.text}
              </p>
            )}

            <div className="mt-5 flex gap-3">
              <button
                type="button"
                onClick={() => setDiscardTarget(null)}
                className="flex-1 min-h-11 rounded-xl bg-slate-800 font-bold text-slate-200 hover:bg-slate-700"
              >
                Abbrechen
              </button>
              <button
                type="button"
                disabled={!discardChecked || discardBusy}
                onClick={confirmDiscard}
                className="flex-1 min-h-11 rounded-xl bg-rose-600 font-bold text-white hover:bg-rose-500 disabled:opacity-40"
              >
                {discardBusy ? "Wird geprüft…" : "Endgültig verwerfen"}
              </button>
            </div>
          </div>
        </div>
      )}

      {adoptTarget && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-6">
            <h3 className="text-lg font-bold text-white">
              Altbestand übernehmen?
            </h3>
            <p className="mt-2 text-sm text-slate-300">
              Diese Vormerkung stammt aus einer älteren Version der Anwendung.
              Ihr ursprünglicher Kontext (Benutzer, Betriebsart, Kassensitzung)
              ist <strong>unbekannt</strong>. Mit "Übernehmen und senden"
              erklärst du, sie unter deinem Namen und der heutigen Betriebsart
              zu verantworten.
            </p>
            {adoptBanner && (
              <p
                className={`mt-3 rounded-lg p-2 text-sm ${
                  adoptBanner.tone === "error"
                    ? "bg-rose-500/10 text-rose-300"
                    : "bg-slate-800 text-slate-200"
                }`}
              >
                {adoptBanner.text}
              </p>
            )}
            <div className="mt-5 flex gap-3">
              <button
                type="button"
                onClick={() => setAdoptTarget(null)}
                className="flex-1 min-h-11 rounded-xl bg-slate-800 font-bold text-slate-200 hover:bg-slate-700"
              >
                Abbrechen
              </button>
              <button
                type="button"
                disabled={adoptBusy}
                onClick={confirmAdopt}
                className="flex-1 min-h-11 rounded-xl bg-indigo-600 font-bold text-white hover:bg-indigo-500 disabled:opacity-40"
              >
                {adoptBusy ? "Wird übernommen…" : "Übernehmen und senden"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
