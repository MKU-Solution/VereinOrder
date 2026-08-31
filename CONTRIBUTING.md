# Beitrags- und Entwicklungsrichtlinien für VereinOrder

VereinOrder wird nach verbindlichen Qualitäts-, Sicherheits- und Teststandards entwickelt. Alle Mitwirkenden (inklusive KI-Subagenten) halten sich an folgende Regeln.

---

## 1. Unverhandelbare Kernregeln

1. **Kein Direkt-Commit auf `main`:** Alle Änderungen erfolgen über eigene Branches und Pull Requests.
2. **Lokale Pflichtprüfungen vor jedem Commit & PR:**
   - Formatierung (`npx prettier --write ...`)
   - Linting (`pnpm -r run lint`)
   - Typprüfung (`pnpm -r run typecheck`)
   - Vollständige Unittests (`pnpm -r run test`)
   - Erfolgreicher Build (`pnpm -r run build`)
3. **Echte Browserprüfung bei UI-Änderungen:**
   - Frontend-Änderungen müssen zwingend in einem echten Browser auf drei Viewports geprüft werden:
     - Mobile: ~390 × 844 px
     - Tablet: ~768 × 1024 px
     - Desktop: ~1440 × 900 px
   - Es muss sowohl mit der Rolle `ADMINISTRATOR` als auch mit `WAITER` (`kellner1`) getestet werden.
4. **Sichere Testdatenbank:**
   - Destruktive Datenbanktests und Migrationstests dürfen ausschließlich eine explizit deklarierte Testdatenbank verwenden (z. B. `VereinOrder_test`), niemals Produktiv- oder Entwicklungsdatenbanken.
5. **Autarkie:**
   - Keine externen CDNs, Google Fonts oder externen Skripte zur Laufzeit. Alle Assets müssen lokal ausgeliefert werden.
6. **Cent-Genauigkeit:**
   - Geldbeträge werden ausnahmslos als ganzzahlige Cent-Beträge (`INTEGER`) verarbeitet und gespeichert.
7. **Kein `[skip ci]`:**
   - Commit-Nachrichten und Pull-Request-Titel dürfen keine CI-Sprungmarke enthalten: weder `[skip ci]` noch die von GitHub Actions gleichwirkend ausgewerteten `[ci skip]`, `[no ci]`, `[skip actions]`, `[actions skip]` oder den Nachsatz `skip-checks:true` (bzw. `skip-checks: true`) – auch nicht für reine Dokumentationsänderungen.
   - Grund: Vom 24.08. bis 31.08.2026 lief die CI wegen eines Abrechnungsproblems gar nicht. In dieser Zeit gelangten 58 Commits ungeprüft auf `main`, 21 davon zusätzlich mit `[skip ci]` versehen. Der erste echte Lauf danach zeigte sechs rote Prüfungen mit vier Ursachen, davon zwei unmittelbar auf `[skip ci]`-Commits zurückgehend – Fehler, die je im eigenen Pull Request sofort sichtbar gewesen wären, statt gemeinsam mit drei fremden Ursachen entwirrt werden zu müssen.
   - Sobald der für `main` vorgesehene Zweigschutz greift (gebunden an die Behebung von #207), macht er dieses Verbot selbsttragend: Pflichtprüfungen müssen dann grün sein, und `[skip ci]` sorgt dafür, dass gar keine Prüfung meldet – der Merge ist damit blockiert, unabhängig davon, ob jemand die Commit-Nachricht liest. Bis der Zweigschutz eingerichtet ist, gilt das Verbot ausschließlich kraft Einhaltung durch alle Mitwirkenden, einschließlich künftiger Agenten.

---

## 2. Monorepo-Struktur

```
VereinOrder/
├── apps/
│   ├── backend/         # NestJS 10 mit Fastify
│   ├── frontend/        # React 18, Vite, Tailwind CSS
│   └── print-worker/    # Node.js Druckdienst (ESC/POS & CUPS/IPP)
├── packages/
│   ├── database/        # Prisma ORM, Schema, SQL-Migrationen & Seeds
│   └── shared/          # Gemeinsame Schnittstellen, Enums & Typen
├── docs/                # Dokumentation
└── infrastructure/      # Dockerfiles & Compose-Setups
```

---

## 3. Git- & Branch-Workflow

### Branch-Namenskonventionen

- `feat/<issue-nr>-<kurzbeschreibung>` (z. B. `feat/97-offene-vormerkungen-warnung`)
- `fix/<issue-nr>-<kurzbeschreibung>` (z. B. `fix/103-backup-restore-error`)
- `docs/<issue-nr>-<kurzbeschreibung>` (z. B. `docs/70-architektur-und-betriebsdokumentation`)
- `test/<issue-nr>-<kurzbeschreibung>` (z. B. `test/126-admin-abnahme`)
- `refactor/<issue-nr>-<kurzbeschreibung>`

### Conventional Commits

Commit-Nachrichten folgen dem Schema `<typ>(<bereich>): <beschreibung>`:

- `feat(pos): add quick sale tile mode`
- `fix(orders): validate item options during submission`
- `docs(ops): add printer troubleshooting guide`
- `test(sessions): cover cash closing with open offline queue`

---

## 4. Lokale Entwicklungsbefehle

```bash
# Gesamte Anwendung starten
pnpm dev

# Einzelne Projekte starten
pnpm --filter @vereinorder/backend start:dev
pnpm --filter @vereinorder/frontend dev
pnpm --filter @vereinorder/print-worker dev

# Prüfwerkzeuge
pnpm -r run lint         # ESLint prüfen
pnpm -r run typecheck    # TypeScript-Typprüfung
pnpm -r run test         # Vitest & Jest Unittests
pnpm -r run build        # Produktionsbuild erstellen
```
