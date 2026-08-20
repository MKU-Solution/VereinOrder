import { Navigate, Outlet } from 'react-router-dom';
import { useAuthStore } from '../../store/useAuthStore';
import { canAccessRoute, defaultRouteForRole, type RouteAccess } from './routeAccess';

interface RoleGuardProps {
  route: RouteAccess;
}

export const RoleGuard = ({ route }: RoleGuardProps) => {
  const user = useAuthStore((state) => state.user);

  if (!user) return <Navigate to="/login" replace />;
  if (!canAccessRoute(user.role, route)) return <Navigate to={defaultRouteForRole(user.role)} replace />;

  return <Outlet />;
};
