import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Login } from './pages/Login';
import { AuthGuard } from './components/layout/AuthGuard';
import { AppLayout } from './components/layout/AppLayout';

// Temporary Dashboard Placeholder
const Dashboard = () => (
  <div className="glass p-6 rounded-2xl">
    <h2 className="text-2xl font-bold mb-2">Dashboard</h2>
    <p className="text-slate-400">Willkommen bei VereinOrder. Du bist erfolgreich eingeloggt.</p>
  </div>
);

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        
        <Route element={<AuthGuard />}>
          <Route element={<AppLayout />}>
            <Route path="/" element={<Dashboard />} />
            {/* Future routes: /order, /admin, etc. */}
          </Route>
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
