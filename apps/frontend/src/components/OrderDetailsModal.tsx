import { useState } from 'react';
import { api } from '../lib/api';
import { X, AlertTriangle } from 'lucide-react';

export const OrderDetailsModal = ({ order, isOpen, onClose, onRefresh }: any) => {
  if (!isOpen || !order) return null;
  const [loading, setLoading] = useState(false);

  const formatPrice = (cents: number) => `€ ${(cents / 100).toFixed(2)}`;

  const handleCancelOrder = async () => {
    if (!confirm('Gesamte Bestellung wirklich stornieren?')) return;
    setLoading(true);
    try {
      await api.post(`/orders/${order.id}/cancel`, { reason: 'Storniert durch Kellner' });
      onRefresh();
      onClose();
    } catch (err: any) {
      alert(err.response?.data?.message || 'Storno fehlgeschlagen');
    }
    setLoading(false);
  };

  const handleCancelItem = async (itemId: string) => {
    if (!confirm('Dieses Produkt wirklich stornieren?')) return;
    setLoading(true);
    try {
      await api.post(`/orders/items/${itemId}/cancel`, { reason: 'Position storniert' });
      onRefresh();
      onClose();
    } catch (err: any) {
      alert(err.response?.data?.message || 'Storno fehlgeschlagen');
    }
    setLoading(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-sm">
      <div className="bg-slate-800 rounded-3xl w-full max-w-lg border border-slate-700/50 shadow-2xl flex flex-col max-h-[90vh]">
        <div className="p-4 bg-slate-800/80 border-b border-slate-700/50 flex justify-between items-center rounded-t-3xl shrink-0">
          <h2 className="text-xl font-bold">Bestellung #{order.orderNumber} bearbeiten</h2>
          <button onClick={onClose} className="p-2 hover:bg-slate-700 rounded-xl transition-colors">
            <X className="w-6 h-6 text-slate-400" />
          </button>
        </div>
        
        <div className="p-6 overflow-y-auto space-y-6 flex-1">
          <div className="space-y-4">
             <div className="flex justify-between items-center text-sm">
               <span className="text-slate-400">Status:</span>
               <span className="bg-slate-700 px-2 py-1 rounded-md text-slate-300 font-medium">
                 {order.lifecycleStatus}
               </span>
             </div>
             <div className="flex justify-between items-center text-sm">
               <span className="text-slate-400">Lieferstatus:</span>
               <span className="bg-indigo-500/20 text-indigo-400 px-2 py-1 rounded-md font-medium">
                 {order.fulfillmentStatus}
               </span>
             </div>
             <div className="flex justify-between items-center text-sm">
               <span className="text-slate-400">Zahlungsstatus:</span>
               <span className="bg-emerald-500/20 text-emerald-400 px-2 py-1 rounded-md font-medium">
                 {order.paymentStatus}
               </span>
             </div>
          </div>

          <div className="space-y-3">
            <h3 className="font-bold text-slate-300 border-b border-slate-700/50 pb-2">Positionen</h3>
            {order.items.map((item: any) => (
              <div key={item.id} className={`flex justify-between items-center p-3 rounded-xl ${item.status === 'CANCELLED' ? 'opacity-50 bg-slate-900/50' : 'bg-slate-900/50'}`}>
                <div className="flex-1">
                  <div className="flex justify-between">
                    <span className="font-medium text-slate-200">
                      {item.quantity}x {item.product.name}
                    </span>
                    <span className="text-slate-300">{formatPrice(item.priceAtTime * item.quantity)}</span>
                  </div>
                  {item.variantName && (
                    <div className="text-xs text-indigo-300 mt-1">{item.variantName}</div>
                  )}
                  {item.extras && item.extras.length > 0 && (
                    <div className="text-xs text-emerald-300 mt-0.5">
                      {item.extras.map((e: any) => e.name).join(', ')}
                    </div>
                  )}
                  {item.status === 'CANCELLED' && <span className="text-red-400 text-xs mt-1 block">Storniert</span>}
                </div>
                {item.status !== 'CANCELLED' && (
                  <button 
                    disabled={loading}
                    onClick={() => handleCancelItem(item.id)}
                    className="ml-4 p-2 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded-lg transition-colors text-sm font-bold"
                  >
                    Storno
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="p-4 border-t border-slate-700/50 rounded-b-3xl shrink-0">
           <button
             disabled={loading || order.lifecycleStatus === 'CANCELLED'}
             onClick={handleCancelOrder}
             className="w-full py-4 bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white rounded-2xl font-bold flex items-center justify-center gap-2 transition-colors"
           >
             <AlertTriangle className="w-5 h-5" />
             Gesamte Bestellung stornieren
           </button>
        </div>
      </div>
    </div>
  );
};
