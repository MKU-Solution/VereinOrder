import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { StationSelection } from './pages/StationSelection';
import { StationView } from './pages/StationView';
import { RevisionDashboard } from './pages/RevisionDashboard';
import { UnpaidOrders } from './pages/UnpaidOrders';
import { AdminDashboard } from './pages/AdminDashboard';
import { CashierDashboard } from './pages/CashierDashboard';
import { AuthGuard } from './components/layout/AuthGuard';
import { AppLayout } from './components/layout/AppLayout';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        
        <Route element={<AuthGuard />}>
          <Route element={<AppLayout />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/unpaid" element={<UnpaidOrders />} />
            <Route path="/stations" element={<StationSelection />} />
            <Route path="/stations/:id" element={<StationView />} />
            <Route path="/revision" element={<RevisionDashboard />} />
            <Route path="/admin" element={<AdminDashboard />} />
            <Route path="/cashier" element={<CashierDashboard />} />
            {/* Future routes: /order, /admin, etc. */}
          </Route>
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
