import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import path from "path";

const apiProxyTarget =
  process.env.VITE_API_PROXY_TARGET || "http://localhost:3000";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.ico", "apple-touch-icon.png", "masked-icon.svg"],
      manifest: {
        name: "VereinOrder",
        short_name: "VereinOrder",
        description: "Mobiles Kassensystem für Vereine",
        theme_color: "#020617",
        background_color: "#020617",
        display: "standalone",
        icons: [
          {
            src: "pwa-192x192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  // Issue #265: Das Frontend nutzt @vereinorder/shared erstmals zur Laufzeit
  // (vorher nur Typen). Das Paket wird als CommonJS gebaut und liegt als
  // Workspace-Verknuepfung ausserhalb von node_modules. Vite behandelt es
  // deshalb als Quellcode und uebersetzt es weder im Entwicklungsserver noch
  // im Build nach ESM - der Build scheitert mit "... is not exported by
  // packages/shared/dist/index.js". Beide Eintraege sind der von Vite
  // dokumentierte Weg fuer verknuepfte CommonJS-Pakete.
  optimizeDeps: {
    include: ["@vereinorder/shared"],
  },
  build: {
    commonjsOptions: {
      include: [/packages[\\/]shared[\\/]dist[\\/]/, /node_modules/],
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: apiProxyTarget,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
      // Der Ereignisstrom laeuft ueber EventSource auf /realtime/stream, also
      // nicht ueber die Axios-Instanz mit ihrem /api-Praefix. Ohne diesen
      // Eintrag landet er beim Entwicklungsserver statt beim Backend und
      // scheitert still, weil EventSource.onerror nur schweigt. Im Betrieb
      // leitet apps/frontend/nginx.conf denselben Pfad weiter.
      "/realtime": {
        target: apiProxyTarget,
        changeOrigin: true,
      },
    },
  },
});
