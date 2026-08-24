import {
  Activity,
  Calendar,
  HardDrive,
  Map,
  Package,
  PowerOff,
  Printer,
  ShieldAlert,
  Store,
  Tag,
  Users,
  type LucideIcon,
} from "lucide-react";

export type AdminAreaId =
  | "events"
  | "diagnostics"
  | "areas"
  | "stations"
  | "printers"
  | "backups"
  | "maintenance"
  | "audit"
  | "categories"
  | "products"
  | "users";

export interface AdminAreaDefinition {
  id: AdminAreaId;
  label: string;
  icon: LucideIcon;
  supportsCreate: boolean;
  requiresEvent: boolean;
}

export const ADMIN_AREAS: readonly AdminAreaDefinition[] = [
  {
    id: "events",
    label: "Veranstaltungen & Lifecycle",
    icon: Calendar,
    supportsCreate: true,
    requiresEvent: false,
  },
  {
    id: "diagnostics",
    label: "System-Status & Diagnose",
    icon: Activity,
    supportsCreate: false,
    requiresEvent: false,
  },
  {
    id: "areas",
    label: "Bereiche",
    icon: Map,
    supportsCreate: true,
    requiresEvent: true,
  },
  {
    id: "stations",
    label: "Stationen",
    icon: Store,
    supportsCreate: true,
    requiresEvent: true,
  },
  {
    id: "printers",
    label: "Drucker & Bon-Routing",
    icon: Printer,
    supportsCreate: true,
    requiresEvent: false,
  },
  {
    id: "backups",
    label: "Backups & Datensicherung",
    icon: HardDrive,
    supportsCreate: false,
    requiresEvent: false,
  },
  {
    id: "maintenance",
    label: "Wartungsmodus",
    icon: PowerOff,
    supportsCreate: false,
    requiresEvent: false,
  },
  {
    id: "audit",
    label: "Audit-Protokoll & Sicherheit",
    icon: ShieldAlert,
    supportsCreate: false,
    requiresEvent: false,
  },
  {
    id: "categories",
    label: "Kategorien",
    icon: Tag,
    supportsCreate: true,
    requiresEvent: true,
  },
  {
    id: "products",
    label: "Produkte",
    icon: Package,
    supportsCreate: true,
    requiresEvent: true,
  },
  {
    id: "users",
    label: "Mitarbeiter",
    icon: Users,
    supportsCreate: true,
    requiresEvent: false,
  },
] as const;

export const getAdminAreaDefinition = (
  area: AdminAreaId,
): AdminAreaDefinition => ADMIN_AREAS.find(({ id }) => id === area)!;

export const getAdminAreaEndpoint = (
  area: AdminAreaId,
  eventId: string,
  auditFilterAction: string,
  auditSearch: string,
): string | null => {
  switch (area) {
    case "events":
      return "/events";
    case "stations":
      return `/stations/admin/all?eventId=${eventId}`;
    case "categories":
      return `/categories?eventId=${eventId}`;
    case "products":
      return `/products/admin?eventId=${eventId}`;
    case "users":
      return "/users";
    case "areas":
      return `/areas?eventId=${eventId}`;
    case "printers":
      return "/print-jobs/printers";
    case "backups":
      return "/backup/list";
    case "diagnostics":
      return "/diagnostics/status";
    case "audit": {
      const query = new URLSearchParams();
      if (auditFilterAction) query.set("action", auditFilterAction);
      if (auditSearch) query.set("search", auditSearch);
      return `/audit/logs?${query.toString()}`;
    }
    case "maintenance":
      return null;
  }
};
