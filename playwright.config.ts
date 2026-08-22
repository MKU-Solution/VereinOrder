import { defineConfig } from "@playwright/test";

const backendPort = 3100;
const frontendPort = 4174;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${frontendPort}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    ...(process.env.PLAYWRIGHT_CHANNEL === "chrome"
      ? { channel: "chrome" as const }
      : {}),
  },
  webServer: [
    {
      // Die Pakete werden hier einzeln gebaut, nicht ueber "pnpm build". Neue
      // Arbeitsbereichspakete muessen deshalb ergaenzt werden: @vereinorder/shared
      // wird zur Laufzeit von orders.service ueber seinen dist-Einstieg geladen,
      // und start:prod baut nichts nach.
      command:
        "pnpm --filter @vereinorder/shared run build && pnpm --filter @vereinorder/database run build && pnpm --filter @vereinorder/backend run build && pnpm --filter @vereinorder/backend run start:prod",
      url: `http://127.0.0.1:${backendPort}/diagnostics/status`,
      timeout: 120_000,
      reuseExistingServer: false,
      env: {
        ...process.env,
        PORT: String(backendPort),
      },
    },
    {
      command: `pnpm --filter @vereinorder/frontend exec vite --host 127.0.0.1 --port ${frontendPort}`,
      url: `http://127.0.0.1:${frontendPort}/login`,
      timeout: 120_000,
      reuseExistingServer: false,
      env: {
        ...process.env,
        VITE_API_PROXY_TARGET: `http://127.0.0.1:${backendPort}`,
      },
    },
  ],
});
