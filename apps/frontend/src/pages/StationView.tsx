import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { ArrowLeft, CheckCircle2, Clock, Play, Star } from 'lucide-react';

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

  const startPreparing = async (itemId: string) => {
    setItems(prev => prev.map(i => i.id === itemId ? { ...i, status: 'PREPARING' } : i));
    try {
      await api.patch(`/stations/items/${itemId}/status`, { status: 'PREPARING' });
    } catch (err) {
      console.error("Failed to start preparing", err);
      fetchItems();
    }
  };

  const markAsReady = async (itemId: string) => {
    setItems(prev => prev.filter(i => i.id !== itemId));
    try {
      await api.patch(`/stations/items/${itemId}/status`, { status: 'READY' });
    } catch (err) {
      console.error("Failed to mark as ready", err);
      fetchItems();
    }
  };

  const togglePriority = async (orderId: string, currentPriority: boolean) => {
    const newPriority = !currentPriority;
    setItems(prev => prev.map(i => i.order.id === orderId ? { ...i, order: { ...i.order, isPriority: newPriority } } : i));
    try {
      await api.patch(`/orders/${orderId}/priority`, { isPriority: newPriority });
    } catch (err) {
      console.error("Failed to toggle priority", err);
      fetchItems();
    }
  };

  const formatTime = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const getWaitTime = (createdAt: string) => {
    const diff = new Date().getTime() - new Date(createdAt).getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return 'Gerade eben';
    return `vor ${minutes} Min`;
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
            <div 
              key={item.id} 
              className={`glass border-l-4 p-6 rounded-2xl flex flex-col justify-between animate-slide-up shadow-xl shadow-black/50 ${item.order.isPriority ? 'border-l-rose-500 bg-rose-950/20' : item.status === 'PREPARING' ? 'border-l-amber-500 bg-amber-950/10' : 'border-l-indigo-500'}`}
            >
              <div className="flex justify-between items-start mb-4">
                <div>
                  <div className="text-5xl font-black text-white mb-2">{item.quantity}x</div>
                  <div className="text-2xl font-bold text-slate-200">{item.product.name}</div>
                  {(item.variantName || (item.extras && item.extras.length > 0)) && (
                    <div className="text-sm text-slate-400 mt-2 font-medium bg-slate-800/50 p-2 rounded-lg inline-block">
                      {item.variantName && <div>• {item.variantName}</div>}
                      {item.extras?.map((e: any) => <div key={e.id}>+ {e.name}</div>)}
                    </div>
                  )}
                </div>
                <div className="text-right flex flex-col items-end">
                  <div className="flex items-center gap-2 mb-2">
                    <button 
                      onClick={() => togglePriority(item.order.id, item.order.isPriority)}
                      className={`p-2 rounded-full transition-colors ${item.order.isPriority ? 'text-rose-400 bg-rose-400/20' : 'text-slate-500 hover:text-slate-300 hover:bg-slate-700'}`}
                      aria-label="Priorität umschalten"
                    >
                      <Star className={`w-6 h-6 ${item.order.isPriority ? 'fill-current' : ''}`} />
                    </button>
                  </div>
                  <div className="text-xs text-slate-400 uppercase font-semibold">Bestellung</div>
                  <div className="text-xl font-mono text-indigo-400 font-bold">#{item.order.orderNumber}</div>
                  <div className="text-sm text-slate-500 mt-1">{formatTime(item.order.createdAt)}</div>
                  <div className="flex items-center gap-1 text-sm font-semibold mt-2 text-slate-300">
                    <Clock className="w-4 h-4" />
                    {getWaitTime(item.order.createdAt)}
                  </div>
                </div>
              </div>
              
              <div className="mt-4 flex gap-2">
                {item.status === 'PENDING' ? (
                  <button 
                    onClick={() => startPreparing(item.id)}
                    className="flex-1 bg-amber-600/20 hover:bg-amber-600/30 text-amber-500 border border-amber-500/50 font-bold py-4 rounded-xl transition-all active:scale-95 flex justify-center items-center gap-2 text-lg"
                  >
                    <Play className="w-6 h-6" />
                    Zubereitung starten
                  </button>
                ) : (
                  <button 
                    onClick={() => markAsReady(item.id)}
                    className="flex-1 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 border border-emerald-500/50 font-bold py-4 rounded-xl transition-all active:scale-95 flex justify-center items-center gap-2 text-lg"
                  >
                    <CheckCircle2 className="w-6 h-6" />
                    Erledigt
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
