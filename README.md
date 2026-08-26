# VereinOrder

**Bestellen. Bonieren. Gemeinsam feiern.**

VereinOrder ist ein eigenständiges, modernes Bestell-, Bonier- und internes Abrechnungssystem, das speziell für österreichische Vereine, Feuerwehren, Sportclubs und Zeltfeste entwickelt wurde. Es ermöglicht ehrenamtlichen Helfern auf handelsüblichen PCs, Notebooks, Tablets und Smartphones, Bestellungen am Tisch aufzunehmen, direkt zu kassieren, Stationskassen oder zentrale Bonkassen zu betreiben und Bons in Echtzeit auf Küchenmonitoren oder Netzwerk-/USB-Bondruckern auszugeben.

---

> [!IMPORTANT] > **Rechtlicher Hinweis (Keine RKSV-Registrierkasse):**  
> VereinOrder wird ausdrücklich **nicht** als österreichische RKSV-Registrierkasse entwickelt und ersetzt keine gesetzlich vorgeschriebene Fiskalkasse. Es dient als internes Bestell-, Bonier-, Küchen- und Auswertungssystem. Der Betreiber ist selbst dafür verantwortlich zu prüfen, ob für seinen Verein oder seine konkrete Veranstaltung Einzelaufzeichnungs-, Belegerteilungs- oder Registrierkassenpflichten bestehen.

---

## 🌟 Kernfunktionen (MVP 1.0)

- **Vollständiger Offline- & Lokaler Festbetrieb:** Läuft eigenständig im lokalen Netzwerk (z. B. auf einem Raspberry Pi 4/5 oder Mini-PC) – ohne jede Abhängigkeit von einer aktiven Internetverbindung oder externen Cloud-Diensten.
- **Vielseitige Betriebsarten:**
  - **Tischservice:** Schnelle Tischbestellung per Smartphone/Tablet mit Sofort- oder Später-Kassierung.
  - **Zentrale Bonkasse & Schnellverkauf:** Tastenbasierter Schnellverkauf mit Direktausgabe von Produktbons.
  - **Stations- & Abholkassen:** Direktbestellung an der Station mit fortlaufenden Abholnummern.
- **Automatische Stationsaufteilung:** Bestellungen werden nach Kategorien und Stationen (z. B. Küche, Schank, Grill, Bar) aufgeteilt und an interaktive Küchenmonitore sowie Bondrucker übermittelt.
- **Ausgereiftes Drucksystem:**
  - Standardmäßige Ansteuerung von ESC/POS-Netzwerkdruckern (LAN/WLAN) via Raw TCP.
  - USB-Druckeranbindung über CUPS / IPP.
  - Persistente Druckwarteschlange in PostgreSQL mit automatischem Failover auf konfigurierte Ersatzdrucker.
  - Integrierter Druckersimulator für Entwicklung und Testläufe.
- **Offline-Warteschlange (IndexedDB):** Bei kurzfristigen WLAN-Unterbrechungen am Kellner-Handy werden Bestellungen lokal zwischengespeichert und mit Idempotenz-Schlüsseln ohne Doppelbuchungen übertragen.
- **Kassensitzungen & Kassenabschluss:** Centgenaue Erfassung von Startguthaben, Barumsätzen, Soll-Bestand, gezähltem Ist-Bestand und Differenzen.
- **Datensicherung & Katastrophenschutz:** Native PostgreSQL-Dumps (`pg_dump`), automatische Vor-Migrations-Sicherungen und abgesicherte Wiederherstellung mit automatischem Wartungsmodus.
- **Audit-Log & Revisionssicherheit:** Lückenlose Protokollierung aller sicherheits-, kassen- und preisrelevanten Aktionen.

---

## 🏗️ Systemarchitektur

VereinOrder ist als **TypeScript-Monorepo** (pnpm Workspaces) strukturiert:

```
VereinOrder/
├── apps/
│   ├── backend/         # NestJS (Fastify-Adapter) REST-API & SSE-Echtzeitstream
│   ├── frontend/        # React 18 PWA mit Tailwind CSS & Lucide Icons
│   └── print-worker/    # Eigenständiger Node.js Print-Worker (ESC/POS & CUPS)
├── packages/
│   ├── database/        # Prisma ORM Schema & PostgreSQL-Migrationen
│   └── shared/          # Gemeinsame TypeScript-Typen, Enums & Validierungen
├── docs/                # Umfassende Architektur- und Betriebsdokumentation
└── infrastructure/      # Dockerfiles & Docker Compose Konfigurationen
```

---

## 🚀 Schnellstart

### 1. Lokale Entwicklung

**Voraussetzungen:** Node.js >= 20, pnpm >= 9, lokales PostgreSQL 16+.

