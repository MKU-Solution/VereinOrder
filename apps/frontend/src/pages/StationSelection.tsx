import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { MonitorPlay } from 'lucide-react';

export const StationSelection = () => {
  const [stations, setStations] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    const fetchStations = async () => {
      try {
        const res = await api.get('/stations');
        setStations(res.data);
      } catch (err) {
        console.error("Failed to load stations", err);
      } finally {
        setIsLoading(false);
      }
    };
    fetchStations();
  }, []);

  if (isLoading) return <div className="text-center py-20 text-slate-400 animate-pulse">Lade Stationen...</div>;

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div className="text-center space-y-2">
        <h1 className="text-3xl font-bold">Stationen-Monitor</h1>
        <p className="text-slate-400">Wähle eine Station aus, um die eingehenden Bestellungen zu sehen.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {stations.map(station => (
          <button
            key={station.id}
            onClick={() => navigate(`/stations/${station.id}`)}
            className="glass p-8 rounded-3xl flex flex-col items-center justify-center gap-4 hover:bg-slate-800/60 active:scale-95 transition-all group"
          >
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center shadow-lg" style={{ backgroundColor: station.color || '#6366f1' }}>
              <MonitorPlay className="w-8 h-8 text-white" />
            </div>
            <div className="text-center">
              <h2 className="text-2xl font-bold">{station.name}</h2>
              {station.shortName && <p className="text-slate-400">{station.shortName}</p>}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};
