import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { Users, LayoutDashboard, Calendar, Store, Tag, Package, Plus, Edit2, Trash2, Map } from 'lucide-react';

type Tab = 'events' | 'stations' | 'categories' | 'products' | 'users' | 'areas';

export const AdminDashboard = () => {
  const [activeTab, setActiveTab] = useState<Tab>('events');
  const [data, setData] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [eventId, setEventId] = useState<string>('');
  
  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<any>(null);
  const [formData, setFormData] = useState<{name: string, sortOrder: number}>({ name: '', sortOrder: 0 });

  // Fetch a valid eventId on mount
  useEffect(() => {
    const fetchEvent = async () => {
      try {
        const res = await api.get('/events');
        if (res.data && res.data.length > 0) {
          setEventId(res.data[0].id);
        }
      } catch (err) {
        console.error('Failed to load initial event', err);
      }
    };
    fetchEvent();
  }, []);

  useEffect(() => {
    if (activeTab === 'events' || eventId) {
      fetchData();
    }
  }, [activeTab, eventId]);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      let endpoint = '';
      if (activeTab === 'events') endpoint = '/events';
      if (activeTab === 'stations') endpoint = `/stations/admin/all?eventId=${eventId}`;
      if (activeTab === 'categories') endpoint = `/categories?eventId=${eventId}`;
      if (activeTab === 'products') endpoint = `/products/admin?eventId=${eventId}`;
      if (activeTab === 'users') endpoint = '/users';
      if (activeTab === 'areas') endpoint = `/areas?eventId=${eventId}`;

      const res = await api.get(endpoint);
      setData(res.data);
    } catch (err) {
      console.error(`Failed to load ${activeTab}`, err);
    } finally {
      setIsLoading(false);
    }
  };

  const tabs = [
    { id: 'events', label: 'Events', icon: Calendar },
    { id: 'stations', label: 'Stationen', icon: Store },
    { id: 'categories', label: 'Kategorien', icon: Tag },
    { id: 'products', label: 'Produkte', icon: Package },
    { id: 'users', label: 'Mitarbeiter', icon: Users },
    { id: 'areas', label: 'Bereiche', icon: Map },
  ] as const;

  const handleOpenModal = (item?: any) => {
    if (item) {
      setEditingItem(item);
      setFormData({ name: item.name || '', sortOrder: item.sortOrder || 0 });
    } else {
      setEditingItem(null);
      setFormData({ name: '', sortOrder: 0 });
    }
    setIsModalOpen(true);
  };

  const handleSave = async () => {
    // Currently only implemented for 'areas' as MVP
    if (activeTab !== 'areas') {
      alert("Speichern ist aktuell nur für Bereiche (Areas) implementiert!");
      return;
    }

    try {
      if (editingItem) {
        await api.patch(`/areas/${editingItem.id}`, formData);
      } else {
        await api.post('/areas', { ...formData, eventId });
      }
      setIsModalOpen(false);
      fetchData();
    } catch (err) {
      console.error("Failed to save", err);
      alert("Fehler beim Speichern");
    }
  };

  const handleDelete = async (id: string) => {
    if (activeTab !== 'areas') {
      alert("Löschen ist aktuell nur für Bereiche (Areas) implementiert!");
      return;
    }
    if (!confirm("Wirklich löschen?")) return;

    try {
      await api.delete(`/areas/${id}`);
      fetchData();
    } catch (err) {
      console.error("Failed to delete", err);
      alert("Fehler beim Löschen");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 mb-6">
        <LayoutDashboard className="w-8 h-8 text-indigo-400" />
        <h1 className="text-3xl font-bold">Verwaltung</h1>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
        {tabs.map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as Tab)}
              className={`flex items-center gap-2 px-6 py-3 rounded-2xl font-bold transition-all whitespace-nowrap
                ${isActive ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/20' : 'glass hover:bg-slate-800 text-slate-400'}
              `}
            >
              <Icon className="w-5 h-5" />
              {tab.label}
            </button>
          );
        })}
      </div>

      <div className="glass rounded-3xl p-6 min-h-[500px] relative">
        <div className="flex justify-between items-center mb-6 pb-4 border-b border-slate-700/50">
          <h2 className="text-xl font-bold capitalize">{activeTab}</h2>
          <button 
            onClick={() => handleOpenModal()}
            className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-white px-4 py-2 rounded-xl font-bold transition-colors"
          >
            <Plus className="w-5 h-5" />
            Neu anlegen
          </button>
        </div>

        {isLoading ? (
          <div className="text-center py-20 text-slate-400 animate-pulse">Lade Daten...</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="text-slate-400 border-b border-slate-700/50">
                  <th className="pb-3 font-medium">Name</th>
                  <th className="pb-3 font-medium">Status / Info</th>
                  <th className="pb-3 font-medium text-right">Aktionen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/50">
                {data.map((item: any) => (
                  <tr key={item.id} className="hover:bg-slate-800/30 transition-colors">
                    <td className="py-4 font-semibold">{item.name || item.username}</td>
                    <td className="py-4 text-sm text-slate-400">
                      {item.role && <span className="bg-indigo-500/20 text-indigo-300 px-2 py-1 rounded-md mr-2">{item.role}</span>}
                      {item.status && <span className="bg-slate-800 px-2 py-1 rounded-md">{item.status}</span>}
                      {item.isActive !== undefined && (
                        <span className={item.isActive ? 'text-emerald-400' : 'text-slate-500'}>
                          {item.isActive ? 'Aktiv' : 'Inaktiv'}
                        </span>
                      )}
                      {item.price !== undefined && `€ ${(item.price / 100).toFixed(2)}`}
                      {item.sortOrder !== undefined && `Sortierung: ${item.sortOrder}`}
                    </td>
                    <td className="py-4 text-right">
                      <button 
                        onClick={() => handleOpenModal(item)}
                        className="p-2 bg-slate-800 hover:bg-slate-700 rounded-lg text-slate-300 transition-colors inline-flex mr-2"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button 
                        onClick={() => handleDelete(item.id)}
                        className="p-2 bg-rose-500/20 hover:bg-rose-500/40 rounded-lg text-rose-400 transition-colors inline-flex"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
                {data.length === 0 && (
                  <tr>
                    <td colSpan={3} className="text-center py-10 text-slate-500">
                      Keine Einträge vorhanden
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-3xl p-6 w-full max-w-md shadow-2xl animate-slide-up">
            <h3 className="text-xl font-bold mb-4">{editingItem ? 'Eintrag bearbeiten' : 'Neu anlegen'}</h3>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-1">Name</label>
                <input 
                  type="text" 
                  value={formData.name}
                  onChange={(e) => setFormData({...formData, name: e.target.value})}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 focus:outline-none focus:border-indigo-500 transition-colors"
                  placeholder="z.B. Zelt"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-1">Sortierung</label>
                <input 
                  type="number" 
                  value={formData.sortOrder}
                  onChange={(e) => setFormData({...formData, sortOrder: parseInt(e.target.value) || 0})}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 focus:outline-none focus:border-indigo-500 transition-colors"
                />
              </div>
            </div>

            <div className="flex gap-3 mt-8">
              <button 
                onClick={() => setIsModalOpen(false)}
                className="flex-1 px-4 py-3 rounded-xl font-bold bg-slate-800 hover:bg-slate-700 transition-colors"
              >
                Abbrechen
              </button>
              <button 
                onClick={handleSave}
                className="flex-1 px-4 py-3 rounded-xl font-bold bg-indigo-500 hover:bg-indigo-400 transition-colors"
              >
                Speichern
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