```bash
# 1. Abhängigkeiten installieren
pnpm install

# 2. Umgebungsvariablen konfigurieren
cp .env.example .env

# 3. Datenbank vorbereiten (Migrationen & Prisma Client)
pnpm --filter @vereinorder/database run db:migrate

# 4. Gesamtes Monorepo im Entwicklungsmodus starten
pnpm dev
```

Die Dienste sind anschließend erreichbar unter:

- **Frontend:** [http://localhost:5173](http://localhost:5173)
- **Backend API:** [http://localhost:3000](http://localhost:3000)
- **Standard-Admin-Zugang:** Benutzer `admin` mit PIN `1234`

### 2. Produktionsstart via Docker Compose

```bash
# Container für Backend, Frontend, PostgreSQL und Print-Worker starten
docker compose up -d
```

---

## 📚 Dokumentationsindex

Eine vollständige Übersicht aller Fach- und Betriebsthemen findest du in der [Dokumentation](file:///c:/Users/Administrator/Documents/Projects/nodejs/VereinOrder/docs):

| Bereich            | Dokument                                                                                                                                 | Beschreibung                                                                |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| **Architektur**    | [Systemarchitektur](file:///c:/Users/Administrator/Documents/Projects/nodejs/VereinOrder/docs/architecture/uebersicht.md)                | Komponenten, Schichten, Datenfluss & Technologieentscheidungen              |
|                    | [Datenmodell & Status](file:///c:/Users/Administrator/Documents/Projects/nodejs/VereinOrder/docs/architecture/datenmodell.md)            | ER-Diagramm, PostgreSQL-Schema, Invarianten & Statusmaschinen               |
|                    | [Rollen- & Berechtigungsmatrix](file:///c:/Users/Administrator/Documents/Projects/nodejs/VereinOrder/docs/architecture/rollen-matrix.md) | Berechtigungen, Guards & Zugriffskontrolle je Benutzerrolle                 |
|                    | [ADR-Verzeichnis](file:///c:/Users/Administrator/Documents/Projects/nodejs/VereinOrder/docs/architecture/decisions/README.md)            | Architecture Decision Records zu Datensicherung, Auth u. v. m.              |
| **Schnittstellen** | [REST-API-Referenz](file:///c:/Users/Administrator/Documents/Projects/nodejs/VereinOrder/docs/api/endpunkte.md)                          | Alle Endpunkte, DTOs, Validierungen & Fehlercodes                           |
|                    | [Echtzeit-Katalog (SSE)](file:///c:/Users/Administrator/Documents/Projects/nodejs/VereinOrder/docs/api/echtzeit.md)                      | Server-Sent Events für Ausverkauft-Meldungen, Bestellungen & Druck          |
| **Betrieb (Ops)**  | [Installationsanleitung](file:///c:/Users/Administrator/Documents/Projects/nodejs/VereinOrder/docs/ops/installation.md)                  | Setup mit Docker Compose auf Servern & Mini-PCs                             |
|                    | [Raspberry Pi Handbuch](file:///c:/Users/Administrator/Documents/Projects/nodejs/VereinOrder/docs/ops/raspberry-pi.md)                   | Schritt-für-Schritt-Anleitung für Raspberry Pi OS, Access Point & mDNS      |
|                    | [Druckerhandbuch](file:///c:/Users/Administrator/Documents/Projects/nodejs/VereinOrder/docs/ops/druckerhandbuch.md)                      | ESC/POS-Netzwerkdrucker, USB-Drucker via CUPS, Failover & Fehlerbehebung    |
|                    | [Betriebs- & Wartungshandbuch](file:///c:/Users/Administrator/Documents/Projects/nodejs/VereinOrder/docs/ops/betrieb-wartung.md)         | Kassenablauf, Backups, Restore-Swap, Updates & Notfallwiederherstellung     |
|                    | [Umgebungsvariablen](file:///c:/Users/Administrator/Documents/Projects/nodejs/VereinOrder/docs/ops/umgebungsvariablen.md)                | Vollständige Referenz aller Konfigurationsschlüssel                         |
| **Bedienung**      | [Bedienungsabläufe](file:///c:/Users/Administrator/Documents/Projects/nodejs/VereinOrder/docs/product/bedienablaeufe.md)                 | Schritt-für-Schritt-Anleitungen für Admin, Kellner, Kasse, Station & Runner |
| **Entwicklung**    | [CONTRIBUTING.md](file:///c:/Users/Administrator/Documents/Projects/nodejs/VereinOrder/CONTRIBUTING.md)                                  | Beitragsrichtlinien, Qualitäts-Workflow & Teststandards                     |
|                    | [SECURITY.md](file:///c:/Users/Administrator/Documents/Projects/nodejs/VereinOrder/SECURITY.md)                                          | Sicherheitsmodell, Absicherung im lokalen Netz & Meldewege                  |
