import {
  Activity,
  Calendar,
  Gauge,
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

export type AdminPageId = "overview" | AdminAreaId;

export type AdminNavigationGroupId =
  | "overview"
  | "operations"
  | "catalog"
  | "staff"
  | "system"
  | "security";

export interface AdminPageDefinition {
  id: AdminPageId;
  path: string;
  group: AdminNavigationGroupId;
  label: string;
  title: string;
  description: string;
  primaryActionLabel: string | null;
  icon: LucideIcon;
  supportsCreate: boolean;
  requiresEvent: boolean;
}

export interface AdminAreaDefinition extends AdminPageDefinition {
  id: AdminAreaId;
}

export const ADMIN_OVERVIEW: AdminPageDefinition = {
  id: "overview",
  path: "/admin/overview",
  group: "overview",
  label: "Betriebsübersicht",
  title: "Betriebsübersicht",
  description:
    "Aktive Veranstaltung, lokaler Systemzustand und Handlungsbedarf.",
  primaryActionLabel: "Status aktualisieren",
  icon: Gauge,
  supportsCreate: false,
  requiresEvent: false,
};

export const ADMIN_AREAS: readonly AdminAreaDefinition[] = [
  {
    id: "events",
    path: "/admin/events",
    group: "operations",
    label: "Veranstaltungen",
    title: "Veranstaltungen",
    description:
      "Veranstaltungen vorbereiten, testen, aktivieren und abschließen.",
    primaryActionLabel: "Veranstaltung anlegen",
    icon: Calendar,
    supportsCreate: true,
    requiresEvent: false,
  },
  {
    id: "areas",
    path: "/admin/areas",
    group: "operations",
    label: "Bereiche",
    title: "Bereiche",
    description: "Bedienbereiche und ihre Reihenfolge verwalten.",
    primaryActionLabel: "Bereich anlegen",
    icon: Map,
    supportsCreate: true,
    requiresEvent: true,
  },
  {
    id: "stations",
    path: "/admin/stations",
    group: "operations",
    label: "Stationen",
    title: "Stationen",
    description: "Ausgabe-, Küchen- und Verkaufsstationen zuordnen.",
    primaryActionLabel: "Station anlegen",
    icon: Store,
    supportsCreate: true,
    requiresEvent: true,
  },
  {
    id: "categories",
    path: "/admin/categories",
    group: "catalog",
    label: "Kategorien",
    title: "Kategorien",
    description: "Produkte verständlich gruppieren und Zielstationen vorgeben.",
    primaryActionLabel: "Kategorie anlegen",
    icon: Tag,
    supportsCreate: true,
    requiresEvent: true,
  },
  {
    id: "products",
    path: "/admin/products",
    group: "catalog",
    label: "Produkte",
    title: "Produkte",
    description: "Preise, Kategorien, Stationen und Auswahlgruppen pflegen.",
    primaryActionLabel: "Produkt anlegen",
    icon: Package,
    supportsCreate: true,
    requiresEvent: true,
  },
  {
    id: "users",
    path: "/admin/users",
    group: "staff",
    label: "Mitarbeiter",
    title: "Mitarbeiter",
    description: "Benutzer, Rollen und lokale Zugänge verwalten.",
    primaryActionLabel: "Mitarbeiter anlegen",
    icon: Users,
    supportsCreate: true,
    requiresEvent: false,
  },
  {
    id: "printers",
    path: "/admin/printers",
    group: "system",
    label: "Drucker & Bon-Routing",
    title: "Drucker & Bon-Routing",
    description: "Druckwege, Ersatzdrucker und unklare Aufträge prüfen.",
    primaryActionLabel: "Drucker anlegen",
    icon: Printer,
    supportsCreate: true,
    requiresEvent: false,
  },
  {
    id: "backups",
    path: "/admin/backups",
    group: "system",
    label: "Backups & Wiederherstellung",
    title: "Backups & Wiederherstellung",
    description:
      "Sicherungen erstellen, prüfen und kontrolliert wiederherstellen.",
    primaryActionLabel: "Datensicherung erstellen",
    icon: HardDrive,
    supportsCreate: false,
    requiresEvent: false,
  },
  {
    id: "maintenance",
    path: "/admin/maintenance",
    group: "system",
    label: "Wartungsmodus",
    title: "Wartungsmodus",
    description:
      "Schreibzugriffe für sichere Wartungsarbeiten kontrolliert sperren.",
    primaryActionLabel: null,
    icon: PowerOff,
    supportsCreate: false,
    requiresEvent: false,
  },
  {
    id: "diagnostics",
    path: "/admin/diagnostics",
    group: "system",
    label: "Systemstatus & Diagnose",
    title: "Systemstatus & Diagnose",
    description: "Backend, Datenbank, Druck und Sicherungen lokal prüfen.",
    primaryActionLabel: "Status aktualisieren",
    icon: Activity,
    supportsCreate: false,
    requiresEvent: false,
  },
  {
    id: "audit",
    path: "/admin/audit",
    group: "security",
    label: "Audit-Protokoll",
    title: "Audit-Protokoll",
    description:
      "Sicherheits- und Geldaktionen nachvollziehen und exportieren.",
    primaryActionLabel: "CSV exportieren",
    icon: ShieldAlert,
    supportsCreate: false,
    requiresEvent: false,
  },
] as const;

export const ADMIN_PAGES: readonly AdminPageDefinition[] = [
  ADMIN_OVERVIEW,
  ...ADMIN_AREAS,
];

export const ADMIN_NAVIGATION_GROUPS = [
  { id: "overview", label: "Übersicht" },
  { id: "operations", label: "Betrieb" },
  { id: "catalog", label: "Sortiment" },
  { id: "staff", label: "Personal" },
  { id: "system", label: "System" },
  { id: "security", label: "Sicherheit" },
] as const satisfies readonly {
  id: AdminNavigationGroupId;
  label: string;
}[];

export const getAdminAreaDefinition = (
  area: AdminAreaId,
): AdminAreaDefinition => ADMIN_AREAS.find(({ id }) => id === area)!;

export const getAdminPageDefinition = (
  page: AdminPageId,
): AdminPageDefinition => ADMIN_PAGES.find(({ id }) => id === page)!;

export const getAdminPageByPath = (
  pathname: string,
): AdminPageDefinition | undefined => {
  const normalized =
    pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return ADMIN_PAGES.find(({ path }) => path === normalized);
};

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
