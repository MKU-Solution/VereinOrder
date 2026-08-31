import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

import { expect, test, type Page } from "@playwright/test";

const BACKEND_URL = "http://127.0.0.1:3100";
const WORKER_TOKEN = process.env.PRINT_WORKER_TOKEN ?? "";

let worker: ChildProcessWithoutNullStreams | undefined;

/**
 * Startet den Print-Worker im Simulatorbetrieb. Damit läuft der Testdruck
 * über dieselbe Warteschlange und dieselbe Aufbereitung wie im Festbetrieb,
 * nur ohne Druckerhardware.
 */
async function startSimulatorWorker(): Promise<void> {
  const child = spawn(
    "pnpm",
    ["--filter", "@vereinorder/print-worker", "run", "dev"],
    {
      env: {
        ...process.env,
        BACKEND_URL,
        PRINT_FORCE_SIMULATOR: "1",
        PRINT_POLL_INTERVAL_MS: "500",
      },
      shell: process.platform === "win32",
      stdio: ["ignore", "pipe", "pipe"],
    },
  ) as ChildProcessWithoutNullStreams;

  worker = child;

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Print-Worker ist nicht gestartet.")),
      60_000,
    );
    child.stdout.on("data", (chunk: Buffer) => {
      if (chunk.toString().includes("worker.started")) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Print-Worker wurde mit Code ${code} beendet.`));
    });
  });
}

async function login(page: Page, username: string) {
  await page.goto("/login");
  await page.getByPlaceholder("Benutzername").fill(username);
  await page.getByPlaceholder("••••").fill("1234");
  await page.getByRole("button", { name: "Anmelden" }).click();
  await expect(page).toHaveURL(/\/$/);
}

test.describe("Testdruck über den Print-Worker", () => {
  test.skip(
    WORKER_TOKEN.length < 32,
    "PRINT_WORKER_TOKEN wird für den Print-Worker benötigt.",
  );

  test.beforeAll(async () => {
    await startSimulatorWorker();
  });

  test.afterAll(() => {
    worker?.kill();
  });

  test("Administrator löst einen Testdruck aus und sieht das Ergebnis", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await login(page, "admin");
    await page.goto("/admin");

    await page.getByRole("button", { name: /Drucker & Bon-Routing/ }).click();
    await expect(page.getByText("Hauptkasse Drucker")).toBeVisible();

    await page
      .getByRole("button", { name: /Testbon drucken/ })
      .first()
      .click();

    await expect(page.getByText("Testbon wurde gedruckt.")).toBeVisible({
      timeout: 30_000,
    });
  });

  test("Kellner erhält für den Testdruck backendseitig 403", async ({
    request,
  }) => {
    const waiterLogin = await request.post(`${BACKEND_URL}/auth/login`, {
      data: { username: "kellner1", pin: "1234" },
    });
    expect(waiterLogin.ok()).toBe(true);
    const token = (await waiterLogin.json()).access_token;

    const printers = await request.get(`${BACKEND_URL}/print-jobs/printers`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(printers.status()).toBe(403);

    const adminLogin = await request.post(`${BACKEND_URL}/auth/login`, {
      data: { username: "admin", pin: "1234" },
    });
    const adminToken = (await adminLogin.json()).access_token;
    const adminPrinters = await request.get(
      `${BACKEND_URL}/print-jobs/printers`,
      { headers: { Authorization: `Bearer ${adminToken}` } },
    );
    expect(adminPrinters.ok()).toBe(true);
    const printerId = (await adminPrinters.json())[0].id;

    const forbidden = await request.post(
      `${BACKEND_URL}/print-jobs/printers/${printerId}/test`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    expect(forbidden.status()).toBe(403);
  });
});
