import { useMemo, useState } from "react";
import { Edit2, User, Users } from "lucide-react";

import { AdminEmptyState } from "./AdminEmptyState";
import { UserActiveBadge, UserRoleBadge } from "./AdminStatusBadge";
import { AdminToolbar } from "./AdminToolbar";

export interface AdminUsersViewProps {
  users: any[];
  onRefresh: () => void;
  onOpenCreate: () => void;
  onEdit: (user: any) => void;
  isRefreshing?: boolean;
}

export const AdminUsersView = ({
  users,
  onRefresh,
  onOpenCreate,
  onEdit,
  isRefreshing = false,
}: AdminUsersViewProps) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");

  const filteredUsers = useMemo(() => {
    return users.filter((u) => {
      const q = searchQuery.trim().toLowerCase();
      const username = u.username || u.name || "";
      const matchesSearch = !q || username.toLowerCase().includes(q);

      const matchesRole = roleFilter === "ALL" || u.role === roleFilter;

      const isActive = u.isActive ?? true;
      const matchesStatus =
        statusFilter === "ALL" ||
        (statusFilter === "ACTIVE" && isActive) ||
        (statusFilter === "INACTIVE" && !isActive);

      return matchesSearch && matchesRole && matchesStatus;
    });
  }, [users, searchQuery, roleFilter, statusFilter]);

  const isFiltered =
    searchQuery.trim().length > 0 ||
    roleFilter !== "ALL" ||
    statusFilter !== "ALL";

  const handleResetFilters = () => {
    setSearchQuery("");
    setRoleFilter("ALL");
    setStatusFilter("ALL");
  };

  const filtersNode = (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-2">
        <label htmlFor="admin-users-role-filter" className="sr-only">
          Rolle filtern
        </label>
        <select
          id="admin-users-role-filter"
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          className="min-h-11 rounded-xl border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-bold text-slate-200 transition-colors hover:border-slate-600 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-400/30"
        >
          <option value="ALL">Alle Rollen</option>
          <option value="ADMINISTRATOR">Administrator</option>
          <option value="EVENT_MANAGER">Veranstaltungsleitung</option>
          <option value="WAITER">Kellner</option>
          <option value="CASHIER">Kasse</option>
          <option value="STATION">Station</option>
          <option value="RUNNER">Läufer</option>
          <option value="REVISION">Revision</option>
        </select>
      </div>

      <div className="flex items-center gap-2">
        <label htmlFor="admin-users-status-filter" className="sr-only">
          Status filtern
        </label>
        <select
          id="admin-users-status-filter"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="min-h-11 rounded-xl border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-bold text-slate-200 transition-colors hover:border-slate-600 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-400/30"
        >
          <option value="ALL">Alle Status</option>
          <option value="ACTIVE">Aktiv</option>
          <option value="INACTIVE">Inaktiv</option>
        </select>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <AdminToolbar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        searchPlaceholder="Benutzername suchen …"
        searchLabel="Mitarbeiter durchsuchen"
        totalCount={users.length}
        filteredCount={filteredUsers.length}
        isRefreshing={isRefreshing}
        onRefresh={onRefresh}
        filters={filtersNode}
      />

      {filteredUsers.length === 0 ? (
        <AdminEmptyState
          icon={Users}
          title="Noch keine Mitarbeiter angelegt"
          description="Lege Benutzer mit Rolle und PIN an, damit sich Kellner, Kassen und Stationspersonal anmelden können."
          actionLabel="Mitarbeiter anlegen"
          onAction={onOpenCreate}
          isFiltered={isFiltered && users.length > 0}
          onResetFilters={handleResetFilters}
        />
      ) : (
        <div className="space-y-3">
          {/* Desktop & Tablet Table */}
          <div className="hidden overflow-hidden rounded-2xl border border-slate-700/80 bg-slate-900/60 shadow-lg md:block">
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-slate-700/80 bg-slate-800/60 text-xs font-bold uppercase tracking-wider text-slate-400">
                    <th className="px-5 py-3.5">Benutzername</th>
                    <th className="px-4 py-3.5">Rolle</th>
                    <th className="px-4 py-3.5">Status</th>
                    <th className="px-5 py-3.5 text-right">Aktionen</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/80 text-sm">
                  {filteredUsers.map((user) => {
                    const username = user.username || user.name || "";
                    const isActive = user.isActive ?? true;

                    return (
                      <tr
                        key={user.id}
                        className="transition-colors hover:bg-slate-800/40"
                      >
                        <td className="px-5 py-4 font-semibold text-slate-50">
                          <div className="flex items-center gap-2.5">
                            <User
                              aria-hidden="true"
                              className="h-4 w-4 text-indigo-300"
                            />
                            <span>{username}</span>
                          </div>
                        </td>
                        <td className="px-4 py-4">
                          <UserRoleBadge role={user.role} />
                        </td>
                        <td className="px-4 py-4">
                          <UserActiveBadge isActive={isActive} />
                        </td>
                        <td className="px-5 py-4 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => onEdit(user)}
                              className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-lg border border-slate-700 bg-slate-800 p-2 text-slate-300 hover:bg-slate-700 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-200"
                              title="Mitarbeiter bearbeiten"
                              aria-label={`Mitarbeiter ${username} bearbeiten`}
                            >
                              <Edit2 aria-hidden="true" className="h-4 w-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Mobile Card View (390×844) */}
          <div className="space-y-2.5 md:hidden">
            {filteredUsers.map((user) => {
              const username = user.username || user.name || "";
              const isActive = user.isActive ?? true;

              return (
                <article
                  key={user.id}
                  className="flex items-center justify-between gap-3 rounded-2xl border border-slate-700/80 bg-slate-900/80 p-4 shadow-md"
                >
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex items-center gap-2">
                      <User
                        aria-hidden="true"
                        className="h-4 w-4 shrink-0 text-indigo-300"
                      />
                      <h3 className="break-words font-bold text-slate-50">
                        {username}
                      </h3>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <UserRoleBadge role={user.role} />
                      <UserActiveBadge isActive={isActive} />
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onEdit(user)}
                      className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-slate-700 bg-slate-800 p-2.5 text-slate-200 hover:bg-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-200"
                      title="Mitarbeiter bearbeiten"
                      aria-label={`Mitarbeiter ${username} bearbeiten`}
                    >
                      <Edit2 aria-hidden="true" className="h-4 w-4" />
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
