import { Edit2, Trash2 } from "lucide-react";

interface AdminEntityTableProps {
  items: any[];
  onEdit: (item: any) => void;
  onDelete: (id: string) => void;
}

/** Gemeinsame Listenansicht der einfachen Stammdatenbereiche. */
export const AdminEntityTable = ({
  items,
  onEdit,
  onDelete,
}: AdminEntityTableProps) => (
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
        {items.map((item, index) => (
          <tr
            key={item.id || `admin-entity-${index}`}
            className="hover:bg-slate-800/30 transition-colors"
          >
            <td className="py-4 font-semibold">
              <div>{item.name || item.username}</div>
              {item.printer && (
                <span className="text-xs text-indigo-400 font-normal flex items-center gap-1 mt-0.5">
                  🖨️ Drucker: {item.printer.name}
                </span>
              )}
            </td>
            <td className="py-4 text-sm text-slate-400">
              {item.role && (
                <span className="bg-indigo-500/20 text-indigo-300 px-2 py-1 rounded-md mr-2">
                  {item.role}
                </span>
              )}
              {item.status && (
                <span className="bg-slate-800 px-2 py-1 rounded-md">
                  {item.status}
                </span>
              )}
              {item.isActive !== undefined && (
                <span
                  className={
                    item.isActive ? "text-emerald-400" : "text-slate-500"
                  }
                >
                  {item.isActive ? "Aktiv" : "Inaktiv"}
                </span>
              )}
              {item.price !== undefined && `€ ${(item.price / 100).toFixed(2)}`}
              {item.sortOrder !== undefined && `Sortierung: ${item.sortOrder}`}
            </td>
            <td className="py-4 text-right">
              <button
                type="button"
                onClick={() => onEdit(item)}
                className="p-2 bg-slate-800 hover:bg-slate-700 rounded-lg text-slate-300 transition-colors inline-flex mr-2"
                title="Bearbeiten"
              >
                <Edit2 className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => onDelete(item.id)}
                className="p-2 bg-rose-500/20 hover:bg-rose-500/40 rounded-lg text-rose-400 transition-colors inline-flex"
                title="Löschen"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </td>
          </tr>
        ))}
        {items.length === 0 && (
          <tr>
            <td colSpan={3} className="text-center py-8 text-slate-500">
              Keine Einträge vorhanden.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  </div>
);
