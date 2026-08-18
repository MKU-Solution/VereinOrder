# VereinOrder

**Bestellen. Bonieren. Gemeinsam feiern.**

VereinOrder ist ein eigenständiges Bestell-, Bonier- und internes Abrechnungssystem für österreichische Vereine und Feste. Es ermöglicht ehrenamtlichen Helfern auf PCs, Tablets und Smartphones, Bestellungen am Tisch aufzunehmen, direkt zu kassieren oder zentrale Bonkassen zu betreiben.

> **Wichtiger Hinweis:** VereinOrder ist **keine** RKSV-Registrierkasse und ersetzt keine gesetzlich vorgeschriebene Fiskalkasse.

## Features (MVP)
- Tischservice & zentrale Kassen (Bonkasse, Stationskasse)
- Automatische Stationsaufteilung (Küche, Schank) & Küchenmonitore
- Offline- und netzwerkresistentes Design (Idempotenz)
- Bondrucker-Unterstützung (ESC/POS via LAN/WLAN/USB)
- Vollständiger lokaler Betrieb (z. B. auf einem Raspberry Pi)

## Entwicklung
Dieses Repository verwendet ein pnpm Monorepo für Frontend, Backend und Printer-Worker.

```bash
pnpm install
pnpm dev
```
