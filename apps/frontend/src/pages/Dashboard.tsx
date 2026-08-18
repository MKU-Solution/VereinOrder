import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useCartStore } from '../store/useCartStore';
import { ShoppingCart, Plus, Minus, Trash2, CheckCircle2 } from 'lucide-react';

import { CheckoutModal } from '../components/CheckoutModal';

export const Dashboard = () => {
  const [products, setProducts] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  
  const { items, addItem, removeItem, clearCart, total } = useCartStore();

  useEffect(() => {
    const fetchProducts = async () => {
      try {
        const res = await api.get('/products');
        setProducts(res.data);
      } catch (err) {
        console.error("Failed to load products", err);
      } finally {
        setIsLoading(false);
      }
    };
    fetchProducts();

    // Offline Sync loop
    const syncOffline = async () => {
      try {
        const { getOfflineOrders, removeOfflineOrder } = await import('../lib/offlineSync');
        const offlineOrders = await getOfflineOrders();
        for (const order of offlineOrders) {
          try {
            await api.post('/orders', { 
              eventId: order.eventId, 
              items: order.items, 
              payments: order.payments, 
              idempotencyKey: order.idempotencyKey 
            });
            await removeOfflineOrder(order.idempotencyKey);
            console.log("Synced offline order:", order.idempotencyKey);
          } catch (e: any) {
            if (e.response) {
              // Server rejected it (e.g. invalid), remove it to avoid endless loop
              await removeOfflineOrder(order.idempotencyKey);
            }
          }
        }
      } catch (e) {
        console.error("Sync error", e);
      }
    };
    
    window.addEventListener('online', syncOffline);
    // Try sync on mount if online
    if (navigator.onLine) {
      syncOffline();
    }
    return () => window.removeEventListener('online', syncOffline);
  }, []);

  const handleCheckoutSubmit = async (payments: { amount: number; method: 'CASH' | 'CARD' | 'VOUCHER' }[]) => {
    setIsCheckoutOpen(false);
    setIsSubmitting(true);
    try {
      const eventId = items[0].product.eventId; 
      const orderItems = items.map(i => ({ productId: i.product.id, quantity: i.quantity }));
      const idempotencyKey = crypto.randomUUID();
      
      await api.post('/orders', { eventId, items: orderItems, payments, idempotencyKey });
      
      setSuccessMsg('Bestellung erfolgreich!');
      clearCart();
      setTimeout(() => setSuccessMsg(''), 3000);
    } catch (err: any) {
      console.error("Order failed", err);
      // Check if network error
      if (!err.response) {
        const eventId = items[0].product.eventId; 
        const orderItems = items.map(i => ({ productId: i.product.id, quantity: i.quantity }));
        const idempotencyKey = crypto.randomUUID();
        
        import('../lib/offlineSync').then(({ saveOrderOffline }) => {
          saveOrderOffline({
            idempotencyKey,
            eventId,
            items: orderItems,
            payments,
            createdAt: Date.now()
          });
        });
        
        setSuccessMsg('Offline gespeichert!');
        clearCart();
        setTimeout(() => setSuccessMsg(''), 3000);
      } else {
        alert('Fehler bei der Buchung!');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const formatPrice = (cents: number) => `€ ${(cents / 100).toFixed(2)}`;

  if (isLoading) return <div className="text-center py-20 animate-pulse text-slate-400">Lade Produkte...</div>;

  return (
    <div className="flex flex-col lg:flex-row gap-6 relative">
      
      {/* Product Grid */}
      <div className="flex-1 space-y-6">
        <h2 className="text-2xl font-bold">Produkte</h2>
        
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
          {products.map(p => (
            <button 
              key={p.id}
              onClick={() => addItem(p)}
              className="glass p-4 rounded-2xl flex flex-col items-center justify-center gap-2 hover:bg-slate-800/60 active:scale-95 transition-all text-center aspect-square"
            >
              <span className="font-semibold text-lg">{p.shortName || p.name}</span>
              <span className="text-indigo-400 font-medium">{formatPrice(p.price)}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Cart Sidebar */}
      <div className="lg:w-96 glass rounded-3xl p-5 flex flex-col h-[calc(100vh-120px)] sticky top-24">
        <div className="flex items-center justify-between mb-6 pb-4 border-b border-slate-700/50">
          <h2 className="text-xl font-bold flex items-center gap-2">
            <ShoppingCart className="w-5 h-5 text-indigo-400" />
            Warenkorb
          </h2>
          {items.length > 0 && (
            <button onClick={clearCart} className="text-slate-400 hover:text-red-400 transition-colors p-2">
              <Trash2 className="w-5 h-5" />
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto space-y-4 pr-2">
          {items.length === 0 ? (
            <div className="text-center text-slate-500 mt-10">Warenkorb ist leer</div>
          ) : (
            items.map(item => (
              <div key={item.product.id} className="flex justify-between items-center bg-slate-800/30 p-3 rounded-xl border border-slate-700/30">
                <div className="flex-1">
                  <div className="font-medium">{item.product.shortName || item.product.name}</div>
                  <div className="text-sm text-slate-400">{formatPrice(item.product.price)}</div>
                </div>
                
                <div className="flex items-center gap-3 bg-slate-900 rounded-lg p-1">
                  <button onClick={() => removeItem(item.product.id)} className="p-1.5 hover:bg-slate-800 rounded-md transition-colors text-slate-300">
                    <Minus className="w-4 h-4" />
                  </button>
                  <span className="w-6 text-center font-bold">{item.quantity}</span>
                  <button onClick={() => addItem(item.product)} className="p-1.5 hover:bg-slate-800 rounded-md transition-colors text-slate-300">
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="mt-6 pt-4 border-t border-slate-700/50">
          <div className="flex justify-between items-end mb-6">
            <span className="text-slate-400">Summe</span>
            <span className="text-3xl font-bold text-white">{formatPrice(total)}</span>
          </div>

          <button
            onClick={() => setIsCheckoutOpen(true)}
            disabled={items.length === 0 || isSubmitting}
            className="w-full bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 text-white font-bold py-4 rounded-2xl shadow-lg shadow-emerald-500/20 active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100 transition-all flex justify-center items-center gap-2 text-lg"
          >
            {isSubmitting ? (
              <span className="animate-spin h-6 w-6 border-2 border-white/30 border-t-white rounded-full"></span>
            ) : successMsg ? (
              <><CheckCircle2 className="w-6 h-6" /> {successMsg}</>
            ) : (
              'Abrechnen'
            )}
          </button>
        </div>
      </div>

      <CheckoutModal
        isOpen={isCheckoutOpen}
        total={total}
        onClose={() => setIsCheckoutOpen(false)}
        onConfirm={handleCheckoutSubmit}
      />
    </div>
  );
};
