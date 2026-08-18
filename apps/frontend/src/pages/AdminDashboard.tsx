import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { Users, LayoutDashboard, Calendar, Store, Tag, Package, Plus, Edit2 } from 'lucide-react';

type Tab = 'events' | 'stations' | 'categories' | 'products' | 'users';

export const AdminDashboard = () => {
  const [activeTab, setActiveTab] = useState<Tab>('events');
  const [data, setData] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // We fetch a specific event's data if needed (for MVP assume eventId is fetched/hardcoded)
  const eventId = "TODO_MVP_EVENT_ID";

  useEffect(() => {
    fetchData();
  }, [activeTab]);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      let endpoint = '';
      if (activeTab === 'events') endpoint = '/events';
      if (activeTab === 'stations') endpoint = `/stations/admin/all?eventId=${eventId}`;
      if (activeTab === 'categories') endpoint = `/categories?eventId=${eventId}`;
      if (activeTab === 'products') endpoint = `/products/admin?eventId=${eventId}`;
      if (activeTab === 'users') endpoint = '/users';

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
  ] as const;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 mb-6">
        <LayoutDashboard className="w-8 h-8 text-indigo-400" />
        <h1 className="text-3xl font-bold">Verwaltung</h1>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-2">
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

      <div className="glass rounded-3xl p-6 min-h-[500px]">
        <div className="flex justify-between items-center mb-6 pb-4 border-b border-slate-700/50">
          <h2 className="text-xl font-bold capitalize">{activeTab}</h2>
          <button className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-white px-4 py-2 rounded-xl font-bold transition-colors">
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
                    </td>
                    <td className="py-4 text-right">
                      <button className="p-2 bg-slate-800 hover:bg-slate-700 rounded-lg text-slate-300 transition-colors inline-flex">
                        <Edit2 className="w-4 h-4" />
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
    </div>
  );
};
