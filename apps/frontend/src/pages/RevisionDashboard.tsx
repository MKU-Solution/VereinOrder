import { useEffect, useState, useCallback } from "react";
import { api } from "../lib/api";
import {
  TrendingUp,
  ShoppingBag,
  Users,
  Package,
  Banknote,
  CreditCard,
  AlertTriangle,
  Download,
  Clock,
  Layers,
  Calendar,
  Wallet,
  RefreshCw,
} from "lucide-react";

interface SummaryData {
  totalAmount: number;
  orderCount: number;
  openAmount: number;
  cashRevenue: number;
  cardRevenue: number;
  voucherRevenue: number;
  cancelledCount: number;
  cancelledAmount: number;
}

interface ProductReport {
  id: string;
  name: string;
  categoryName: string;
  price: number;
  taxRate: number;
  quantity: number;
  revenue: number;
}

interface CategoryReport {
  name: string;
  quantity: number;
  revenue: number;
}

interface UserReport {
  id: string;
  username: string;
  role: string;
  orderCount: number;
  revenue: number;
  cashRevenue: number;
  cardRevenue: number;
}

interface HourlyReport {
  hour: string;
  count: number;
  revenue: number;
}

interface SessionReport {
  id: string;
  username: string;
  status: "ACTIVE" | "CLOSED";
  startTime: string;
  endTime?: string;
  startingBalance: number;
  cashSales: number;
  cardSales: number;
  expectedCash: number;
  closingBalance?: number;
  difference?: number | null;
}

interface EventItem {
  id: string;
  name: string;
  status: string;
}

