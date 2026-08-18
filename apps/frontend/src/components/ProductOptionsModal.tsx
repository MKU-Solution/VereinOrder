import { useState, useEffect } from 'react';
import { X, Check } from 'lucide-react';

interface ProductOptionsModalProps {
  product: any | null;
  isOpen: boolean;
  onClose: () => void;
  onAdd: (product: any, variant?: any, extras?: any[]) => void;
}

export const ProductOptionsModal = ({ product, isOpen, onClose, onAdd }: ProductOptionsModalProps) => {
  const [selectedVariant, setSelectedVariant] = useState<any>(null);
  const [selectedExtras, setSelectedExtras] = useState<any[]>([]);

  useEffect(() => {
    if (isOpen && product) {
      setSelectedVariant(product.variants?.length > 0 ? product.variants[0] : null);
      setSelectedExtras([]);
    }
  }, [isOpen, product]);

  if (!isOpen || !product) return null;

  const handleAdd = () => {
    onAdd(product, selectedVariant, selectedExtras);
    onClose();
  };

  const toggleExtra = (extra: any) => {
    if (selectedExtras.find(e => e.id === extra.id)) {
      setSelectedExtras(selectedExtras.filter(e => e.id !== extra.id));
    } else {
      setSelectedExtras([...selectedExtras, extra]);
    }
  };

  const formatPrice = (cents: number) => `+ € ${(cents / 100).toFixed(2)}`;
  const formatAbsPrice = (cents: number) => `€ ${(cents / 100).toFixed(2)}`;

  const hasVariants = product.variants && product.variants.length > 0;
  const hasExtras = product.extras && product.extras.length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4">
      <div className="bg-slate-900 rounded-3xl w-full max-w-md p-6 relative animate-in slide-in-from-bottom-10 sm:zoom-in-95 duration-200 shadow-2xl border border-slate-700">
        <button onClick={onClose} className="absolute right-4 top-4 text-slate-400 hover:text-white p-2">
          <X className="w-6 h-6" />
        </button>

        <h2 className="text-2xl font-bold mb-1 text-white">{product.name}</h2>
        <div className="text-indigo-400 font-bold mb-6">Basis: {formatAbsPrice(product.price)}</div>

        {hasVariants && (
          <div className="mb-6">
            <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-3">Variante wählen</h3>
            <div className="grid grid-cols-2 gap-3">
              {product.variants.map((v: any) => (
                <button
                  key={v.id}
                  onClick={() => setSelectedVariant(v)}
                  className={`p-3 rounded-xl border-2 transition-all text-left ${selectedVariant?.id === v.id ? 'border-indigo-500 bg-indigo-500/20 text-white' : 'border-slate-700 bg-slate-800 text-slate-300'}`}
                >
                  <div className="font-bold">{v.name}</div>
                  <div className="text-sm opacity-80">{formatAbsPrice(v.price)}</div>
                </button>
              ))}
            </div>
          </div>
        )}

        {hasExtras && (
          <div className="mb-8">
            <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-3">Extras</h3>
            <div className="space-y-2 max-h-48 overflow-y-auto pr-2">
              {product.extras.map((e: any) => {
                const isSelected = selectedExtras.some(x => x.id === e.id);
                return (
                  <button
                    key={e.id}
                    onClick={() => toggleExtra(e)}
                    className={`w-full p-3 flex justify-between items-center rounded-xl border-2 transition-all ${isSelected ? 'border-emerald-500 bg-emerald-500/20 text-white' : 'border-slate-700 bg-slate-800 text-slate-300'}`}
                  >
                    <span className="font-bold">{e.name}</span>
                    <span className="flex items-center gap-2 text-sm opacity-90">
                      {e.price !== 0 ? formatPrice(e.price) : 'Kostenlos'}
                      <div className={`w-5 h-5 rounded flex items-center justify-center border ${isSelected ? 'bg-emerald-500 border-emerald-500' : 'border-slate-500'}`}>
                        {isSelected && <Check className="w-3 h-3 text-white" />}
                      </div>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <button
          onClick={handleAdd}
          className="w-full bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-400 hover:to-orange-500 text-white font-bold py-4 rounded-2xl shadow-lg active:scale-95 transition-all flex justify-center items-center gap-2 text-lg"
        >
          Hinzufügen <Check className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
};
