import { useCallback, useEffect, useState } from "react";
import { useAuthStore } from "../store/useAuthStore";
import { api } from "../lib/api";
import { MAINTENANCE_ENDED_EVENT } from "../lib/maintenance";
import {
  Wallet,
  Banknote,
  CreditCard,
  Activity,
  Play,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import {
  getOfflineQueueDB,
  getOpenOfflineQueueSummaryForSession,
  type OpenOfflineQueueSummary,
} from "../lib/offlineQueueDb";

interface SessionSummary {
  id: string;
  status: "ACTIVE" | "CLOSED";
  startingBalance: number;
  cashSales: number;
  cardSales: number;
  otherSales: number;
  expectedCash: number;
  depositCollected?: number;
  depositRefunded?: number;
  depositNet?: number;
  startTime: string;
  endTime?: string;
  closingBalance?: number;
}

interface SessionEvent {
  id: string;
  name: string;
  status: "ACTIVE" | "TEST_MODE";
  testMode: boolean;
}

const parseEuroToCents = (value: string) => {
  const match = /^(\d{1,7})(?:[,.](\d{0,2}))?$/.exec(value.trim());
  if (!match) return null;
  const cents =
    Number(match[1]) * 100 + Number((match[2] || "").padEnd(2, "0"));
  return Number.isSafeInteger(cents) && cents <= 2_147_483_647 ? cents : null;
};

export const CashierDashboard = () => {
  const { user } = useAuthStore();
  const [eventId, setEventId] = useState<string>("");
  const [events, setEvents] = useState<SessionEvent[]>([]);
  const [activeSession, setActiveSession] = useState<{
    id: string;
    startingBalance: number;
  } | null>(null);
  const [summary, setSummary] = useState<SessionSummary | null>(null);
  const [loading, setLoading] = useState(true);

  // Forms
  const [startingBalanceInput, setStartingBalanceInput] = useState("");
  const [closingBalanceInput, setClosingBalanceInput] = useState("");
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [openQueueSummary, setOpenQueueSummary] =
    useState<OpenOfflineQueueSummary | null>(null);
  const [acknowledgedOpenQueue, setAcknowledgedOpenQueue] = useState(false);

  const fetchSession = useCallback(async () => {
    if (!eventId) return;
    try {
      setLoading(true);
      const res = await api.get(`/sessions/active?eventId=${eventId}`);
      if (res.data) {
        setActiveSession({
          id: res.data.id,
          startingBalance: res.data.startingBalance,
        });
        const summaryRes = await api.get(`/sessions/${res.data.id}/summary`);
        setSummary(summaryRes.data);
      } else {
        setActiveSession(null);
        setSummary(null);
      }
    } catch (err) {
      console.error("Error fetching session", err);
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    const fetchEvent = async () => {
      try {
        const res = await api.get("/sessions/context");
        setEvents(res.data);
        if (res.data && res.data.length > 0) {
          setEventId(res.data[0].id);
        }
      } catch (err) {
        console.error("Failed to load initial event", err);
      }
    };
    fetchEvent();

    // Issue #67 (Wartungsmodus): nach dem Ende einer Wartung können sich
    // Veranstaltung und Sitzung um Stunden zurückbewegt haben (Entwurf
    // Abschnitt 6) - derselbe Kontextabruf wie beim Einstieg lädt neu.
    window.addEventListener(MAINTENANCE_ENDED_EVENT, fetchEvent);
    return () =>
      window.removeEventListener(MAINTENANCE_ENDED_EVENT, fetchEvent);
  }, []);

  useEffect(() => {
    if (eventId) fetchSession();
  }, [eventId, fetchSession]);

  const handleStartSession = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!eventId) return;

    const amount = parseEuroToCents(startingBalanceInput);
    if (amount === null) return alert("Ungültiger Betrag");

    try {
      await api.post("/sessions", { eventId, startingBalance: amount });
      setStartingBalanceInput("");
      await fetchSession();
    } catch (err: any) {
      alert("Fehler beim Starten der Sitzung: " + err.message);
    }
  };

  const handleOpenCloseModal = async () => {
    if (!activeSession) return;
    setAcknowledgedOpenQueue(false);
    try {
      const db = await getOfflineQueueDB();
      const openSummary = await getOpenOfflineQueueSummaryForSession(
        db,
        activeSession.id,
      );
      setOpenQueueSummary(openSummary);
    } catch (err) {
      console.error(
        "Failed to query open offline queue summary for session",
        err,
      );
      setOpenQueueSummary({ count: 0, totalCents: 0 });
    }
    setShowCloseModal(true);
  };

  const handleCloseSession = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeSession) return;

    const amount = parseEuroToCents(closingBalanceInput);
    if (amount === null) return alert("Ungültiger Betrag");

    if (
      openQueueSummary &&
      openQueueSummary.count > 0 &&
      !acknowledgedOpenQueue
    ) {
      return alert(
        "Bitte bestätige die Kenntnisnahme der offenen Vormerkungen vor dem Abschluss.",
      );
    }

    try {
      await api.patch(`/sessions/${activeSession.id}/close`, {
        closingBalance: amount,
        ...(openQueueSummary && openQueueSummary.count > 0
          ? {
              offlineQueueWarning: {
                hasOpenOrders: true,
                openCount: openQueueSummary.count,
                openTotalCents: openQueueSummary.totalCents,
                acknowledged: true,
              },
            }
          : {}),
      });
      setShowCloseModal(false);
      setClosingBalanceInput("");
      await fetchSession();
    } catch (err: any) {
      alert("Fehler beim Abschließen: " + err.message);
    }
  };

  const formatCurrency = (cents: number) => {
    return (cents / 100).toLocaleString("de-AT", {
      style: "currency",
      currency: "EUR",
    });
  };

  if (loading) {
    return (
      <div className="p-8 text-center text-slate-400">
        Lade Kassensitzung...
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto mt-6">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-12 h-12 bg-indigo-500/20 rounded-xl flex items-center justify-center">
          <Wallet className="w-6 h-6 text-indigo-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Meine Kassa</h1>
          <p className="text-slate-400">Abrechnung für {user?.username}</p>
        </div>
        {events.length > 1 && (
          <label className="ml-auto text-xs font-bold uppercase tracking-wider text-slate-400">
            Veranstaltung
            <select
              value={eventId}
              onChange={(e) => setEventId(e.target.value)}
              className="mt-1 block rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-200 focus:border-indigo-500 focus:outline-none"
            >
              {events.map((evt) => (
                <option key={evt.id} value={evt.id}>
                  {evt.name} {evt.testMode ? "(Testmodus)" : ""}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {!activeSession && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
          <h2 className="text-xl font-bold text-slate-100 mb-2">
            Kassensitzung starten
          </h2>
          <p className="text-slate-400 mb-6">
            Bitte gib den Wechselgeldbetrag (Anfangsbestand) ein, um die Kassa
            zu öffnen.
          </p>

          <form onSubmit={handleStartSession} className="max-w-sm">
            <div className="mb-4">
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Anfangsbestand in Bar (€)
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                required
                value={startingBalanceInput}
                onChange={(e) => setStartingBalanceInput(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-slate-200 focus:outline-none focus:border-indigo-500 text-lg"
                placeholder="z.B. 100.00"
              />
            </div>
            <button
              type="submit"
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-3 rounded-xl transition flex items-center justify-center gap-2"
            >
              <Play className="w-5 h-5" />
              Sitzung beginnen
            </button>
          </form>
        </div>
      )}

      {activeSession && summary && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
              <div className="flex items-center gap-3 text-slate-400 mb-2">
                <Wallet className="w-5 h-5 text-indigo-400" />
                <span className="text-sm font-medium">Anfangsbestand</span>
              </div>
              <div className="text-2xl font-bold text-slate-100">
                {formatCurrency(summary.startingBalance)}
              </div>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
              <div className="flex items-center gap-3 text-slate-400 mb-2">
                <Banknote className="w-5 h-5 text-emerald-400" />
                <span className="text-sm font-medium">Bargeld-Umsatz</span>
              </div>
              <div className="text-2xl font-bold text-emerald-400">
                +{formatCurrency(summary.cashSales)}
              </div>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
              <div className="flex items-center gap-3 text-slate-400 mb-2">
                <CreditCard className="w-5 h-5 text-blue-400" />
                <span className="text-sm font-medium">Karte / Sonstiges</span>
              </div>
              <div className="text-2xl font-bold text-slate-100">
                {formatCurrency(summary.cardSales + summary.otherSales)}
              </div>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
              <div className="flex items-center gap-3 text-slate-400 mb-2">
                <Activity className="w-5 h-5 text-purple-400" />
                <span className="text-sm font-medium">Soll-Kassenstand</span>
              </div>
              <div className="text-2xl font-bold text-purple-400">
                {formatCurrency(summary.expectedCash)}
              </div>
            </div>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
            <h3 className="text-lg font-bold text-slate-100 mb-4">
              Sitzungsdetails
            </h3>
            <div className="space-y-3">
              <div className="flex justify-between py-2 border-b border-slate-800 text-sm">
                <span className="text-slate-400">Gestartet am:</span>
                <span className="text-slate-200">
                  {new Date(summary.startTime).toLocaleString("de-AT")}
                </span>
              </div>
              <div className="flex justify-between py-2 border-b border-slate-800 text-sm">
                <span className="text-slate-400">Bar-Umsätze:</span>
                <span className="text-slate-200 font-medium">
                  {formatCurrency(summary.cashSales)}
                </span>
              </div>
              <div className="flex justify-between py-2 border-b border-slate-800 text-sm">
                <span className="text-slate-400">Kartenzahlungen:</span>
                <span className="text-slate-200 font-medium">
                  {formatCurrency(summary.cardSales)}
                </span>
              </div>
              {summary.otherSales > 0 && (
                <div className="flex justify-between py-2 border-b border-slate-800 text-sm">
                  <span className="text-slate-400">Gutscheine / Sonstige:</span>
                  <span className="text-slate-200 font-medium">
                    {formatCurrency(summary.otherSales)}
                  </span>
                </div>
              )}
              <div className="flex justify-between py-2 border-b border-slate-800 text-sm">
                <span className="text-slate-400">Pfandeinnahmen:</span>
                <span className="text-amber-400 font-medium">
                  {formatCurrency(summary.depositCollected ?? 0)}
                </span>
              </div>
              <div className="flex justify-between py-2 border-b border-slate-800 text-sm">
                <span className="text-slate-400">Pfandauszahlungen:</span>
                <span className="text-rose-400 font-medium">
                  - {formatCurrency(summary.depositRefunded ?? 0)}
                </span>
              </div>
              <div className="flex justify-between py-2 border-b border-slate-800 text-sm">
                <span className="text-slate-400 font-bold">Pfandsaldo:</span>
                <span className="text-slate-100 font-bold">
                  {formatCurrency(summary.depositNet ?? 0)}
                </span>
              </div>
            </div>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div>
              <h3 className="text-lg font-medium text-slate-200">
                Schicht beenden
              </h3>
              <p className="text-slate-400 text-sm">
                Geld zählen und Sitzung abschließen
              </p>
            </div>
            <button
              onClick={handleOpenCloseModal}
              className="w-full sm:w-auto bg-slate-800 hover:bg-slate-700 text-white font-medium px-6 py-3 rounded-xl transition flex items-center justify-center gap-2"
            >
              <CheckCircle2 className="w-5 h-5" />
              Kassenabschluss
            </button>
          </div>
        </div>
      )}

      {showCloseModal && summary && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md overflow-hidden">
            <div className="p-6 border-b border-slate-800">
              <h2 className="text-xl font-bold text-slate-100">
                Kassenabschluss
              </h2>
              <p className="text-slate-400 mt-1">Bitte zähle dein Bargeld.</p>
            </div>

            <form onSubmit={handleCloseSession} className="p-6">
              {openQueueSummary && openQueueSummary.count > 0 && (
                <div
                  data-testid="cashier-session-offline-warning"
                  className="mb-6 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-amber-200"
                >
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-400" />
                    <div className="space-y-2 text-sm">
                      <p className="font-semibold text-amber-300">
                        Achtung: {openQueueSummary.count} offene Vormerkung
                        {openQueueSummary.count === 1 ? "" : "en"} (
                        {formatCurrency(openQueueSummary.totalCents)}) auf
                        diesem Gerät!
                      </p>
                      <p className="text-xs text-amber-200/90 leading-relaxed">
                        Auf diesem Gerät liegen noch nicht an den Server
                        übertragene Vormerkungen. Bitte stelle die
                        Netzwerkverbindung her, damit sie gesendet werden
                        können, oder prüfe das Offline-Warteschlangen-Panel.
                      </p>
                      <p className="text-xs text-amber-300/80 italic">
                        Hinweis: Es werden ausschließlich die offenen
                        Vormerkungen auf diesem Gerät geprüft. Nach dem
                        Sitzungsschluss können diese Vormerkungen nicht mehr
                        dieser Kassensitzung zugeordnet werden.
                      </p>
                      <label className="flex items-start gap-2 pt-2 cursor-pointer select-none text-xs font-medium text-amber-100">
                        <input
                          type="checkbox"
                          checked={acknowledgedOpenQueue}
                          onChange={(e) =>
                            setAcknowledgedOpenQueue(e.target.checked)
                          }
                          className="mt-0.5 rounded border-amber-400 text-indigo-600 focus:ring-amber-400"
                        />
                        <span>
                          Ich habe die offenen Vormerkungen zur Kenntnis
                          genommen und möchte die Sitzung trotzdem abschließen.
                        </span>
                      </label>
                    </div>
                  </div>
                </div>
              )}

              <div className="mb-6">
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-slate-400">
                    Erwarteter Kassenstand:
                  </span>
                  <span className="text-slate-200 font-medium">
                    {formatCurrency(summary.expectedCash)}
                  </span>
                </div>
              </div>

              <div className="mb-6">
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Tatsächlich gezähltes Bargeld (€)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  required
                  autoFocus
                  value={closingBalanceInput}
                  onChange={(e) => setClosingBalanceInput(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-slate-200 focus:outline-none focus:border-indigo-500 text-lg"
                  placeholder="z.B. 125.50"
                />
              </div>

              {closingBalanceInput && (
                <div
                  className={`p-4 rounded-xl mb-6 ${
                    Math.round(
                      parseFloat(closingBalanceInput.replace(",", ".")) * 100,
                    ) -
                      summary.expectedCash >
                    0
                      ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-400"
                      : Math.round(
                            parseFloat(closingBalanceInput.replace(",", ".")) *
                              100,
                          ) -
                            summary.expectedCash <
                          0
                        ? "bg-red-500/10 border border-red-500/20 text-red-400"
                        : "bg-slate-800 text-slate-300"
                  }`}
                >
                  <div className="text-sm">Differenz (Trinkgeld / Manko):</div>
                  <div className="text-xl font-bold">
                    {formatCurrency(
                      Math.round(
                        parseFloat(closingBalanceInput.replace(",", ".")) * 100,
                      ) - summary.expectedCash,
                    )}
                  </div>
                </div>
              )}

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowCloseModal(false)}
                  className="flex-1 px-4 py-3 rounded-xl font-medium bg-slate-800 text-slate-300 hover:bg-slate-700 transition"
                >
                  Abbrechen
                </button>
                <button
                  type="submit"
                  disabled={Boolean(
                    openQueueSummary &&
                      openQueueSummary.count > 0 &&
                      !acknowledgedOpenQueue,
                  )}
                  className={`flex-1 px-4 py-3 rounded-xl font-medium text-white transition ${
                    openQueueSummary &&
                    openQueueSummary.count > 0 &&
                    !acknowledgedOpenQueue
                      ? "bg-slate-700 text-slate-400 cursor-not-allowed opacity-60"
                      : "bg-indigo-600 hover:bg-indigo-700"
                  }`}
                >
                  Abschließen
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
