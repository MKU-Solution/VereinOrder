import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Clock, RefreshCw, CheckCircle, Settings2 } from 'lucide-react';
import { CheckoutModal } from '../components/CheckoutModal';
import { OrderDetailsModal } from '../components/OrderDetailsModal';

export const UnpaidOrders = () => {
  const [orders, setOrders] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<any | null>(null);
  const [editingOrder, setEditingOrder] = useState<any | null>(null);

  const fetchOrders = async () => {
    try {
      // Temporary hardcode or fetch first available event
      const productsRes = await api.get('/products');
      if (productsRes.data.length > 0) {
        const eId = productsRes.data[0].eventId;
        const res = await api.get(`/orders/unpaid?eventId=${eId}`);
        setOrders(res.data);
      }
    } catch (err) {
      console.error("Failed to load unpaid orders", err);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    fetchOrders();
    const interval = setInterval(() => {
      fetchOrders();
    }, 10000); // Poll every 10s
    return () => clearInterval(interval);
  }, []);

  const handleRefresh = () => {
    setIsRefreshing(true);
    fetchOrders();
  };

  const handlePaymentConfirm = async (payments: { amount: number; method: 'CASH' | 'CARD' | 'VOUCHER' }[]) => {
    if (!selectedOrder || payments.length === 0) {
      setSelectedOrder(null);
      return;
    }
    
    try {
      await api.post(`/orders/${selectedOrder.id}/payments`, { payments });
      setSelectedOrder(null);
      fetchOrders();
    } catch (err) {
      console.error("Payment failed", err);
      alert('Fehler bei der Zahlung!');
    }
  };

  const formatPrice = (cents: number) => `€ ${(cents / 100).toFixed(2)}`;

  if (isLoading) return <div className="text-center py-20 animate-pulse text-slate-400">Lade offene Bestellungen...</div>;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold flex items-center gap-2">
          <Clock className="w-6 h-6 text-orange-400" />
          Offene Bestellungen
        </h2>
        <button 
          onClick={handleRefresh}
          className={`p-2 glass rounded-xl hover:bg-slate-700 transition-colors ${isRefreshing ? 'animate-spin' : ''}`}
        >
          <RefreshCw className="w-5 h-5 text-slate-300" />
        </button>
      </div>

      <div className="space-y-10">
        {Object.entries(
          orders.reduce((acc: any, order: any) => {
            const key = order.tableName || 'Ohne Tisch / Theke';
            if (!acc[key]) acc[key] = [];
            acc[key].push(order);
            return acc;
          }, {})
        ).map(([tableName, groupOrders]: [string, any]) => (
          <div key={tableName} className="space-y-4">
            <h3 className="text-xl font-bold text-slate-200 border-b border-slate-700/50 pb-2">
              {tableName}
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {groupOrders.map((order: any) => {
                const totalPaid = order.payments.reduce((sum: number, p: any) => sum + p.amount, 0);
                const remainingAmount = order.totalAmount - totalPaid;

                return (
                  <div key={order.id} className="glass p-6 rounded-3xl flex flex-col gap-4">
                    <div className="flex justify-between items-start">
                      <div className="flex items-center gap-2">
                        <span className="bg-slate-800 text-slate-300 px-3 py-1 rounded-full text-sm font-medium">
                          #{order.orderNumber}
                        </span>
                        <span className="text-xs font-medium text-slate-500 bg-slate-800/50 px-2 py-1 rounded-md">
                          {order.lifecycleStatus}
                        </span>
                      </div>
                      <div className="flex items-center gap-4">
                        <span className="text-lg font-bold">{formatPrice(order.totalAmount)}</span>
                        <button onClick={() => setEditingOrder(order)} className="p-2 hover:bg-slate-700 rounded-xl transition-colors text-slate-400">
                          <Settings2 className="w-5 h-5" />
                        </button>
                      </div>
                    </div>
                    
                    <div className="flex-1 space-y-2">
                      {order.items.map((item: any) => (
                        <div key={item.id} className={`flex justify-between text-sm ${item.status === 'CANCELLED' ? 'text-slate-600 line-through' : 'text-slate-300'}`}>
                          <span>{item.quantity}x {item.product.name} {item.variantName ? `(${item.variantName})` : ''}</span>
                          <span>{formatPrice(item.priceAtTime * item.quantity)}</span>
                        </div>
                      ))}
                    </div>

                    {totalPaid > 0 && (
                      <div className="pt-4 border-t border-slate-700/50">
                        <div className="flex justify-between text-sm text-slate-400 mb-1">
                          <span>Bereits bezahlt:</span>
                          <span className="text-emerald-400 font-medium">{formatPrice(totalPaid)}</span>
                        </div>
                        {order.payments.map((p: any) => (
                          <div key={p.id} className="flex justify-between text-xs text-slate-500">
                            <span>{p.method === 'CASH' ? 'Bar' : (p.method === 'REFUND' ? 'Erstattung' : 'Karte')}</span>
                            <span>{p.method === 'REFUND' ? '-' : ''}{formatPrice(Math.abs(p.amount))}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="pt-4 border-t border-slate-700/50 flex justify-between items-center">
                      <div>
                        <div className="text-sm text-slate-400">Noch offen</div>
                        <div className={`text-2xl font-bold ${remainingAmount > 0 ? 'text-orange-400' : 'text-emerald-400'}`}>
                          {formatPrice(Math.max(0, remainingAmount))}
                        </div>
                      </div>
                      <button
                        disabled={remainingAmount <= 0}
                        onClick={() => setSelectedOrder({ ...order, remainingAmount })}
                        className="bg-indigo-500 hover:bg-indigo-400 disabled:opacity-50 text-white px-4 py-2 rounded-xl font-bold transition-colors"
                      >
                        Abkassieren
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        {orders.length === 0 && (
          <div className="col-span-full py-20 text-center text-slate-500 glass rounded-3xl">
            <CheckCircle className="w-12 h-12 mx-auto mb-4 text-emerald-500/50" />
            <p className="text-xl">Keine offenen Bestellungen</p>
          </div>
        )}
      </div>

      <CheckoutModal
        isOpen={selectedOrder !== null}
        total={selectedOrder ? selectedOrder.remainingAmount : 0}
        onClose={() => setSelectedOrder(null)}
        onConfirm={handlePaymentConfirm}
      />
      
      <OrderDetailsModal
        order={editingOrder}
        isOpen={editingOrder !== null}
        onClose={() => setEditingOrder(null)}
        onRefresh={fetchOrders}
      />
    </div>
  );
};
