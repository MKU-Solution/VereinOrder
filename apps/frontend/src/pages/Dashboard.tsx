import { useEffect, useState, useMemo } from 'react';
import { api } from '../lib/api';
import { useCartStore, CartItem as CartItemType } from '../store/useCartStore';
import { Trash2, Check, ArrowLeft, LayoutGrid, List, Minus } from 'lucide-react';
import { CheckoutModal } from '../components/CheckoutModal';
import { ProductOptionsModal } from '../components/ProductOptionsModal';

const formatPrice = (cents: number) => `€ ${(cents / 100).toFixed(2)}`;

// Sub-Komponente für Swipe-to-Delete/Reduce
const CartItem = ({ item, removeItem, deleteItem }: { item: CartItemType, removeItem: (id: string) => void, deleteItem: (id: string) => void }) => {
  const [translateX, setTranslateX] = useState(0);
  const [startX, setStartX] = useState(0);

  const onTouchStart = (e: React.TouchEvent) => setStartX(e.touches[0].clientX);
  
  const onTouchMove = (e: React.TouchEvent) => {
    const currentX = e.touches[0].clientX;
    const diff = currentX - startX;
    if (diff < 0) {
      setTranslateX(Math.max(-140, diff));
    }
  };
  
  const onTouchEnd = () => {
    if (translateX < -70) {
      setTranslateX(-140);
    } else {
      setTranslateX(0); 
    }
  };

  return (
    <div className="relative overflow-hidden border-b border-slate-200">
      <div className="absolute inset-y-0 right-0 w-[140px] flex">
        <button 
          onClick={() => { removeItem(item.id); setTranslateX(0); }}
          className="w-[70px] bg-yellow-500 flex items-center justify-center text-white transition-opacity active:opacity-70"
          aria-label="Menge reduzieren"
        >
          <Minus className="w-6 h-6" />
        </button>
        <button 
          onClick={() => { deleteItem(item.id); setTranslateX(0); }}
          className="w-[70px] bg-red-500 flex items-center justify-center text-white transition-opacity active:opacity-70"
          aria-label="Position löschen"
        >
          <Trash2 className="w-6 h-6" />
        </button>
      </div>
      <div 
        className="flex justify-between items-center p-3 bg-white relative transition-transform"
        style={{ transform: `translateX(${translateX}px)` }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onClick={() => setTranslateX(0)}
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

const categoryColors = [
  '#3b82f6', // blue
  '#ef4444', // red
  '#10b981', // emerald
  '#f59e0b', // amber
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#06b6d4', // cyan
];

export const Dashboard = () => {
  const [products, setProducts] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [tableName, setTableName] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedProductForOptions, setSelectedProductForOptions] = useState<any | null>(null);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  const { items, addItem, removeItem, deleteItem, clearCart, total } = useCartStore();

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

  const getProductColor = (p: any) => {
    if (p.color) return p.color;
    if (p.category?.name) {
      const idx = categories.indexOf(p.category.name);
      if (idx !== -1) return categoryColors[idx % categoryColors.length];
    }
    return '#334155';
  };

  if (isLoading) return <div className="text-center py-20 animate-pulse text-slate-400">Lade Produkte...</div>;

  return (
    <div className="fixed inset-0 top-[64px] bg-white flex flex-col z-50 overflow-hidden">
      {/* Cart List (White background) */}
      <div className="flex-1 overflow-y-auto bg-white pb-2 touch-pan-y">
        {items.length === 0 ? (
          <div className="text-center text-slate-400 mt-10">Warenkorb ist leer</div>
        ) : (
          <div className="divide-y divide-slate-200">
            {items.map(item => (
              <CartItem key={item.id} item={item} removeItem={removeItem} deleteItem={deleteItem} />
            ))}
          </div>
        )}
      </div>

      {/* Category Slider & View Toggle */}
      <div className="shrink-0 bg-slate-900 flex items-center border-t-4 border-slate-800 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.1)]">
        <div className="flex-1 overflow-x-auto whitespace-nowrap scrollbar-hide">
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
        <button 
          onClick={() => setViewMode(prev => prev === 'grid' ? 'list' : 'grid')}
          className="p-3 mr-2 bg-slate-800 text-slate-300 rounded-xl hover:bg-slate-700 transition-colors"
          aria-label="Ansicht umschalten"
        >
          {viewMode === 'grid' ? <List className="w-5 h-5" /> : <LayoutGrid className="w-5 h-5" />}
        </button>
      </div>

      {/* Product List/Grid */}
      <div className="h-[40vh] bg-slate-800 overflow-y-auto shrink-0 overscroll-contain">
        {viewMode === 'grid' ? (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-1 p-1">
            {filteredProducts.map(p => (
              <button
                key={p.id}
                onClick={() => handleProductClick(p)}
                style={{ backgroundColor: getProductColor(p) }}
                className="aspect-square flex flex-col justify-center items-center text-center p-2 hover:opacity-80 active:opacity-60 transition-opacity rounded-md"
              >
                <span className="text-white font-bold drop-shadow-md text-sm md:text-base leading-tight">
                  {p.shortName || p.name}
                </span>
                <span className="text-white/80 text-xs mt-1 drop-shadow-md">{formatPrice(p.price)}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-1 p-1">
            {filteredProducts.map(p => (
              <button
                key={p.id}
                onClick={() => handleProductClick(p)}
                style={{ backgroundColor: getProductColor(p) }}
                className="flex justify-between items-center text-left p-4 hover:opacity-80 active:opacity-60 transition-opacity rounded-md"
              >
                <span className="text-white font-bold text-lg drop-shadow-md">
                  {p.name}
                </span>
                <span className="text-white font-bold text-lg drop-shadow-md">
                  {formatPrice(p.price)}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Bottom Action Bar (Orange) */}
      <div className="bg-orange-500 text-white p-3 flex justify-between items-center shadow-[0_-4px_10px_rgba(0,0,0,0.2)] shrink-0 h-[72px] pb-safe">
        <button onClick={clearCart} className="p-3 hover:bg-orange-600 rounded-full transition-colors" aria-label="Warenkorb leeren">
          <Trash2 className="w-6 h-6" />
        </button>
        
        <div className="flex-1 flex justify-center items-center gap-2 sm:gap-4 text-lg font-bold cursor-pointer hover:bg-orange-600 p-2 rounded-lg transition-colors mx-2" onClick={handleTableClick}>
          <span>{tableName ? tableName : 'Tisch?'}</span>
          <span className="opacity-60">|</span>
          <span>{formatPrice(total)}</span>
        </div>

        <button 
          onClick={() => setIsCheckoutOpen(true)} 
          disabled={items.length === 0 || isSubmitting}
          className="flex items-center gap-2 font-bold tracking-wide bg-white text-orange-600 hover:bg-orange-100 px-5 py-3 rounded-xl transition-colors disabled:opacity-50 disabled:bg-white/50"
        >
          {isSubmitting ? '...' : successMsg ? 'OK' : 'Zahlen'}
          {!isSubmitting && !successMsg && <Check className="w-5 h-5" />}
        </button>
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
