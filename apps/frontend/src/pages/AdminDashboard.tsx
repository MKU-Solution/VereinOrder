import { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';
import { 
  Users, 
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
  Printer,
  HardDrive,
  Download,
  RotateCcw,
  ShieldCheck
} from 'lucide-react';

type Tab = 'events' | 'stations' | 'categories' | 'products' | 'users' | 'areas' | 'printers' | 'backups';

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

interface BackupItem {
  filename: string;
  sizeBytes: number;
  createdAt: string;
  checksumSha256: string;
  version: string;
  counts: Record<string, number>;
}

export const AdminDashboard = () => {
  const [activeTab, setActiveTab] = useState<Tab>('events');
  const [data, setData] = useState<any[]>([]);
  const [printersList, setPrintersList] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [eventId, setEventId] = useState<string>('');
  
  // Generic Modal State (for Areas / Simple Items)
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<any>(null);
  const [formData, setFormData] = useState<{name: string, sortOrder: number, printerId?: string}>({ name: '', sortOrder: 0 });

  // Printer Modal State
  const [isPrinterModalOpen, setIsPrinterModalOpen] = useState(false);
  const [editingPrinter, setEditingPrinter] = useState<any>(null);
  const [printerFormData, setPrinterFormData] = useState({
    name: '',
    type: 'CONSOLE',
    ipAddress: '',
    port: 9100
  });

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

  // Fetch a valid eventId and printers list on mount
  useEffect(() => {
    const fetchInitialData = async () => {
      try {
        const [eventsRes, printersRes] = await Promise.all([
          api.get('/events'),
          api.get('/print-jobs/printers')
        ]);
        if (eventsRes.data && eventsRes.data.length > 0) {
          setEventId(eventsRes.data[0].id);
        }
        if (printersRes.data) {
          setPrintersList(printersRes.data);
        }
      } catch (err) {
        console.error('Failed to load initial data', err);
      }
    };
    fetchInitialData();
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
      if (activeTab === 'printers') endpoint = '/print-jobs/printers';
      if (activeTab === 'backups') endpoint = '/backup/list';

      const res = await api.get(endpoint);
      setData(res.data);

      if (activeTab === 'printers') {
        setPrintersList(res.data);
      }
    } catch (err) {
      console.error(`Failed to load ${activeTab}`, err);
    } finally {
      setIsLoading(false);
    }
  }, [activeTab, eventId]);

  useEffect(() => {
    if (activeTab === 'events' || activeTab === 'printers' || activeTab === 'backups' || eventId) {
      fetchData();
    }
  }, [activeTab, eventId, fetchData]);

  const tabs = [
    { id: 'events', label: 'Veranstaltungen & Lifecycle', icon: Calendar },
    { id: 'areas', label: 'Bereiche', icon: Map },
    { id: 'stations', label: 'Stationen', icon: Store },
    { id: 'printers', label: 'Drucker & Bon-Routing', icon: Printer },
    { id: 'backups', label: 'Backups & Datensicherung', icon: HardDrive },
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
    } else if (activeTab === 'printers') {
      if (item) {
        setEditingPrinter(item);
        setPrinterFormData({
          name: item.name || '',
          type: item.type || 'CONSOLE',
          ipAddress: item.ipAddress || '',
          port: item.port || 9100
        });
      } else {
        setEditingPrinter(null);
        setPrinterFormData({
          name: '',
          type: 'CONSOLE',
          ipAddress: '',
          port: 9100
        });
      }
      setIsPrinterModalOpen(true);
    } else {
      if (item) {
        setEditingItem(item);
        setFormData({ 
          name: item.name || item.username || '', 
          sortOrder: item.sortOrder || 0,
          printerId: item.printerId || ''
        });
      } else {
        setEditingItem(null);
        setFormData({ name: '', sortOrder: 0, printerId: '' });
      }
      setIsModalOpen(true);
    }
  };

  const handleSaveModal = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (activeTab === 'printers') {
        if (editingPrinter) {
          await api.patch(`/print-jobs/printers/${editingPrinter.id}`, printerFormData);
        } else {
          await api.post('/print-jobs/printers', printerFormData);
        }
        setIsPrinterModalOpen(false);
      } else if (activeTab === 'events') {
        const payload = {
          ...eventFormData,
          startTime: eventFormData.startTime ? new Date(eventFormData.startTime).toISOString() : undefined,
          endTime: eventFormData.endTime ? new Date(eventFormData.endTime).toISOString() : undefined,
        };

        if (editingEvent) {
          await api.patch(`/events/${editingEvent.id}`, payload);
        } else {
          const res = await api.post('/events', payload);
          if (!eventId) setEventId(res.data.id);
        }
        setIsEventModalOpen(false);
      } else {
        let endpoint = '';
        if (activeTab === 'areas') endpoint = '/areas';
        if (activeTab === 'stations') endpoint = '/stations';
        if (activeTab === 'categories') endpoint = '/categories';
        if (activeTab === 'products') endpoint = '/products';
        if (activeTab === 'users') endpoint = '/users';

        const payload = {
          ...formData,
          eventId: (activeTab !== 'users') ? eventId : undefined,
        };

        if (editingItem) {
          await api.patch(`${endpoint}/${editingItem.id}`, payload);
        } else {
          await api.post(endpoint, payload);
        }
        setIsModalOpen(false);
      }
      fetchData();
    } catch (err) {
      console.error('Failed to save item', err);
      alert('Fehler beim Speichern');
    }
  };

  const handleTestPrint = async (printerId: string) => {
    try {
      await api.post(`/print-jobs/printers/${printerId}/test`);
      alert('Test-Druckauftrag erfolgreich an die Druckerwarteschlange gesendet!');
    } catch (err) {
      console.error('Failed to test print', err);
      alert('Fehler beim Senden des Testdrucks');
    }
  };

  // --- BACKUP ACTIONS ---
  const handleCreateBackup = async () => {
    setIsBackingUp(true);
    try {
      await api.post('/backup/create');
      alert('Datensicherung erfolgreich erstellt!');
      fetchData();
    } catch (err) {
      console.error('Failed to create backup', err);
      alert('Fehler bei der Erstellung des Backups');
    } finally {
      setIsBackingUp(false);
    }
  };

  const handleDownloadBackup = async (filename: string) => {
    try {
      const response = await api.get(`/backup/download/${filename}`, {
        responseType: 'blob'
      });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (err) {
      console.error('Failed to download backup', err);
      alert('Fehler beim Herunterladen des Backups');
    }
  };

  const handleRestoreBackup = async (filename: string) => {
    if (!confirm(`⚠️ ACHTUNG: Möchtest du wirklich den Zustand aus "${filename}" wiederherstellen?\n\nEs wird vorab automatisch ein Sicherheits-Backup des aktuellen Zustands angelegt.`)) {
      return;
    }
    try {
      const res = await api.post(`/backup/restore/${filename}`);
      alert(`Wiederherstellung erfolgreich!\n\n${res.data.message || ''}`);
      fetchData();
    } catch (err) {
      console.error('Failed to restore backup', err);
      alert('Fehler bei der Wiederherstellung des Backups');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Diesen Eintrag wirklich unwiderruflich löschen?')) return;
    try {
      let endpoint = '';
      if (activeTab === 'events') endpoint = `/events/${id}`;
      if (activeTab === 'areas') endpoint = `/areas/${id}`;
      if (activeTab === 'stations') endpoint = `/stations/${id}`;
      if (activeTab === 'categories') endpoint = `/categories/${id}`;
      if (activeTab === 'products') endpoint = `/products/${id}`;
      if (activeTab === 'users') endpoint = `/users/${id}`;

      await api.delete(endpoint);
      fetchData();
    } catch (err) {
      console.error('Failed to delete item', err);
      alert('Fehler beim Löschen');
    }
  };

  // --- EVENT LIFECYCLE HANDLERS ---
  const handleOpenActivateModal = (evt: EventItem) => {
    setRksvTargetEvent(evt);
    setRksvConfirmed(false);
    setRksvModalOpen(true);
  };

  const handleConfirmActivation = async () => {
    if (!rksvTargetEvent || !rksvConfirmed) return;
    setIsActivating(true);
    try {
      await api.post(`/events/${rksvTargetEvent.id}/activate`, {
        confirmRksvExemption: true
      });
      setRksvModalOpen(false);
      fetchData();
    } catch (err) {
      console.error('Activation failed', err);
      alert('Fehler bei der Aktivierung der Veranstaltung!');
    } finally {
      setIsActivating(false);
    }
  };

  const handleSetTestMode = async (evt: EventItem) => {
    try {
      await api.patch(`/events/${evt.id}/status`, { status: 'TEST_MODE' });
      fetchData();
    } catch (err) {
      console.error('Failed to set test mode', err);
      alert('Fehler beim Aktivieren des Testmodus');
    }
  };

  const handlePauseEvent = async (evt: EventItem) => {
    try {
      await api.patch(`/events/${evt.id}/status`, { status: 'PAUSED' });
      fetchData();
    } catch (err) {
      console.error('Failed to pause event', err);
    }
  };

  const handleCompleteEvent = async (evt: EventItem) => {
    if (!confirm(`Möchtest du "${evt.name}" wirklich abschließen? Es können danach keine neuen Bestellungen mehr erfasst werden.`)) return;
    try {
      await api.patch(`/events/${evt.id}/status`, { status: 'COMPLETED' });
      fetchData();
    } catch (err) {
      console.error('Failed to complete event', err);
    }
  };

  const handleCleanTestData = async (evt: EventItem) => {
    if (!confirm(`ACHTUNG: Möchtest du wirklich alle Testbestellungen, Zahlungen und Kassenstände für "${evt.name}" löschen? Diese Aktion kann nicht rückgängig gemacht werden.`)) return;
    try {
      await api.post(`/events/${evt.id}/clean-test-data`);
      alert('Testdaten erfolgreich bereinigt! Die Veranstaltung ist bereit für den Feststart.');
      fetchData();
    } catch (err) {
      console.error('Failed to clean test data', err);
      alert('Fehler beim Bereinigen der Testdaten');
    }
  };

  const getStatusBadge = (status: string, rksvConfirmedAt?: string) => {
    switch (status) {
      case 'ACTIVE':
        return (
          <div className="flex flex-col items-start gap-1">
            <span className="bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-2.5 py-1 rounded-full text-xs font-bold flex items-center gap-1.5 shadow-sm shadow-emerald-500/20">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              Echtbetrieb (Aktiv)
            </span>
            {rksvConfirmedAt && (
              <span className="text-[10px] text-emerald-300/80 font-medium">
                ✓ RKSV-Ausschluss bestätigt
              </span>
            )}
          </div>
        );
      case 'TEST_MODE':
        return (
          <span className="bg-amber-500/20 text-amber-300 border border-amber-500/30 px-2.5 py-1 rounded-full text-xs font-bold flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5" />
            Testmodus (Schulung)
          </span>
        );
      case 'PAUSED':
        return (
          <span className="bg-slate-700 text-slate-300 px-2.5 py-1 rounded-full text-xs font-bold flex items-center gap-1.5">
            <Pause className="w-3.5 h-3.5" />
            Pausiert
          </span>
        );
      case 'COMPLETED':
        return (
          <span className="bg-indigo-500/20 text-indigo-300 px-2.5 py-1 rounded-full text-xs font-bold flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5" />
            Abgeschlossen
          </span>
        );
      default:
        return (
          <span className="bg-slate-800 text-slate-400 px-2.5 py-1 rounded-full text-xs font-medium">
            Entwurf (DRAFT)
          </span>
        );
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold">Administration & Stammdaten</h1>
          <p className="text-slate-400 text-sm mt-1">Veranstaltungssteuerung, Druck-Routing, Backups und Sortimentspflege</p>
        </div>
        {activeTab !== 'backups' && (
          <button 
            onClick={() => handleOpenModal()} 
            className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2.5 px-5 rounded-2xl flex items-center gap-2 shadow-lg shadow-indigo-600/30 transition-all active:scale-95 shrink-0"
          >
            <Plus className="w-5 h-5" />
            Neu anlegen
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-2 overflow-x-auto pb-2 border-b border-slate-800 scrollbar-hide">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as Tab)}
              className={`flex items-center gap-2.5 px-4 py-2.5 rounded-2xl font-bold text-sm transition-all whitespace-nowrap ${
                isActive 
                  ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30' 
                  : 'bg-slate-850 text-slate-400 hover:bg-slate-800 hover:text-slate-200'
              }`}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Content Area */}
      <div className="glass p-6 rounded-3xl">
        {isLoading ? (
          <div className="text-center py-12 text-slate-400 animate-pulse">Lade Daten...</div>
        ) : activeTab === 'events' ? (
          /* Events Lifecycle Cards */
          <div className="space-y-4">
            {data.map((evt: EventItem) => (
              <div 
                key={evt.id} 
                className="bg-slate-900/60 border border-slate-800/80 p-5 rounded-2xl flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 hover:border-slate-700 transition"
              >
                <div className="space-y-2">
                  <div className="flex items-center gap-3">
                    <h3 className="text-xl font-bold text-slate-100">{evt.name}</h3>
                    {getStatusBadge(evt.status, evt.rksvConfirmedAt)}
                  </div>
                  <div className="flex flex-wrap gap-4 text-xs text-slate-400">
                    {evt.organizer && <span>🏛️ {evt.organizer}</span>}
                    {evt.location && <span>📍 {evt.location}</span>}
                    {evt.startTime && <span>📅 {new Date(evt.startTime).toLocaleDateString()}</span>}
                  </div>
                  {evt._count && (
                    <div className="flex gap-4 text-xs text-slate-500 pt-1">
                      <span>{evt._count.orders} Bestellungen</span>
                      <span>•</span>
                      <span>{evt._count.products} Artikel</span>
                      <span>•</span>
                      <span>{evt._count.stations} Stationen</span>
                      <span>•</span>
                      <span>{evt._count.areas} Bereiche</span>
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-2 lg:pt-0 w-full lg:w-auto justify-end">
                  {/* Status Actions */}
                  {evt.status !== 'ACTIVE' && (
                    <button
                      onClick={() => handleOpenActivateModal(evt)}
                      className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition flex items-center gap-1.5 shadow-md shadow-emerald-600/30"
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
            ))}
            {data.length === 0 && (
              <div className="text-center py-12 text-slate-500">
                Noch keine Veranstaltungen angelegt.
              </div>
            )}
          </div>
        ) : activeTab === 'printers' ? (
          /* Printers Table */
          <div className="space-y-4">
            <div className="flex justify-between items-center text-sm text-slate-400 pb-2 border-b border-slate-800">
              <span>Konfigurierte Beleg- und Küchenbondrucker (ESC/POS & Konsole)</span>
              <span>Aktive Drucker: {data.filter((p: any) => p.isActive).length}</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {data.map((printer: any) => (
                <div key={printer.id} className="bg-slate-900/70 border border-slate-800 p-5 rounded-2xl space-y-3">
                  <div className="flex justify-between items-start">
                    <div className="flex items-center gap-3">
                      <div className="p-2.5 bg-indigo-500/20 text-indigo-400 rounded-xl">
                        <Printer className="w-6 h-6" />
                      </div>
                      <div>
                        <h4 className="text-lg font-bold text-slate-100">{printer.name}</h4>
                        <span className="text-xs text-slate-400 font-mono">Typ: {printer.type} {printer.ipAddress ? `(${printer.ipAddress}:${printer.port || 9100})` : ''}</span>
                      </div>
                    </div>
                    <span className={`text-xs px-2.5 py-1 rounded-full font-bold ${printer.isActive ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-slate-800 text-slate-500'}`}>
                      {printer.isActive ? 'Bereit' : 'Inaktiv'}
                    </span>
                  </div>

                  <div className="pt-2 flex justify-between items-center border-t border-slate-800">
                    <button
                      onClick={() => handleTestPrint(printer.id)}
                      className="px-3 py-1.5 rounded-xl bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 text-xs font-bold transition flex items-center gap-1.5 border border-indigo-500/30"
                    >
                      <Printer className="w-3.5 h-3.5" />
                      Testbon drucken
                    </button>
                    <div className="flex gap-2">
                      <button 
                        onClick={() => handleOpenModal(printer)}
                        className="p-2 bg-slate-800 hover:bg-slate-700 rounded-lg text-slate-300 transition-colors"
                        title="Bearbeiten"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
              {data.length === 0 && (
                <div className="col-span-2 text-center py-12 text-slate-500">
                  Keine Drucker konfiguriert.
                </div>
              )}
            </div>
          </div>
        ) : activeTab === 'backups' ? (
          /* Backups & Data Protection */
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-slate-900/80 border border-slate-800 p-5 rounded-2xl">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-emerald-500/20 text-emerald-400 rounded-2xl border border-emerald-500/30">
                  <ShieldCheck className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white">Automatische & Manuelle Datensicherung</h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Stündliche automatische Sicherung während aktiver Feste. JSON-Snapshots mit SHA256-Integritätsprüfung.
                  </p>
                </div>
              </div>

              <button
                disabled={isBackingUp}
                onClick={handleCreateBackup}
                className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold text-sm rounded-xl shadow-lg shadow-emerald-600/30 transition flex items-center gap-2 shrink-0"
              >
                <HardDrive className="w-4 h-4" />
                {isBackingUp ? 'Sicherung läuft...' : 'Jetzt sichern (Manuelles Backup)'}
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="text-slate-400 border-b border-slate-700/50 text-xs uppercase font-semibold">
                    <th className="pb-3">Backup-Datei</th>
                    <th className="pb-3">Erstellt am</th>
                    <th className="pb-3">Größe</th>
                    <th className="pb-3">Umfang</th>
                    <th className="pb-3">Integrität (SHA256)</th>
                    <th className="pb-3 text-right">Aktionen</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700/50 text-sm">
                  {data.map((b: BackupItem) => (
                    <tr key={b.filename} className="hover:bg-slate-800/30 transition-colors">
                      <td className="py-4 font-mono font-medium text-indigo-300">
                        {b.filename}
                      </td>
                      <td className="py-4 text-slate-300">
                        {new Date(b.createdAt).toLocaleString('de-AT')}
                      </td>
                      <td className="py-4 text-slate-400">
                        {(b.sizeBytes / 1024).toFixed(1)} kB
                      </td>
                      <td className="py-4 text-xs text-slate-400">
                        {b.counts ? (
                          <span>
                            {b.counts.orders || 0} Bestellungen, {b.counts.products || 0} Artikel
                          </span>
                        ) : '-'}
                      </td>
                      <td className="py-4 font-mono text-xs text-slate-500" title={b.checksumSha256}>
                        {b.checksumSha256 ? `${b.checksumSha256.slice(0, 12)}...` : 'Geprüft'}
                      </td>
                      <td className="py-4 text-right">
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={() => handleDownloadBackup(b.filename)}
                            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 rounded-lg text-slate-300 transition text-xs font-bold flex items-center gap-1.5 border border-slate-700"
                            title="Auf USB-Stick / PC herunterladen"
                          >
                            <Download className="w-3.5 h-3.5" />
                            Download
                          </button>
                          <button
                            onClick={() => handleRestoreBackup(b.filename)}
                            className="px-3 py-1.5 bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 rounded-lg transition text-xs font-bold flex items-center gap-1.5 border border-rose-500/30"
                            title="Datenbank auf diesen Stand zurücksetzen"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                            Wiederherstellen
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {data.length === 0 && (
                    <tr>
                      <td colSpan={6} className="text-center py-12 text-slate-500">
                        Noch keine Datensicherungen vorhanden. Erstelle jetzt ein manuelles Backup.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          /* Standard Tables (Areas, Stations, Categories, etc.) */
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
                    <td className="py-4 font-semibold">
                      <div>{item.name || item.username}</div>
                      {item.printer && (
                        <span className="text-xs text-indigo-400 font-normal flex items-center gap-1 mt-0.5">
                          🖨️ Drucker: {item.printer.name}
                        </span>
                      )}
                    </td>
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
                    <td colSpan={3} className="text-center py-8 text-slate-500">
                      Keine Einträge vorhanden.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* RKSV DISCLAIMER & ACTIVATION MODAL */}
      {rksvModalOpen && rksvTargetEvent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
          <div className="bg-slate-900 border border-slate-700 p-6 sm:p-8 rounded-3xl max-w-xl w-full shadow-2xl space-y-6 animate-scale-up">
            <div className="flex items-start gap-4">
              <div className="p-3 bg-amber-500/20 text-amber-400 rounded-2xl border border-amber-500/30 shrink-0">
                <ShieldAlert className="w-8 h-8" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-white">Rechtlicher Hinweis: RKSV-Konformität</h3>
                <p className="text-sm text-slate-400 mt-1">
                  Veranstaltung: <span className="text-slate-200 font-semibold">{rksvTargetEvent.name}</span>
                </p>
              </div>
            </div>

            <div className="bg-slate-950/80 border border-slate-800 p-4 rounded-2xl text-xs sm:text-sm text-slate-300 space-y-3 leading-relaxed">
              <div className="font-semibold text-amber-300 flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>Wichtige rechtliche Erklärung vor dem Echtbetrieb:</span>
              </div>
              <p className="border-l-2 border-amber-500/50 pl-3 py-1 font-medium text-slate-200">
                „VereinOrder ist <strong>keine RKSV-Registrierkasse</strong> im Sinne der österreichischen Registrierkassensicherheitsverordnung. Der Veranstalter ist selbst dafür verantwortlich zu prüfen, ob für diese Veranstaltung gesetzliche Einzelaufzeichnungs-, Belegerteilungs- oder Registrierkassenpflichten bestehen.“
              </p>
              <div className="text-slate-400 text-[11px] pt-1">
                Dieser Vorgang wird revisionssicher mit Zeitstempel, Benutzer-ID und Versionsnummer im Audit-Log archiviert.
              </div>
            </div>

            <label className="flex items-start gap-3 p-3 bg-slate-800/40 hover:bg-slate-800/70 rounded-2xl border border-slate-700/50 cursor-pointer transition">
              <input
                type="checkbox"
                checked={rksvConfirmed}
                onChange={(e) => setRksvConfirmed(e.target.checked)}
                className="w-5 h-5 mt-0.5 rounded border-slate-600 text-indigo-600 focus:ring-indigo-500"
              />
              <span className="text-xs sm:text-sm text-slate-200 font-medium select-none">
                Ich habe diesen Hinweis zur Kenntnis genommen und bestätige, dass VereinOrder für diese Veranstaltung unter Eigenverantwortung des Veranstalters eingesetzt wird.
              </span>
            </label>

            <div className="flex gap-3 justify-end pt-2">
              <button
                type="button"
                onClick={() => setRksvModalOpen(false)}
                className="px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-sm transition"
              >
                Abbrechen
              </button>
              <button
                type="button"
                disabled={!rksvConfirmed || isActivating}
                onClick={handleConfirmActivation}
                className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-sm shadow-lg shadow-emerald-600/30 transition flex items-center gap-2"
              >
                {isActivating ? 'Aktivierung läuft...' : 'Bestätigen & Scharf schalten'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PRINTER MODAL */}
      {isPrinterModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 p-6 rounded-3xl max-w-md w-full shadow-2xl space-y-4">
            <h3 className="text-xl font-bold text-white">
              {editingPrinter ? 'Drucker bearbeiten' : 'Neuen Drucker anlegen'}
            </h3>
            <form onSubmit={handleSaveModal} className="space-y-4">
              <div>
                <label className="text-xs font-bold text-slate-400 block mb-1">Druckername</label>
                <input
                  type="text"
                  required
                  value={printerFormData.name}
                  onChange={(e) => setPrinterFormData({ ...printerFormData, name: e.target.value })}
                  placeholder="z. B. Küchen-Bon-Drucker 1"
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-white"
                />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-400 block mb-1">Druckertyp</label>
                <select
                  value={printerFormData.type}
                  onChange={(e) => setPrinterFormData({ ...printerFormData, type: e.target.value })}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-white"
                >
                  <option value="CONSOLE">Konsole / Virtuell (Test)</option>
                  <option value="ESC_POS_NETWORK">Netzwerk-Bondrucker (LAN / WLAN)</option>
                  <option value="ESC_POS_USB">USB-Bondrucker</option>
                  <option value="WINDOWS_DRIVER">Windows Treiber-Drucker</option>
                </select>
              </div>
              {printerFormData.type === 'ESC_POS_NETWORK' && (
                <div className="grid grid-cols-3 gap-2">
                  <div className="col-span-2">
                    <label className="text-xs font-bold text-slate-400 block mb-1">IP-Adresse</label>
                    <input
                      type="text"
                      value={printerFormData.ipAddress}
                      onChange={(e) => setPrinterFormData({ ...printerFormData, ipAddress: e.target.value })}
                      placeholder="192.168.1.100"
                      className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-white"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-slate-400 block mb-1">Port</label>
                    <input
                      type="number"
                      value={printerFormData.port}
                      onChange={(e) => setPrinterFormData({ ...printerFormData, port: Number(e.target.value) })}
                      className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-white"
                    />
                  </div>
                </div>
              )}
              <div className="flex gap-2 justify-end pt-2">
                <button
                  type="button"
                  onClick={() => setIsPrinterModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold"
                >
                  Abbrechen
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold"
                >
                  Speichern
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* EVENT MODAL */}
      {isEventModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 p-6 rounded-3xl max-w-lg w-full shadow-2xl space-y-4">
            <h3 className="text-xl font-bold text-white">
              {editingEvent ? 'Veranstaltung bearbeiten' : 'Neue Veranstaltung anlegen'}
            </h3>
            <form onSubmit={handleSaveModal} className="space-y-4">
              <div>
                <label className="text-xs font-bold text-slate-400 block mb-1">Name der Veranstaltung</label>
                <input
                  type="text"
                  required
                  value={eventFormData.name}
                  onChange={(e) => setEventFormData({ ...eventFormData, name: e.target.value })}
                  placeholder="z. B. Feuerwehrfest 2026"
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-white"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-400 block mb-1">Veranstalter</label>
                  <input
                    type="text"
                    value={eventFormData.organizer}
                    onChange={(e) => setEventFormData({ ...eventFormData, organizer: e.target.value })}
                    placeholder="Freiwillige Feuerwehr"
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-white"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-400 block mb-1">Ort</label>
                  <input
                    type="text"
                    value={eventFormData.location}
                    onChange={(e) => setEventFormData({ ...eventFormData, location: e.target.value })}
                    placeholder="Festzelt Sportplatz"
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-white"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-400 block mb-1">Startzeit</label>
                  <input
                    type="datetime-local"
                    value={eventFormData.startTime}
                    onChange={(e) => setEventFormData({ ...eventFormData, startTime: e.target.value })}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-white text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-400 block mb-1">Endzeit</label>
                  <input
                    type="datetime-local"
                    value={eventFormData.endTime}
                    onChange={(e) => setEventFormData({ ...eventFormData, endTime: e.target.value })}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-white text-sm"
                  />
                </div>
              </div>
              <div className="flex gap-2 justify-end pt-2">
                <button
                  type="button"
                  onClick={() => setIsEventModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold"
                >
                  Abbrechen
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold"
                >
                  Speichern
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* GENERIC ITEM MODAL (Areas, Stations, etc.) */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 p-6 rounded-3xl max-w-md w-full shadow-2xl space-y-4">
            <h3 className="text-xl font-bold text-white">
              {editingItem ? 'Eintrag bearbeiten' : 'Neu anlegen'}
            </h3>
            <form onSubmit={handleSaveModal} className="space-y-4">
              <div>
                <label className="text-xs font-bold text-slate-400 block mb-1">Bezeichnung</label>
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Name..."
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-white"
                />
              </div>

              {activeTab === 'stations' && (
                <div>
                  <label className="text-xs font-bold text-slate-400 block mb-1">Zugewiesener Bondrucker</label>
                  <select
                    value={formData.printerId || ''}
                    onChange={(e) => setFormData({ ...formData, printerId: e.target.value || undefined })}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-white text-sm"
                  >
                    <option value="">Standard-Drucker verwenden</option>
                    {printersList.map((p: any) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.type})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="text-xs font-bold text-slate-400 block mb-1">Sortierung</label>
                <input
                  type="number"
                  value={formData.sortOrder}
                  onChange={(e) => setFormData({ ...formData, sortOrder: Number(e.target.value) })}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-white"
                />
              </div>
              <div className="flex gap-2 justify-end pt-2">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold"
                >
                  Abbrechen
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold"
                >
                  Speichern
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
