# Lokale Test- und CI-Strategie

## Unterstützte Werkzeuge

- Node.js 20 LTS (`.nvmrc`)
- pnpm 9.15.4 (`packageManager` in `package.json`)
- PostgreSQL 16 samt `psql` für Migrationstests
- Docker mit Buildx/QEMU für AMD64-/ARM64-Images
- Chromium, installiert über Playwright

Neue Testabhängigkeiten sind reine Entwicklungsabhängigkeiten. Vitest, Testing Library,
jsdom, Playwright, ESLint und Prettier unterstützen Node.js 20 auf AMD64 und ARM64. Die
Browser-Binärdatei wird nur für End-to-End-Tests installiert und nicht in die
Festbetriebs-Images aufgenommen.

## Pflichtbefehle

```bash
pnpm install --frozen-lockfile
pnpm --filter @vereinorder/database run db:generate
pnpm test:repository
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

`format:check`, `lint` und `typecheck` verändern keine Quelldateien. Frontendtests laufen
mit Vitest und jsdom, Backend-Unit-Tests mit Jest. Der Print-Worker verwendet dieselbe
Jest-Fassung wie das Backend samt `ts-jest`; beide sind reine Entwicklungsabhängigkeiten
ohne native Bestandteile und laufen auf AMD64 und ARM64. Seine Transporttests starten
einen lokalen TCP-Server als Ersatzdrucker und benötigen keine Hardware und kein Internet.
Der Bondruck ist in `docs/development/printing.md` beschrieben.

## PostgreSQL-Integration

Destruktive Datenbanktests werden nur ausgeführt, wenn alle drei Bedingungen erfüllt sind:

1. Host ist `localhost`, `127.0.0.1` oder der lokale Compose-Dienst `postgres`.
2. Der Datenbankname enthält eindeutig `_test`.
3. `TEST_DATABASE_CONFIRMATION=VEREINORDER_TEST_ONLY` ist gesetzt.

Beispiel für eine isolierte Integrationstest-Datenbank:

```bash
export DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/vereinorder_integration_test?schema=public'
export TEST_DATABASE_CONFIRMATION='VEREINORDER_TEST_ONLY'
pnpm test:db-guard
pnpm --filter @vereinorder/database exec prisma migrate deploy
pnpm test:integration
```

Der Migrationstest benötigt zusätzlich eine lokale Verwaltungsverbindung. Er erzeugt und
löscht ausschließlich `vereinorder_ci_test_empty` und `vereinorder_ci_test_upgrade`:

```bash
export MIGRATION_TEST_ADMIN_URL='postgresql://postgres:postgres@127.0.0.1:5432/postgres'
pnpm test:migrations
```

Der leere Stand erhält alle Migrationen. Der Upgrade-Stand erhält zunächst alle bis auf die
neueste Migration und wird anschließend mit Prisma auf den aktuellen Stand gebracht.

## Browser-Smoke

Die Seed-Daten sind ausschließlich synthetisch (`admin` und `kellner1`, Test-PIN `1234`).
Vor dem Lauf muss die geprüfte E2E-Testdatenbank migriert und geseedet sein:

```bash
pnpm playwright:install
pnpm test:e2e
```

Ist lokales Google Chrome bereits installiert, kann ohne zusätzlichen Browserdownload mit
`PLAYWRIGHT_CHANNEL=chrome pnpm test:e2e` geprüft werden. CI verwendet weiterhin die explizit
installierte, reproduzierbare Chromium-Version.

Playwright startet Backend und Frontend auf den reservierten Ports 3100 und 4174, damit ein
bereits laufender lokaler Festbetrieb nicht wiederverwendet wird. Geprüft werden beide Rollen
bei 390×844, 768×1024 und 1440×900 Pixeln.

## CI-Pflichtjobs

Die Action `.github/workflows/ci.yml` umfasst:

- Repository-Hygiene, Formatierung, Linting, Typprüfung, Unit-/Komponententests und Builds
- PostgreSQL-Integration sowie Migration einer leeren und einer älteren Testdatenbank
- Rollen-Smoke im echten Chromium
- Docker-Builds für Backend, Frontend und Print-Worker auf AMD64 und ARM64
- Geheimnisprüfung über Gitleaks

Nach dem ersten grünen Pull Request werden diese Jobnamen als verpflichtende Statuschecks für
`main` konfiguriert. Das ist eine GitHub-Repository-Einstellung und wird nicht durch lokale
Dateien vorgetäuscht.
