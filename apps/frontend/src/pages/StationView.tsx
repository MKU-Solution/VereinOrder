import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { ArrowLeft, CheckCircle2 } from 'lucide-react';

export const StationView = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [items, setItems] = useState<any[]>([]);
  const [lastUpdated, setLastUpdated] = useState(new Date());

  const fetchItems = useCallback(async () => {
    try {
      const res = await api.get(`/stations/${id}/items`);
      setItems(res.data);
      setLastUpdated(new Date());
    } catch (err) {
      console.error("Failed to fetch station items", err);
    }
  }, [id]);

  // Polling every 5 seconds
  useEffect(() => {
    fetchItems(); // initial fetch
    const interval = setInterval(fetchItems, 5000);
    return () => clearInterval(interval);
  }, [fetchItems]);

  const markAsReady = async (itemId: string) => {
    // Optimistic UI Update
    setItems(prev => prev.filter(i => i.id !== itemId));
    
    try {
      await api.patch(`/stations/items/${itemId}/status`, { status: 'READY' });
    } catch (err) {
      console.error("Failed to mark as ready", err);
      // Revert on error (could fetch items again)
      fetchItems();
    }
  };

  const formatTime = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between glass p-4 rounded-2xl sticky top-24 z-10">
        <div className="flex items-center gap-4">
          <button 
            onClick={() => navigate('/stations')}
            className="p-2 hover:bg-slate-800 rounded-xl transition-colors"
          >
            <ArrowLeft className="w-6 h-6 text-slate-300" />
          </button>
          <h1 className="text-2xl font-bold">Monitor</h1>
        </div>
        <div className="text-sm text-slate-400 flex items-center gap-2">
          <span className="relative flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
          </span>
          Live (Aktualisiert: {lastUpdated.toLocaleTimeString()})
        </div>
      </div>

      {items.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-64 text-slate-500 space-y-4">
          <CheckCircle2 className="w-16 h-16 text-slate-700" />
          <p className="text-xl">Keine offenen Bestellungen</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {items.map(item => (
            <div key={item.id} className="glass border-l-4 border-l-indigo-500 p-6 rounded-2xl flex flex-col justify-between animate-slide-up shadow-xl shadow-black/50">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <div className="text-5xl font-black text-white mb-2">{item.quantity}x</div>
                  <div className="text-2xl font-bold text-slate-200">{item.product.name}</div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-slate-400 uppercase font-semibold">Bestellung</div>
                  <div className="text-xl font-mono text-indigo-400 font-bold">#{item.order.orderNumber}</div>
                  <div className="text-sm text-slate-500 mt-1">{formatTime(item.order.createdAt)}</div>
                </div>
              </div>
              
              <button 
                onClick={() => markAsReady(item.id)}
                className="w-full mt-4 bg-slate-800 hover:bg-emerald-600/20 hover:text-emerald-400 hover:border-emerald-500/50 border border-transparent text-slate-300 font-bold py-4 rounded-xl transition-all active:scale-95 flex justify-center items-center gap-2 text-lg"
              >
                <CheckCircle2 className="w-6 h-6" />
                Erledigt
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
