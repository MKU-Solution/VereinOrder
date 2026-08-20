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
  ShieldCheck,
  Search,
  FileSpreadsheet,
  Activity,
  Cpu,
  Database,
  RefreshCw,
  AlertOctagon,
  ArrowRight
} from 'lucide-react';

type Tab = 'events' | 'stations' | 'categories' | 'products' | 'users' | 'areas' | 'printers' | 'backups' | 'audit' | 'diagnostics';

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

interface AuditLogItem {
  id: string;
  action: string;
  entityId: string;
  entityType: string;
  userId?: string;
  user?: {
    id: string;
    username: string;
    role: string;
  };
  details?: any;
  createdAt: string;
}

export const AdminDashboard = () => {
  const [activeTab, setActiveTab] = useState<Tab>('events');
  const [data, setData] = useState<any[]>([]);
  const [diagnosticsData, setDiagnosticsData] = useState<any>(null);
  const [printersList, setPrintersList] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [isRetryingJobs, setIsRetryingJobs] = useState(false);
  const [eventId, setEventId] = useState<string>('');

  // Audit state
  const [auditStats, setAuditStats] = useState<any>(null);
  const [auditFilterAction, setAuditFilterAction] = useState<string>('');
  const [auditSearch, setAuditSearch] = useState<string>('');
  
  // Generic Modal State (for Areas / Simple Items)
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<any>(null);
  const [formData, setFormData] = useState<{name: string, shortName?: string, sortOrder: number, printerId?: string}>({ name: '', shortName: '', sortOrder: 0, printerId: '' });
  const [modalError, setModalError] = useState('');
  const [isSavingModal, setIsSavingModal] = useState(false);

  // Product Modal State
  const [isProductModalOpen, setIsProductModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<any>(null);
  const [productFormData, setProductFormData] = useState({
    name: '',
    euro: '',
    cent: '',
    categoryId: '',
    targetStationId: '',
    sortOrder: '0'
  });
  const [productCategories, setProductCategories] = useState<any[]>([]);
  const [productStations, setProductStations] = useState<any[]>([]);

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
      if (activeTab === 'diagnostics') endpoint = '/diagnostics/status';
      if (activeTab === 'audit') {
        const queryParams = new URLSearchParams();
        if (auditFilterAction) queryParams.set('action', auditFilterAction);
        if (auditSearch) queryParams.set('search', auditSearch);
        endpoint = `/audit/logs?${queryParams.toString()}`;

        const statsRes = await api.get('/audit/stats');
        setAuditStats(statsRes.data);
      }

      const res = await api.get(endpoint);
      if (activeTab === 'audit') {
        setData(res.data.logs || []);
      } else if (activeTab === 'diagnostics') {
        setDiagnosticsData(res.data);
      } else {
        setData(res.data);
      }

      if (activeTab === 'printers') {
        setPrintersList(res.data);
      }
    } catch (err) {
      console.error(`Failed to load ${activeTab}`, err);
    } finally {
      setIsLoading(false);
    }
  }, [activeTab, eventId, auditFilterAction, auditSearch]);

  useEffect(() => {
    if (activeTab === 'events' || activeTab === 'printers' || activeTab === 'backups' || activeTab === 'audit' || activeTab === 'diagnostics' || eventId) {
      fetchData();
    }
  }, [activeTab, eventId, fetchData]);

  // Periodic poll for diagnostics tab
  useEffect(() => {
    if (activeTab !== 'diagnostics') return;
    const interval = setInterval(() => {
      fetchData();
    }, 10000);
    return () => clearInterval(interval);
  }, [activeTab, fetchData]);

  const tabs = [
    { id: 'events', label: 'Veranstaltungen & Lifecycle', icon: Calendar },
    { id: 'diagnostics', label: 'System-Status & Diagnose', icon: Activity },
    { id: 'areas', label: 'Bereiche', icon: Map },
    { id: 'stations', label: 'Stationen', icon: Store },
    { id: 'printers', label: 'Drucker & Bon-Routing', icon: Printer },
    { id: 'backups', label: 'Backups & Datensicherung', icon: HardDrive },
    { id: 'audit', label: 'Audit-Protokoll & Sicherheit', icon: ShieldAlert },
    { id: 'categories', label: 'Kategorien', icon: Tag },
    { id: 'products', label: 'Produkte', icon: Package },
    { id: 'users', label: 'Mitarbeiter', icon: Users },
  ] as const;

  const handleModalEscape = (e: React.KeyboardEvent, closeModal: () => void) => {
    if (e.key === 'Escape' && !isSavingModal) {
      e.preventDefault();
      closeModal();
    }
  };

  const handleOpenModal = async (item?: any) => {
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
    } else if (activeTab === 'products') {
      setModalError('');
      setEditingProduct(item || null);
      const price = Number.isInteger(item?.price) ? item.price : 0;
      setProductFormData({
        name: item?.name || '',
        euro: String(Math.floor(price / 100)),
        cent: String(Math.abs(price % 100)).padStart(2, '0'),
        categoryId: item?.categoryId || '',
        targetStationId: item?.targetStationId || '',
        sortOrder: String(item?.sortOrder ?? 0)
      });
      setIsProductModalOpen(true);
      if (!eventId) {
        setModalError('Bitte wähle zuerst eine Veranstaltung aus.');
        return;
      }
      try {
        const [categoriesRes, stationsRes] = await Promise.all([
          api.get(`/categories?eventId=${eventId}`),
          api.get(`/stations/admin/all?eventId=${eventId}`)
        ]);
        setProductCategories(categoriesRes.data || []);
        setProductStations(stationsRes.data || []);
      } catch (err) {
        console.error('Failed to load product modal options', err);
        setModalError('Kategorien oder Stationen konnten nicht geladen werden. Bitte erneut versuchen.');
      }
    } else {
      setModalError('');
      if (item) {
        setEditingItem(item);
        setFormData({ 
          name: item.name || item.username || '', 
          shortName: item.shortName || '',
          sortOrder: item.sortOrder ?? 0,
          printerId: item.printerId || ''
        });
      } else {
        setEditingItem(null);
        setFormData({ name: '', shortName: '', sortOrder: 0, printerId: '' });
      }
      setIsModalOpen(true);
    }
  };

  const handleSaveModal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSavingModal) return;
    setModalError('');

    if (activeTab === 'stations') {
      const name = formData.name.trim();
      const shortName = (formData.shortName || '').trim();
      if (!name) {
        setModalError('Bitte gib einen Namen für die Station ein.');
        return;
      }
      if (shortName.length > 12) {
        setModalError('Die Kurzbezeichnung darf höchstens 12 Zeichen lang sein.');
        return;
      }
      if (!Number.isInteger(formData.sortOrder)) {
        setModalError('Die Sortierung muss eine ganze Zahl sein.');
        return;
      }
    }

    setIsSavingModal(true);
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
        if (activeTab === 'users') endpoint = '/users';

        if (activeTab === 'stations') {
          const payload = {
            name: formData.name.trim(),
            shortName: (formData.shortName || '').trim() || null,
            printerId: formData.printerId || null,
            sortOrder: formData.sortOrder
          };
          if (editingItem) {
            await api.patch(`${endpoint}/${editingItem.id}`, payload);
          } else {
            await api.post(endpoint, { ...payload, eventId });
          }
        } else if (activeTab === 'areas' || activeTab === 'categories') {
          const payload = { name: formData.name, sortOrder: formData.sortOrder };
          if (editingItem) {
            await api.patch(`${endpoint}/${editingItem.id}`, payload);
          } else {
            await api.post(endpoint, { ...payload, eventId });
          }
        } else {
          // Benutzer verwenden weiterhin den bisherigen, nicht erweiterten Modalumfang.
          const payload = { name: formData.name, sortOrder: formData.sortOrder, printerId: formData.printerId };
          if (editingItem) {
            await api.patch(`${endpoint}/${editingItem.id}`, payload);
          } else {
            await api.post(endpoint, payload);
          }
        }
        setIsModalOpen(false);
      }
      fetchData();
    } catch (err) {
      console.error('Failed to save item', err);
      if (activeTab === 'events' || activeTab === 'printers') {
        alert('Fehler beim Speichern');
      } else {
        setModalError('Speichern fehlgeschlagen. Bitte prüfe die Eingaben und versuche es erneut.');
      }
    } finally {
      setIsSavingModal(false);
    }
  };

  const handleSaveProductModal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSavingModal) return;
    setModalError('');

    const name = productFormData.name.trim();
    const euroInput = productFormData.euro.trim();
    const centInput = productFormData.cent.trim();
    const sortOrderInput = productFormData.sortOrder.trim();
    const euro = Number(euroInput);
    const cent = Number(centInput);
    const sortOrder = Number(sortOrderInput);
    if (!eventId) {
      setModalError('Bitte wähle zuerst eine Veranstaltung aus.');
      return;
    }
    if (!name) {
      setModalError('Bitte gib einen Produktnamen ein.');
      return;
    }
    if (!/^\d+$/.test(euroInput) || !/^\d+$/.test(centInput) || !Number.isSafeInteger(euro) || euro < 0 || !Number.isSafeInteger(cent) || cent < 0 || cent > 99) {
      setModalError('Euro muss eine nichtnegative ganze Zahl und Cent ein Wert von 0 bis 99 sein.');
      return;
    }
    if (!/^-?\d+$/.test(sortOrderInput) || !Number.isInteger(sortOrder)) {
      setModalError('Die Sortierung muss eine ganze Zahl sein.');
      return;
    }
    const price = euro * 100 + cent;
    if (!Number.isSafeInteger(price) || price > 2_147_483_647) {
      setModalError('Der Preis ist zu hoch. Maximal erlaubt sind 21.474.836,47 Euro.');
      return;
    }

    setIsSavingModal(true);
    try {
      const payload = {
        name,
        price,
        categoryId: productFormData.categoryId || null,
        targetStationId: productFormData.targetStationId || null,
        sortOrder
      };
      if (editingProduct) {
        await api.patch(`/products/${editingProduct.id}`, payload);
      } else {
        await api.post('/products', { ...payload, eventId });
      }
      setIsProductModalOpen(false);
      fetchData();
    } catch (err) {
      console.error('Failed to save product', err);
      setModalError('Speichern fehlgeschlagen. Bitte prüfe die Eingaben und versuche es erneut.');
    } finally {
      setIsSavingModal(false);
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

  // --- AUDIT ACTIONS ---
  const handleExportAuditCsv = async () => {
    try {
      const res = await api.get('/audit/export', { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `vereinorder_audit_log_${new Date().toISOString().slice(0, 10)}.csv`);
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (err) {
      console.error('Failed to export audit log', err);
      alert('Fehler beim Exportieren des Audit-Logs');
    }
  };

  // --- DIAGNOSTICS ACTIONS ---
  const handleRetryFailedJobs = async () => {
    setIsRetryingJobs(true);
    try {
      const res = await api.post('/diagnostics/retry-failed-print-jobs');
      alert(res.data.message);
      fetchData();
    } catch (err) {
      console.error('Failed to retry print jobs', err);
      alert('Fehler beim Wiederholen der Druckaufträge');
    } finally {
      setIsRetryingJobs(false);
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

  const formatUptime = (seconds: number) => {
    const d = Math.floor(seconds / (3600 * 24));
    const h = Math.floor((seconds % (3600 * 24)) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);

    const parts = [];
    if (d > 0) parts.push(`${d}d`);
    if (h > 0 || d > 0) parts.push(`${h}h`);
    parts.push(`${m}m`);
    parts.push(`${s}s`);
    return parts.join(' ');
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

  const getActionBadge = (action?: string) => {
    if (!action) return <span className="bg-slate-800 text-slate-500 px-2.5 py-0.5 rounded-full text-xs font-medium">Unbekannt</span>;
    if (action.includes('CANCEL')) {
      return <span className="bg-rose-500/20 text-rose-300 border border-rose-500/30 px-2.5 py-0.5 rounded-full text-xs font-bold">Storno</span>;
    }
    if (action.includes('PRICE')) {
      return <span className="bg-amber-500/20 text-amber-300 border border-amber-500/30 px-2.5 py-0.5 rounded-full text-xs font-bold">Preisänderung</span>;
    }
    if (action.includes('PAYMENT')) {
      return <span className="bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-2.5 py-0.5 rounded-full text-xs font-bold">Zahlung</span>;
    }
    if (action === 'LOGIN') {
      return <span className="bg-blue-500/20 text-blue-300 border border-blue-500/30 px-2.5 py-0.5 rounded-full text-xs font-bold">Login</span>;
    }
    if (action === 'FAILED_LOGIN') {
      return <span className="bg-red-600/30 text-red-300 border border-red-500/50 px-2.5 py-0.5 rounded-full text-xs font-bold">Fehlversuch</span>;
    }
    if (action.includes('RKSV')) {
      return <span className="bg-purple-500/20 text-purple-300 border border-purple-500/30 px-2.5 py-0.5 rounded-full text-xs font-bold">RKSV-Erklärung</span>;
    }
    if (action.includes('BACKUP')) {
      return <span className="bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 px-2.5 py-0.5 rounded-full text-xs font-bold">Datensicherung</span>;
    }
    return <span className="bg-slate-800 text-slate-300 px-2.5 py-0.5 rounded-full text-xs font-medium">{action}</span>;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold">Administration & Stammdaten</h1>
          <p className="text-slate-400 text-sm mt-1">Veranstaltungssteuerung, Systemstatus, Druck-Routing, Backups & Audit-Log</p>
        </div>
        {activeTab !== 'backups' && activeTab !== 'audit' && activeTab !== 'diagnostics' && (
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
        ) : activeTab === 'diagnostics' ? (
          /* DIAGNOSTICS & SYSTEM STATUS */
          <div className="space-y-6">
            {/* Top Bar: Overall Health & Actions */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-slate-900/80 border border-slate-800 p-5 rounded-2xl">
              <div className="flex items-center gap-3">
                <div className={`p-3 rounded-2xl border ${
                  diagnosticsData?.overallHealth === 'GREEN'
                    ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                    : diagnosticsData?.overallHealth === 'YELLOW'
                    ? 'bg-amber-500/20 text-amber-400 border-amber-500/30'
                    : 'bg-rose-500/20 text-rose-400 border-rose-500/30'
                }`}>
                  <Activity className="w-7 h-7" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-xl font-bold text-white">Systemgesundheit:</h3>
                    <span className={`px-3 py-1 rounded-full text-xs font-extrabold uppercase tracking-wide border ${
                      diagnosticsData?.overallHealth === 'GREEN'
                        ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                        : diagnosticsData?.overallHealth === 'YELLOW'
                        ? 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                        : 'bg-rose-500/20 text-rose-300 border-rose-500/30'
                    }`}>
                      {diagnosticsData?.overallHealth === 'GREEN' ? '● Bereit für Festbetrieb' : diagnosticsData?.overallHealth === 'YELLOW' ? '▲ Handlung empfohlen' : '✖ Systemstörung'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-1">
                    Serverzeit: {new Date(diagnosticsData?.serverTime || Date.now()).toLocaleString('de-AT')} • Automatische Prüfung alle 10s
                  </p>
                </div>
              </div>

              <button
                onClick={() => fetchData()}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs rounded-xl transition flex items-center gap-2 border border-slate-700 self-stretch sm:self-auto justify-center"
              >
                <RefreshCw className="w-4 h-4" />
                Jetzt aktualisieren
              </button>
            </div>

            {/* Smart Health Recommendations */}
            {diagnosticsData?.recommendations && diagnosticsData.recommendations.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Handlungsempfehlungen & Hinweise</h4>
                <div className="grid grid-cols-1 gap-2.5">
                  {diagnosticsData.recommendations.map((rec: any, idx: number) => (
                    <div 
                      key={idx}
                      className={`p-4 rounded-2xl border flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 ${
                        rec.level === 'SUCCESS'
                          ? 'bg-emerald-950/30 border-emerald-800/40 text-emerald-300'
                          : rec.level === 'WARNING'
                          ? 'bg-amber-950/30 border-amber-800/40 text-amber-300'
                          : rec.level === 'ERROR'
                          ? 'bg-rose-950/30 border-rose-800/40 text-rose-300'
                          : 'bg-indigo-950/30 border-indigo-800/40 text-indigo-300'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        {rec.level === 'SUCCESS' ? (
                          <CheckCircle2 className="w-5 h-5 mt-0.5 shrink-0 text-emerald-400" />
                        ) : rec.level === 'ERROR' ? (
                          <AlertOctagon className="w-5 h-5 mt-0.5 shrink-0 text-rose-400" />
                        ) : (
                          <AlertTriangle className="w-5 h-5 mt-0.5 shrink-0 text-amber-400" />
                        )}
                        <div>
                          <div className="font-bold text-sm text-slate-100">{rec.title}</div>
                          <div className="text-xs text-slate-300/90 mt-0.5">{rec.message}</div>
                        </div>
                      </div>

                      {rec.actionTab && (
                        <button
                          onClick={() => setActiveTab(rec.actionTab as Tab)}
                          className="px-3.5 py-1.5 rounded-xl bg-slate-900/80 hover:bg-slate-900 text-white text-xs font-bold transition flex items-center gap-1.5 border border-slate-700/80 shrink-0"
                        >
                          Öffnen <ArrowRight className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 4 Detail Grid Tiles */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* 1. Backend & Host */}
              <div className="bg-slate-900/70 border border-slate-800 p-5 rounded-2xl space-y-4">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 bg-blue-500/20 text-blue-400 rounded-xl">
                    <Cpu className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="font-bold text-slate-100">Backend & Host-System</h4>
                    <span className="text-xs text-slate-400">Node.js Runtime & Speicherauslastung</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="bg-slate-800/50 p-3 rounded-xl">
                    <span className="text-slate-400 block mb-1">Betriebsbereit seit (Uptime)</span>
                    <span className="text-slate-200 font-bold font-mono">
                      {diagnosticsData ? formatUptime(diagnosticsData.backend.uptimeSeconds) : '-'}
                    </span>
                  </div>
                  <div className="bg-slate-800/50 p-3 rounded-xl">
                    <span className="text-slate-400 block mb-1">Node & App Version</span>
                    <span className="text-slate-200 font-bold font-mono">
                      {diagnosticsData?.backend.nodeVersion} (v{diagnosticsData?.backend.appVersion})
                    </span>
                  </div>
                  <div className="bg-slate-800/50 p-3 rounded-xl">
                    <span className="text-slate-400 block mb-1">RAM Belegung (RSS)</span>
                    <span className="text-slate-200 font-bold font-mono">
                      {diagnosticsData?.backend.memory.rssMb} MB
                    </span>
                  </div>
                  <div className="bg-slate-800/50 p-3 rounded-xl">
                    <span className="text-slate-400 block mb-1">Node.js Heap</span>
                    <span className="text-slate-200 font-bold font-mono">
                      {diagnosticsData?.backend.memory.heapUsedMb} MB / {diagnosticsData?.backend.memory.heapTotalMb} MB
                    </span>
                  </div>
                </div>
              </div>

              {/* 2. Database (PostgreSQL) */}
              <div className="bg-slate-900/70 border border-slate-800 p-5 rounded-2xl space-y-4">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 bg-emerald-500/20 text-emerald-400 rounded-xl">
                    <Database className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="font-bold text-slate-100">PostgreSQL Datenbank</h4>
                    <span className="text-xs text-slate-400">Verbindungsstatus & Tabellenumfang</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="bg-slate-800/50 p-3 rounded-xl">
                    <span className="text-slate-400 block mb-1">Status & Ping-Latenz</span>
                    <span className="text-emerald-400 font-bold font-mono flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                      ONLINE ({diagnosticsData?.database.latencyMs} ms)
                    </span>
                  </div>
                  <div className="bg-slate-800/50 p-3 rounded-xl">
                    <span className="text-slate-400 block mb-1">Bestellungen erfasst</span>
                    <span className="text-slate-200 font-bold font-mono">
                      {diagnosticsData?.database.counts.orders || 0}
                    </span>
                  </div>
                  <div className="bg-slate-800/50 p-3 rounded-xl">
                    <span className="text-slate-400 block mb-1">Produkte / Artikel</span>
                    <span className="text-slate-200 font-bold font-mono">
                      {diagnosticsData?.database.counts.products || 0}
                    </span>
                  </div>
                  <div className="bg-slate-800/50 p-3 rounded-xl">
                    <span className="text-slate-400 block mb-1">Mitarbeiter & Benutzer</span>
                    <span className="text-slate-200 font-bold font-mono">
                      {diagnosticsData?.database.counts.users || 0}
                    </span>
                  </div>
                </div>
              </div>

              {/* 3. Printers & Queue */}
              <div className="bg-slate-900/70 border border-slate-800 p-5 rounded-2xl space-y-4">
                <div className="flex justify-between items-start">
                  <div className="flex items-center gap-3">
                    <div className="p-2.5 bg-indigo-500/20 text-indigo-400 rounded-xl">
                      <Printer className="w-5 h-5" />
                    </div>
                    <div>
                      <h4 className="font-bold text-slate-100">Drucker & Warteschlange</h4>
                      <span className="text-xs text-slate-400">
                        {diagnosticsData?.printers.active || 0} von {diagnosticsData?.printers.total || 0} Druckern aktiv
                      </span>
                    </div>
                  </div>

                  {diagnosticsData?.printers.queue.failed > 0 && (
                    <button
                      disabled={isRetryingJobs}
                      onClick={handleRetryFailedJobs}
                      className="px-3 py-1.5 bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold rounded-xl transition flex items-center gap-1.5"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      {isRetryingJobs ? 'Wiederhole...' : 'Fehlgeschlagene wiederholen'}
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div className="bg-slate-800/50 p-3 rounded-xl">
                    <span className="text-slate-400 block mb-1">Wartend (Pending)</span>
                    <span className="text-amber-300 font-bold font-mono">
                      {diagnosticsData?.printers.queue.pending || 0}
                    </span>
                  </div>
                  <div className="bg-slate-800/50 p-3 rounded-xl">
                    <span className="text-slate-400 block mb-1">Gedruckt</span>
                    <span className="text-emerald-400 font-bold font-mono">
                      {diagnosticsData?.printers.queue.printed || 0}
                    </span>
                  </div>
                  <div className="bg-slate-800/50 p-3 rounded-xl">
                    <span className="text-slate-400 block mb-1">Fehlgeschlagen</span>
                    <span className={`font-bold font-mono ${diagnosticsData?.printers.queue.failed > 0 ? 'text-rose-400 font-extrabold' : 'text-slate-500'}`}>
                      {diagnosticsData?.printers.queue.failed || 0}
                    </span>
                  </div>
                </div>
              </div>

              {/* 4. Backup & Storage */}
              <div className="bg-slate-900/70 border border-slate-800 p-5 rounded-2xl space-y-4">
                <div className="flex justify-between items-start">
                  <div className="flex items-center gap-3">
                    <div className="p-2.5 bg-emerald-500/20 text-emerald-400 rounded-xl">
                      <HardDrive className="w-5 h-5" />
                    </div>
                    <div>
                      <h4 className="font-bold text-slate-100">Datensicherung & Snapshots</h4>
                      <span className="text-xs text-slate-400">
                        {diagnosticsData?.backup.totalBackups || 0} Sicherungen vorhanden
                      </span>
                    </div>
                  </div>

                  <button
                    onClick={() => setActiveTab('backups')}
                    className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold rounded-xl transition flex items-center gap-1"
                  >
                    Backups <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="bg-slate-800/50 p-3 rounded-xl text-xs space-y-1">
                  {diagnosticsData?.backup.latestBackup ? (
                    <>
                      <div className="text-slate-400">Letztes Backup:</div>
                      <div className="text-slate-200 font-bold">
                        {new Date(diagnosticsData.backup.latestBackup.createdAt).toLocaleString('de-AT')}
                      </div>
                      <div className="font-mono text-slate-500 text-[11px]">
                        {diagnosticsData.backup.latestBackup.filename} ({(diagnosticsData.backup.latestBackup.sizeBytes / 1024).toFixed(1)} kB)
                      </div>
                    </>
                  ) : (
                    <div className="text-amber-400 font-medium py-1">
                      Noch kein Backup vorhanden.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
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
        ) : activeTab === 'audit' ? (
          /* Audit-Log & Security */
          <div className="space-y-6">
            {/* KPI Summary Cards */}
            {auditStats && (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                <div className="bg-slate-900/80 border border-slate-800 p-4 rounded-2xl">
                  <span className="text-xs text-slate-400 font-medium">Gesamt-Aktionen</span>
                  <div className="text-2xl font-bold text-white mt-1">{auditStats.totalCount}</div>
                </div>
                <div className="bg-slate-900/80 border border-slate-800 p-4 rounded-2xl">
                  <span className="text-xs text-slate-400 font-medium">Heute</span>
                  <div className="text-2xl font-bold text-indigo-400 mt-1">{auditStats.todayCount}</div>
                </div>
                <div className="bg-slate-900/80 border border-slate-800 p-4 rounded-2xl">
                  <span className="text-xs text-slate-400 font-medium">Stornierungen</span>
                  <div className="text-2xl font-bold text-rose-400 mt-1">{auditStats.cancellationsCount}</div>
                </div>
                <div className="bg-slate-900/80 border border-slate-800 p-4 rounded-2xl">
                  <span className="text-xs text-slate-400 font-medium">Preisänderungen</span>
                  <div className="text-2xl font-bold text-amber-400 mt-1">{auditStats.priceChangesCount}</div>
                </div>
                <div className="bg-slate-900/80 border border-slate-800 p-4 rounded-2xl">
                  <span className="text-xs text-slate-400 font-medium">Login-Fehlversuche</span>
                  <div className="text-2xl font-bold text-red-500 mt-1">{auditStats.failedLoginsCount}</div>
                </div>
                <div className="bg-slate-900/80 border border-slate-800 p-4 rounded-2xl">
                  <span className="text-xs text-slate-400 font-medium">RKSV-Bestätigungen</span>
                  <div className="text-2xl font-bold text-purple-400 mt-1">{auditStats.rksvConfirmationsCount}</div>
                </div>
              </div>
            )}

            {/* Filter Bar & Export */}
            <div className="flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-3 bg-slate-900/80 border border-slate-800 p-4 rounded-2xl">
              <div className="flex flex-wrap items-center gap-3 flex-1">
                <div className="relative flex-1 min-w-[200px]">
                  <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={auditSearch}
                    onChange={(e) => setAuditSearch(e.target.value)}
                    placeholder="Benutzer, Aktion oder Detail durchsuchen..."
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl pl-9 pr-4 py-2 text-sm text-white placeholder-slate-500"
                  />
                </div>

                <select
                  value={auditFilterAction}
                  onChange={(e) => setAuditFilterAction(e.target.value)}
                  className="bg-slate-800 border border-slate-700 rounded-xl px-4 py-2 text-sm text-white font-medium"
                >
                  <option value="">Alle Aktionen</option>
                  <option value="LOGIN">Anmeldung (Login)</option>
                  <option value="FAILED_LOGIN">Fehlgeschlagene Logins</option>
                  <option value="CANCEL_ORDER">Bestellstorno</option>
                  <option value="CANCEL_ORDER_ITEM">Positionstorno</option>
                  <option value="PRICE_CHANGED">Preisänderung</option>
                  <option value="PAYMENT_RECEIVED">Zahlung</option>
                  <option value="ACTIVATE_EVENT_RKSV">RKSV-Bestätigung</option>
                  <option value="CREATE_BACKUP">Datensicherung</option>
                </select>
              </div>

              <button
                onClick={handleExportAuditCsv}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs rounded-xl shadow-md shadow-indigo-600/30 transition flex items-center gap-2 shrink-0 justify-center"
              >
                <FileSpreadsheet className="w-4 h-4" />
                Audit-Log als CSV exportieren
              </button>
            </div>

            {/* Audit Log Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="text-slate-400 border-b border-slate-700/50 text-xs uppercase font-semibold">
                    <th className="pb-3">Zeitpunkt</th>
                    <th className="pb-3">Aktion</th>
                    <th className="pb-3">Benutzer</th>
                    <th className="pb-3">Entität</th>
                    <th className="pb-3">Details & Begründung</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700/50 text-sm">
                  {data.map((log: AuditLogItem) => (
                    <tr key={log.id} className="hover:bg-slate-800/30 transition-colors">
                      <td className="py-3.5 whitespace-nowrap text-slate-300 font-mono text-xs">
                        {new Date(log.createdAt).toLocaleString('de-AT')}
                      </td>
                      <td className="py-3.5">
                        {getActionBadge(log.action)}
                      </td>
                      <td className="py-3.5 text-slate-200">
                        {log.user ? (
                          <div className="flex items-center gap-2">
                            <span className="font-semibold">{log.user.username}</span>
                            <span className="text-[10px] bg-slate-800 px-1.5 py-0.5 rounded text-slate-400">{log.user.role}</span>
                          </div>
                        ) : (
                          <span className="text-slate-500 italic">System</span>
                        )}
                      </td>
                      <td className="py-3.5 font-mono text-xs text-slate-400">
                        {log.entityType}
                      </td>
                      <td className="py-3.5 text-xs text-slate-300 font-mono max-w-md truncate">
                        {log.details ? (
                          <span title={JSON.stringify(log.details, null, 2)}>
                            {log.details.reason ? (
                              <span className="text-rose-300 font-semibold mr-2">Grund: „{log.details.reason}“</span>
                            ) : null}
                            {log.details.previousPrice ? (
                              <span className="text-amber-300 font-semibold mr-2">
                                € {(log.details.previousPrice / 100).toFixed(2)} ➔ € {(log.details.newPrice / 100).toFixed(2)}
                              </span>
                            ) : null}
                            {JSON.stringify(log.details)}
                          </span>
                        ) : '-'}
                      </td>
                    </tr>
                  ))}
                  {data.length === 0 && (
                    <tr>
                      <td colSpan={5} className="text-center py-12 text-slate-500">
                        Keine Audit-Einträge für die gewählten Filter gefunden.
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

      {/* PRODUCT MODAL */}
      {isProductModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="product-modal-title"
            onKeyDown={(e) => handleModalEscape(e, () => setIsProductModalOpen(false))}
            className="bg-slate-900 border border-slate-800 p-6 rounded-3xl max-w-lg w-full max-h-[calc(100vh-2rem)] overflow-y-auto shadow-2xl space-y-4"
          >
            <h3 id="product-modal-title" className="text-xl font-bold text-white">
              {editingProduct ? 'Produkt bearbeiten' : 'Neues Produkt anlegen'}
            </h3>
            <form onSubmit={handleSaveProductModal} className="space-y-4">
              {modalError && (
                <p role="alert" className="rounded-xl border border-rose-500/50 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
                  {modalError}
                </p>
              )}
              <div>
                <label htmlFor="product-name" className="text-xs font-bold text-slate-400 block mb-1">Produktname</label>
                <input
                  id="product-name"
                  type="text"
                  required
                  autoFocus
                  value={productFormData.name}
                  onChange={(e) => setProductFormData({ ...productFormData, name: e.target.value })}
                  className="w-full min-h-11 bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-white"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="product-euro" className="text-xs font-bold text-slate-400 block mb-1">Preis in Euro</label>
                  <input
                    id="product-euro"
                    type="number"
                    min="0"
                    step="1"
                    inputMode="numeric"
                    required
                    value={productFormData.euro}
                    onChange={(e) => setProductFormData({ ...productFormData, euro: e.target.value })}
                    className="w-full min-h-11 bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-white"
                  />
                </div>
                <div>
                  <label htmlFor="product-cent" className="text-xs font-bold text-slate-400 block mb-1">Preis in Cent</label>
                  <input
                    id="product-cent"
                    type="number"
                    min="0"
                    max="99"
                    step="1"
                    inputMode="numeric"
                    required
                    value={productFormData.cent}
                    onChange={(e) => setProductFormData({ ...productFormData, cent: e.target.value })}
                    className="w-full min-h-11 bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-white"
                  />
                </div>
              </div>
              <div>
                <label htmlFor="product-category" className="text-xs font-bold text-slate-400 block mb-1">Kategorie</label>
                <select
                  id="product-category"
                  value={productFormData.categoryId}
                  onChange={(e) => setProductFormData({ ...productFormData, categoryId: e.target.value })}
                  className="w-full min-h-11 bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-white"
                >
                  <option value="">Keine Kategorie</option>
                  {productCategories.map((category: any) => (
                    <option key={category.id} value={category.id}>{category.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="product-station" className="text-xs font-bold text-slate-400 block mb-1">Zielstation</label>
                <select
                  id="product-station"
                  value={productFormData.targetStationId}
                  onChange={(e) => setProductFormData({ ...productFormData, targetStationId: e.target.value })}
                  className="w-full min-h-11 bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-white"
                >
                  <option value="">Keine Zielstation</option>
                  {productStations.map((station: any) => (
                    <option key={station.id} value={station.id}>{station.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="product-sort-order" className="text-xs font-bold text-slate-400 block mb-1">Sortierung</label>
                <input
                  id="product-sort-order"
                  type="number"
                  step="1"
                  required
                  value={productFormData.sortOrder}
                  onChange={(e) => setProductFormData({ ...productFormData, sortOrder: e.target.value })}
                  className="w-full min-h-11 bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-white"
                />
              </div>
              <div className="flex gap-2 justify-end pt-2">
                <button
                  type="button"
                  onClick={() => setIsProductModalOpen(false)}
                  className="min-h-11 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold"
                >
                  Abbrechen
                </button>
                <button
                  type="submit"
                  disabled={isSavingModal}
                  className="min-h-11 px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60 text-white font-bold"
                >
                  {isSavingModal ? 'Speichert …' : 'Speichern'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* GENERIC ITEM MODAL (Areas, Stations, etc.) */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div role="dialog" aria-modal="true" aria-labelledby="item-modal-title" onKeyDown={(e) => handleModalEscape(e, () => setIsModalOpen(false))} className="bg-slate-900 border border-slate-800 p-6 rounded-3xl max-w-md w-full max-h-[calc(100vh-2rem)] overflow-y-auto shadow-2xl space-y-4">
            <h3 id="item-modal-title" className="text-xl font-bold text-white">
              {editingItem ? 'Eintrag bearbeiten' : 'Neu anlegen'}
            </h3>
            <form onSubmit={handleSaveModal} className="space-y-4">
              {modalError && (
                <p role="alert" className="rounded-xl border border-rose-500/50 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
                  {modalError}
                </p>
              )}
              <div>
                <label htmlFor="item-name" className="text-xs font-bold text-slate-400 block mb-1">Bezeichnung</label>
                <input
                  id="item-name"
                  type="text"
                  required
                  autoFocus={activeTab === 'stations'}
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Name..."
                  className="w-full min-h-11 bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-white"
                />
              </div>

              {activeTab === 'stations' && (
                <>
                  <div>
                    <label htmlFor="station-short-name" className="text-xs font-bold text-slate-400 block mb-1">Kurzbezeichnung</label>
                    <input
                      id="station-short-name"
                      type="text"
                      maxLength={12}
                      value={formData.shortName || ''}
                      onChange={(e) => setFormData({ ...formData, shortName: e.target.value })}
                      className="w-full min-h-11 bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-white"
                    />
                  </div>
                  <div>
                    <label htmlFor="station-printer" className="text-xs font-bold text-slate-400 block mb-1">Zugewiesener Bondrucker</label>
                    <select
                      id="station-printer"
                      value={formData.printerId || ''}
                      onChange={(e) => setFormData({ ...formData, printerId: e.target.value })}
                      className="w-full min-h-11 bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-white text-sm"
                    >
                      <option value="">Standard-Drucker verwenden</option>
                      {printersList.map((p: any) => (
                        <option key={p.id} value={p.id}>
                          {p.name} ({p.type})
                        </option>
                      ))}
                    </select>
                  </div>
                </>
              )}

              <div>
                <label htmlFor="item-sort-order" className="text-xs font-bold text-slate-400 block mb-1">Sortierung</label>
                <input
                  id="item-sort-order"
                  type="number"
                  step="1"
                  value={formData.sortOrder}
                  onChange={(e) => setFormData({ ...formData, sortOrder: Number(e.target.value) })}
                  className="w-full min-h-11 bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-white"
                />
              </div>
              <div className="flex gap-2 justify-end pt-2">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="min-h-11 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold"
                >
                  Abbrechen
                </button>
                <button
                  type="submit"
                  disabled={isSavingModal}
                  className="min-h-11 px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60 text-white font-bold"
                >
                  {isSavingModal ? 'Speichert …' : 'Speichern'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
