import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { TrendingUp, ShoppingBag, Users, Package } from 'lucide-react';

export const RevisionDashboard = () => {
  const [summary, setSummary] = useState({ totalAmount: 0, orderCount: 0 });
  const [products, setProducts] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [sumRes, prodRes, usersRes] = await Promise.all([
          api.get('/reports/summary'),
          api.get('/reports/products'),
          api.get('/reports/users')
        ]);
        setSummary(sumRes.data);
        setProducts(prodRes.data);
        setUsers(usersRes.data);
      } catch (err) {
        console.error("Failed to load reports", err);
      } finally {
        setIsLoading(false);
      }
    };
    fetchData();
    const interval = setInterval(fetchData, 10000); // 10s poll for live feeling
    return () => clearInterval(interval);
  }, []);

  const formatPrice = (cents: number) => `€ ${(cents / 100).toFixed(2)}`;

  if (isLoading) return <div className="text-center py-20 text-slate-400 animate-pulse">Lade Auswertungen...</div>;

  return (
    <div className="space-y-6">
      <div className="text-center md:text-left mb-8">
        <h1 className="text-3xl font-bold">Interne Abrechnung & Revision</h1>
        <p className="text-slate-400 mt-2">Live-Auswertung der laufenden Veranstaltung</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="glass p-6 rounded-3xl flex items-center gap-6">
          <div className="w-16 h-16 rounded-2xl bg-emerald-500/20 flex items-center justify-center border border-emerald-500/30">
            <TrendingUp className="w-8 h-8 text-emerald-400" />
          </div>
          <div>
            <div className="text-slate-400 font-semibold mb-1">Gesamtumsatz</div>
            <div className="text-4xl font-black text-white">{formatPrice(summary.totalAmount)}</div>
          </div>
        </div>

        <div className="glass p-6 rounded-3xl flex items-center gap-6">
          <div className="w-16 h-16 rounded-2xl bg-indigo-500/20 flex items-center justify-center border border-indigo-500/30">
            <ShoppingBag className="w-8 h-8 text-indigo-400" />
          </div>
          <div>
            <div className="text-slate-400 font-semibold mb-1">Bestellungen</div>
            <div className="text-4xl font-black text-white">{summary.orderCount}</div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-8">
        {/* Top Products */}
        <div className="glass p-6 rounded-3xl">
          <h2 className="text-xl font-bold flex items-center gap-2 mb-6">
            <Package className="w-5 h-5 text-indigo-400" />
            Bestseller Produkte
          </h2>
          <div className="space-y-4">
            {products.map((p, idx) => {
              const maxVal = products[0]?.quantity || 1;
              const width = Math.max((p.quantity / maxVal) * 100, 5);
              return (
                <div key={p.id} className="relative">
                  <div className="flex justify-between text-sm mb-1 z-10 relative px-2">
                    <span className="font-semibold text-slate-200">{idx + 1}. {p.name}</span>
                    <span className="text-slate-400">{p.quantity}x ({formatPrice(p.revenue)})</span>
                  </div>
                  <div className="h-8 bg-slate-800/50 rounded-lg overflow-hidden">
                    <div 
                      className="h-full bg-indigo-500/30 rounded-lg transition-all duration-1000"
                      style={{ width: `${width}%` }}
                    />
                  </div>
                </div>
              );
            })}
            {products.length === 0 && <p className="text-slate-500">Noch keine Verkäufe.</p>}
          </div>
        </div>

        {/* Top Waiters */}
        <div className="glass p-6 rounded-3xl">
          <h2 className="text-xl font-bold flex items-center gap-2 mb-6">
            <Users className="w-5 h-5 text-indigo-400" />
            Umsatz nach Mitarbeiter
          </h2>
          <div className="space-y-4">
            {users.map((u, idx) => {
              const maxVal = users[0]?.revenue || 1;
              const width = Math.max((u.revenue / maxVal) * 100, 5);
              return (
                <div key={u.id} className="relative">
                  <div className="flex justify-between text-sm mb-1 z-10 relative px-2">
                    <span className="font-semibold text-slate-200">{idx + 1}. {u.username}</span>
                    <span className="text-slate-400">{u.orderCount} Bestellungen ({formatPrice(u.revenue)})</span>
                  </div>
                  <div className="h-8 bg-slate-800/50 rounded-lg overflow-hidden">
                    <div 
                      className="h-full bg-emerald-500/30 rounded-lg transition-all duration-1000"
                      style={{ width: `${width}%` }}
                    />
                  </div>
                </div>
              );
            })}
            {users.length === 0 && <p className="text-slate-500">Noch keine Umsätze.</p>}
          </div>
        </div>
      </div>
    </div>
  );
};
