import { describe, expect, it } from "vitest";
import {
  canAccessRoute,
  defaultRouteForRole,
  routeAccess,
} from "./routeAccess";

describe("zentrale Rollenmatrix", () => {
  it("erlaubt ausschließlich Administratoren den Verwaltungsbereich", () => {
    expect(canAccessRoute("ADMINISTRATOR", routeAccess.admin)).toBe(true);
    expect(canAccessRoute("WAITER", routeAccess.admin)).toBe(false);
  });

  it("leitet Kellner zur Bestellaufnahme", () => {
    expect(defaultRouteForRole("WAITER")).toBe("/");
  });

  it("hält Revision und Verwaltung für Kellner getrennt", () => {
    expect(canAccessRoute("WAITER", routeAccess.revision)).toBe(false);
    expect(canAccessRoute("WAITER", routeAccess.dashboard)).toBe(true);
  });
});
