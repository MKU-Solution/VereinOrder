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
 * Ist die Ersteinrichtung bereits erledigt (hier: durch den Seed), sind
 * `/setup` UND ein direkter Aufruf von `/login` nicht dauerhaft blockiert -
 * `/setup` führt zurück auf `/login`, und `/login` selbst bleibt normal
 * bedienbar (die Regressionsstelle aus der ersten Fassung, siehe
 * `RequireSetupComplete.tsx`).
 *
 * Der volle Weg auf einem tatsächlich leeren System - Formular ausfüllen,
 * Fehlerfälle (abweichende Wiederholung, zu kurze PIN, bereits
 * eingerichtet), automatische Anmeldung danach, sowie der direkte Aufruf
 * von `/login` VOR der Anlage - ist für diese Aufgabe manuell gegen ein
 * frisches, isoliertes Docker-Bündel geprüft worden (CONTRIBUTING.md
 * Abschnitt 1.3), ist automatisiert über `apps/frontend/src/pages/Setup.test.tsx`
 * und `apps/frontend/src/components/layout/RequireSetupComplete.test.tsx`
 * abgesichert (beide simulieren die leere Benutzertabelle über den
 * Setup-Status-Kontext, statt eine echte leere Datenbank zu brauchen), und
 * wird auf Schnittstellenebene zusätzlich von #192 abgedeckt - dort ist die
 * Lücke zu suchen, falls dieser Weg künftig einmal gegen eine echte leere
 * Datenbank laufen soll.
 */
test.describe("Ersteinrichtung auf einem bereits eingerichteten System", () => {
  test("/setup ist nicht erreichbar und führt zur Anmeldemaske", async ({
    page,
  }) => {
    await page.goto("/setup");

    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByPlaceholder("Benutzername")).toBeVisible();
  });

  test("/login bleibt direkt aufrufbar und funktionsfähig", async ({
    page,
  }) => {
    await page.goto("/login");

    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByPlaceholder("Benutzername")).toBeVisible();
    await expect(page.getByRole("button", { name: "Anmelden" })).toBeVisible();
  });
});
