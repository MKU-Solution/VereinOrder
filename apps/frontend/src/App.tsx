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
import { RoleGuard } from './components/layout/RoleGuard';
import { defaultRouteForRole, routeAccess } from './components/layout/routeAccess';
import { useAuthStore } from './store/useAuthStore';

const DefaultRoute = () => {
  const user = useAuthStore((state) => state.user);
  return <Navigate to={user ? defaultRouteForRole(user.role) : '/login'} replace />;
};

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        
        <Route element={<AuthGuard />}>
          <Route element={<AppLayout />}>
            <Route element={<RoleGuard route={routeAccess.dashboard} />}><Route path="/" element={<Dashboard />} /></Route>
            <Route element={<RoleGuard route={routeAccess.unpaid} />}><Route path="/unpaid" element={<UnpaidOrders />} /></Route>
            <Route element={<RoleGuard route={routeAccess.stations} />}><Route path="/stations" element={<StationSelection />} /></Route>
            <Route element={<RoleGuard route={routeAccess.station} />}><Route path="/stations/:id" element={<StationView />} /></Route>
            <Route element={<RoleGuard route={routeAccess.revision} />}><Route path="/revision" element={<RevisionDashboard />} /></Route>
            <Route element={<RoleGuard route={routeAccess.admin} />}><Route path="/admin" element={<AdminDashboard />} /></Route>
            <Route element={<RoleGuard route={routeAccess.cashier} />}><Route path="/cashier" element={<CashierDashboard />} /></Route>
          </Route>
        </Route>

        <Route path="*" element={<DefaultRoute />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
