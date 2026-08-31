import { expect, test } from "@playwright/test";

/**
 * Issue #174: Ergänzt `auth-roles.spec.ts` um den Ersteinrichtungsweg.
 *
 * ## Warum hier nur die eine Hälfte des Wegs geprüft wird
 *
 * Ein vollständiger Test des Wizards (leere Datenbank -> Formular ->
 * angemeldeter Administrator) bräuchte einen Moment mit leerer
 * Benutzertabelle. Den gibt es in diesem Auftrag nicht:
 * `.github/workflows/ci.yml` seedet über
 * `pnpm --filter @vereinorder/database exec prisma db seed` GENAU EINMAL,
 * bevor `pnpm test:e2e` startet, und `playwright.config.ts` hebt dafür
 * genau einen Backend- und einen Frontend-Server, den sich alle Dateien in
 * `e2e/` teilen. `auth-roles.spec.ts:9-15` und `printing.spec.ts` verlassen
 * sich auf genau diesen Seed (`admin`/`1234`) - ihn zu leeren, um einen
 * frischen Zustand zu erzeugen, würde also nicht einen zusätzlichen Test
 * ermöglichen, sondern zwei bestehende zerstören.
 *
 * Was sich in dieser gemeinsamen Umgebung ehrlich und ohne Seiteneffekt auf
 * andere Specs prüfen lässt, ist die andere Hälfte des Vertrags aus #174:
 * Ist die Ersteinrichtung bereits erledigt (hier: durch den Seed), ist
 * `/setup` nicht mehr erreichbar und führt zurück auf `/login`.
 *
 * Der volle Weg auf einem tatsächlich leeren System - Formular ausfüllen,
 * Fehlerfälle (abweichende Wiederholung, zu kurze PIN, bereits
 * eingerichtet), automatische Anmeldung danach - ist für diese Aufgabe
 * manuell gegen ein frisches, isoliertes Docker-Bündel auf drei Viewports
 * geprüft worden (CONTRIBUTING.md Abschnitt 1.3) und ist automatisiert über
 * `apps/frontend/src/pages/Setup.test.tsx` abgesichert, das die leere
 * Benutzertabelle über eine gemockte `GET /setup/status`-Antwort simuliert
 * - genau das, was in dieser gemeinsam genutzten E2E-Datenbank nicht
 * herstellbar ist, ohne den Seed zu zerstören.
 */
test.describe("Ersteinrichtung auf einem bereits eingerichteten System", () => {
  test("/setup ist nicht erreichbar und führt zur Anmeldemaske", async ({
    page,
  }) => {
    await page.goto("/setup");

    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByPlaceholder("Benutzername")).toBeVisible();
  });
});
