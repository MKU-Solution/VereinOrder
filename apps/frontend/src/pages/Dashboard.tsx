import { useEffect, useState, useMemo } from 'react';
import { api } from '../lib/api';
import { useCartStore, CartItem as CartItemType } from '../store/useCartStore';
import { Trash2, Check, ArrowLeft } from 'lucide-react';
import { CheckoutModal } from '../components/CheckoutModal';
import { ProductOptionsModal } from '../components/ProductOptionsModal';

const formatPrice = (cents: number) => `€ ${(cents / 100).toFixed(2)}`;

// Sub-Komponente für Swipe-to-Delete
const CartItem = ({ item, removeItem }: { item: CartItemType, removeItem: (id: string) => void }) => {
  const [translateX, setTranslateX] = useState(0);
  const [startX, setStartX] = useState(0);

  const onTouchStart = (e: React.TouchEvent) => setStartX(e.touches[0].clientX);
  
  const onTouchMove = (e: React.TouchEvent) => {
    const currentX = e.touches[0].clientX;
    const diff = currentX - startX;
    if (diff < 0) {
      setTranslateX(Math.max(-100, diff));
    }
  };
  
  const onTouchEnd = () => {
    if (translateX < -60) {
      removeItem(item.id);
    }
    setTranslateX(0); 
  };

  return (
    <div className="relative overflow-hidden border-b border-slate-200">
      <div className="absolute inset-y-0 right-0 w-24 bg-red-500 flex items-center justify-end pr-6 text-white">
        <Trash2 className="w-6 h-6" />
      </div>
      <div 
        className="flex justify-between items-center p-3 bg-white relative transition-transform"
        style={{ transform: `translateX(${translateX}px)` }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        <div className="w-12 text-center text-lg font-bold text-slate-800">{item.quantity}</div>
        <div className="flex-1 truncate pr-2">
          <div className="text-lg font-semibold text-slate-800">{item.product.shortName || item.product.name}</div>
          {(item.variant || (item.extras && item.extras.length > 0)) && (
            <div className="text-sm text-slate-500 leading-tight">
              {item.variant?.name}
              {item.variant && item.extras?.length ? ' · ' : ''}
              {item.extras?.map(e => e.name).join(', ')}
            </div>
          )}
        </div>
        <div className="text-right text-lg font-bold text-slate-800 w-24">{formatPrice(item.finalPrice * item.quantity)}</div>
      </div>
    </div>
  );
};

export const Dashboard = () => {
  const [products, setProducts] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [tableName, setTableName] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedProductForOptions, setSelectedProductForOptions] = useState<any | null>(null);

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
              idempotencyKey: order.idempotencyKey,
              tableName: order.tableName
            });
            await removeOfflineOrder(order.idempotencyKey);
          } catch (e: any) {
            if (e.response) await removeOfflineOrder(order.idempotencyKey);
          }
        }
      } catch (e) {
        console.error("Sync error", e);
      }
    };
    
    window.addEventListener('online', syncOffline);
    if (navigator.onLine) syncOffline();
    return () => window.removeEventListener('online', syncOffline);
  }, []);

  const categories = useMemo(() => {
    const cats = new Set<string>();
    products.forEach(p => {
      if (p.category?.name) cats.add(p.category.name);
    });
    return Array.from(cats);
  }, [products]);

  const filteredProducts = useMemo(() => {
    if (!selectedCategory) return products;
    return products.filter(p => p.category?.name === selectedCategory);
  }, [products, selectedCategory]);

  const handleProductClick = (p: any) => {
    if ((p.variants && p.variants.length > 0) || (p.extras && p.extras.length > 0)) {
      setSelectedProductForOptions(p);
    } else {
      addItem(p);
    }
  };

  const handleCheckoutSubmit = async (payments: { amount: number; method: 'CASH' | 'CARD' | 'VOUCHER' }[], finalTableName?: string) => {
    setIsCheckoutOpen(false);
    setIsSubmitting(true);
    try {
      const eventId = items[0].product.eventId; 
      const orderItems = items.map(i => ({ 
        productId: i.product.id, 
        quantity: i.quantity,
        variantId: i.variant?.id,
        variantName: i.variant?.name,
        extras: i.extras
      }));
      const idempotencyKey = crypto.randomUUID();
      const nameToUse = finalTableName || tableName;
      
      await api.post('/orders', { eventId, items: orderItems, payments, idempotencyKey, tableName: nameToUse });
      
      setSuccessMsg('Bestellung erfolgreich!');
      clearCart();
      setTableName('');
      setTimeout(() => setSuccessMsg(''), 3000);
    } catch (err: any) {
      if (!err.response) {
        const eventId = items[0].product.eventId; 
        const orderItems = items.map(i => ({ 
          productId: i.product.id, 
          quantity: i.quantity,
          variantId: i.variant?.id,
          variantName: i.variant?.name,
          extras: i.extras
        }));
        const idempotencyKey = crypto.randomUUID();
        const nameToUse = finalTableName || tableName;
        
        import('../lib/offlineSync').then(({ saveOrderOffline }) => {
          saveOrderOffline({
            idempotencyKey,
            eventId,
            items: orderItems,
            payments,
            tableName: nameToUse,
            createdAt: Date.now()
          });
        });
        
        setSuccessMsg('Offline gespeichert!');
        clearCart();
        setTableName('');
        setTimeout(() => setSuccessMsg(''), 3000);
      } else {
        alert('Fehler bei der Buchung!');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleTableClick = () => {
    const input = prompt("Tisch / Bereich eingeben:", tableName);
    if (input !== null) {
      setTableName(input);
    }
  };

  const totalItems = items.reduce((acc, i) => acc + i.quantity, 0);

  if (isLoading) return <div className="text-center py-20 animate-pulse text-slate-400">Lade Produkte...</div>;

  return (
    <div className="fixed inset-0 top-[64px] bg-white flex flex-col z-50 overflow-hidden">
      {/* Top Bar (Orange) */}
      <div className="bg-orange-500 text-white p-3 flex justify-between items-center shadow-md shrink-0 h-16">
        <button onClick={clearCart} className="p-2 hover:bg-orange-600 rounded-full transition-colors" aria-label="Warenkorb leeren">
          <ArrowLeft className="w-6 h-6" />
        </button>
        
        <div className="flex-1 flex justify-center items-center gap-2 sm:gap-4 text-lg font-bold cursor-pointer hover:bg-orange-600 p-2 rounded-lg transition-colors" onClick={handleTableClick}>
          <span>{tableName ? tableName : 'Tisch?'}</span>
          <span className="opacity-60">|</span>
          <span>{formatPrice(total)}</span>
          <span className="opacity-60">|</span>
          <span>{totalItems}</span>
        </div>

        <button 
          onClick={() => setIsCheckoutOpen(true)} 
          disabled={items.length === 0 || isSubmitting}
          className="flex items-center gap-1 font-bold tracking-wide hover:bg-orange-600 p-2 rounded-lg transition-colors disabled:opacity-50"
        >
          {isSubmitting ? '...' : successMsg ? 'OK' : 'FERTIG'}
          {!isSubmitting && !successMsg && <Check className="w-5 h-5" />}
        </button>
      </div>

      {/* Cart List (White background) */}
      <div className="flex-1 overflow-y-auto bg-white pb-2 touch-pan-y">
        {items.length === 0 ? (
          <div className="text-center text-slate-400 mt-10">Warenkorb ist leer</div>
        ) : (
          <div className="divide-y divide-slate-200">
            {items.map(item => (
              <CartItem key={item.id} item={item} removeItem={removeItem} />
            ))}
          </div>
        )}
      </div>

      {/* Category Slider */}
      <div className="shrink-0 bg-slate-900 overflow-x-auto whitespace-nowrap scrollbar-hide border-t-4 border-slate-800 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.1)]">
        <div className="flex p-2 gap-2">
          <button
            onClick={() => setSelectedCategory(null)}
            className={`px-4 py-2 rounded-xl font-bold transition-colors ${!selectedCategory ? 'bg-orange-500 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}
          >
            Alle
          </button>
          {categories.map(cat => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-4 py-2 rounded-xl font-bold transition-colors ${selectedCategory === cat ? 'bg-orange-500 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Product Grid (Kacheln) */}
      <div className="h-[45vh] bg-slate-800 overflow-y-auto shrink-0 overscroll-contain">
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-1 p-1">
          {filteredProducts.map(p => (
            <button
              key={p.id}
              onClick={() => handleProductClick(p)}
              style={{ backgroundColor: p.color || '#334155' }}
              className="aspect-square flex flex-col justify-center items-center text-center p-2 hover:opacity-80 active:opacity-60 transition-opacity rounded-md"
            >
              <span className="text-white font-bold drop-shadow-md text-sm md:text-base leading-tight">
                {p.shortName || p.name}
              </span>
            </button>
          ))}
        </div>
      </div>

      <CheckoutModal
        isOpen={isCheckoutOpen}
        total={total}
        initialTableName={tableName}
        onClose={() => setIsCheckoutOpen(false)}
        onConfirm={handleCheckoutSubmit}
      />

      <ProductOptionsModal
        product={selectedProductForOptions}
        isOpen={!!selectedProductForOptions}
        onClose={() => setSelectedProductForOptions(null)}
        onAdd={addItem}
      />
    </div>
  );
};
