import { useState, useEffect } from 'react';
import { X, Delete, History, MapPin, Search } from 'lucide-react';
import { api } from '../lib/api';

interface TableSelectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (tableName: string) => void;
  eventId: string | null;
}

export const TableSelectionModal = ({ isOpen, onClose, onSelect, eventId }: TableSelectionModalProps) => {
  const [inputValue, setInputValue] = useState('');
  const [areas, setAreas] = useState<any[]>([]);
  const [recentTables, setRecentTables] = useState<string[]>([]);

  useEffect(() => {
    if (isOpen) {
      setInputValue('');
      loadAreas();
      loadRecentTables();
    }
  }, [isOpen, eventId]);

  const loadAreas = async () => {
    if (!eventId) return;
    try {
      const res = await api.get(`/areas?eventId=${eventId}`);
      setAreas(res.data);
    } catch (err) {
      console.error('Failed to load areas', err);
    }
  };

  const loadRecentTables = () => {
    try {
      const stored = localStorage.getItem('vereinorder_recent_tables');
      if (stored) {
        setRecentTables(JSON.parse(stored));
      }
    } catch (err) {
      console.error('Failed to load recent tables', err);
    }
  };

  const saveRecentTable = (table: string) => {
    if (!table || table === 'Abholung') return;
    try {
      let updated = [table, ...recentTables.filter(t => t !== table)].slice(0, 5);
      localStorage.setItem('vereinorder_recent_tables', JSON.stringify(updated));
      setRecentTables(updated);
    } catch (err) {
      // Ignore
    }
  };

  const handleNumpad = (val: string) => {
    setInputValue(prev => prev + val);
  };

  const handleBackspace = () => {
    setInputValue(prev => prev.slice(0, -1));
  };

  const handleAreaSelect = (areaName: string) => {
    setInputValue(areaName + ' ');
  };

  const handleSubmit = (tableToSubmit: string = inputValue) => {
    const finalTable = tableToSubmit.trim();
    if (finalTable) {
      saveRecentTable(finalTable);
      onSelect(finalTable);
      onClose();
    }
  };

  const handleTakeaway = () => {
    onSelect('Abholung');
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-slate-900/95 backdrop-blur-sm animate-fade-in touch-none">
      <div className="flex justify-between items-center p-4 border-b border-slate-800 bg-slate-900">
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <MapPin className="text-indigo-400 w-6 h-6" />
          Tisch / Bereich
        </h2>
        <button onClick={onClose} className="p-2 rounded-full bg-slate-800 text-slate-400 hover:text-white transition-colors">
          <X className="w-6 h-6" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        
        {/* Input Field */}
        <div className="bg-slate-800 p-4 rounded-2xl flex items-center shadow-inner">
          <Search className="w-6 h-6 text-slate-500 mr-3" />
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            className="bg-transparent text-3xl font-bold text-white w-full focus:outline-none"
            placeholder="z.B. 12 oder Bar"
            autoFocus
          />
          {inputValue && (
            <button onClick={() => setInputValue('')} className="p-2 text-slate-400 hover:text-white">
              <X className="w-6 h-6" />
            </button>
          )}
        </div>

        {/* Areas Quick Select */}
        {areas.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">Bereiche</h3>
            <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
              {areas.map(a => (
                <button
                  key={a.id}
                  onClick={() => handleAreaSelect(a.name)}
                  className="shrink-0 bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 px-5 py-3 rounded-xl font-bold whitespace-nowrap active:bg-indigo-500/40 transition-colors"
                >
                  {a.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Recent Tables */}
        {recentTables.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1">
              <History className="w-4 h-4" /> Zuletzt verwendet
            </h3>
            <div className="flex flex-wrap gap-2">
              {recentTables.map(t => (
                <button
                  key={t}
                  onClick={() => handleSubmit(t)}
                  className="bg-slate-800 text-slate-300 border border-slate-700 px-4 py-2 rounded-lg font-medium active:bg-slate-700 transition-colors"
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Numpad */}
        <div className="grid grid-cols-3 gap-3 mt-auto pt-6">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(num => (
            <button
              key={num}
              onClick={() => handleNumpad(num.toString())}
              className="bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-white text-3xl font-bold py-6 rounded-2xl transition-colors shadow-sm"
            >
              {num}
            </button>
          ))}
          <button
            onClick={handleTakeaway}
            className="bg-orange-500/20 hover:bg-orange-500/30 active:bg-orange-500/40 text-orange-400 text-lg font-bold py-6 rounded-2xl transition-colors shadow-sm flex flex-col items-center justify-center gap-1"
          >
            Abholung
          </button>
          <button
            onClick={() => handleNumpad('0')}
            className="bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-white text-3xl font-bold py-6 rounded-2xl transition-colors shadow-sm"
          >
            0
          </button>
          <button
            onClick={handleBackspace}
            className="bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-slate-400 text-2xl font-bold py-6 rounded-2xl transition-colors shadow-sm flex items-center justify-center"
          >
            <Delete className="w-8 h-8" />
          </button>
        </div>
      </div>

      {/* Footer / Submit */}
      <div className="p-4 bg-slate-900 border-t border-slate-800 pb-safe">
        <button
          onClick={() => handleSubmit()}
          disabled={!inputValue.trim()}
          className="w-full bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 disabled:hover:bg-emerald-500 text-white text-xl font-bold py-4 rounded-2xl shadow-lg shadow-emerald-500/20 transition-all active:scale-[0.98]"
        >
          Übernehmen
        </button>
      </div>
    </div>
  );
};
