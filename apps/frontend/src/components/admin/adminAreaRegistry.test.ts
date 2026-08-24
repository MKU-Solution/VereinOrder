import { describe, expect, it } from "vitest";

import {
  ADMIN_AREAS,
  ADMIN_NAVIGATION_GROUPS,
  ADMIN_PAGES,
  getAdminAreaEndpoint,
  getAdminPageByPath,
} from "./adminAreaRegistry";

describe("Admin-Bereichsregistrierung", () => {
  it("registriert jeden Verwaltungsbereich genau einmal", () => {
    expect(ADMIN_AREAS.map(({ id }) => id)).toEqual([
      "events",
      "areas",
      "stations",
      "categories",
      "products",
      "users",
      "printers",
      "backups",
      "maintenance",
      "diagnostics",
      "audit",
    ]);
    expect(new Set(ADMIN_AREAS.map(({ id }) => id)).size).toBe(11);
  });

  it("führt jede Verwaltungsseite über eine eindeutige stabile URL", () => {
    expect(ADMIN_PAGES.map(({ path }) => path)).toEqual([
      "/admin/overview",
      "/admin/events",
      "/admin/areas",
      "/admin/stations",
      "/admin/categories",
      "/admin/products",
      "/admin/users",
      "/admin/printers",
      "/admin/backups",
      "/admin/maintenance",
      "/admin/diagnostics",
      "/admin/audit",
    ]);
    expect(new Set(ADMIN_PAGES.map(({ path }) => path)).size).toBe(12);
    for (const page of ADMIN_PAGES) {
      expect(getAdminPageByPath(page.path)).toBe(page);
    }
  });

  it("bewahrt die freigegebene Gruppenreihenfolge", () => {
    expect(ADMIN_NAVIGATION_GROUPS.map(({ label }) => label)).toEqual([
      "Übersicht",
      "Betrieb",
      "Sortiment",
      "Personal",
      "System",
      "Sicherheit",
    ]);
  });

  it("bewahrt die bestehenden API-Pfade und Auditfilter", () => {
    const eventId = "event-1";
    expect(getAdminAreaEndpoint("events", eventId, "", "")).toBe("/events");
    expect(getAdminAreaEndpoint("areas", eventId, "", "")).toBe(
      "/areas?eventId=event-1",
    );
    expect(getAdminAreaEndpoint("stations", eventId, "", "")).toBe(
      "/stations/admin/all?eventId=event-1",
    );
    expect(getAdminAreaEndpoint("categories", eventId, "", "")).toBe(
      "/categories?eventId=event-1",
    );
    expect(getAdminAreaEndpoint("products", eventId, "", "")).toBe(
      "/products/admin?eventId=event-1",
    );
    expect(getAdminAreaEndpoint("users", eventId, "", "")).toBe("/users");
    expect(getAdminAreaEndpoint("printers", eventId, "", "")).toBe(
      "/print-jobs/printers",
    );
    expect(getAdminAreaEndpoint("backups", eventId, "", "")).toBe(
      "/backup/list",
    );
    expect(getAdminAreaEndpoint("diagnostics", eventId, "", "")).toBe(
      "/diagnostics/status",
    );
    expect(getAdminAreaEndpoint("audit", eventId, "LOGIN", "admin test")).toBe(
      "/audit/logs?action=LOGIN&search=admin+test",
    );
    expect(getAdminAreaEndpoint("maintenance", eventId, "", "")).toBeNull();
  });
});
