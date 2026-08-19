import { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';
import { 
  Users, 
  LayoutDashboard, 
  Calendar, 
  Store, 
  Tag, 
  Package, 
  Plus, 
  Edit2, 
  Trash2, 
  Map, 
  ShieldAlert, 
  CheckCircle2, 
  Play, 
  Pause, 
  Square, 
  Eraser, 
  Sparkles,
  AlertTriangle,
  Info
} from 'lucide-react';

type Tab = 'events' | 'stations' | 'categories' | 'products' | 'users' | 'areas';

interface EventItem {
  id: string;
  name: string;
  organizer?: string;
  location?: string;
  startTime?: string;
  endTime?: string;
  timezone: string;
  status: 'DRAFT' | 'PREPARED' | 'TEST_MODE' | 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'ARCHIVED';
  testMode: boolean;
  rksvConfirmedAt?: string;
  rksvConfirmedByUserId?: string;
  rksvDisclaimerVersion?: string;
  _count?: {
    orders: number;
    products: number;
    stations: number;
    areas: number;
  };
}

export const AdminDashboard = () => {
  const [activeTab, setActiveTab] = useState<Tab>('events');
  const [data, setData] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [eventId, setEventId] = useState<string>('');
  
  // Generic Modal State (for Areas / Simple Items)
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<any>(null);
  const [formData, setFormData] = useState<{name: string, sortOrder: number}>({ name: '', sortOrder: 0 });

  // Event Modal State
  const [isEventModalOpen, setIsEventModalOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<EventItem | null>(null);
  const [eventFormData, setEventFormData] = useState({
    name: '',
    organizer: '',
    location: '',
    startTime: '',
    endTime: '',
    status: 'DRAFT',
    testMode: true
  });

  // RKSV Disclaimer Modal State
  const [rksvModalOpen, setRksvModalOpen] = useState(false);
  const [rksvTargetEvent, setRksvTargetEvent] = useState<EventItem | null>(null);
  const [rksvConfirmed, setRksvConfirmed] = useState(false);
  const [isActivating, setIsActivating] = useState(false);

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

  const fetchData = useCallback(async () => {
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
  }, [activeTab, eventId]);

  useEffect(() => {
    if (activeTab === 'events' || eventId) {
      fetchData();
    }
  }, [activeTab, eventId, fetchData]);

  const tabs = [
    { id: 'events', label: 'Veranstaltungen & Lifecycle', icon: Calendar },
    { id: 'areas', label: 'Bereiche', icon: Map },
    { id: 'stations', label: 'Stationen', icon: Store },
    { id: 'categories', label: 'Kategorien', icon: Tag },
    { id: 'products', label: 'Produkte', icon: Package },
    { id: 'users', label: 'Mitarbeiter', icon: Users },
  ] as const;

  const handleOpenModal = (item?: any) => {
    if (activeTab === 'events') {
      if (item) {
        setEditingEvent(item);
        setEventFormData({
          name: item.name || '',
          organizer: item.organizer || '',
          location: item.location || '',
          startTime: item.startTime ? item.startTime.slice(0, 16) : '',
          endTime: item.endTime ? item.endTime.slice(0, 16) : '',
          status: item.status || 'DRAFT',
          testMode: item.testMode || false
        });
      } else {
        setEditingEvent(null);
        setEventFormData({
          name: '',
          organizer: '',
          location: '',
          startTime: '',
          endTime: '',
          status: 'DRAFT',
          testMode: true
        });
      }
      setIsEventModalOpen(true);
      return;
    }

    if (item) {
      setEditingItem(item);
      setFormData({ name: item.name || '', sortOrder: item.sortOrder || 0 });
    } else {
      setEditingItem(null);
      setFormData({ name: '', sortOrder: 0 });
    }
    setIsModalOpen(true);
  };

  const handleSaveEvent = async () => {
    if (!eventFormData.name.trim()) {
      alert('Bitte einen Veranstaltungsnamen angeben.');
      return;
    }

    try {
      if (editingEvent) {
        await api.patch(`/events/${editingEvent.id}`, eventFormData);
      } else {
        const res = await api.post('/events', eventFormData);
        if (!eventId) setEventId(res.data.id);
      }
      setIsEventModalOpen(false);
      fetchData();
    } catch (err: any) {
      console.error('Failed to save event', err);
      alert('Fehler beim Speichern der Veranstaltung: ' + (err.response?.data?.message || err.message));
    }
  };

  const handleSave = async () => {
    if (activeTab !== 'areas') {
      alert("Speichern ist aktuell nur für Veranstaltungen und Bereiche (Areas) implementiert!");
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
    if (activeTab === 'events') {
      if (!confirm("Veranstaltung wirklich löschen? Alle zugehörigen Daten gehen verloren!")) return;
      try {
        await api.delete(`/events/${id}`);
        fetchData();
      } catch (err: any) {
        alert('Fehler beim Löschen: ' + (err.response?.data?.message || err.message));
      }
      return;
    }

    if (activeTab !== 'areas') {
      alert("Löschen ist aktuell nur für Veranstaltungen und Bereiche (Areas) implementiert!");
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

  // Event Lifecycle Actions
  const handleSetTestMode = async (event: EventItem) => {
    try {
      await api.patch(`/events/${event.id}/status`, { status: 'TEST_MODE' });
      fetchData();
    } catch (err: any) {
      alert('Fehler: ' + (err.response?.data?.message || err.message));
    }
  };

  const handlePauseEvent = async (event: EventItem) => {
    try {
      await api.patch(`/events/${event.id}/status`, { status: 'PAUSED' });
      fetchData();
    } catch (err: any) {
      alert('Fehler: ' + (err.response?.data?.message || err.message));
    }
  };

  const handleCompleteEvent = async (event: EventItem) => {
    if (!confirm(`Möchtest du '${event.name}' wirklich als abgeschlossen markieren?`)) return;
    try {
      await api.patch(`/events/${event.id}/status`, { status: 'COMPLETED' });
      fetchData();
    } catch (err: any) {
      alert('Fehler: ' + (err.response?.data?.message || err.message));
    }
  };

  const handleCleanTestData = async (event: EventItem) => {
    const ordersCount = event._count?.orders || 0;
    if (!confirm(`Sollen alle ${ordersCount} Testbestellungen, Zahlungen und Kassensitzungen für '${event.name}' unwiderruflich gelöscht werden?\n\nDie Produkt-, Bereichs- und Stationseinstellungen bleiben erhalten.`)) {
      return;
    }

    try {
      const res = await api.post(`/events/${event.id}/clean-test-data`);
      alert(res.data.message || 'Testdaten erfolgreich bereinigt.');
      fetchData();
    } catch (err: any) {
      alert('Fehler bei der Bereinigung: ' + (err.response?.data?.message || err.message));
    }
  };

  const handleOpenRksvModal = (event: EventItem) => {
    setRksvTargetEvent(event);
    setRksvConfirmed(false);
    setRksvModalOpen(true);
  };

  const handleConfirmActivate = async () => {
    if (!rksvTargetEvent) return;
    if (!rksvConfirmed) {
      alert('Bitte bestätige den rechtlichen Hinweis durch Anklicken der Checkbox.');
      return;
    }

    setIsActivating(true);
    try {
      await api.post(`/events/${rksvTargetEvent.id}/activate`, {
        confirmed: true,
        disclaimerVersion: '1.0'
      });
      setRksvModalOpen(false);
      fetchData();
      alert(`Festbetrieb für '${rksvTargetEvent.name}' erfolgreich scharfgeschaltet!`);
    } catch (err: any) {
      alert('Aktivierung fehlgeschlagen: ' + (err.response?.data?.message || err.message));
    } finally {
      setIsActivating(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'ACTIVE':
        return <span className="bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-2.5 py-1 rounded-xl text-xs font-bold flex items-center gap-1.5 w-fit"><span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>Echtbetrieb aktiv</span>;
      case 'TEST_MODE':
        return <span className="bg-amber-500/20 text-amber-300 border border-amber-500/30 px-2.5 py-1 rounded-xl text-xs font-bold flex items-center gap-1.5 w-fit"><Sparkles className="w-3.5 h-3.5" />Testmodus</span>;
      case 'PAUSED':
        return <span className="bg-blue-500/20 text-blue-300 border border-blue-500/30 px-2.5 py-1 rounded-xl text-xs font-bold flex items-center gap-1.5 w-fit"><Pause className="w-3.5 h-3.5" />Pausiert</span>;
      case 'COMPLETED':
        return <span className="bg-slate-800 text-slate-400 border border-slate-700 px-2.5 py-1 rounded-xl text-xs font-bold flex items-center gap-1.5 w-fit"><Square className="w-3.5 h-3.5" />Abgeschlossen</span>;
      default:
        return <span className="bg-slate-800/80 text-slate-300 px-2.5 py-1 rounded-xl text-xs font-semibold w-fit">{status}</span>;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-12 h-12 rounded-2xl bg-indigo-500/20 flex items-center justify-center border border-indigo-500/30">
          <LayoutDashboard className="w-6 h-6 text-indigo-400" />
        </div>
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-white to-slate-300 bg-clip-text text-transparent">
            Systemverwaltung & Events
          </h1>
          <p className="text-slate-400 text-sm">Festkonfiguration, rechtliche Bestätigungen und Stammdaten</p>
        </div>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
        {tabs.map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as Tab)}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-2xl font-bold text-sm transition-all whitespace-nowrap
                ${isActive ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30' : 'glass hover:bg-slate-800 text-slate-400'}
              `}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      <div className="glass rounded-3xl p-6 min-h-[500px] relative">
        <div className="flex justify-between items-center mb-6 pb-4 border-b border-slate-700/50">
          <div>
            <h2 className="text-xl font-bold capitalize">{tabs.find(t => t.id === activeTab)?.label}</h2>
            {activeTab === 'events' && (
              <p className="text-xs text-slate-400 mt-0.5">
                Verwalte Veranstaltungen, Testdaten und den rechtssicheren Feststart.
              </p>
            )}
          </div>
          <button 
            onClick={() => handleOpenModal()}
            className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-white px-4 py-2.5 rounded-xl font-bold transition-colors shadow-lg shadow-emerald-500/20 text-sm"
          >
            <Plus className="w-4 h-4" />
            {activeTab === 'events' ? 'Neue Veranstaltung' : 'Neu anlegen'}
          </button>
        </div>

        {isLoading ? (
          <div className="text-center py-20 text-slate-400 animate-pulse">Lade Daten...</div>
        ) : activeTab === 'events' ? (
          /* Events Dedicated Card / List View */
          <div className="space-y-4">
            {data.map((evt: EventItem) => (
              <div 
                key={evt.id} 
                className={`p-5 rounded-2xl border transition-all ${
                  evt.status === 'ACTIVE' 
                    ? 'bg-slate-900/90 border-emerald-500/40 shadow-lg shadow-emerald-500/5' 
                    : 'bg-slate-900/50 border-slate-800 hover:border-slate-700'
                }`}
              >
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center gap-3">
                      <h3 className="text-lg font-bold text-white">{evt.name}</h3>
                      {getStatusBadge(evt.status)}
                      {evt.rksvConfirmedAt && (
                        <span className="bg-indigo-500/10 text-indigo-300 border border-indigo-500/20 px-2 py-0.5 rounded-lg text-xs flex items-center gap-1 font-medium">
                          <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                          RKSV-Ausschluss bestätigt ({new Date(evt.rksvConfirmedAt).toLocaleDateString('de-AT')})
                        </span>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-4 text-xs text-slate-400">
                      {evt.organizer && <span>Veranstalter: <strong className="text-slate-300">{evt.organizer}</strong></span>}
                      {evt.location && <span>Ort: <strong className="text-slate-300">{evt.location}</strong></span>}
                      {evt.startTime && (
                        <span>Zeitraum: <strong className="text-slate-300">{new Date(evt.startTime).toLocaleString('de-AT', { dateStyle: 'short', timeStyle: 'short' })}</strong></span>
                      )}
                      <span>Bestellungen: <strong className="text-slate-300">{evt._count?.orders || 0}</strong></span>
                      <span>Artikel: <strong className="text-slate-300">{evt._count?.products || 0}</strong></span>
                    </div>
                  </div>

                  {/* Lifecycle Actions */}
                  <div className="flex flex-wrap items-center gap-2">
                    {evt.status !== 'ACTIVE' && (
                      <button
                        onClick={() => handleOpenRksvModal(evt)}
                        className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition flex items-center gap-1.5 shadow-md shadow-emerald-600/20"
                        title="Echtbetrieb starten (Rechtliche RKSV-Bestätigung erforderlich)"
                      >
                        <Play className="w-3.5 h-3.5" />
                        Scharf schalten (Echtbetrieb)
                      </button>
                    )}

                    {evt.status !== 'TEST_MODE' && evt.status !== 'ACTIVE' && (
                      <button
                        onClick={() => handleSetTestMode(evt)}
                        className="px-3 py-2 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 text-xs font-bold transition flex items-center gap-1.5 border border-amber-500/30"
                      >
                        <Sparkles className="w-3.5 h-3.5" />
                        Testmodus
                      </button>
                    )}

                    {evt.status === 'ACTIVE' && (
                      <button
                        onClick={() => handlePauseEvent(evt)}
                        className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold transition flex items-center gap-1.5"
                      >
                        <Pause className="w-3.5 h-3.5" />
                        Pausieren
                      </button>
                    )}

                    {evt.status !== 'COMPLETED' && evt.status !== 'ARCHIVED' && (
                      <button
                        onClick={() => handleCompleteEvent(evt)}
                        className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold transition flex items-center gap-1.5"
                      >
                        <Square className="w-3.5 h-3.5" />
                        Abschließen
                      </button>
                    )}

                    {(evt.testMode || evt._count?.orders! > 0) && evt.status !== 'ACTIVE' && (
                      <button
                        onClick={() => handleCleanTestData(evt)}
                        className="px-3 py-2 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 text-xs font-bold transition flex items-center gap-1.5 border border-rose-500/30"
                        title="Alle Testbestellungen und Testkassenstände löschen"
                      >
                        <Eraser className="w-3.5 h-3.5" />
                        Testdaten bereinigen
                      </button>
                    )}

                    <button 
                      onClick={() => handleOpenModal(evt)}
                      className="p-2 bg-slate-800 hover:bg-slate-700 rounded-xl text-slate-300 transition-colors inline-flex"
                      title="Bearbeiten"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>

                    <button 
                      onClick={() => handleDelete(evt.id)}
                      className="p-2 bg-rose-500/20 hover:bg-rose-500/40 rounded-xl text-rose-400 transition-colors inline-flex"
                      title="Löschen"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
            {data.length === 0 && (
              <div className="text-center py-12 text-slate-500">
                Noch keine Veranstaltungen angelegt.
              </div>
            )}
          </div>
        ) : (
          /* Standard Tables (Areas, Stations, etc.) */
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

      {/* RKSV Legal Confirmation Modal */}
      {rksvModalOpen && rksvTargetEvent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-md p-4 animate-fade-in">
          <div className="bg-slate-900 border border-slate-700 rounded-3xl p-6 md:p-8 w-full max-w-xl shadow-2xl space-y-6">
            <div className="flex items-center gap-3 text-amber-400">
              <div className="w-12 h-12 rounded-2xl bg-amber-500/20 flex items-center justify-center border border-amber-500/30">
                <ShieldAlert className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-white">Rechtliche Bestätigung vor Feststart</h3>
                <p className="text-xs text-slate-400">Veranstaltung: <strong className="text-slate-200">{rksvTargetEvent.name}</strong></p>
              </div>
            </div>

            <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-5 space-y-3">
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
                <div className="text-sm text-slate-200 font-semibold leading-relaxed">
                  „VereinOrder ist keine RKSV-Registrierkasse. Der Veranstalter ist selbst dafür verantwortlich zu prüfen, ob für diese Veranstaltung Einzelaufzeichnungs-, Belegerteilungs- oder Registrierkassenpflichten bestehen.“
                </div>
              </div>

              <div className="text-xs text-slate-400 pt-2 border-t border-amber-500/20 flex items-center justify-between">
                <span>Dokumentation: BMF & USP Österreich</span>
                <span className="font-mono">Hinweis-Version: 1.0</span>
              </div>
            </div>

            <div className="bg-slate-950 border border-slate-800 rounded-2xl p-4 text-xs text-slate-400 space-y-1.5">
              <div className="flex items-center gap-2 font-medium text-slate-300">
                <Info className="w-4 h-4 text-indigo-400" />
                Revisionssichere Archivierung:
              </div>
              <p>
                Mit deiner Bestätigung wird dieser Vorgang unveränderlich im Audit-Log mit Datum, Uhrzeit, deinem Benutzerkonto und der Anwendungsversion protokolliert.
              </p>
            </div>

            <label className="flex items-start gap-3 cursor-pointer p-3 rounded-xl hover:bg-slate-800/40 transition">
              <input
                type="checkbox"
                checked={rksvConfirmed}
                onChange={(e) => setRksvConfirmed(e.target.checked)}
                className="w-5 h-5 rounded mt-0.5 accent-indigo-600 cursor-pointer"
              />
              <span className="text-xs text-slate-300 font-medium">
                Ich habe den rechtlichen Hinweis verstanden und bestätige die Aktivierung des Festbetriebs auf eigene Verantwortung des Veranstalters.
              </span>
            </label>

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => setRksvModalOpen(false)}
                disabled={isActivating}
                className="flex-1 px-4 py-3 rounded-xl font-bold bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors text-sm"
              >
                Abbrechen
              </button>
              <button
                type="button"
                onClick={handleConfirmActivate}
                disabled={!rksvConfirmed || isActivating}
                className="flex-1 px-4 py-3 rounded-xl font-bold bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white transition-colors text-sm shadow-lg shadow-emerald-600/30 flex items-center justify-center gap-2"
              >
                <CheckCircle2 className="w-4 h-4" />
                {isActivating ? 'Aktivieren...' : 'Verbindlich Aktivieren'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Event Create / Edit Modal */}
      {isEventModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-3xl p-6 w-full max-w-lg shadow-2xl animate-slide-up space-y-4">
            <h3 className="text-xl font-bold">
              {editingEvent ? 'Veranstaltung bearbeiten' : 'Neue Veranstaltung anlegen'}
            </h3>

            <div className="space-y-3 text-sm">
              <div>
                <label className="block font-medium text-slate-400 mb-1">Veranstaltungsname *</label>
                <input
                  type="text"
                  required
                  value={eventFormData.name}
                  onChange={(e) => setEventFormData({ ...eventFormData, name: e.target.value })}
                  placeholder="z.B. Feuerwehrfest 2026"
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 focus:outline-none focus:border-indigo-500 text-slate-200"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-400 mb-1">Veranstalter</label>
                  <input
                    type="text"
                    value={eventFormData.organizer}
                    onChange={(e) => setEventFormData({ ...eventFormData, organizer: e.target.value })}
                    placeholder="z.B. FF Musterdorf"
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 focus:outline-none focus:border-indigo-500 text-slate-200"
                  />
                </div>

                <div>
                  <label className="block font-medium text-slate-400 mb-1">Ort</label>
                  <input
                    type="text"
                    value={eventFormData.location}
                    onChange={(e) => setEventFormData({ ...eventFormData, location: e.target.value })}
                    placeholder="z.B. Festzelt Hauptplatz"
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 focus:outline-none focus:border-indigo-500 text-slate-200"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-400 mb-1">Startzeit</label>
                  <input
                    type="datetime-local"
                    value={eventFormData.startTime}
                    onChange={(e) => setEventFormData({ ...eventFormData, startTime: e.target.value })}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 focus:outline-none focus:border-indigo-500 text-slate-200"
                  />
                </div>

                <div>
                  <label className="block font-medium text-slate-400 mb-1">Endzeit</label>
                  <input
                    type="datetime-local"
                    value={eventFormData.endTime}
                    onChange={(e) => setEventFormData({ ...eventFormData, endTime: e.target.value })}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 focus:outline-none focus:border-indigo-500 text-slate-200"
                  />
                </div>
              </div>
            </div>

            <div className="flex gap-3 pt-4 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setIsEventModalOpen(false)}
                className="flex-1 px-4 py-2.5 rounded-xl font-bold bg-slate-800 hover:bg-slate-700 transition-colors text-sm"
              >
                Abbrechen
              </button>
              <button
                type="button"
                onClick={handleSaveEvent}
                className="flex-1 px-4 py-2.5 rounded-xl font-bold bg-indigo-600 hover:bg-indigo-500 text-white transition-colors text-sm shadow-lg shadow-indigo-600/30"
              >
                Speichern
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Generic Area / Item Modal */}
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
