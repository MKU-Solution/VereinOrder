import { Outlet, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../store/useAuthStore';
import { LogOut, LayoutDashboard, Wallet } from 'lucide-react';

export const AppLayout = () => {
  const logout = useAuthStore((state) => state.logout);
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col">
      {/* Top Navigation Bar */}
      <header className="glass sticky top-0 z-50 px-4 py-3 flex justify-between items-center rounded-b-2xl mb-4 mx-2 mt-2">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2 cursor-pointer" onClick={() => navigate('/')}>
            <div className="w-8 h-8 bg-indigo-500 rounded-lg flex items-center justify-center">
              <LayoutDashboard className="w-4 h-4 text-white" />
            </div>
            <span className="font-semibold text-lg bg-clip-text text-transparent bg-gradient-to-r from-white to-slate-300">
              VereinOrder
            </span>
          </div>
          
          <nav className="hidden md:flex items-center gap-2">
            <button onClick={() => navigate('/')} className="px-4 py-2 rounded-xl hover:bg-slate-800/50 text-sm font-medium text-slate-300 transition-colors">
              Bestellaufnahme
            </button>
            <button onClick={() => navigate('/unpaid')} className="px-4 py-2 rounded-xl hover:bg-slate-800/50 text-sm font-medium text-slate-300 transition-colors">
              Offene Tische
            </button>
            <button onClick={() => navigate('/stations')} className="px-4 py-2 rounded-xl hover:bg-slate-800/50 text-sm font-medium text-slate-300 transition-colors">
              Stationen
            </button>
            <button onClick={() => navigate('/revision')} className="px-4 py-2 rounded-xl hover:bg-slate-800/50 text-sm font-medium text-slate-300 transition-colors">
              Revision
            </button>
            <button onClick={() => navigate('/admin')} className="px-4 py-2 rounded-xl hover:bg-slate-800/50 text-sm font-medium text-slate-300 transition-colors text-indigo-400">
              Verwaltung
            </button>
          </nav>
        </div>
        
        <div className="flex items-center gap-2">
          <button 
            onClick={() => navigate('/cashier')}
            className="hidden sm:flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-800/50 hover:bg-slate-700/50 text-slate-300 transition-colors"
          >
            <Wallet className="w-4 h-4 text-emerald-400" />
            <span className="text-sm font-medium">Meine Kassa</span>
          </button>
          
          <button 
            onClick={handleLogout}
            className="p-2 rounded-xl bg-slate-800/50 hover:bg-slate-700/50 text-slate-300 transition-colors"
          >
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 px-4 pb-8 max-w-7xl mx-auto w-full animate-fade-in">
        <Outlet />
      </main>
    </div>
  );
};
