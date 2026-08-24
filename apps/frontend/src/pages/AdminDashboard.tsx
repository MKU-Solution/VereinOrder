import { ArrowRight } from "lucide-react";
import { Link, Navigate, useLocation } from "react-router-dom";

import { AdminDashboardController } from "../components/admin/AdminDashboardController";
import { getAdminPageByPath } from "../components/admin/adminAreaRegistry";

const AdminPageNotFound = () => (
  <div className="rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-xl shadow-slate-950/20">
    <p className="text-sm font-semibold text-indigo-300">Verwaltung</p>
    <h1 className="mt-1 text-2xl font-bold text-slate-50">
      Verwaltungsseite nicht gefunden
    </h1>
    <p className="mt-2 max-w-2xl leading-6 text-slate-300">
      Öffne die Betriebsübersicht oder wähle links einen Bereich. Die
      aufgerufene Adresse gehört zu keiner Verwaltungsseite.
    </p>
    <Link
      to="/admin/overview"
      replace
      className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-[10px] bg-indigo-600 px-4 py-2.5 text-sm font-bold text-slate-50 hover:bg-indigo-500 focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-amber-200"
    >
      Betriebsübersicht öffnen
      <ArrowRight aria-hidden="true" className="h-4 w-4" />
    </Link>
  </div>
);

/** URL-gesteuerter Einstiegspunkt für alle Verwaltungsunterseiten. */
export const AdminDashboard = () => {
  const location = useLocation();
  const normalizedPath =
    location.pathname.length > 1
      ? location.pathname.replace(/\/+$/, "")
      : location.pathname;

  if (normalizedPath === "/admin") {
    return <Navigate to="/admin/overview" replace />;
  }

  const page = getAdminPageByPath(normalizedPath);
  if (!page) return <AdminPageNotFound />;

  return <AdminDashboardController activePage={page.id} />;
};
