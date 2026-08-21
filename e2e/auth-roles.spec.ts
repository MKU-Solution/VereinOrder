import { expect, test, type Page } from "@playwright/test";

const viewports = [
  { name: "mobile", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 900 },
] as const;

async function login(page: Page, username: string) {
  await page.goto("/login");
  await page.getByPlaceholder("z.B. admin").fill(username);
  await page.getByPlaceholder("••••").fill("1234");
  await page.getByRole("button", { name: "Anmelden" }).click();
  await expect(page).toHaveURL(/\/$/);
}

async function openNavigation(page: Page, width: number) {
  if (width < 1024) {
    await page.getByRole("button", { name: "Navigation öffnen" }).click();
    await expect(
      page.getByRole("dialog", { name: "Navigation" }),
    ).toBeVisible();
  }
}

for (const viewport of viewports) {
  test.describe(`${viewport.name} ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport });

    test("Administrator sieht und erreicht die Verwaltung", async ({
      page,
    }) => {
      await login(page, "admin");
      await openNavigation(page, viewport.width);
      await expect(
        page.getByRole("button", { name: "Verwaltung" }),
      ).toBeVisible();
      await page.goto("/admin");
      await expect(page).toHaveURL(/\/admin$/);
    });

    test("Kellner sieht keine Verwaltung und wird von /admin abgewiesen", async ({
      page,
    }) => {
      await login(page, "kellner1");
      await openNavigation(page, viewport.width);
      await expect(
        page.getByRole("button", { name: "Verwaltung" }),
      ).toHaveCount(0);
      await page.goto("/admin");
      await expect(page).toHaveURL(/\/$/);
    });
  });
}
