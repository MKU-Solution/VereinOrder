import { describe, expect, it } from "vitest";

import { ADMIN_AREAS, getAdminAreaEndpoint } from "./adminAreaRegistry";

describe("Admin-Bereichsregistrierung", () => {
  it("registriert jeden Verwaltungsbereich genau einmal", () => {
    expect(ADMIN_AREAS.map(({ id }) => id)).toEqual([
      "events",
      "diagnostics",
      "areas",
      "stations",
      "printers",
      "backups",
      "maintenance",
      "audit",
      "categories",
      "products",
      "users",
    ]);
    expect(new Set(ADMIN_AREAS.map(({ id }) => id)).size).toBe(11);
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