export const RevisionDashboard = () => {
  const [events, setEvents] = useState<EventItem[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string>("");

  const [activeTab, setActiveTab] = useState<
    "overview" | "products" | "staff" | "sessions"
  >("overview");

  const [summary, setSummary] = useState<SummaryData>({
    totalAmount: 0,
    orderCount: 0,
    openAmount: 0,
    cashRevenue: 0,
    cardRevenue: 0,
    voucherRevenue: 0,
    cancelledCount: 0,
    cancelledAmount: 0,
  });

  const [products, setProducts] = useState<ProductReport[]>([]);
  const [categories, setCategories] = useState<CategoryReport[]>([]);
  const [users, setUsers] = useState<UserReport[]>([]);
  const [hourly, setHourly] = useState<HourlyReport[]>([]);
  const [sessions, setSessions] = useState<SessionReport[]>([]);

  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [exportingType, setExportingType] = useState<string | null>(null);

  // Load events list on mount
  useEffect(() => {
    const fetchEvents = async () => {
      try {
        const res = await api.get("/events");
        setEvents(res.data);
        if (res.data && res.data.length > 0) {
          const active =
            res.data.find(
              (e: any) => e.status === "ACTIVE" || e.status === "TEST_MODE",
            ) || res.data[0];
          setSelectedEventId(active.id);
        }
      } catch (err) {
        console.error("Failed to load events", err);
      }
    };
    fetchEvents();
  }, []);

  const fetchData = useCallback(
    async (showRefreshing = false) => {
      if (!selectedEventId) return;
      if (showRefreshing) setIsRefreshing(true);

      try {
        const q = `?eventId=${selectedEventId}`;
        const [sumRes, prodRes, catRes, userRes, hourRes, sessRes] =
          await Promise.all([
            api.get(`/reports/summary${q}`),
            api.get(`/reports/products${q}`),
            api.get(`/reports/categories${q}`),
            api.get(`/reports/users${q}`),
            api.get(`/reports/hourly${q}`),
            api.get(`/reports/sessions${q}`),
          ]);

        setSummary(sumRes.data);
        setProducts(prodRes.data);
        setCategories(catRes.data);
        setUsers(userRes.data);
        setHourly(hourRes.data);
        setSessions(sessRes.data);
      } catch (err) {
        console.error("Failed to load report data", err);
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [selectedEventId],
  );

  useEffect(() => {
    if (selectedEventId) {
      fetchData();
      const interval = setInterval(() => fetchData(false), 15000);
      return () => clearInterval(interval);
    }
  }, [selectedEventId, fetchData]);

  const formatPrice = (cents: number | null | undefined) => {
    if (cents === null || cents === undefined) return "€ 0,00";
    return `€ ${(cents / 100).toLocaleString("de-AT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const formatDate = (isoStr?: string) => {
    if (!isoStr) return "-";
    const d = new Date(isoStr);
    return (
      d.toLocaleTimeString("de-AT", { hour: "2-digit", minute: "2-digit" }) +
      " (" +
      d.toLocaleDateString("de-AT", { day: "2-digit", month: "2-digit" }) +
      ")"
    );
  };

  const handleExport = async (
    type: "orders" | "products" | "users" | "sessions" | "categories",
  ) => {
    setExportingType(type);
    try {
      const res = await api.get(
        `/reports/export/${type}?eventId=${selectedEventId}`,
        {
          responseType: "blob",
        },
      );
      const blob = new Blob([res.data], { type: "text/csv;charset=utf-8;" });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `vereinorder_${type}_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Export failed", err);
      alert("Fehler beim CSV-Export.");
    } finally {
      setExportingType(null);
    }
  };

  if (isLoading && events.length === 0) {
    return (
      <div className="text-center py-20 text-slate-400 animate-pulse">
        Lade Auswertungen...
      </div>
    );
  }

  const maxHourlyRevenue = Math.max(...hourly.map((h) => h.revenue), 1);
  const maxProductRevenue = Math.max(...products.map((p) => p.revenue), 1);

  return (
    <div className="space-y-6">
      {/* Header & Event Selector */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 glass p-6 rounded-3xl">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold bg-gradient-to-r from-white to-slate-300 bg-clip-text text-transparent">
            Abrechnung & Revision
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            Revisionssichere Fest- und Kellnerauswertungen mit Live-Statistiken
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {events.length > 0 && (
            <div className="flex items-center gap-2 bg-slate-900/80 border border-slate-700/60 px-3 py-2 rounded-2xl">
              <Calendar className="w-4 h-4 text-indigo-400" />
              <select
                value={selectedEventId}
                onChange={(e) => setSelectedEventId(e.target.value)}
                className="bg-transparent text-slate-200 text-sm font-medium focus:outline-none cursor-pointer"
              >
                {events.map((evt) => (
                  <option
                    key={evt.id}
                    value={evt.id}
                    className="bg-slate-900 text-slate-200"
                  >
                    {evt.name} {evt.status === "ACTIVE" ? "🟢" : ""}
                  </option>
                ))}
              </select>
            </div>
          )}

          <button
            onClick={() => fetchData(true)}
            disabled={isRefreshing}
            className="p-2.5 rounded-2xl bg-slate-800/80 hover:bg-slate-700/80 text-slate-300 transition-colors border border-slate-700/50 flex items-center justify-center"
            title="Daten aktualisieren"
          >
            <RefreshCw
              className={`w-4 h-4 ${isRefreshing ? "animate-spin text-indigo-400" : ""}`}
            />
          </button>
        </div>
      </div>

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Revenue */}
        <div className="glass p-5 rounded-3xl flex items-center gap-4 relative overflow-hidden border-indigo-500/20">
          <div className="w-12 h-12 rounded-2xl bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center flex-shrink-0">
            <TrendingUp className="w-6 h-6 text-indigo-400" />
          </div>
          <div className="min-w-0">
            <div className="text-slate-400 text-xs font-semibold uppercase tracking-wider">
              Gesamtumsatz
            </div>
            <div className="text-2xl font-black text-white truncate">
              {formatPrice(summary.totalAmount)}
            </div>
            <div className="text-xs text-slate-400 mt-0.5">
              {summary.orderCount} Bestellungen
            </div>
          </div>
        </div>

        {/* Cash vs Card */}
        <div className="glass p-5 rounded-3xl flex items-center gap-4 relative overflow-hidden border-emerald-500/20">
          <div className="w-12 h-12 rounded-2xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center flex-shrink-0">
            <Banknote className="w-6 h-6 text-emerald-400" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-slate-400 text-xs font-semibold uppercase tracking-wider">
              Bar-Umsatz
            </div>
            <div className="text-2xl font-black text-emerald-400 truncate">
              {formatPrice(summary.cashRevenue)}
            </div>
            <div className="text-xs text-slate-400 mt-0.5 flex items-center gap-1">
              <CreditCard className="w-3 h-3 text-blue-400" />
              Karte: {formatPrice(summary.cardRevenue)}
            </div>
          </div>
        </div>

        {/* Open Amount */}
        <div className="glass p-5 rounded-3xl flex items-center gap-4 relative overflow-hidden border-amber-500/20">
          <div className="w-12 h-12 rounded-2xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center flex-shrink-0">
            <Clock className="w-6 h-6 text-amber-400" />
          </div>
          <div className="min-w-0">
            <div className="text-slate-400 text-xs font-semibold uppercase tracking-wider">
              Offene Tische
            </div>
            <div className="text-2xl font-black text-amber-300 truncate">
              {formatPrice(summary.openAmount)}
            </div>
            <div className="text-xs text-slate-400 mt-0.5">Noch unbezahlt</div>
          </div>
        </div>

        {/* Cancelled Volume */}
        <div className="glass p-5 rounded-3xl flex items-center gap-4 relative overflow-hidden border-rose-500/20">
          <div className="w-12 h-12 rounded-2xl bg-rose-500/20 border border-rose-500/30 flex items-center justify-center flex-shrink-0">
            <AlertTriangle className="w-6 h-6 text-rose-400" />
          </div>
          <div className="min-w-0">
            <div className="text-slate-400 text-xs font-semibold uppercase tracking-wider">
              Stornos
            </div>
            <div className="text-2xl font-black text-rose-400 truncate">
              {formatPrice(summary.cancelledAmount)}
            </div>
            <div className="text-xs text-slate-400 mt-0.5">
              {summary.cancelledCount} storniert
            </div>
          </div>
        </div>
      </div>

      {/* Export Action Bar */}
      <div className="glass p-4 rounded-3xl flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-300 px-2">
          <Download className="w-4 h-4 text-indigo-400" />
          <span>CSV-Exporte (Excel-kompatibel):</span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => handleExport("orders")}
            disabled={exportingType !== null}
            className="px-3.5 py-1.5 rounded-xl bg-slate-800/80 hover:bg-slate-700/80 text-xs font-semibold text-slate-200 border border-slate-700/60 transition-colors flex items-center gap-1.5"
          >
            {exportingType === "orders" ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <ShoppingBag className="w-3.5 h-3.5 text-indigo-400" />
            )}
            Bestellungen
          </button>

          <button
            onClick={() => handleExport("products")}
            disabled={exportingType !== null}
            className="px-3.5 py-1.5 rounded-xl bg-slate-800/80 hover:bg-slate-700/80 text-xs font-semibold text-slate-200 border border-slate-700/60 transition-colors flex items-center gap-1.5"
          >
            {exportingType === "products" ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Package className="w-3.5 h-3.5 text-emerald-400" />
            )}
            Artikelverkäufe
          </button>

          <button
            onClick={() => handleExport("users")}
            disabled={exportingType !== null}
            className="px-3.5 py-1.5 rounded-xl bg-slate-800/80 hover:bg-slate-700/80 text-xs font-semibold text-slate-200 border border-slate-700/60 transition-colors flex items-center gap-1.5"
          >
            {exportingType === "users" ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Users className="w-3.5 h-3.5 text-blue-400" />
            )}
            Mitarbeiter
          </button>

          <button
            onClick={() => handleExport("sessions")}
            disabled={exportingType !== null}
            className="px-3.5 py-1.5 rounded-xl bg-slate-800/80 hover:bg-slate-700/80 text-xs font-semibold text-slate-200 border border-slate-700/60 transition-colors flex items-center gap-1.5"
          >
            {exportingType === "sessions" ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Wallet className="w-3.5 h-3.5 text-amber-400" />
            )}
            Kassenabschlüsse
          </button>

          <button
            onClick={() => handleExport("categories")}
            disabled={exportingType !== null}
            className="px-3.5 py-1.5 rounded-xl bg-slate-800/80 hover:bg-slate-700/80 text-xs font-semibold text-slate-200 border border-slate-700/60 transition-colors flex items-center gap-1.5"
          >
            {exportingType === "categories" ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Layers className="w-3.5 h-3.5 text-purple-400" />
            )}
            Kategorien
          </button>
        </div>
      </div>

      {/* Tabs Navigation */}
      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
        {[
          { id: "overview", label: "Übersicht & Verlauf", icon: TrendingUp },
          { id: "products", label: "Produkte & Warengruppen", icon: Package },
          { id: "staff", label: "Mitarbeiterabrechnung", icon: Users },
          { id: "sessions", label: "Kassensitzungen", icon: Wallet },
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-2xl font-bold text-sm transition-all whitespace-nowrap ${
                isActive
                  ? "bg-indigo-600 text-white shadow-lg shadow-indigo-600/30"
                  : "glass hover:bg-slate-800/70 text-slate-400"
              }`}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab Contents */}
      {activeTab === "overview" && (
        <div className="space-y-6">
          {/* Hourly Timeline Chart */}
          <div className="glass p-6 rounded-3xl">
            <h2 className="text-lg font-bold flex items-center gap-2 mb-6">
              <Clock className="w-5 h-5 text-indigo-400" />
              Umsatz- und Bestellverlauf nach Uhrzeit
            </h2>

            {hourly.length === 0 ? (
              <p className="text-slate-500 text-center py-8">
                Noch keine Bestellungen im Verlauf vorhanden.
              </p>
            ) : (
              <div className="space-y-3">
                {hourly.map((h) => {
                  const width = Math.max(
                    (h.revenue / maxHourlyRevenue) * 100,
                    3,
                  );
                  return (
                    <div key={h.hour} className="flex items-center gap-3">
                      <div className="w-16 text-xs font-bold text-slate-400 flex-shrink-0">
                        {h.hour}
                      </div>
                      <div className="flex-1 h-8 bg-slate-900/60 rounded-xl overflow-hidden relative border border-slate-800">
                        <div
                          className="h-full bg-gradient-to-r from-indigo-500/40 to-indigo-500/80 rounded-xl transition-all duration-700"
                          style={{ width: `${width}%` }}
                        />
                        <div className="absolute inset-0 flex items-center justify-between px-3 text-xs">
                          <span className="font-semibold text-slate-200">
                            {h.count} Bestellungen
                          </span>
                          <span className="font-bold text-white">
                            {formatPrice(h.revenue)}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Quick Category Summary */}
          <div className="glass p-6 rounded-3xl">
            <h2 className="text-lg font-bold flex items-center gap-2 mb-6">
              <Layers className="w-5 h-5 text-purple-400" />
              Umsatz nach Warengruppen
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {categories.map((c) => (
                <div
                  key={c.name}
                  className="bg-slate-900/60 border border-slate-800 p-4 rounded-2xl"
                >
                  <div className="flex justify-between items-center mb-1">
                    <span className="font-semibold text-slate-200">
                      {c.name}
                    </span>
                    <span className="text-xs bg-slate-800 text-slate-400 px-2 py-0.5 rounded-lg">
                      {c.quantity} Stk.
                    </span>
                  </div>
                  <div className="text-xl font-bold text-white">
                    {formatPrice(c.revenue)}
                  </div>
                </div>
              ))}
              {categories.length === 0 && (
                <p className="text-slate-500">Keine Daten verfügbar.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {activeTab === "products" && (
        <div className="glass p-6 rounded-3xl space-y-6">
          <div className="flex justify-between items-center">
            <h2 className="text-lg font-bold flex items-center gap-2">
              <Package className="w-5 h-5 text-emerald-400" />
              Artikel-Verkaufsstatistik
            </h2>
            <span className="text-xs text-slate-400">
              {products.length} verschiedene Produkte
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-slate-400 border-b border-slate-800">
                  <th className="pb-3 font-semibold">Rang & Produkt</th>
                  <th className="pb-3 font-semibold">Kategorie</th>
                  <th className="pb-3 font-semibold text-right">Einzelpreis</th>
                  <th className="pb-3 font-semibold text-right">Menge</th>
                  <th className="pb-3 font-semibold text-right">Umsatz</th>
                  <th className="pb-3 font-semibold w-36">Anteil</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {products.map((p, idx) => {
                  const width = Math.max(
                    (p.revenue / maxProductRevenue) * 100,
                    3,
                  );
                  return (
                    <tr
                      key={p.id}
                      className="hover:bg-slate-800/30 transition-colors"
                    >
                      <td className="py-3 font-medium text-slate-200">
                        <span className="text-slate-500 font-bold mr-2">
                          #{idx + 1}
                        </span>
                        {p.name}
                      </td>
                      <td className="py-3 text-slate-400">
                        <span className="bg-slate-800/80 px-2 py-0.5 rounded-md text-xs">
                          {p.categoryName}
                        </span>
                      </td>
                      <td className="py-3 text-right text-slate-300">
                        {formatPrice(p.price)}
                      </td>
                      <td className="py-3 text-right font-bold text-slate-100">
                        {p.quantity}x
                      </td>
                      <td className="py-3 text-right font-bold text-emerald-400">
                        {formatPrice(p.revenue)}
                      </td>
                      <td className="py-3">
                        <div className="h-3 bg-slate-800 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-emerald-500/50 rounded-full"
                            style={{ width: `${width}%` }}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {products.length === 0 && (
                  <tr>
                    <td colSpan={6} className="text-center py-8 text-slate-500">
                      Noch keine Produktverkäufe aufgezeichnet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === "staff" && (
        <div className="glass p-6 rounded-3xl space-y-6">
          <div className="flex justify-between items-center">
            <h2 className="text-lg font-bold flex items-center gap-2">
              <Users className="w-5 h-5 text-indigo-400" />
              Mitarbeiter-Umsätze & Rollen
            </h2>
            <span className="text-xs text-slate-400">
              {users.length} aktive Mitarbeiter
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-slate-400 border-b border-slate-800">
                  <th className="pb-3 font-semibold">Mitarbeiter</th>
                  <th className="pb-3 font-semibold">Rolle</th>
                  <th className="pb-3 font-semibold text-right">
                    Bestellungen
                  </th>
                  <th className="pb-3 font-semibold text-right">
                    Bar eingenommen
                  </th>
                  <th className="pb-3 font-semibold text-right">
                    Karte eingenommen
                  </th>
                  <th className="pb-3 font-semibold text-right">
                    Gesamtumsatz
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {users.map((u) => (
                  <tr
                    key={u.id}
                    className="hover:bg-slate-800/30 transition-colors"
                  >
                    <td className="py-3 font-bold text-slate-100 flex items-center gap-2">
                      <div className="w-7 h-7 rounded-lg bg-indigo-500/20 text-indigo-300 flex items-center justify-center font-bold text-xs">
                        {u.username.slice(0, 2).toUpperCase()}
                      </div>
                      {u.username}
                    </td>
                    <td className="py-3">
                      <span className="bg-slate-800 text-indigo-300 px-2 py-0.5 rounded-md text-xs font-medium">
                        {u.role}
                      </span>
                    </td>
                    <td className="py-3 text-right font-medium text-slate-300">
                      {u.orderCount}
                    </td>
                    <td className="py-3 text-right font-bold text-emerald-400">
                      {formatPrice(u.cashRevenue)}
                    </td>
                    <td className="py-3 text-right font-bold text-blue-400">
                      {formatPrice(u.cardRevenue)}
                    </td>
                    <td className="py-3 text-right font-black text-white">
                      {formatPrice(u.revenue)}
                    </td>
                  </tr>
                ))}
                {users.length === 0 && (
                  <tr>
                    <td colSpan={6} className="text-center py-8 text-slate-500">
                      Noch keine Mitarbeiter-Umsätze vorhanden.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === "sessions" && (
        <div className="glass p-6 rounded-3xl space-y-6">
          <div className="flex justify-between items-center">
            <h2 className="text-lg font-bold flex items-center gap-2">
              <Wallet className="w-5 h-5 text-amber-400" />
              Kassensitzungen & Schichtabrechnungen
            </h2>
            <span className="text-xs text-slate-400">
              {sessions.length} erfasste Sitzungen
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-slate-400 border-b border-slate-800">
                  <th className="pb-3 font-semibold">Mitarbeiter</th>
                  <th className="pb-3 font-semibold">Status</th>
                  <th className="pb-3 font-semibold">Schichtzeit</th>
                  <th className="pb-3 font-semibold text-right">Wechselgeld</th>
                  <th className="pb-3 font-semibold text-right">Barumsatz</th>
                  <th className="pb-3 font-semibold text-right">Soll (Bar)</th>
                  <th className="pb-3 font-semibold text-right">
                    Gezählt (Ist)
                  </th>
                  <th className="pb-3 font-semibold text-right">Differenz</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {sessions.map((s) => {
                  const hasDiff =
                    s.difference !== null && s.difference !== undefined;
                  const isPositive = hasDiff && (s.difference || 0) > 0;
                  const isNegative = hasDiff && (s.difference || 0) < 0;

                  return (
                    <tr
                      key={s.id}
                      className="hover:bg-slate-800/30 transition-colors"
                    >
                      <td className="py-3 font-bold text-slate-100">
                        {s.username}
                      </td>
                      <td className="py-3">
                        <span
                          className={`px-2 py-0.5 rounded-md text-xs font-semibold ${
                            s.status === "ACTIVE"
                              ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                              : "bg-slate-800 text-slate-400"
                          }`}
                        >
                          {s.status === "ACTIVE" ? "Aktiv" : "Abgeschlossen"}
                        </span>
                      </td>
                      <td className="py-3 text-xs text-slate-400">
                        {formatDate(s.startTime)}{" "}
                        {s.endTime ? `bis ${formatDate(s.endTime)}` : ""}
                      </td>
                      <td className="py-3 text-right text-slate-300">
                        {formatPrice(s.startingBalance)}
                      </td>
                      <td className="py-3 text-right font-medium text-emerald-400">
                        +{formatPrice(s.cashSales)}
                      </td>
                      <td className="py-3 text-right font-bold text-slate-100">
                        {formatPrice(s.expectedCash)}
                      </td>
                      <td className="py-3 text-right font-bold text-slate-200">
                        {s.closingBalance !== null &&
                        s.closingBalance !== undefined
                          ? formatPrice(s.closingBalance)
                          : "-"}
                      </td>
                      <td className="py-3 text-right font-bold">
                        {hasDiff ? (
                          <span
                            className={
                              isPositive
                                ? "text-emerald-400"
                                : isNegative
                                  ? "text-rose-400"
                                  : "text-slate-400"
                            }
                          >
                            {isPositive ? "+" : ""}
                            {formatPrice(s.difference)}
                          </span>
                        ) : (
                          <span className="text-slate-500">-</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {sessions.length === 0 && (
                  <tr>
                    <td colSpan={8} className="text-center py-8 text-slate-500">
                      Noch keine Kassensitzungen eröffnet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
