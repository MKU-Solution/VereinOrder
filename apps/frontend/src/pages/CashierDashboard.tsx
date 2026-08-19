import { useState, useEffect } from 'react';
import { useAuthStore } from '../store/useAuthStore';
import { api } from '../lib/api';
import { Wallet, Banknote, CreditCard, Activity, Play, CheckCircle2 } from 'lucide-react';

interface SessionSummary {
  id: string;
  status: 'ACTIVE' | 'CLOSED';
  startingBalance: number;
  cashSales: number;
  cardSales: number;
  otherSales: number;
  expectedCash: number;
  startTime: string;
  endTime?: string;
  closingBalance?: number;
}

export const CashierDashboard = () => {
  const { user } = useAuthStore();
  const [eventId, setEventId] = useState<string>('');
  const [activeSession, setActiveSession] = useState<{ id: string, startingBalance: number } | null>(null);
  const [summary, setSummary] = useState<SessionSummary | null>(null);
  const [loading, setLoading] = useState(true);

  // Forms
  const [startingBalanceInput, setStartingBalanceInput] = useState('');
  const [closingBalanceInput, setClosingBalanceInput] = useState('');
  const [showCloseModal, setShowCloseModal] = useState(false);

  const fetchSession = async () => {
    if (!eventId) return;
    try {
      setLoading(true);
      const res = await api.get(`/sessions/active?eventId=${eventId}`);
      if (res.data) {
        setActiveSession({ id: res.data.id, startingBalance: res.data.startingBalance });
        const summaryRes = await api.get(`/sessions/${res.data.id}/summary`);
        setSummary(summaryRes.data);
      } else {
        setActiveSession(null);
        setSummary(null);
      }
    } catch (err) {
      console.error('Error fetching session', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const fetchEvent = async () => {
      try {
        const res = await api.get('/events');
        if (res.data && res.data.length > 0) {
          setEventId(res.data[0].id);
        }
      } catch (err) {
        console.error('Failed to load initial event', err);
      }
    };
    fetchEvent();
  }, []);

  useEffect(() => {
    if (eventId) fetchSession();
  }, [eventId]);

  const handleStartSession = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!eventId) return;
    
    const amount = Math.round(parseFloat(startingBalanceInput.replace(',', '.')) * 100);
    if (isNaN(amount) || amount < 0) return alert('Ungültiger Betrag');

    try {
      await api.post('/sessions', { eventId, startingBalance: amount });
      setStartingBalanceInput('');
      await fetchSession();
    } catch (err: any) {
      alert('Fehler beim Starten der Sitzung: ' + err.message);
    }
  };

  const handleCloseSession = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeSession) return;

    const amount = Math.round(parseFloat(closingBalanceInput.replace(',', '.')) * 100);
    if (isNaN(amount) || amount < 0) return alert('Ungültiger Betrag');

    try {
      await api.patch(`/sessions/${activeSession.id}/close`, { closingBalance: amount });
      setShowCloseModal(false);
      setClosingBalanceInput('');
      await fetchSession();
    } catch (err: any) {
      alert('Fehler beim Abschließen: ' + err.message);
    }
  };

  const formatCurrency = (cents: number) => {
    return (cents / 100).toLocaleString('de-AT', { style: 'currency', currency: 'EUR' });
  };

  if (loading) {
    return <div className="p-8 text-center text-slate-400">Lade Kassensitzung...</div>;
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
      </div>

      {!activeSession && (
        <div className="bg-slate-900 rounded-2xl p-8 border border-slate-800 text-center">
          <Activity className="w-12 h-12 text-slate-500 mx-auto mb-4" />
          <h2 className="text-xl font-medium text-slate-200 mb-2">Keine aktive Kassensitzung</h2>
          <p className="text-slate-400 mb-6 max-w-md mx-auto">
            Bevor du bar abkassieren kannst, solltest du eine Kassensitzung eröffnen und dein Wechselgeld eintragen.
          </p>

          <form onSubmit={handleStartSession} className="max-w-xs mx-auto">
            <div className="mb-4 text-left">
              <label className="block text-sm font-medium text-slate-400 mb-2">
                Wechselgeld / Startkapital (€)
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                required
                value={startingBalanceInput}
                onChange={(e) => setStartingBalanceInput(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-slate-200 focus:outline-none focus:border-indigo-500 text-lg"
                placeholder="z.B. 50.00"
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
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
              <div className="flex items-center gap-3 mb-2">
                <Banknote className="w-5 h-5 text-emerald-400" />
                <h3 className="text-slate-400 font-medium">Erwarteter Kassenstand (Bar)</h3>
              </div>
              <div className="text-4xl font-bold text-slate-100">
                {formatCurrency(summary.expectedCash)}
              </div>
              <div className="mt-4 text-sm text-slate-500 flex justify-between">
                <span>Startkapital</span>
                <span>{formatCurrency(summary.startingBalance)}</span>
              </div>
              <div className="text-sm text-slate-500 flex justify-between mt-1">
                <span>Bar-Umsätze</span>
                <span className="text-emerald-400">+{formatCurrency(summary.cashSales)}</span>
              </div>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
              <div className="flex items-center gap-3 mb-2">
                <CreditCard className="w-5 h-5 text-blue-400" />
                <h3 className="text-slate-400 font-medium">Karten-Umsätze</h3>
              </div>
              <div className="text-4xl font-bold text-slate-100">
                {formatCurrency(summary.cardSales)}
              </div>
              {summary.otherSales > 0 && (
                <div className="mt-4 text-sm text-slate-500 flex justify-between">
                  <span>Gutscheine / Sonstiges</span>
                  <span className="text-purple-400">+{formatCurrency(summary.otherSales)}</span>
                </div>
              )}
            </div>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div>
              <h3 className="text-lg font-medium text-slate-200">Schicht beenden</h3>
              <p className="text-slate-400 text-sm">Geld zählen und Sitzung abschließen</p>
            </div>
            <button
              onClick={() => setShowCloseModal(true)}
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
              <h2 className="text-xl font-bold text-slate-100">Kassenabschluss</h2>
              <p className="text-slate-400 mt-1">Bitte zähle dein Bargeld.</p>
            </div>
            
            <form onSubmit={handleCloseSession} className="p-6">
              <div className="mb-6">
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-slate-400">Erwarteter Kassenstand:</span>
                  <span className="text-slate-200 font-medium">{formatCurrency(summary.expectedCash)}</span>
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
                <div className={`p-4 rounded-xl mb-6 ${
                  (Math.round(parseFloat(closingBalanceInput.replace(',', '.')) * 100) - summary.expectedCash) > 0 
                    ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400' 
                    : (Math.round(parseFloat(closingBalanceInput.replace(',', '.')) * 100) - summary.expectedCash) < 0
                    ? 'bg-red-500/10 border border-red-500/20 text-red-400'
                    : 'bg-slate-800 text-slate-300'
                }`}>
                  <div className="text-sm">Differenz (Trinkgeld / Manko):</div>
                  <div className="text-xl font-bold">
                    {formatCurrency(Math.round(parseFloat(closingBalanceInput.replace(',', '.')) * 100) - summary.expectedCash)}
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
                  className="flex-1 px-4 py-3 rounded-xl font-medium bg-indigo-600 text-white hover:bg-indigo-700 transition"
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
