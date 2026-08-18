import { useState } from 'react';
import { X, Coins, CreditCard, Clock, SplitSquareHorizontal } from 'lucide-react';

interface CheckoutModalProps {
  isOpen: boolean;
  total: number;
  onClose: () => void;
  onConfirm: (payments: { amount: number; method: 'CASH' | 'CARD' | 'VOUCHER' }[]) => void;
}

export const CheckoutModal = ({ isOpen, total, onClose, onConfirm }: CheckoutModalProps) => {
  const [mode, setMode] = useState<'SELECT' | 'SPLIT'>('SELECT');
  const [cashAmount, setCashAmount] = useState<number>(0);

  if (!isOpen) return null;

  const formatPrice = (cents: number) => `€ ${(cents / 100).toFixed(2)}`;

  const handleFullPayment = (method: 'CASH' | 'CARD') => {
    onConfirm([{ amount: total, method }]);
  };

  const handlePayLater = () => {
    onConfirm([]); // No payments immediately
  };

  const handleSplitSubmit = () => {
    if (cashAmount <= 0 || cashAmount >= total) return;
    const cardAmount = total - cashAmount;
    onConfirm([
      { amount: cashAmount, method: 'CASH' },
      { amount: cardAmount, method: 'CARD' }
    ]);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm">
      <div className="glass rounded-3xl w-full max-w-md p-6 relative animate-in fade-in zoom-in-95 duration-200">
        <button 
          onClick={onClose}
          className="absolute right-6 top-6 text-slate-400 hover:text-white transition-colors"
        >
          <X className="w-6 h-6" />
        </button>

        <h2 className="text-2xl font-bold mb-2">Abrechnung</h2>
        <div className="text-3xl font-bold text-indigo-400 mb-8">{formatPrice(total)}</div>

        {mode === 'SELECT' ? (
          <div className="space-y-3">
            <button
              onClick={() => handleFullPayment('CASH')}
              className="w-full flex items-center gap-4 bg-slate-800/50 hover:bg-slate-700 p-4 rounded-2xl transition-all border border-slate-700/50"
            >
              <div className="bg-emerald-500/20 p-3 rounded-xl text-emerald-400"><Coins className="w-6 h-6" /></div>
              <div className="text-left font-semibold text-lg">Barzahlung</div>
            </button>
            <button
              onClick={() => handleFullPayment('CARD')}
              className="w-full flex items-center gap-4 bg-slate-800/50 hover:bg-slate-700 p-4 rounded-2xl transition-all border border-slate-700/50"
            >
              <div className="bg-blue-500/20 p-3 rounded-xl text-blue-400"><CreditCard className="w-6 h-6" /></div>
              <div className="text-left font-semibold text-lg">Kartenzahlung</div>
            </button>
            <button
              onClick={() => setMode('SPLIT')}
              className="w-full flex items-center gap-4 bg-slate-800/50 hover:bg-slate-700 p-4 rounded-2xl transition-all border border-slate-700/50"
            >
              <div className="bg-purple-500/20 p-3 rounded-xl text-purple-400"><SplitSquareHorizontal className="w-6 h-6" /></div>
              <div className="text-left font-semibold text-lg">Zahlung splitten</div>
            </button>
            <div className="py-2 border-t border-slate-700/50 mt-4">
              <button
                onClick={handlePayLater}
                className="w-full flex items-center gap-4 bg-slate-800/50 hover:bg-slate-700 p-4 rounded-2xl transition-all border border-slate-700/50"
              >
                <div className="bg-orange-500/20 p-3 rounded-xl text-orange-400"><Clock className="w-6 h-6" /></div>
                <div className="text-left font-semibold text-lg">Später bezahlen (Tisch)</div>
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-slate-400 mb-2">Bar gezahlt (in €)</label>
              <input 
                type="number"
                step="0.01"
                min="0"
                max={total / 100}
                className="w-full bg-slate-900 border border-slate-700 rounded-xl p-4 text-2xl font-bold"
                value={cashAmount ? cashAmount / 100 : ''}
                onChange={e => setCashAmount(Math.round(parseFloat(e.target.value) * 100))}
                autoFocus
              />
            </div>
            
            <div className="bg-slate-800/50 p-4 rounded-xl flex justify-between items-center border border-slate-700/50">
              <span className="text-slate-400 font-medium">Rest auf Karte:</span>
              <span className="text-2xl font-bold text-blue-400">
                {formatPrice(Math.max(0, total - cashAmount))}
              </span>
            </div>

            <div className="flex gap-3">
              <button 
                onClick={() => setMode('SELECT')}
                className="flex-1 py-4 bg-slate-800 hover:bg-slate-700 rounded-xl font-bold transition-colors"
              >
                Zurück
              </button>
              <button 
                onClick={handleSplitSubmit}
                disabled={cashAmount <= 0 || cashAmount >= total}
                className="flex-1 py-4 bg-gradient-to-r from-indigo-500 to-indigo-600 hover:from-indigo-400 hover:to-indigo-500 rounded-xl font-bold transition-colors disabled:opacity-50"
              >
                Bestätigen
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
