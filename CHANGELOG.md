# Changelog – VereinOrder

Alle relevanten Änderungen und Meilensteine von VereinOrder werden in diesem Dokument dokumentiert. Das Format basiert auf [Keep a Changelog](https://keepachangelog.com/de/1.0.0/) und folgt [Semantic Versioning](https://semver.org/).

---

## [1.0.0] – MVP 1.0 Festbetrieb bereit

### Hinzugefügt (Features)

- **Veranstaltungsverwaltung & Lifecycle:**
  - Anlegen, Bearbeiten, Kopieren von Sortimenten und Verwenden von Vorlagen.
  - Strikte Trennung zwischen Testmodus (`TEST_MODE`) und Echtbetrieb (`ACTIVE`).
  - Bereinigung von Testdaten (`POST /events/:id/clean-test-data`) mit Sicherheitsabfrage.
  - Rechtlicher RKSV-Nicht-Registrierkassen-Hinweis mit protokollierter Bestätigung.
- **Kassen- & Bestellbetrieb (POS):**
  - Mobile Tischbestellungen mit touch-optimierter Bereichs- und Tischauswahl.
  - Zentraler Bonkassen-Schnellverkaufsmodus (`QuickSaleDashboard`) mit Kachelansicht für Massenbetrieb.
  - Stationskassen- & Abholkassenmodus mit fortlaufenden, tagesgenauen Abholnummern.
  - Produktoptionen, Pflicht- und Wahlauswahlen mit Mindest- und Maximalanzahl (z. B. Beilagen, Saucen).
  - Warenkorb mit Live-Bestandsanzeige, Mengeneingabe per Touch-Tastatur und nachträglicher Optionsänderung.
- **Stations- & Auslieferungsverwaltung:**
  - Automatische Aufteilung von Bestellungen auf Zielstationen (Küche, Schank, Grill).
  - Interaktiver Küchenmonitor (`StationView`) mit Echtzeit-Status, Wartezeiten und Summenansicht.
  - Zusteller- und Runner-Ansicht (`/runner`) zur Übernahme und Auslieferungsquittierung fertiger Bestellungen.
  - Ausverkauft-Echtzeitmeldung (`AVAILABLE`, `LOW`, `OUT_OF_STOCK`) über Server-Sent Events.
- **Drucksystem:**
  - Persistente PostgreSQL-Druckwarteschlange (`PrintJob`) mit automatischem Failover auf Ersatzdrucker.
  - Native ESC/POS-Ansteuerung via Raw TCP (LAN/WLAN) und USB-Druckeranbindung via CUPS/IPP.
  - Unterstützung für Küchenbons, Stationsbons, Schankbons, Produktbons und Kassenabschlüsse.
  - Integrierter Druckersimulator für Entwicklung und Tests.
- **Offline-Warteschlange & Netzwerkausfallsicherheit:**
  - Lokale IndexedDB-Warteschlange mit Idempotenz-Schlüsseln gegen Doppelbuchungen.
  - Statusverfolgung (`LOCAL_PENDING`, `SENDING`, `CONFLICT`, `CONFIRMED`, `FAILED`).
  - Warnung bei Kassenabschluss und Veranstaltungsende bei noch offenen lokalen Vormerkungen (Issue #97).
- **Kassensitzungen & Abrechnung:**
  - Centgenaue Kassenführung mit Eröffnungsbestand, Soll-/Ist-Bargeld, Differenzen und Abschlussberichten.
  - Audit-Log mit unveränderlicher Protokollierung aller sicherheits- und kassenrelevanten Transaktionen.
  - Umfassende Umsatz- und Mengenberichte mit CSV- und JSON-Export.
- **Administration & Diagnose:**
  - Neues modulares Admin-Panel mit Sidebar-Navigation, Leitstand-Übersicht und Tastaturfokus (Issue #120–#126).
  - Integrierte Systemdiagnose (Backend, Datenbank, Druck-Worker, Speicher, Uptime).
  - Native Datensicherung mit PostgreSQL Custom-Dumps, Vor-Migrations-Sicherungen und automatischem Wartungsmodus bei Wiederherstellung.

### Technische Verbesserungen & Qualität

- Vollständige Monorepo-Architektur mit TypeScript, NestJS, React, Prisma ORM und Fastify.
- Testabdeckung: 104 Testdateien mit 808 automatisierten Unittests.
- Multi-Architektur-Unterstützung für AMD64 (x86_64) und ARM64 (Raspberry Pi 4/5).
