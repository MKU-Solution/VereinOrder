import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CONFIRMATION = "VEREINORDER_TEST_ONLY";
const EMPTY_DATABASE = "vereinorder_ci_test_empty";
const UPGRADE_DATABASE = "vereinorder_ci_test_upgrade";
const DUPLICATE_DATABASE = "vereinorder_ci_test_duplicate";
const INVALID_EVENT_DATABASE = "vereinorder_ci_test_invalid_event_refs";
const EVENT_STATUS_TESTMODE_VIOLATION_DATABASE =
  "vereinorder_ci_test_event_status_testmode_violation";
const PAYMENT_TENDER_VIOLATION_DATABASE =
  "vereinorder_ci_test_payment_tender_violation";
const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const migrationsDir = resolve(repoRoot, "packages/database/prisma/migrations");
const pnpmEntryPoint = process.env.npm_execpath;
const prismaCliEntryPoint = process.env.PRISMA_CLI_ENTRYPOINT;

// Kennungen des repraesentativen Altstands fuer die Uebernahmepruefung der
// Migration "20260821140000_add_product_option_groups" (Issue #75). Fest
// verdrahtet statt zufaellig erzeugt, damit die Verifikation unten dieselben
// Werte referenzieren kann wie die Einfuegung.
const LEGACY_SEED = {
  eventId: "a0000000-0000-4000-8000-000000000001",
  categoryId: "a0000000-0000-4000-8000-000000000002",
  userId: "a0000000-0000-4000-8000-000000000003",
  // Produkt mit Varianten UND Extras.
  productBoth: "a0000000-0000-4000-8000-000000000010",
  // Produkt nur mit Varianten.
  productVariantsOnly: "a0000000-0000-4000-8000-000000000011",
  // Produkt nur mit Extras.
  productExtrasOnly: "a0000000-0000-4000-8000-000000000012",
  // Produkt ohne Varianten und ohne Extras.
  productNone: "a0000000-0000-4000-8000-000000000013",
  // Varianten von productBoth.
  variantBoth1: "a0000000-0000-4000-8000-000000000020",
  variantBoth2: "a0000000-0000-4000-8000-000000000021",
  // Varianten von productVariantsOnly, bewusst mit gleichem sortOrder, um die
  // deterministische Neuvergabe zu pruefen.
  variantOnly1: "a0000000-0000-4000-8000-000000000022",
  variantOnly2: "a0000000-0000-4000-8000-000000000023",
  // Extras von productBoth: ein positiver Aufpreis und ein Abschlag
  // (negativer Preis, ausdruecklich erlaubt).
  extraBoth1: "a0000000-0000-4000-8000-000000000030",
  extraBoth2: "a0000000-0000-4000-8000-000000000031",
  // Extras von productExtrasOnly, beide mit Preis 0 und gleichem sortOrder,
  // um Preis-0 und die deterministische Neuvergabe zusammen zu pruefen.
  extraOnly1: "a0000000-0000-4000-8000-000000000032",
  extraOnly2: "a0000000-0000-4000-8000-000000000033",
  orderId: "a0000000-0000-4000-8000-000000000040",
  orderItemId: "a0000000-0000-4000-8000-000000000041",
};

// Kennungen des repraesentativen Altstands fuer die Uebernahmepruefung der
// Migration "20260822120000_move_target_station_to_category" (Issue #84).
// Eigene Veranstaltung, damit die Auffangkategorie und die Produktzaehlung
// nicht mit dem Altstand der Produktoptionen vermengt werden.
const STATION_SEED = {
  eventId: "b0000000-0000-4000-8000-000000000001",
  // "Kueche" hat die kleinere sortOrder und gewinnt damit jeden Gleichstand.
  stationKitchen: "b0000000-0000-4000-8000-000000000002",
  stationBar: "b0000000-0000-4000-8000-000000000003",
  // Kategorie, deren Produkte alle dieselbe Station haben.
  categoryUniform: "b0000000-0000-4000-8000-000000000010",
  // Kategorie mit uneinheitlichen Stationen, ohne Produkt ohne Station.
  categoryMixed: "b0000000-0000-4000-8000-000000000011",
  // Kategorie, deren Produkte alle ohne Station sind.
  categoryNone: "b0000000-0000-4000-8000-000000000012",
  // Kategorie mit Gleichstand zwischen zwei Stationen.
  categoryTie: "b0000000-0000-4000-8000-000000000013",
  // Kategorie, in der eine Station mehrheitlich vorkommt, aber ein Produkt
  // ohne Station steht. Sie darf keine Vorgabe erhalten.
  categoryPartial: "b0000000-0000-4000-8000-000000000014",
  productUniform1: "b0000000-0000-4000-8000-000000000020",
  productUniform2: "b0000000-0000-4000-8000-000000000021",
  productMixedBar1: "b0000000-0000-4000-8000-000000000022",
  productMixedBar2: "b0000000-0000-4000-8000-000000000023",
  productMixedKitchen: "b0000000-0000-4000-8000-000000000024",
  productNone1: "b0000000-0000-4000-8000-000000000025",
  productNone2: "b0000000-0000-4000-8000-000000000026",
  productTieBar: "b0000000-0000-4000-8000-000000000027",
  productTieKitchen: "b0000000-0000-4000-8000-000000000028",
  productPartial1: "b0000000-0000-4000-8000-000000000029",
  productPartial2: "b0000000-0000-4000-8000-00000000002a",
  productPartialNone: "b0000000-0000-4000-8000-00000000002b",
  // Produkte ohne Kategorie: eines mit, eines ohne Station.
  productOrphanKitchen: "b0000000-0000-4000-8000-000000000030",
  productOrphanNone: "b0000000-0000-4000-8000-000000000031",
};

// Anzahl der Produkte der Veranstaltung aus STATION_SEED. Fest verdrahtet,
// damit ein versehentlich verlorenes oder doppeltes Produkt auffaellt.
const STATION_SEED_PRODUCT_COUNT = 14;

// Kennungen des repraesentativen Altstands fuer die Migration
// "20260823100000_add_station_sale_pickup_numbers" (Issue #66). Eigene
// Veranstaltung und eigener Benutzer, damit die Bestellzaehlung nicht mit den
// beiden anderen Altstaenden vermengt wird.
const PICKUP_SEED = {
  eventId: "c0000000-0000-4000-8000-000000000001",
  userId: "c0000000-0000-4000-8000-000000000002",
  stationId: "c0000000-0000-4000-8000-000000000003",
  // Zwei Echtbestellungen und eine Testbestellung, alle vor der Migration
  // angelegt und damit ohne Abholnummer.
  orderLive1: "c0000000-0000-4000-8000-000000000010",
  orderLive2: "c0000000-0000-4000-8000-000000000011",
  orderTest1: "c0000000-0000-4000-8000-000000000012",
};

// Betraege der Bestandsbestellungen aus PICKUP_SEED, fest verdrahtet, damit
// eine stille Veraenderung durch die Migration auffaellt.
const PICKUP_SEED_AMOUNTS = {
  live1: 1250,
  live2: 480,
  test1: 300,
};

// Altstand unmittelbar vor Issue #102. Dieselbe Bestellnummer ist in einer
// anderen Betriebsart fachlich erlaubt; innerhalb derselben Kombination aus
// Veranstaltung und Betriebsart muss die neue Migration sie abweisen.
const ORDER_NUMBER_SEED = {
  eventId: "d0000000-0000-4000-8000-000000000001",
  userId: "d0000000-0000-4000-8000-000000000002",
  orderLive: "d0000000-0000-4000-8000-000000000010",
  orderOtherMode: "d0000000-0000-4000-8000-000000000011",
  orderNumber: 900000,
};

// Gueltiger Altstand unmittelbar vor Issue #96. Alle drei abgesicherten
// Referenzen werden belegt, damit das Upgrade nicht nur auf einer leeren
// Datenbank durchlaeuft.
const EVENT_INTEGRITY_SEED = {
  eventId: "e0000000-0000-4000-8000-000000000001",
  otherEventId: "e0000000-0000-4000-8000-000000000002",
  stationId: "e0000000-0000-4000-8000-000000000010",
  otherStationId: "e0000000-0000-4000-8000-000000000011",
  categoryId: "e0000000-0000-4000-8000-000000000020",
  productId: "e0000000-0000-4000-8000-000000000030",
};

// Issue #141 erhaelt alle vier historisch gespeicherten Availability-Werte
// als manuellen Override. Der Upgrade-Test belegt ausdrücklich, dass daraus
// keine erfundenen Bestandszeilen oder Mengen entstehen.
const INVENTORY_SEED = {
  eventId: "f0000000-0000-4000-8000-000000000001",
  categoryId: "f0000000-0000-4000-8000-000000000002",
  products: {
    AVAILABLE: "f0000000-0000-4000-8000-000000000010",
    LOW_STOCK: "f0000000-0000-4000-8000-000000000011",
    OUT_OF_STOCK: "f0000000-0000-4000-8000-000000000012",
    DISABLED: "f0000000-0000-4000-8000-000000000013",
  },
};

// Gueltiger Altstand fuer die Migration
// "20260830090000_add_event_status_testmode_check" (Issue #157): eine
// Echtveranstaltung, eine Testveranstaltung und eine Veranstaltung, die aus
// TEST_MODE nach PAUSED gewechselt ist und dabei testMode=true behaelt - ein
// voellig normaler Zustand, der vom neuen CHECK-Constraint ausdruecklich NICHT
// abgewiesen werden darf.
const EVENT_STATUS_TESTMODE_SEED = {
  liveEventId: "g0000000-0000-4000-8000-000000000001",
  testEventId: "g0000000-0000-4000-8000-000000000002",
  pausedFromTestEventId: "g0000000-0000-4000-8000-000000000003",
};

// Bestandsinstanz mit einer bereits verletzenden Zeile fuer dieselbe
// Migration: eine Veranstaltung mit status=ACTIVE und testMode=true, wie sie
// nach der Untersuchung zu #152 einzig ueber das Einspielen einer alten
// JSON-Sicherung vor der Behebung von Issue #157 entstehen konnte.
const EVENT_STATUS_TESTMODE_VIOLATION_SEED = {
  eventId: "h0000000-0000-4000-8000-000000000001",
};

// Gueltiger Altstand fuer die Migration
// "20260830100000_add_payment_tender_check" (Issue #165): je eine Zahlung
// pro tatsaechlich vorkommender Kombination aus method und Bargeldfeldern -
// CASH ohne Bargeldbeleg (Tischbestellung), CASH mit vollstaendigem Beleg
// (Bon-/Stationskasse), CARD, VOUCHER und REFUND. Keine dieser fuenf Zeilen
// darf vom neuen Constraint angefasst werden.
const PAYMENT_TENDER_SEED = {
  eventId: "i0000000-0000-4000-8000-000000000001",
  userId: "i0000000-0000-4000-8000-000000000002",
  orderId: "i0000000-0000-4000-8000-000000000003",
  paymentCashNoTender: "i0000000-0000-4000-8000-000000000010",
  paymentCashWithTender: "i0000000-0000-4000-8000-000000000011",
  paymentCard: "i0000000-0000-4000-8000-000000000012",
  paymentVoucher: "i0000000-0000-4000-8000-000000000013",
  paymentRefund: "i0000000-0000-4000-8000-000000000014",
};

// Bestandsinstanz mit einer bereits verletzenden Zeile fuer dieselbe
// Migration: eine CASH-Zahlung mit tenderedAmount unter dem Betrag, wie sie
// vor Issue #165 einzig ueber das Einspielen einer alten JSON-Sicherung
// entstehen konnte.
const PAYMENT_TENDER_VIOLATION_SEED = {
  eventId: "j0000000-0000-4000-8000-000000000001",
  userId: "j0000000-0000-4000-8000-000000000002",
  orderId: "j0000000-0000-4000-8000-000000000003",
  paymentId: "j0000000-0000-4000-8000-000000000010",
};

function fail(message) {
  throw new Error(message);
}

// MIGRATION_TEST_ADMIN_URL hat immer Vorrang, damit sich am CI-Weg (siehe
// .github/workflows/ci.yml) nichts aendert. Fehlt sie, wird ersatzweise
// DATABASE_URL herangezogen, wie es jede andere datenbankgestuetzte Pruefung
// des Projekts ohnehin schon verlangt (siehe docs/development/testing.md).
// DATABASE_URL zeigt dabei ueblicherweise auf eine Testdatenbank wie
// vereinorder_integration_test, niemals auf die Verwaltungsdatenbank
// "postgres" - deshalb wird nur der Datenbankname ersetzt, Host, Zugang und
// Port bleiben unveraendert. Das Muster ist die Umkehrung von
// createTargetUrl() in
// apps/backend/test/inventory-stock-concurrency.integration-spec.ts, die aus
// derselben DATABASE_URL in die andere Richtung eine Zieldatenbank ableitet.
function resolveAdminUrlSource() {
  const explicit = process.env.MIGRATION_TEST_ADMIN_URL;
  if (explicit) {
    return { rawUrl: explicit, source: "MIGRATION_TEST_ADMIN_URL" };
  }
  const fallback = process.env.DATABASE_URL;
  if (fallback) {
    const derived = new URL(fallback);
    derived.pathname = "/postgres";
    return {
      rawUrl: derived.toString(),
      source:
        'DATABASE_URL (ersatzweise verwendet, Datenbankname durch "postgres" ersetzt)',
    };
  }
  fail(
    "MIGRATION_TEST_ADMIN_URL fehlt und auch DATABASE_URL ist nicht gesetzt. " +
      "Setze eine lokale Verwaltungsverbindung, z. B. " +
      "MIGRATION_TEST_ADMIN_URL='postgresql://<user>:<passwort>@127.0.0.1:5432/postgres', " +
      "oder DATABASE_URL auf die lokale Testdatenbank.",
  );
}

function parseAdminTarget() {
  if (process.env.TEST_DATABASE_CONFIRMATION !== CONFIRMATION) {
    fail(`TEST_DATABASE_CONFIRMATION muss exakt ${CONFIRMATION} sein.`);
  }
  const { rawUrl, source } = resolveAdminUrlSource();
  const parsed = new URL(rawUrl);
  if (!["127.0.0.1", "localhost"].includes(parsed.hostname)) {
    fail(
      `Nur eine lokale PostgreSQL-Testinstanz ist erlaubt, nicht ${parsed.hostname} (aus ${source}).`,
    );
  }
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (database !== "postgres") {
    fail(
      `${source} muss auf die Verwaltungsdatenbank postgres zeigen (gefunden: ${database || "<leer>"}).`,
    );
  }
  return parsed;
}

function postgresArgs(target, database) {
  const args = [
    "-X",
    "-v",
    "ON_ERROR_STOP=1",
    "-h",
    target.hostname,
    "-p",
    target.port || "5432",
    "-U",
    decodeURIComponent(target.username),
    "-d",
    database,
  ];
  return args;
}

// Unter Windows liegt der PostgreSQL-Client ueblicherweise NICHT auf PATH,
// sondern unter "C:\Program Files\PostgreSQL\<Hauptversion>\bin". Eine feste
// Versionsnummer (wie im Existenzcheck von
// apps/backend/test/inventory-stock-concurrency.integration-spec.ts) altert,
// sobald hier eine neuere Hauptversion installiert wird. Deshalb wird
// stattdessen das Installationsverzeichnis nach allen vorhandenen
// Versionsordnern durchsucht und die neueste installierte Version verwendet,
// bei der die gesuchte Programmdatei tatsaechlich existiert.
// MIGRATION_TEST_POSTGRES_BIN_DIR hat ausdruecklich Vorrang vor dieser Suche,
// falls PostgreSQL an einem abweichenden Ort installiert ist. Unter Linux und
// in CI (siehe .github/workflows/ci.yml) bleibt es unveraendert beim
// bisherigen Weg ueber PATH.
const WINDOWS_POSTGRES_INSTALL_ROOT = "C:\\Program Files\\PostgreSQL";
const resolvedPostgresCommands = new Map();

function windowsExecutableName(command) {
  return `${command}.exe`;
}

function findNewestWindowsPostgresBinary(command) {
  let versionDirs;
  try {
    versionDirs = readdirSync(WINDOWS_POSTGRES_INSTALL_ROOT, {
      withFileTypes: true,
    })
      .filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name))
      .map((entry) => entry.name)
      .sort((a, b) => Number(b) - Number(a));
  } catch {
    return undefined;
  }
  for (const version of versionDirs) {
    const candidate = resolve(
      WINDOWS_POSTGRES_INSTALL_ROOT,
      version,
      "bin",
      windowsExecutableName(command),
    );
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

function resolvePostgresCommand(command) {
  if (resolvedPostgresCommands.has(command)) {
    return resolvedPostgresCommands.get(command);
  }
  let resolved = command;
  const override = process.env.MIGRATION_TEST_POSTGRES_BIN_DIR;
  if (override) {
    const candidate = resolve(override, windowsExecutableName(command));
    if (!existsSync(candidate)) {
      fail(
        `MIGRATION_TEST_POSTGRES_BIN_DIR ist gesetzt, aber ${candidate} existiert nicht.`,
      );
    }
    resolved = candidate;
  } else if (process.platform === "win32") {
    resolved = findNewestWindowsPostgresBinary(command) ?? command;
  }
  resolvedPostgresCommands.set(command, resolved);
  return resolved;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: options.input ? ["pipe", "pipe", "pipe"] : "pipe",
    input: options.input,
    env: options.env || process.env,
  });
  if (result.error?.code === "ENOENT") {
    fail(
      `${command} wurde nicht gefunden. PostgreSQL-Client und pnpm müssen im PATH liegen ` +
        "(unter Windows kann alternativ MIGRATION_TEST_POSTGRES_BIN_DIR auf das bin-Verzeichnis " +
        "der PostgreSQL-Installation zeigen).",
    );
  }
  if (result.error) {
    fail(`${command} konnte nicht gestartet werden: ${result.error.message}`);
  }
  if (result.status !== 0) {
    process.stdout.write(result.stdout || "");
    process.stderr.write(result.stderr || "");
    fail(`${command} ${args.join(" ")} ist fehlgeschlagen.`);
  }
  return result.stdout;
}

function psql(target, database, sql) {
  return run(resolvePostgresCommand("psql"), postgresArgs(target, database), {
    input: sql,
    env: {
      ...process.env,
      PGPASSWORD: decodeURIComponent(target.password),
    },
  });
}

function psqlExpectFailure(target, database, sql, expectedMessage) {
  const command = resolvePostgresCommand("psql");
  const result = spawnSync(command, postgresArgs(target, database), {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    input: sql,
    env: {
      ...process.env,
      PGPASSWORD: decodeURIComponent(target.password),
    },
  });
  if (result.error?.code === "ENOENT") {
    fail(
      `${command} wurde nicht gefunden. PostgreSQL-Client und pnpm müssen im PATH liegen ` +
        "(unter Windows kann alternativ MIGRATION_TEST_POSTGRES_BIN_DIR auf das bin-Verzeichnis " +
        "der PostgreSQL-Installation zeigen).",
    );
  }
  if (result.error) {
    fail(`${command} konnte nicht gestartet werden: ${result.error.message}`);
  }
  if (result.status === 0) {
    fail("Die absichtlich ungültige Migration wurde unerwartet akzeptiert.");
  }
  const output = `${result.stdout || ""}\n${result.stderr || ""}`;
  if (!output.includes(expectedMessage)) {
    process.stdout.write(result.stdout || "");
    process.stderr.write(result.stderr || "");
    fail(
      `Die Migration scheiterte ohne die erwartete verständliche Meldung: ${expectedMessage}`,
    );
  }
  return output;
}

function databaseUrl(target, database) {
  const url = new URL(target.toString());
  url.pathname = `/${database}`;
  url.searchParams.set("schema", "public");
  return url.toString();
}

function prisma(args, targetUrl) {
  // Lokale Agenten-/Release-Umgebungen koennen die bereits installierte
  // Prisma-CLI ohne Paketmanager-Netzzugriff verwenden. CI und normale
  // Entwicklerlaeufe bleiben beim dokumentierten pnpm-Pfad.
  if (prismaCliEntryPoint) {
    return run(
      process.execPath,
      [
        prismaCliEntryPoint,
        ...args,
        "--schema",
        resolve(repoRoot, "packages/database/prisma/schema.prisma"),
      ],
      {
        env: { ...process.env, DATABASE_URL: targetUrl },
      },
    );
  }
  const command = pnpmEntryPoint ? process.execPath : "pnpm";
  const commandArgs = pnpmEntryPoint
    ? [
        pnpmEntryPoint,
        "--filter",
        "@vereinorder/database",
        "exec",
        "prisma",
        ...args,
      ]
    : ["--filter", "@vereinorder/database", "exec", "prisma", ...args];
  return run(command, commandArgs, {
    env: { ...process.env, DATABASE_URL: targetUrl },
  });
}

function recreateDatabase(target, database) {
  if (
    ![
      EMPTY_DATABASE,
      UPGRADE_DATABASE,
      DUPLICATE_DATABASE,
      INVALID_EVENT_DATABASE,
      EVENT_STATUS_TESTMODE_VIOLATION_DATABASE,
      PAYMENT_TENDER_VIOLATION_DATABASE,
    ].includes(database)
  ) {
    fail(`Unerlaubtes destruktives Datenbankziel: ${database}`);
  }
  const literal = database.replaceAll("'", "''");
  psql(
    target,
    "postgres",
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${literal}' AND pid <> pg_backend_pid();`,
  );
  psql(target, "postgres", `DROP DATABASE IF EXISTS "${database}";`);
  psql(target, "postgres", `CREATE DATABASE "${database}";`);
}

// Fuegt einen repraesentativen Altstand aus "ProductVariant"/"ProductExtra"
// ein (samt Veranstaltung, Kategorie, Produkten und einer Bestellposition,
// die auf eine Variante zeigt). Muss nach dem Einspielen aller Migrationen
// bis auf die letzte und vor deren "migrate deploy" laufen, sonst existieren
// die Quelltabellen nicht mehr bzw. die Zieltabellen noch nicht.
function seedLegacyProductOptionsSql(ids) {
  return `
INSERT INTO "User" (id, username, "pinHash", role, "isActive", "createdAt", "updatedAt")
VALUES ('${ids.userId}', 'ci-migration-test-user', 'x', 'ADMINISTRATOR'::"Role", true, now(), now());

INSERT INTO "Event" (id, name, "createdAt", "updatedAt")
VALUES ('${ids.eventId}', 'CI Migrationstest Fest', now(), now());

INSERT INTO "ProductCategory" (id, name, "eventId", "createdAt", "updatedAt")
VALUES ('${ids.categoryId}', 'CI Testkategorie', '${ids.eventId}', now(), now());

INSERT INTO "Product" (id, name, price, "categoryId", "eventId", "createdAt", "updatedAt") VALUES
('${ids.productBoth}', 'Schnitzel (Variante und Extra)', 1200, '${ids.categoryId}', '${ids.eventId}', now(), now()),
('${ids.productVariantsOnly}', 'Getraenk (nur Variante)', 200, '${ids.categoryId}', '${ids.eventId}', now(), now()),
('${ids.productExtrasOnly}', 'Pommes (nur Extra)', 350, '${ids.categoryId}', '${ids.eventId}', now(), now()),
('${ids.productNone}', 'Kaffee (ohne Optionen)', 250, '${ids.categoryId}', '${ids.eventId}', now(), now());

-- Zwei Varianten von productVariantsOnly teilen sich bewusst denselben
-- sortOrder (5), um die deterministische Neuvergabe dicht ab 0 zu pruefen.
INSERT INTO "ProductVariant" (id, name, price, "sortOrder", "productId") VALUES
('${ids.variantBoth1}', 'Klein', 250, 0, '${ids.productBoth}'),
('${ids.variantBoth2}', 'Gross', 350, 1, '${ids.productBoth}'),
('${ids.variantOnly1}', '0,3l', 200, 5, '${ids.productVariantsOnly}'),
('${ids.variantOnly2}', '0,5l', 300, 5, '${ids.productVariantsOnly}');

-- extraBoth2 ist ein Abschlag mit negativem Preis (siehe prisma/seed.ts,
-- ausdruecklich erlaubt). extraOnly1/extraOnly2 haben beide Preis 0 und
-- teilen sich denselben sortOrder (0).
INSERT INTO "ProductExtra" (id, name, price, "sortOrder", "productId") VALUES
('${ids.extraBoth1}', 'Sauce', 80, 0, '${ids.productBoth}'),
('${ids.extraBoth2}', 'Ohne Sauce (Abschlag)', -50, 1, '${ids.productBoth}'),
('${ids.extraOnly1}', 'Becher', 0, 0, '${ids.productExtrasOnly}'),
('${ids.extraOnly2}', 'Serviette', 0, 0, '${ids.productExtrasOnly}');

INSERT INTO "Order" (id, "totalAmount", "userId", "eventId", "dataMode", "createdAt", "updatedAt")
VALUES ('${ids.orderId}', 330, '${ids.userId}', '${ids.eventId}', 'TEST'::"OperationalDataMode", now(), now());

-- Diese Bestellposition zeigt ueber "variantId" auf variantBoth1 und muss
-- danach weiterhin auf eine existierende ProductOption zeigen.
INSERT INTO "OrderItem" (id, quantity, "priceAtTime", "variantId", "variantName", "orderId", "productId", "createdAt", "updatedAt")
VALUES ('${ids.orderItemId}', 1, 330, '${ids.variantBoth1}', 'Klein', '${ids.orderId}', '${ids.productBoth}', now(), now());
`;
}

// Prueft nach "migrate deploy" der letzten Migration, dass die Uebernahme
// von "ProductVariant"/"ProductExtra" nach "ProductOptionGroup"/"ProductOption"
// verlustfrei, kennungsstabil und regelkonform war. Jede DO-Anweisung bricht
// mit RAISE EXCEPTION ab; psql laeuft mit "ON_ERROR_STOP=1", ein Abbruch hier
// laesst das Skript insgesamt fehlschlagen.
function verifyProductOptionMigrationSql(ids) {
  return `
-- 1. Keine Zeile verloren: 4 Varianten + 4 Extras = 8 Optionen insgesamt.
--    Diese Testdatenbank enthaelt ausschliesslich die oben eingefuegten
--    Zeilen, keine weiteren Migrationen fuegen Daten ein.
DO $$
DECLARE
  actual int;
BEGIN
  SELECT count(*) INTO actual FROM "ProductOption";
  IF actual <> 8 THEN
    RAISE EXCEPTION 'Erwartete 8 ProductOption-Zeilen (4 Varianten + 4 Extras), gefunden %.', actual;
  END IF;
END $$;

-- 2. Kennungen, Namen und Preise unveraendert uebernommen, einschliesslich
--    des negativen Abschlags und der beiden Preis-0-Extras.
DO $$
DECLARE
  mismatched int;
BEGIN
  SELECT count(*) INTO mismatched FROM (
    VALUES
      ('${ids.variantBoth1}', 'Klein', 250),
      ('${ids.variantBoth2}', 'Gross', 350),
      ('${ids.variantOnly1}', '0,3l', 200),
      ('${ids.variantOnly2}', '0,5l', 300),
      ('${ids.extraBoth1}', 'Sauce', 80),
      ('${ids.extraBoth2}', 'Ohne Sauce (Abschlag)', -50),
      ('${ids.extraOnly1}', 'Becher', 0),
      ('${ids.extraOnly2}', 'Serviette', 0)
  ) AS expected(id, name, price)
  LEFT JOIN "ProductOption" po ON po.id = expected.id
  WHERE po.id IS NULL OR po.name <> expected.name OR po."priceEffect" <> expected.price;
  IF mismatched <> 0 THEN
    RAISE EXCEPTION 'Mindestens eine ProductOption-Zeile hat nach der Uebernahme eine falsche oder fehlende Kennung, Namen oder Preis (% Abweichungen).', mismatched;
  END IF;
END $$;

-- 3. Die Bestellposition zeigt weiterhin auf eine existierende Option.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "OrderItem" oi
    JOIN "ProductOption" po ON po.id = oi."variantId"
    WHERE oi.id = '${ids.orderItemId}'
  ) THEN
    RAISE EXCEPTION 'OrderItem.variantId zeigt nach der Migration nicht mehr auf eine existierende ProductOption.';
  END IF;
END $$;

-- 4. Ehemalige Varianten haengen an einer ABSOLUTE-Gruppe, ehemalige Extras
--    an einer SURCHARGE-Gruppe (keine Vertauschung zwischen den beiden
--    Uebernahmepfaden).
DO $$
DECLARE
  bad_count int;
BEGIN
  SELECT count(*) INTO bad_count
  FROM "ProductOption" po
  JOIN "ProductOptionGroup" g ON g.id = po."groupId"
  WHERE po.id IN ('${ids.variantBoth1}', '${ids.variantBoth2}', '${ids.variantOnly1}', '${ids.variantOnly2}')
    AND g."priceMode" <> 'ABSOLUTE';
  IF bad_count <> 0 THEN
    RAISE EXCEPTION 'Ehemalige Varianten haengen nach der Migration nicht an einer ABSOLUTE-Gruppe (% Zeilen).', bad_count;
  END IF;

  SELECT count(*) INTO bad_count
  FROM "ProductOption" po
  JOIN "ProductOptionGroup" g ON g.id = po."groupId"
  WHERE po.id IN ('${ids.extraBoth1}', '${ids.extraBoth2}', '${ids.extraOnly1}', '${ids.extraOnly2}')
    AND g."priceMode" <> 'SURCHARGE';
  IF bad_count <> 0 THEN
    RAISE EXCEPTION 'Ehemalige Extras haengen nach der Migration nicht an einer SURCHARGE-Gruppe (% Zeilen).', bad_count;
  END IF;
END $$;

-- 5. Je Produkt mit Varianten genau eine Pflicht-Einfachauswahl-Gruppe mit
--    absolutem Preis und Kachelmarke.
DO $$
DECLARE
  bad_products text;
BEGIN
  SELECT string_agg(p.id, ', ') INTO bad_products
  FROM (VALUES ('${ids.productBoth}'), ('${ids.productVariantsOnly}')) AS p(id)
  WHERE (
    SELECT count(*) FROM "ProductOptionGroup" g
    WHERE g."productId" = p.id
      AND g."priceMode" = 'ABSOLUTE'
      AND g."isRequired"
      AND g."selectionType" = 'SINGLE'
      AND g."quickSaleTiles"
  ) <> 1;
  IF bad_products IS NOT NULL THEN
    RAISE EXCEPTION 'Produkt(e) % haben nicht genau eine ABSOLUTE/Pflicht/SINGLE/quickSaleTiles-Gruppe.', bad_products;
  END IF;
END $$;

-- 6. Je Produkt mit Extras genau eine freiwillige Mehrfachauswahl-Gruppe mit
--    Aufpreis.
DO $$
DECLARE
  bad_products text;
BEGIN
  SELECT string_agg(p.id, ', ') INTO bad_products
  FROM (VALUES ('${ids.productBoth}'), ('${ids.productExtrasOnly}')) AS p(id)
  WHERE (
    SELECT count(*) FROM "ProductOptionGroup" g
    WHERE g."productId" = p.id
      AND g."priceMode" = 'SURCHARGE'
      AND NOT g."isRequired"
      AND g."selectionType" = 'MULTIPLE'
  ) <> 1;
  IF bad_products IS NOT NULL THEN
    RAISE EXCEPTION 'Produkt(e) % haben nicht genau eine freiwillige MULTIPLE/SURCHARGE-Gruppe.', bad_products;
  END IF;
END $$;

-- 7. Das Produkt ohne Varianten und Extras hat keine Gruppe erhalten.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "ProductOptionGroup" WHERE "productId" = '${ids.productNone}') THEN
    RAISE EXCEPTION 'Produkt ohne Varianten und Extras hat nach der Migration eine Gruppe erhalten.';
  END IF;
END $$;

-- 8. sortOrder ist je betroffener Gruppe dicht ab 0 und eindeutig, auch dort,
--    wo die Altdaten absichtlich gleiche sortOrder-Werte hatten.
DO $$
DECLARE
  bad_groups text;
BEGIN
  SELECT string_agg(g.id, ', ') INTO bad_groups
  FROM "ProductOptionGroup" g
  WHERE g."productId" IN ('${ids.productBoth}', '${ids.productVariantsOnly}', '${ids.productExtrasOnly}')
    AND (
      (SELECT count(DISTINCT o."sortOrder") FROM "ProductOption" o WHERE o."groupId" = g.id)
        <> (SELECT count(*) FROM "ProductOption" o WHERE o."groupId" = g.id)
      OR (SELECT min(o."sortOrder") FROM "ProductOption" o WHERE o."groupId" = g.id) <> 0
      OR (SELECT max(o."sortOrder") FROM "ProductOption" o WHERE o."groupId" = g.id)
        <> (SELECT count(*) FROM "ProductOption" o WHERE o."groupId" = g.id) - 1
    );
  IF bad_groups IS NOT NULL THEN
    RAISE EXCEPTION 'Gruppe(n) % haben nach der Uebernahme keine dichte, eindeutige sortOrder ab 0.', bad_groups;
  END IF;
END $$;
`;
}

// Fuegt einen repraesentativen Altstand fuer die Verlagerung der Zielstation
// an die Kategorie ein (Issue #84): eine Kategorie mit einheitlicher
// Station, eine mit uneinheitlichen Stationen, eine ganz ohne Station, eine
// mit Gleichstand, eine mit Mehrheit aber einem Produkt ohne Station, und zwei
// Produkte ohne Kategorie. Muss vor "migrate deploy" der zugehoerigen
// Migration laufen, sonst ist "Product"."categoryId" bereits Pflicht.
function seedLegacyTargetStationsSql(ids) {
  return `
INSERT INTO "Event" (id, name, "createdAt", "updatedAt")
VALUES ('${ids.eventId}', 'CI Migrationstest Stationen', now(), now());

-- "Kueche" hat die kleinere sortOrder und gewinnt deshalb den Gleichstand in
-- der Kategorie categoryTie.
INSERT INTO "Station" (id, name, "sortOrder", "eventId", "createdAt", "updatedAt") VALUES
('${ids.stationKitchen}', 'Kueche', 0, '${ids.eventId}', now(), now()),
('${ids.stationBar}', 'Schank', 1, '${ids.eventId}', now(), now());

INSERT INTO "ProductCategory" (id, name, "sortOrder", "eventId", "createdAt", "updatedAt") VALUES
('${ids.categoryUniform}', 'Speisen (einheitlich)', 0, '${ids.eventId}', now(), now()),
('${ids.categoryMixed}', 'Getraenke (uneinheitlich)', 1, '${ids.eventId}', now(), now()),
('${ids.categoryNone}', 'Ohne Station', 2, '${ids.eventId}', now(), now()),
('${ids.categoryTie}', 'Gleichstand', 3, '${ids.eventId}', now(), now()),
('${ids.categoryPartial}', 'Mehrheit mit Luecke', 4, '${ids.eventId}', now(), now());

INSERT INTO "Product" (id, name, price, "categoryId", "targetStationId", "eventId", "createdAt", "updatedAt") VALUES
-- Alle Produkte der Kategorie zeigen auf dieselbe Station.
('${ids.productUniform1}', 'Schnitzel', 1200, '${ids.categoryUniform}', '${ids.stationKitchen}', '${ids.eventId}', now(), now()),
('${ids.productUniform2}', 'Pommes', 350, '${ids.categoryUniform}', '${ids.stationKitchen}', '${ids.eventId}', now(), now()),
-- Zwei Produkte an der Schank, eines abweichend in der Kueche.
('${ids.productMixedBar1}', 'Bier', 400, '${ids.categoryMixed}', '${ids.stationBar}', '${ids.eventId}', now(), now()),
('${ids.productMixedBar2}', 'Wein', 450, '${ids.categoryMixed}', '${ids.stationBar}', '${ids.eventId}', now(), now()),
('${ids.productMixedKitchen}', 'Punsch (aus der Kueche)', 500, '${ids.categoryMixed}', '${ids.stationKitchen}', '${ids.eventId}', now(), now()),
-- Kategorie ganz ohne Station: beide Produkte gehen an die zentrale Ausgabe.
('${ids.productNone1}', 'Sackerl', 50, '${ids.categoryNone}', NULL, '${ids.eventId}', now(), now()),
('${ids.productNone2}', 'Pfandmarke', 200, '${ids.categoryNone}', NULL, '${ids.eventId}', now(), now()),
-- Gleichstand: je ein Produkt an Schank und Kueche.
('${ids.productTieBar}', 'Spritzer', 380, '${ids.categoryTie}', '${ids.stationBar}', '${ids.eventId}', now(), now()),
('${ids.productTieKitchen}', 'Suppe', 420, '${ids.categoryTie}', '${ids.stationKitchen}', '${ids.eventId}', now(), now()),
-- Mehrheit Kueche, aber ein Produkt ohne Station: die Kategorie darf keine
-- Vorgabe erhalten, sonst wuerde productPartialNone umgeleitet.
('${ids.productPartial1}', 'Gulasch', 900, '${ids.categoryPartial}', '${ids.stationKitchen}', '${ids.eventId}', now(), now()),
('${ids.productPartial2}', 'Knoedel', 300, '${ids.categoryPartial}', '${ids.stationKitchen}', '${ids.eventId}', now(), now()),
('${ids.productPartialNone}', 'Serviette', 0, '${ids.categoryPartial}', NULL, '${ids.eventId}', now(), now()),
-- Produkte ohne Kategorie, eines mit und eines ohne Station.
('${ids.productOrphanKitchen}', 'Tagesteller (ohne Kategorie)', 1100, NULL, '${ids.stationKitchen}', '${ids.eventId}', now(), now()),
('${ids.productOrphanNone}', 'Trinkgeld (ohne Kategorie)', 100, NULL, NULL, '${ids.eventId}', now(), now());
`;
}

// Prueft nach "migrate deploy", dass die Zielstation verlustfrei an die
// Kategorie gewandert ist: jedes Produkt loest auf dieselbe Station auf wie
// vorher, keine Zeile ging verloren, "categoryId" ist nirgends NULL. Zusaetzlich
// werden die Einzelregeln geprueft (Mehrheit, Gleichstand, Luecke, Auffangkategorie).
function verifyTargetStationMigrationSql(ids) {
  return `
-- 1. Kein Produkt hat seine Kategorie verloren, in keiner Veranstaltung.
DO $$
DECLARE
  orphaned int;
BEGIN
  SELECT count(*) INTO orphaned FROM "Product" WHERE "categoryId" IS NULL;
  IF orphaned <> 0 THEN
    RAISE EXCEPTION 'Nach der Migration haben % Produkte keine Kategorie.', orphaned;
  END IF;
END $$;

-- 2. Kein Produkt der Testveranstaltung ging verloren oder kam hinzu.
DO $$
DECLARE
  actual int;
BEGIN
  SELECT count(*) INTO actual FROM "Product" WHERE "eventId" = '${ids.eventId}';
  IF actual <> ${STATION_SEED_PRODUCT_COUNT} THEN
    RAISE EXCEPTION 'Erwartete ${STATION_SEED_PRODUCT_COUNT} Produkte in der Stations-Testveranstaltung, gefunden %.', actual;
  END IF;
END $$;

-- 3. Kernpruefung: jedes Produkt loest auf dieselbe Station auf wie vor der
--    Migration. Die erwartete Station ist die, die im Altstand am Produkt
--    stand; die neue Aufloesung ist Produktstation, sonst Kategoriestation.
DO $$
DECLARE
  drifted int;
  sample text;
BEGIN
  SELECT count(*), string_agg(q."productId", ', ' ORDER BY q."productId")
  INTO drifted, sample
  FROM (
    SELECT e."productId"
    FROM (
      VALUES
        ('${ids.productUniform1}'::text, '${ids.stationKitchen}'::text),
        ('${ids.productUniform2}', '${ids.stationKitchen}'),
        ('${ids.productMixedBar1}', '${ids.stationBar}'),
        ('${ids.productMixedBar2}', '${ids.stationBar}'),
        ('${ids.productMixedKitchen}', '${ids.stationKitchen}'),
        ('${ids.productNone1}', NULL),
        ('${ids.productNone2}', NULL),
        ('${ids.productTieBar}', '${ids.stationBar}'),
        ('${ids.productTieKitchen}', '${ids.stationKitchen}'),
        ('${ids.productPartial1}', '${ids.stationKitchen}'),
        ('${ids.productPartial2}', '${ids.stationKitchen}'),
        ('${ids.productPartialNone}', NULL),
        ('${ids.productOrphanKitchen}', '${ids.stationKitchen}'),
        ('${ids.productOrphanNone}', NULL)
    ) AS e("productId", "stationId")
    LEFT JOIN "Product" p ON p."id" = e."productId"
    LEFT JOIN "ProductCategory" c ON c."id" = p."categoryId"
    WHERE p."id" IS NULL
       OR COALESCE(p."targetStationId", c."targetStationId") IS DISTINCT FROM e."stationId"
  ) AS q;

  IF drifted <> 0 THEN
    RAISE EXCEPTION 'Nach der Migration loesen % Produkte auf eine andere Station auf als vorher: %.', drifted, sample;
  END IF;
END $$;

-- 4. Einheitliche Kategorie: die Station wandert an die Kategorie, die
--    Produkte verlieren ihren Eintrag.
DO $$
BEGIN
  IF (SELECT "targetStationId" FROM "ProductCategory" WHERE id = '${ids.categoryUniform}')
     IS DISTINCT FROM '${ids.stationKitchen}' THEN
    RAISE EXCEPTION 'Die einheitliche Kategorie hat nicht die Station ihrer Produkte uebernommen.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "Product"
    WHERE id IN ('${ids.productUniform1}', '${ids.productUniform2}')
      AND "targetStationId" IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Produkte der einheitlichen Kategorie tragen weiterhin einen eigenen Stationseintrag.';
  END IF;
END $$;

-- 5. Uneinheitliche Kategorie: die haeufigste Station gewinnt, das abweichende
--    Produkt behaelt seinen Eintrag als Ausnahme.
DO $$
BEGIN
  IF (SELECT "targetStationId" FROM "ProductCategory" WHERE id = '${ids.categoryMixed}')
     IS DISTINCT FROM '${ids.stationBar}' THEN
    RAISE EXCEPTION 'Die uneinheitliche Kategorie hat nicht die haeufigste Station uebernommen.';
  END IF;
  IF (SELECT "targetStationId" FROM "Product" WHERE id = '${ids.productMixedKitchen}')
     IS DISTINCT FROM '${ids.stationKitchen}' THEN
    RAISE EXCEPTION 'Das abweichende Produkt hat seine Ausnahme verloren.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "Product"
    WHERE id IN ('${ids.productMixedBar1}', '${ids.productMixedBar2}')
      AND "targetStationId" IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Produkte der Mehrheitsstation tragen weiterhin einen eigenen Stationseintrag.';
  END IF;
END $$;

-- 6. Kategorie ohne jede Station bleibt ohne Vorgabe.
DO $$
BEGIN
  IF (SELECT "targetStationId" FROM "ProductCategory" WHERE id = '${ids.categoryNone}') IS NOT NULL THEN
    RAISE EXCEPTION 'Die Kategorie ohne Station hat eine Vorgabe erhalten.';
  END IF;
END $$;

-- 7. Gleichstand: es entscheidet sortOrder der Station, "Kueche" vor "Schank".
DO $$
BEGIN
  IF (SELECT "targetStationId" FROM "ProductCategory" WHERE id = '${ids.categoryTie}')
     IS DISTINCT FROM '${ids.stationKitchen}' THEN
    RAISE EXCEPTION 'Der Gleichstand wurde nicht nach sortOrder der Station aufgeloest.';
  END IF;
END $$;

-- 8. Mehrheit mit Luecke: eine Vorgabe wuerde das Produkt ohne Station
--    umleiten, deshalb bleibt die Kategorie ohne Vorgabe und alle Produkte
--    behalten ihren Eintrag.
DO $$
BEGIN
  IF (SELECT "targetStationId" FROM "ProductCategory" WHERE id = '${ids.categoryPartial}') IS NOT NULL THEN
    RAISE EXCEPTION 'Eine Kategorie mit einem Produkt ohne Station hat eine Vorgabe erhalten.';
  END IF;
  IF (SELECT count(*) FROM "Product"
      WHERE id IN ('${ids.productPartial1}', '${ids.productPartial2}')
        AND "targetStationId" = '${ids.stationKitchen}') <> 2 THEN
    RAISE EXCEPTION 'Produkte einer Kategorie ohne Vorgabe haben ihren Stationseintrag verloren.';
  END IF;
END $$;

-- 9. Auffangkategorie: beide Produkte ohne Kategorie liegen in derselben,
--    neuen Kategorie ihrer Veranstaltung, diese hat keine Vorgabe, und das
--    Produkt mit Station behaelt sie als Ausnahme.
DO $$
DECLARE
  fallback_id text;
BEGIN
  SELECT "categoryId" INTO fallback_id FROM "Product" WHERE id = '${ids.productOrphanKitchen}';
  IF fallback_id IS NULL THEN
    RAISE EXCEPTION 'Das Produkt ohne Kategorie wurde keiner Auffangkategorie zugeordnet.';
  END IF;
  IF fallback_id IN (
    '${ids.categoryUniform}', '${ids.categoryMixed}', '${ids.categoryNone}',
    '${ids.categoryTie}', '${ids.categoryPartial}'
  ) THEN
    RAISE EXCEPTION 'Das Produkt ohne Kategorie wurde einer bestehenden Kategorie zugeordnet statt der Auffangkategorie.';
  END IF;
  IF (SELECT "categoryId" FROM "Product" WHERE id = '${ids.productOrphanNone}') IS DISTINCT FROM fallback_id THEN
    RAISE EXCEPTION 'Die Produkte ohne Kategorie liegen in verschiedenen Auffangkategorien.';
  END IF;
  IF (SELECT "eventId" FROM "ProductCategory" WHERE id = fallback_id) IS DISTINCT FROM '${ids.eventId}' THEN
    RAISE EXCEPTION 'Die Auffangkategorie gehoert nicht zur Veranstaltung ihrer Produkte.';
  END IF;
  IF (SELECT "targetStationId" FROM "ProductCategory" WHERE id = fallback_id) IS NOT NULL THEN
    RAISE EXCEPTION 'Die Auffangkategorie hat eine Vorgabe erhalten.';
  END IF;
  IF (SELECT "targetStationId" FROM "Product" WHERE id = '${ids.productOrphanKitchen}')
     IS DISTINCT FROM '${ids.stationKitchen}' THEN
    RAISE EXCEPTION 'Das Produkt ohne Kategorie hat seine Station verloren.';
  END IF;
END $$;

-- 10. Die Kategorie des Altstands der Produktoptionen hatte keine Station und
--     darf auch keine erhalten haben; ihre Produkte bleiben ohne Eintrag.
DO $$
BEGIN
  IF (SELECT "targetStationId" FROM "ProductCategory" WHERE id = '${LEGACY_SEED.categoryId}') IS NOT NULL THEN
    RAISE EXCEPTION 'Die Kategorie des Produktoptionen-Altstands hat eine Vorgabe erhalten.';
  END IF;
END $$;
`;
}

// Fuegt einen Altstand aus Bestellungen ein, wie er vor der Einfuehrung der
// Abholnummer aussieht (Issue #66): eine Veranstaltung mit einer Station, zwei
// Echt- und einer Testbestellung. Muss vor "migrate deploy" der zugehoerigen
// Migration laufen, sonst ist die Momentaufnahme der Selbstpruefung leer und
// die Migration wuerde einen Datenverlust nicht bemerken koennen.
function seedLegacyOrdersWithoutPickupSql(ids, amounts) {
  return `
INSERT INTO "User" (id, username, "pinHash", role, "isActive", "createdAt", "updatedAt")
VALUES ('${ids.userId}', 'ci-migration-test-kassa', 'x', 'CASHIER'::"Role", true, now(), now());

INSERT INTO "Event" (id, name, "createdAt", "updatedAt")
VALUES ('${ids.eventId}', 'CI Migrationstest Abholnummer', now(), now());

INSERT INTO "Station" (id, name, "sortOrder", "eventId", "createdAt", "updatedAt")
VALUES ('${ids.stationId}', 'Grillstation', 0, '${ids.eventId}', now(), now());

-- Bestandsbestellungen ohne Abholnummer und ohne Station. Genau diese Zeilen
-- muss die Migration unveraendert lassen.
INSERT INTO "Order" (id, "totalAmount", "userId", "eventId", "dataMode", "createdAt", "updatedAt") VALUES
('${ids.orderLive1}', ${amounts.live1}, '${ids.userId}', '${ids.eventId}', 'LIVE'::"OperationalDataMode", now(), now()),
('${ids.orderLive2}', ${amounts.live2}, '${ids.userId}', '${ids.eventId}', 'LIVE'::"OperationalDataMode", now(), now()),
('${ids.orderTest1}', ${amounts.test1}, '${ids.userId}', '${ids.eventId}', 'TEST'::"OperationalDataMode", now(), now());
`;
}

// Prueft nach "migrate deploy", dass die Einfuehrung der Abholnummer die
// Bestandsbestellungen unveraendert gelassen hat und dass die neuen Zusagen
// tatsaechlich an der Datenhaltung haengen und nicht nur im Anwendungscode:
// mehrere NULL-Nummern stoeren einander nicht, eine doppelte echte Nummer wird
// abgewiesen, und eine geloeschte Station reisst keine bezahlte Bestellung mit.
function verifyPickupNumberMigrationSql(ids, amounts) {
  return `
-- 1. Die drei Bestandsbestellungen sind unveraendert vorhanden: Anzahl,
--    Betrag und Betriebsart. Ein Datenverlust waere hier eine verschwundene
--    Zahlung.
DO $$
DECLARE
  mismatched int;
BEGIN
  SELECT count(*) INTO mismatched FROM (
    VALUES
      ('${ids.orderLive1}', ${amounts.live1}, 'LIVE'),
      ('${ids.orderLive2}', ${amounts.live2}, 'LIVE'),
      ('${ids.orderTest1}', ${amounts.test1}, 'TEST')
  ) AS expected(id, "totalAmount", "dataMode")
  LEFT JOIN "Order" o ON o.id = expected.id
  WHERE o.id IS NULL
     OR o."totalAmount" <> expected."totalAmount"
     OR o."dataMode"::text <> expected."dataMode";
  IF mismatched <> 0 THEN
    RAISE EXCEPTION 'Nach der Einfuehrung der Abholnummer fehlen oder verandern sich % Bestandsbestellungen.', mismatched;
  END IF;

  IF (SELECT count(*) FROM "Order" WHERE "eventId" = '${ids.eventId}') <> 3 THEN
    RAISE EXCEPTION 'Erwartete 3 Bestellungen in der Abholnummern-Testveranstaltung, gefunden %.',
      (SELECT count(*) FROM "Order" WHERE "eventId" = '${ids.eventId}');
  END IF;
END $$;

-- 2. Kein Bestandsdatensatz hat eine Abholnummer oder eine Station erhalten.
--    Die Migration vergibt keine Nummern; taete sie es, traegen zwei Personen
--    dieselbe.
DO $$
DECLARE
  filled int;
BEGIN
  SELECT count(*) INTO filled FROM "Order"
  WHERE "pickupNumber" IS NOT NULL OR "stationId" IS NOT NULL;
  IF filled <> 0 THEN
    RAISE EXCEPTION 'Nach der Migration tragen % Bestandsbestellungen eine Abholnummer oder eine Station.', filled;
  END IF;
END $$;

-- 3. Der Zaehler existiert und ist leer. Er wird erst beim ersten
--    Stationsverkauf angelegt; eine von der Migration vorbelegte Zeile wuerde
--    die Zaehlung bei einem falschen Stand beginnen lassen.
DO $$
BEGIN
  IF to_regclass('"EventPickupCounter"') IS NULL THEN
    RAISE EXCEPTION 'Die Tabelle EventPickupCounter fehlt nach der Migration.';
  END IF;
  IF (SELECT count(*) FROM "EventPickupCounter") <> 0 THEN
    RAISE EXCEPTION 'Die Migration hat % Zaehlerzeilen vorbelegt, erwartet waren 0.',
      (SELECT count(*) FROM "EventPickupCounter");
  END IF;
END $$;

-- 4. Der Unique-Index laesst mehrere Bestellungen ohne Abholnummer
--    nebeneinander zu. In PostgreSQL gelten NULL-Werte in einem Unique-Index
--    als verschieden; genau darauf beruht, dass die Migration auf einer
--    Bestandsdatenbank ueberhaupt laufen kann. Statt das anzunehmen, wird es
--    hier eingefuegt.
DO $$
DECLARE
  neu int;
BEGIN
  INSERT INTO "Order" (id, "totalAmount", "userId", "eventId", "dataMode", "createdAt", "updatedAt")
  SELECT gen_random_uuid()::text, 100, '${ids.userId}', '${ids.eventId}',
         'LIVE'::"OperationalDataMode", now(), now()
  FROM generate_series(1, 3);

  SELECT count(*) INTO neu FROM "Order"
  WHERE "eventId" = '${ids.eventId}' AND "dataMode" = 'LIVE' AND "pickupNumber" IS NULL;
  IF neu <> 5 THEN
    RAISE EXCEPTION 'Erwartete 5 Echtbestellungen ohne Abholnummer, gefunden %.', neu;
  END IF;
END $$;

-- 5. Zwei Bestellungen derselben Veranstaltung und Betriebsart mit derselben
--    Abholnummer werden von der Datenhaltung abgewiesen, dieselbe Nummer in
--    der anderen Betriebsart nicht. Das ist die Absicherung, die auch dann
--    haelt, wenn der Anwendungscode einmal danebengreift.
DO $$
DECLARE
  abgewiesen boolean := false;
BEGIN
  UPDATE "Order" SET "pickupNumber" = 1 WHERE id = '${ids.orderLive1}';

  BEGIN
    UPDATE "Order" SET "pickupNumber" = 1 WHERE id = '${ids.orderLive2}';
  EXCEPTION WHEN unique_violation THEN
    abgewiesen := true;
  END;

  IF NOT abgewiesen THEN
    RAISE EXCEPTION 'Zwei Bestellungen derselben Veranstaltung und Betriebsart konnten dieselbe Abholnummer tragen.';
  END IF;

  -- Dieselbe Nummer im Testbetrieb muss erlaubt bleiben, sonst waeren die
  -- beiden Zaehler faktisch doch gekoppelt.
  UPDATE "Order" SET "pickupNumber" = 1 WHERE id = '${ids.orderTest1}';
  IF (SELECT "pickupNumber" FROM "Order" WHERE id = '${ids.orderTest1}') <> 1 THEN
    RAISE EXCEPTION 'Die Abholnummer 1 wurde im Testbetrieb derselben Veranstaltung abgewiesen.';
  END IF;
END $$;

-- 6. Eine geloeschte Station reisst keine bezahlte Bestellung mit; die
--    Bestellung bleibt bestehen und verliert nur ihren Stationsvermerk
--    (ON DELETE SET NULL).
DO $$
BEGIN
  UPDATE "Order" SET "stationId" = '${ids.stationId}' WHERE id = '${ids.orderLive1}';
  DELETE FROM "Station" WHERE id = '${ids.stationId}';

  IF NOT EXISTS (SELECT 1 FROM "Order" WHERE id = '${ids.orderLive1}') THEN
    RAISE EXCEPTION 'Das Loeschen einer Station hat eine bezahlte Bestellung mitgeloescht.';
  END IF;
  IF (SELECT "stationId" FROM "Order" WHERE id = '${ids.orderLive1}') IS NOT NULL THEN
    RAISE EXCEPTION 'Die Bestellung zeigt nach dem Loeschen ihrer Station weiterhin auf sie.';
  END IF;
  IF (SELECT "pickupNumber" FROM "Order" WHERE id = '${ids.orderLive1}') <> 1 THEN
    RAISE EXCEPTION 'Die Bestellung hat beim Loeschen ihrer Station die Abholnummer verloren.';
  END IF;
END $$;
`;
}

function seedLegacyOrderNumbersSql(ids, duplicateWithinScope = false) {
  const secondMode = duplicateWithinScope ? "LIVE" : "TEST";
  return `
INSERT INTO "User" (id, username, "pinHash", role, "isActive", "createdAt", "updatedAt")
VALUES ('${ids.userId}', 'migration-order-number-user', 'x', 'CASHIER'::"Role", true, now(), now());

INSERT INTO "Event" (id, name, "testMode", status, "createdAt", "updatedAt")
VALUES ('${ids.eventId}', 'Migration Bestellnummer', false, 'DRAFT'::"EventStatus", now(), now());

-- Explizite Nummern bewegen eine SERIAL-Sequenz nicht. Im gueltigen Fall
-- beweist die zweite Betriebsart zugleich, dass der neue Schluessel nicht
-- versehentlich global angelegt wird.
INSERT INTO "Order" (
  id, "orderNumber", "totalAmount", "userId", "eventId", "dataMode", "createdAt", "updatedAt"
) VALUES
('${ids.orderLive}', ${ids.orderNumber}, 350, '${ids.userId}', '${ids.eventId}', 'LIVE'::"OperationalDataMode", now(), now()),
('${ids.orderOtherMode}', ${ids.orderNumber}, 700, '${ids.userId}', '${ids.eventId}', '${secondMode}'::"OperationalDataMode", now(), now());
`;
}

function verifyOrderNumberMigrationSql(ids) {
  return `
DO $$
DECLARE
  generated_number integer;
  duplicate_rejected boolean := false;
  index_definition text;
BEGIN
  SELECT indexdef INTO index_definition
  FROM pg_indexes
  WHERE schemaname = current_schema()
    AND indexname = 'Order_eventId_dataMode_orderNumber_key';

  IF index_definition IS NULL
     OR index_definition NOT LIKE '%("eventId", "dataMode", "orderNumber")%' THEN
    RAISE EXCEPTION 'Der zusammengesetzte Unique-Index fuer Bestellnummern fehlt oder hat die falsche Grenze: %.', index_definition;
  END IF;

  -- Die Migration muss die SERIAL-Sequenz auf das explizit geschriebene
  -- Maximum ausrichten. Sonst waere der folgende Wert wesentlich kleiner.
  INSERT INTO "Order" (
    id, "totalAmount", "userId", "eventId", "dataMode", "createdAt", "updatedAt"
  ) VALUES (
    gen_random_uuid()::text, 100, '${ids.userId}', '${ids.eventId}',
    'LIVE'::"OperationalDataMode", now(), now()
  ) RETURNING "orderNumber" INTO generated_number;

  IF generated_number <= ${ids.orderNumber} THEN
    RAISE EXCEPTION 'Bestellnummernsequenz steht auf %, erwartet wurde ein Wert groesser als das importierte Maximum %.', generated_number, ${ids.orderNumber};
  END IF;

  BEGIN
    INSERT INTO "Order" (
      id, "orderNumber", "totalAmount", "userId", "eventId", "dataMode", "createdAt", "updatedAt"
    ) VALUES (
      gen_random_uuid()::text, ${ids.orderNumber}, 100, '${ids.userId}',
      '${ids.eventId}', 'LIVE'::"OperationalDataMode", now(), now()
    );
  EXCEPTION WHEN unique_violation THEN
    duplicate_rejected := true;
  END;

  IF NOT duplicate_rejected THEN
    RAISE EXCEPTION 'Doppelte Bestellnummer innerhalb derselben Veranstaltung und Betriebsart wurde nicht abgewiesen.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM "Order"
    WHERE id = '${ids.orderOtherMode}'
      AND "dataMode" = 'TEST'::"OperationalDataMode"
      AND "orderNumber" = ${ids.orderNumber}
  ) THEN
    RAISE EXCEPTION 'Dieselbe Bestellnummer wurde im getrennten Testbetrieb nicht erhalten.';
  END IF;
END $$;
`;
}

function seedLegacyEventIntegritySql(ids) {
  return `
INSERT INTO "Event" (id, name, "createdAt", "updatedAt") VALUES
  ('${ids.eventId}', 'Migration Eventintegritaet', now(), now()),
  ('${ids.otherEventId}', 'Andere Migration Eventintegritaet', now(), now());

INSERT INTO "Station" (id, name, "sortOrder", "eventId", "createdAt", "updatedAt") VALUES
  ('${ids.stationId}', 'Ausgabe Hauptveranstaltung', 0, '${ids.eventId}', now(), now()),
  ('${ids.otherStationId}', 'Ausgabe andere Veranstaltung', 0, '${ids.otherEventId}', now(), now());

INSERT INTO "ProductCategory" (
  id, name, "eventId", "targetStationId", "createdAt", "updatedAt"
) VALUES (
  '${ids.categoryId}', 'Migration Kategorie', '${ids.eventId}', '${ids.stationId}', now(), now()
);

INSERT INTO "Product" (
  id, name, price, "categoryId", "targetStationId", "eventId", "createdAt", "updatedAt"
) VALUES (
  '${ids.productId}', 'Migration Produkt', 100, '${ids.categoryId}', '${ids.stationId}', '${ids.eventId}', now(), now()
);
`;
}

function verifyEventIntegrityMigrationSql(ids) {
  return `
-- Der gueltige Altbestand bleibt unveraendert referenzierbar.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "Product" p
    JOIN "ProductCategory" c ON c.id = p."categoryId"
    JOIN "Station" product_station ON product_station.id = p."targetStationId"
    JOIN "Station" category_station ON category_station.id = c."targetStationId"
    WHERE p.id = '${ids.productId}'
      AND p."eventId" = '${ids.eventId}'
      AND c."eventId" = '${ids.eventId}'
      AND product_station."eventId" = '${ids.eventId}'
      AND category_station."eventId" = '${ids.eventId}'
  ) THEN
    RAISE EXCEPTION 'Der gueltige Altbestand fuer die Eventintegritaet wurde nicht unveraendert erhalten.';
  END IF;
END $$;

-- Jede der drei Beziehungen wird unmittelbar von der Datenbank abgewiesen,
-- auch wenn ein Direktzugriff den Anwendungscode umgeht.
DO $$
DECLARE
  category_rejected boolean := false;
  category_station_rejected boolean := false;
  product_station_rejected boolean := false;
  station_reparent_rejected boolean := false;
BEGIN
  BEGIN
    UPDATE "Station"
    SET "eventId" = '${ids.otherEventId}'
    WHERE id = '${ids.stationId}';
  EXCEPTION WHEN foreign_key_violation THEN
    station_reparent_rejected := true;
  END;

  BEGIN
    UPDATE "Product"
    SET "eventId" = '${ids.otherEventId}'
    WHERE id = '${ids.productId}';
  EXCEPTION WHEN foreign_key_violation THEN
    category_rejected := true;
  END;

  BEGIN
    UPDATE "ProductCategory"
    SET "targetStationId" = '${ids.otherStationId}'
    WHERE id = '${ids.categoryId}';
  EXCEPTION WHEN foreign_key_violation THEN
    category_station_rejected := true;
  END;

  BEGIN
    UPDATE "Product"
    SET "targetStationId" = '${ids.otherStationId}'
    WHERE id = '${ids.productId}';
  EXCEPTION WHEN foreign_key_violation THEN
    product_station_rejected := true;
  END;

  IF NOT category_rejected THEN
    RAISE EXCEPTION 'Ein Produkt konnte seine Kategorie ueber eine andere Veranstaltung hinweg referenzieren.';
  END IF;
  IF NOT category_station_rejected THEN
    RAISE EXCEPTION 'Eine Kategorie konnte ihre Zielstation ueber eine andere Veranstaltung hinweg referenzieren.';
  END IF;
  IF NOT product_station_rejected THEN
    RAISE EXCEPTION 'Ein Produkt konnte seine Zielstation ueber eine andere Veranstaltung hinweg referenzieren.';
  END IF;
  IF NOT station_reparent_rejected THEN
    RAISE EXCEPTION 'Eine Stationsaenderung hat referenzierende Daten still in eine andere Veranstaltung verschoben.';
  END IF;
END $$;

-- Das bisherige Verhalten beim Loeschen einer Station bleibt: nur die
-- optionale Zielstation wird geloescht, die Veranstaltung bleibt erhalten.
DO $$
BEGIN
  DELETE FROM "Station" WHERE id = '${ids.stationId}';

  IF (SELECT "targetStationId" FROM "ProductCategory" WHERE id = '${ids.categoryId}') IS NOT NULL
     OR (SELECT "targetStationId" FROM "Product" WHERE id = '${ids.productId}') IS NOT NULL THEN
    RAISE EXCEPTION 'Das Loeschen einer Station hat die optionalen Zielstationen nicht auf NULL gesetzt.';
  END IF;
  IF (SELECT "eventId" FROM "ProductCategory" WHERE id = '${ids.categoryId}') IS DISTINCT FROM '${ids.eventId}'
     OR (SELECT "eventId" FROM "Product" WHERE id = '${ids.productId}') IS DISTINCT FROM '${ids.eventId}' THEN
    RAISE EXCEPTION 'Das Loeschen einer Station hat die Eventzugehoerigkeit veraendert.';
  END IF;
END $$;
`;
}

function seedLegacyAvailabilitySql(ids) {
  return `
INSERT INTO "Event" (id, name, "createdAt", "updatedAt")
VALUES ('${ids.eventId}', 'Migration Bestandsfuehrung', now(), now());
INSERT INTO "ProductCategory" (id, name, "eventId", "createdAt", "updatedAt")
VALUES ('${ids.categoryId}', 'Bestandsartikel', '${ids.eventId}', now(), now());
INSERT INTO "Product" (
  id, name, price, availability, "categoryId", "eventId", "createdAt", "updatedAt"
) VALUES
  ('${ids.products.AVAILABLE}', 'Verfuegbar', 100, 'AVAILABLE', '${ids.categoryId}', '${ids.eventId}', now(), now()),
  ('${ids.products.LOW_STOCK}', 'Knapp', 100, 'LOW_STOCK', '${ids.categoryId}', '${ids.eventId}', now(), now()),
  ('${ids.products.OUT_OF_STOCK}', 'Aus', 100, 'OUT_OF_STOCK', '${ids.categoryId}', '${ids.eventId}', now(), now()),
  ('${ids.products.DISABLED}', 'Deaktiviert', 100, 'DISABLED', '${ids.categoryId}', '${ids.eventId}', now(), now());
`;
}

function verifyInventoryMigrationSql(ids) {
  const expected = Object.entries(ids.products)
    .map(
      ([availability, id]) =>
        `('${id}', '${availability}'::"ProductAvailability")`,
    )
    .join(",\n      ");
  return `
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ${expected}
    ) AS expected(id, availability)
    LEFT JOIN "Product" p ON p.id = expected.id
    WHERE p.id IS NULL OR p.availability IS DISTINCT FROM expected.availability
  ) THEN
    RAISE EXCEPTION 'Die Bestandsmigration hat einen manuellen Availability-Override veraendert oder geloescht.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "InventoryStock" WHERE "eventId" = '${ids.eventId}'
  ) OR EXISTS (
    SELECT 1 FROM "InventoryMovement" WHERE "eventId" = '${ids.eventId}'
  ) THEN
    RAISE EXCEPTION 'Die Bestandsmigration hat aus historischen Statuswerten Mengen erfunden.';
  END IF;
END $$;
`;
}

// Fuegt den gueltigen Altstand fuer die Migration
// "20260830090000_add_event_status_testmode_check" ein (Issue #157): eine
// Echt-, eine Test- und eine aus TEST_MODE nach PAUSED gewechselte
// Veranstaltung. Muss vor der zugehoerigen Migration laufen, sonst wuerde der
// neue CHECK-Constraint bereits beim Einfuegen greifen.
function seedLegacyEventStatusTestModeSql(ids) {
  return `
INSERT INTO "Event" (id, name, status, "testMode", "createdAt", "updatedAt") VALUES
('${ids.liveEventId}', 'Migration Betriebsart Echtbetrieb', 'ACTIVE'::"EventStatus", false, now(), now()),
('${ids.testEventId}', 'Migration Betriebsart Testbetrieb', 'TEST_MODE'::"EventStatus", true, now(), now()),
('${ids.pausedFromTestEventId}', 'Migration Betriebsart pausiert aus Testbetrieb', 'PAUSED'::"EventStatus", true, now(), now());
`;
}

// Prueft nach "migrate deploy", dass die drei Bestandsveranstaltungen
// unveraendert geblieben sind (der Constraint darf keine gueltige Zeile
// anfassen - insbesondere nicht die pausierte Veranstaltung mit
// testMode=true), dass der Constraint tatsaechlich im Systemkatalog liegt und
// dass er beide unmoeglichen Kombinationen abweist, ohne eine gueltige
// Statusaenderung zu blockieren.
function verifyEventStatusTestModeMigrationSql(ids) {
  return `
-- 1. Alle drei Bestandsveranstaltungen sind unveraendert vorhanden.
DO $$
DECLARE
  mismatched int;
BEGIN
  SELECT count(*) INTO mismatched FROM (
    VALUES
      ('${ids.liveEventId}', 'ACTIVE', false),
      ('${ids.testEventId}', 'TEST_MODE', true),
      ('${ids.pausedFromTestEventId}', 'PAUSED', true)
  ) AS expected(id, status, "testMode")
  LEFT JOIN "Event" e ON e.id = expected.id
  WHERE e.id IS NULL
     OR e.status::text <> expected.status
     OR e."testMode" <> expected."testMode";
  IF mismatched <> 0 THEN
    RAISE EXCEPTION 'Der Betriebsart-Constraint hat % Bestandsveranstaltung(en) veraendert oder entfernt.', mismatched;
  END IF;
END $$;

-- 2. Der Constraint liegt tatsaechlich im Systemkatalog.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Event_status_testMode_check'
  ) THEN
    RAISE EXCEPTION 'Der CHECK-Constraint Event_status_testMode_check fehlt nach der Migration.';
  END IF;
END $$;

-- 3. Beide unmoeglichen Kombinationen werden abgewiesen, auch bei einem
--    direkten Zugriff, der den Anwendungscode umgeht.
DO $$
DECLARE
  active_rejected boolean := false;
  test_mode_rejected boolean := false;
BEGIN
  BEGIN
    UPDATE "Event" SET "testMode" = true WHERE id = '${ids.liveEventId}';
  EXCEPTION WHEN check_violation THEN
    active_rejected := true;
  END;
  IF NOT active_rejected THEN
    RAISE EXCEPTION 'ACTIVE mit testMode=true wurde von der Datenhaltung nicht abgewiesen.';
  END IF;

  BEGIN
    UPDATE "Event" SET "testMode" = false WHERE id = '${ids.testEventId}';
  EXCEPTION WHEN check_violation THEN
    test_mode_rejected := true;
  END;
  IF NOT test_mode_rejected THEN
    RAISE EXCEPTION 'TEST_MODE mit testMode=false wurde von der Datenhaltung nicht abgewiesen.';
  END IF;
END $$;

-- 4. Der Gegenbeweis: ein Wechsel zwischen PAUSED und TEST_MODE bei
--    unveraendertem testMode=true bleibt erlaubt. Ohne diesen Nachweis waere
--    nicht erkennbar, ob der Constraint versehentlich jede Kombination mit
--    testMode=true blockiert statt nur die beiden unmoeglichen.
DO $$
BEGIN
  UPDATE "Event" SET status = 'TEST_MODE'::"EventStatus"
    WHERE id = '${ids.pausedFromTestEventId}';
  UPDATE "Event" SET status = 'PAUSED'::"EventStatus"
    WHERE id = '${ids.pausedFromTestEventId}';

  IF (SELECT status FROM "Event" WHERE id = '${ids.pausedFromTestEventId}') <> 'PAUSED' THEN
    RAISE EXCEPTION 'Der Wechsel zwischen PAUSED und TEST_MODE bei gleichbleibendem testMode=true wurde faelschlich abgewiesen.';
  END IF;
END $$;
`;
}

// Fuegt eine bereits verletzende Veranstaltung ein (status=ACTIVE,
// testMode=true), wie sie vor Issue #157 einzig ueber das Einspielen einer
// alten JSON-Sicherung entstehen konnte. Wird eingespielt, bevor der neue
// CHECK-Constraint existiert - danach wuerde schon das INSERT selbst
// abgewiesen.
function seedEventStatusTestModeViolationSql(ids) {
  return `
INSERT INTO "Event" (id, name, status, "testMode", "createdAt", "updatedAt")
VALUES ('${ids.eventId}', 'Migrationstest Betriebsart Verletzung', 'ACTIVE'::"EventStatus", true, now(), now());
`;
}

// Fuegt den gueltigen Altstand fuer die Migration
// "20260830100000_add_payment_tender_check" ein (Issue #165): eine
// Veranstaltung, ein Benutzer, eine Bestellung und fuenf Zahlungen, je eine
// pro tatsaechlich vorkommender Kombination. Muss vor der zugehoerigen
// Migration laufen, sonst wuerde der neue CHECK-Constraint bereits beim
// Einfuegen greifen.
function seedLegacyPaymentTenderSql(ids) {
  return `
INSERT INTO "User" (id, username, "pinHash", role, "isActive", "createdAt", "updatedAt")
VALUES ('${ids.userId}', 'migration-payment-tender-user', 'x', 'CASHIER'::"Role", true, now(), now());

INSERT INTO "Event" (id, name, "testMode", status, "createdAt", "updatedAt")
VALUES ('${ids.eventId}', 'Migration Zahlungs-Tenderregel', false, 'DRAFT'::"EventStatus", now(), now());

INSERT INTO "Order" (
  id, "totalAmount", "userId", "eventId", "dataMode", "createdAt", "updatedAt"
) VALUES (
  '${ids.orderId}', 700, '${ids.userId}', '${ids.eventId}', 'LIVE'::"OperationalDataMode", now(), now()
);

INSERT INTO "Payment" (
  id, amount, "tenderedAmount", "changeAmount", method, status, "orderId", "createdAt", "updatedAt"
) VALUES
-- Tischbestellung ueber createOrder/addPaymentsToOrder/splitPaymentOrder:
-- CASH ohne Bargeldbeleg.
('${ids.paymentCashNoTender}', 700, NULL, 0, 'CASH'::"PaymentMethod", 'COMPLETED'::"PaymentStatus", '${ids.orderId}', now(), now()),
-- Bon-/Stationskasse: CASH mit vollstaendigem Beleg samt Wechselgeld.
('${ids.paymentCashWithTender}', 700, 1000, 300, 'CASH'::"PaymentMethod", 'COMPLETED'::"PaymentStatus", '${ids.orderId}', now(), now()),
('${ids.paymentCard}', 700, NULL, 0, 'CARD'::"PaymentMethod", 'COMPLETED'::"PaymentStatus", '${ids.orderId}', now(), now()),
('${ids.paymentVoucher}', 700, NULL, 0, 'VOUCHER'::"PaymentMethod", 'COMPLETED'::"PaymentStatus", '${ids.orderId}', now(), now()),
('${ids.paymentRefund}', 200, NULL, 0, 'REFUND'::"PaymentMethod", 'COMPLETED'::"PaymentStatus", '${ids.orderId}', now(), now());
`;
}

// Prueft nach "migrate deploy", dass alle fuenf Bestandszahlungen unveraendert
// geblieben sind (der Constraint darf keine gueltige Zeile anfassen -
// insbesondere nicht die CASH-Zahlung ohne Bargeldbeleg), dass der Constraint
// tatsaechlich im Systemkatalog liegt und dass er sowohl unmoegliche
// Kombinationen abweist als auch eine gueltige Aenderung an der
// Bar-mit-Beleg-Zahlung weiterhin zulaesst.
function verifyPaymentTenderMigrationSql(ids) {
  return `
-- 1. Alle fuenf Bestandszahlungen sind unveraendert vorhanden.
DO $$
DECLARE
  mismatched int;
BEGIN
  SELECT count(*) INTO mismatched FROM (
    VALUES
      ('${ids.paymentCashNoTender}', 'CASH', NULL::int, 0),
      ('${ids.paymentCashWithTender}', 'CASH', 1000, 300),
      ('${ids.paymentCard}', 'CARD', NULL::int, 0),
      ('${ids.paymentVoucher}', 'VOUCHER', NULL::int, 0),
      ('${ids.paymentRefund}', 'REFUND', NULL::int, 0)
  ) AS expected(id, method, "tenderedAmount", "changeAmount")
  LEFT JOIN "Payment" p ON p.id = expected.id
  WHERE p.id IS NULL
     OR p.method::text <> expected.method
     OR p."tenderedAmount" IS DISTINCT FROM expected."tenderedAmount"
     OR p."changeAmount" IS DISTINCT FROM expected."changeAmount";
  IF mismatched <> 0 THEN
    RAISE EXCEPTION 'Der Tender-Constraint hat % Bestandszahlung(en) veraendert oder entfernt.', mismatched;
  END IF;
END $$;

-- 2. Der Constraint liegt tatsaechlich im Systemkatalog.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Payment_tender_check'
  ) THEN
    RAISE EXCEPTION 'Der CHECK-Constraint Payment_tender_check fehlt nach der Migration.';
  END IF;
END $$;

-- 3. Unmoegliche Kombinationen werden abgewiesen, auch bei einem direkten
--    Zugriff, der den Anwendungscode umgeht.
DO $$
DECLARE
  card_with_tender_rejected boolean := false;
  cash_without_tender_but_change_rejected boolean := false;
  voucher_with_change_rejected boolean := false;
BEGIN
  BEGIN
    UPDATE "Payment" SET "tenderedAmount" = 700 WHERE id = '${ids.paymentCard}';
  EXCEPTION WHEN check_violation THEN
    card_with_tender_rejected := true;
  END;
  IF NOT card_with_tender_rejected THEN
    RAISE EXCEPTION 'CARD mit gesetztem tenderedAmount wurde von der Datenhaltung nicht abgewiesen.';
  END IF;

  BEGIN
    UPDATE "Payment" SET "changeAmount" = 50 WHERE id = '${ids.paymentCashNoTender}';
  EXCEPTION WHEN check_violation THEN
    cash_without_tender_but_change_rejected := true;
  END;
  IF NOT cash_without_tender_but_change_rejected THEN
    RAISE EXCEPTION 'CASH ohne tenderedAmount mit changeAmount ungleich 0 wurde von der Datenhaltung nicht abgewiesen.';
  END IF;

  BEGIN
    UPDATE "Payment" SET "changeAmount" = 1 WHERE id = '${ids.paymentVoucher}';
  EXCEPTION WHEN check_violation THEN
    voucher_with_change_rejected := true;
  END;
  IF NOT voucher_with_change_rejected THEN
    RAISE EXCEPTION 'VOUCHER mit changeAmount ungleich 0 wurde von der Datenhaltung nicht abgewiesen.';
  END IF;
END $$;

-- 4. Der Gegenbeweis: eine gueltige Aenderung an der Bar-mit-Beleg-Zahlung
--    (hoeherer Tenderbetrag, entsprechend angepasstes Wechselgeld) bleibt
--    erlaubt. Ohne diesen Nachweis waere nicht erkennbar, ob der Constraint
--    versehentlich jede Aenderung an einer CASH-Zahlung blockiert statt nur
--    die unmoeglichen Kombinationen.
DO $$
BEGIN
  UPDATE "Payment" SET "tenderedAmount" = 1500, "changeAmount" = 800
    WHERE id = '${ids.paymentCashWithTender}';
  UPDATE "Payment" SET "tenderedAmount" = 1000, "changeAmount" = 300
    WHERE id = '${ids.paymentCashWithTender}';

  IF (SELECT "changeAmount" FROM "Payment" WHERE id = '${ids.paymentCashWithTender}') <> 300 THEN
    RAISE EXCEPTION 'Eine gueltige Aenderung an der Bar-mit-Beleg-Zahlung wurde faelschlich abgewiesen.';
  END IF;
END $$;
`;
}

// Fuegt eine bereits verletzende Zahlung ein (method=CASH,
// tenderedAmount < amount), wie sie vor Issue #165 einzig ueber das
// Einspielen einer alten JSON-Sicherung entstehen konnte. Wird eingespielt,
// bevor der neue CHECK-Constraint existiert - danach wuerde schon das INSERT
// selbst abgewiesen.
function seedPaymentTenderViolationSql(ids) {
  return `
INSERT INTO "User" (id, username, "pinHash", role, "isActive", "createdAt", "updatedAt")
VALUES ('${ids.userId}', 'migration-payment-tender-violation-user', 'x', 'CASHIER'::"Role", true, now(), now());

INSERT INTO "Event" (id, name, "testMode", status, "createdAt", "updatedAt")
VALUES ('${ids.eventId}', 'Migrationstest Zahlungs-Tenderregel Verletzung', false, 'DRAFT'::"EventStatus", now(), now());

INSERT INTO "Order" (
  id, "totalAmount", "userId", "eventId", "dataMode", "createdAt", "updatedAt"
) VALUES (
  '${ids.orderId}', 700, '${ids.userId}', '${ids.eventId}', 'LIVE'::"OperationalDataMode", now(), now()
);

INSERT INTO "Payment" (
  id, amount, "tenderedAmount", "changeAmount", method, status, "orderId", "createdAt", "updatedAt"
) VALUES (
  '${ids.paymentId}', 700, 500, 0, 'CASH'::"PaymentMethod", 'COMPLETED'::"PaymentStatus", '${ids.orderId}', now(), now()
);
`;
}

function dropDatabase(target, database) {
  const literal = database.replaceAll("'", "''");
  psql(
    target,
    "postgres",
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${literal}' AND pid <> pg_backend_pid();`,
  );
  psql(target, "postgres", `DROP DATABASE IF EXISTS "${database}";`);
}

const target = parseAdminTarget();
const migrationNames = readdirSync(migrationsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

if (migrationNames.length < 2)
  fail("Mindestens zwei Migrationen werden für den Upgrade-Test benötigt.");

// Datenuebernehmende Migrationen und der zu ihnen gehoerende Altstand. Der
// Seed wird jeweils unmittelbar VOR der genannten Migration eingespielt, sonst
// laeuft er gegen bereits umgebaute Tabellen. Diese Bindung an den
// Migrationsnamen ersetzt die frueher noetige Annahme, die zu pruefende
// Migration sei die letzte im Verzeichnis: eine nachrueckende Migration
// verschiebt den Einspielpunkt jetzt automatisch nicht mehr.
const DATA_MIGRATION_CHECKS = [
  {
    migration: "20260821140000_add_product_option_groups",
    seedLabel: "repräsentativen Altstand für Produktoptionen einspielen",
    seed: () => seedLegacyProductOptionsSql(LEGACY_SEED),
    verifyLabel: "Datenübernahme der Produktoptionen prüfen",
    verify: () => verifyProductOptionMigrationSql(LEGACY_SEED),
  },
  {
    migration: "20260822120000_move_target_station_to_category",
    seedLabel: "repräsentativen Altstand für Zielstationen einspielen",
    seed: () => seedLegacyTargetStationsSql(STATION_SEED),
    verifyLabel: "Verlustfreiheit der Zielstationen prüfen",
    verify: () => verifyTargetStationMigrationSql(STATION_SEED),
  },
  {
    migration: "20260823100000_add_station_sale_pickup_numbers",
    seedLabel: "Bestandsbestellungen ohne Abholnummer einspielen",
    seed: () =>
      seedLegacyOrdersWithoutPickupSql(PICKUP_SEED, PICKUP_SEED_AMOUNTS),
    verifyLabel: "Unversehrtheit der Bestellungen und die Abholnummer prüfen",
    verify: () =>
      verifyPickupNumberMigrationSql(PICKUP_SEED, PICKUP_SEED_AMOUNTS),
  },
  {
    migration: "20260823110000_enforce_unique_order_number",
    seedLabel:
      "explizite Bestellnummern und getrennte Betriebsarten einspielen",
    seed: () => seedLegacyOrderNumbersSql(ORDER_NUMBER_SEED),
    verifyLabel: "Eindeutigkeit und Sequenz der Bestellnummer prüfen",
    verify: () => verifyOrderNumberMigrationSql(ORDER_NUMBER_SEED),
  },
  {
    migration: "20260823120000_enforce_event_referential_integrity",
    seedLabel: "gueltigen Altstand fuer Eventintegritaet einspielen",
    seed: () => seedLegacyEventIntegritySql(EVENT_INTEGRITY_SEED),
    verifyLabel: "Eventintegritaet und Stationsloeschung pruefen",
    verify: () => verifyEventIntegrityMigrationSql(EVENT_INTEGRITY_SEED),
  },
  {
    migration: "20260829100000_add_inventory_stock_and_movements",
    seedLabel: "alle manuellen Availability-Overrides einspielen",
    seed: () => seedLegacyAvailabilitySql(INVENTORY_SEED),
    verifyLabel:
      "Verlustfreiheit der Overrides und ausbleibende Mengenerfindung prüfen",
    verify: () => verifyInventoryMigrationSql(INVENTORY_SEED),
  },
  {
    migration: "20260830090000_add_event_status_testmode_check",
    seedLabel:
      "gültigen Altstand für Betriebsart/Testflag einspielen (u.a. PAUSED mit testMode=true)",
    seed: () => seedLegacyEventStatusTestModeSql(EVENT_STATUS_TESTMODE_SEED),
    verifyLabel:
      "Betriebsart-Constraint greift, ohne gültige Bestandsdaten oder PAUSED/testMode=true abzuweisen",
    verify: () =>
      verifyEventStatusTestModeMigrationSql(EVENT_STATUS_TESTMODE_SEED),
  },
  {
    migration: "20260830100000_add_payment_tender_check",
    seedLabel:
      "gültigen Altstand für die Zahlungs-Tenderregel einspielen (CASH mit und ohne Bargeldbeleg, CARD, VOUCHER, REFUND)",
    seed: () => seedLegacyPaymentTenderSql(PAYMENT_TENDER_SEED),
    verifyLabel:
      "Tender-Constraint greift, ohne gültige Bestandszahlungen abzuweisen",
    verify: () => verifyPaymentTenderMigrationSql(PAYMENT_TENDER_SEED),
  },
];

for (const check of DATA_MIGRATION_CHECKS) {
  if (!migrationNames.includes(check.migration)) {
    fail(
      `Die Datenübernahmeprüfung ist an die Migration "${check.migration}" gebunden, ` +
        `diese existiert aber nicht mehr. Seed-/Verifikationslogik in scripts/ci/test-migrations.mjs muss angepasst werden.`,
    );
  }
}

const seedsByMigration = new Map(
  DATA_MIGRATION_CHECKS.map((check) => [check.migration, check]),
);
const orderNumberMigration = "20260823110000_enforce_unique_order_number";
const orderNumberMigrationIndex = migrationNames.indexOf(orderNumberMigration);
if (orderNumberMigrationIndex < 0) {
  fail(`Migration ${orderNumberMigration} fehlt.`);
}
const eventIntegrityMigration =
  "20260823120000_enforce_event_referential_integrity";
const eventIntegrityMigrationIndex = migrationNames.indexOf(
  eventIntegrityMigration,
);
if (eventIntegrityMigrationIndex < 0) {
  fail(`Migration ${eventIntegrityMigration} fehlt.`);
}
const eventStatusTestModeMigration =
  "20260830090000_add_event_status_testmode_check";
const eventStatusTestModeMigrationIndex = migrationNames.indexOf(
  eventStatusTestModeMigration,
);
if (eventStatusTestModeMigrationIndex < 0) {
  fail(`Migration ${eventStatusTestModeMigration} fehlt.`);
}
const paymentTenderMigration = "20260830100000_add_payment_tender_check";
const paymentTenderMigrationIndex = migrationNames.indexOf(
  paymentTenderMigration,
);
if (paymentTenderMigrationIndex < 0) {
  fail(`Migration ${paymentTenderMigration} fehlt.`);
}

try {
  console.log(`Migrationstest auf ${target.hostname}: leere Datenbank`);
  recreateDatabase(target, EMPTY_DATABASE);
  const emptyUrl = databaseUrl(target, EMPTY_DATABASE);
  prisma(["migrate", "deploy"], emptyUrl);
  prisma(["migrate", "status"], emptyUrl);

  console.log(
    `Migrationstest auf ${target.hostname}: repräsentativer Altstand`,
  );
  recreateDatabase(target, UPGRADE_DATABASE);
  const upgradeUrl = databaseUrl(target, UPGRADE_DATABASE);

  // Die datenuebernehmenden Migrationen verlieren in einem Testlauf sonst nie
  // Daten, weil die Datenbank bis zu ihnen leer ist. Der jeweils passende
  // Altstand wird deshalb unmittelbar vor der betroffenen Migration
  // eingespielt. Alle Migrationen bis auf die letzte werden dafuer einzeln
  // ueber psql eingespielt und als angewendet vermerkt; die letzte laeuft
  // ueber "migrate deploy", damit auch dieser Weg im Test vorkommt.
  const seedBefore = (migrationName) => {
    const check = seedsByMigration.get(migrationName);
    if (!check) return;
    console.log(`Migrationstest: ${check.seedLabel}`);
    psql(target, UPGRADE_DATABASE, check.seed());
  };

  for (const migrationName of migrationNames.slice(0, -1)) {
    seedBefore(migrationName);
    const sql = readFileSync(
      resolve(migrationsDir, migrationName, "migration.sql"),
      "utf8",
    );
    psql(target, UPGRADE_DATABASE, sql);
    prisma(["migrate", "resolve", "--applied", migrationName], upgradeUrl);
  }
  seedBefore(migrationNames[migrationNames.length - 1]);

  prisma(["migrate", "deploy"], upgradeUrl);
  prisma(["migrate", "status"], upgradeUrl);

  for (const check of DATA_MIGRATION_CHECKS) {
    console.log(`Migrationstest: ${check.verifyLabel}`);
    psql(target, UPGRADE_DATABASE, check.verify());
  }

  console.log(
    `Migrationstest auf ${target.hostname}: vorhandene doppelte Bestellnummern`,
  );
  recreateDatabase(target, DUPLICATE_DATABASE);
  for (const migrationName of migrationNames.slice(
    0,
    orderNumberMigrationIndex,
  )) {
    const sql = readFileSync(
      resolve(migrationsDir, migrationName, "migration.sql"),
      "utf8",
    );
    psql(target, DUPLICATE_DATABASE, sql);
  }
  psql(
    target,
    DUPLICATE_DATABASE,
    seedLegacyOrderNumbersSql(ORDER_NUMBER_SEED, true),
  );
  psqlExpectFailure(
    target,
    DUPLICATE_DATABASE,
    readFileSync(
      resolve(migrationsDir, orderNumberMigration, "migration.sql"),
      "utf8",
    ),
    "Eindeutigkeit der Bestellnummer je Veranstaltung und Betriebsart kann nicht aktiviert werden",
  );
  psql(
    target,
    DUPLICATE_DATABASE,
    `DO $$
     BEGIN
       IF to_regclass('"Order_eventId_dataMode_orderNumber_key"') IS NOT NULL THEN
         RAISE EXCEPTION 'Nach dem erwarteten Migrationsabbruch blieb ein Teilindex zurück.';
       END IF;
       IF (SELECT count(*) FROM "Order"
           WHERE "eventId" = '${ORDER_NUMBER_SEED.eventId}'
             AND "dataMode" = 'LIVE'::"OperationalDataMode"
             AND "orderNumber" = ${ORDER_NUMBER_SEED.orderNumber}) <> 2 THEN
         RAISE EXCEPTION 'Der Migrationsabbruch hat den absichtlich doppelten Altbestand verändert.';
       END IF;
     END $$;`,
  );

  console.log(
    `Migrationstest auf ${target.hostname}: veranstaltungsfremde Bestandsreferenzen`,
  );
  recreateDatabase(target, INVALID_EVENT_DATABASE);
  for (const migrationName of migrationNames.slice(
    0,
    eventIntegrityMigrationIndex,
  )) {
    const sql = readFileSync(
      resolve(migrationsDir, migrationName, "migration.sql"),
      "utf8",
    );
    psql(target, INVALID_EVENT_DATABASE, sql);
  }
  psql(
    target,
    INVALID_EVENT_DATABASE,
    seedLegacyEventIntegritySql(EVENT_INTEGRITY_SEED),
  );
  psql(
    target,
    INVALID_EVENT_DATABASE,
    `UPDATE "Product"
       SET "eventId" = '${EVENT_INTEGRITY_SEED.otherEventId}'
       WHERE id = '${EVENT_INTEGRITY_SEED.productId}';
     UPDATE "ProductCategory"
       SET "targetStationId" = '${EVENT_INTEGRITY_SEED.otherStationId}'
       WHERE id = '${EVENT_INTEGRITY_SEED.categoryId}';`,
  );
  const invalidEventOutput = psqlExpectFailure(
    target,
    INVALID_EVENT_DATABASE,
    readFileSync(
      resolve(migrationsDir, eventIntegrityMigration, "migration.sql"),
      "utf8",
    ),
    "Gleiche Eventzugehoerigkeit fuer Produkte, Kategorien und Zielstationen kann nicht aktiviert werden",
  );
  for (const expectedDetail of [
    "Product->ProductCategory",
    "ProductCategory->Station",
    "Product->Station",
    EVENT_INTEGRITY_SEED.productId,
    EVENT_INTEGRITY_SEED.categoryId,
  ]) {
    if (!invalidEventOutput.includes(expectedDetail)) {
      fail(
        `Der verständliche Migrationsabbruch nennt das erwartete Detail nicht: ${expectedDetail}`,
      );
    }
  }
  psql(
    target,
    INVALID_EVENT_DATABASE,
    `DO $$
     BEGIN
       IF to_regclass('"Station_id_eventId_key"') IS NOT NULL
          OR to_regclass('"ProductCategory_id_eventId_key"') IS NOT NULL THEN
         RAISE EXCEPTION 'Nach dem erwarteten Migrationsabbruch blieb ein Teilindex zurück.';
       END IF;
       IF (SELECT "eventId" FROM "Product" WHERE id = '${EVENT_INTEGRITY_SEED.productId}')
            IS DISTINCT FROM '${EVENT_INTEGRITY_SEED.otherEventId}'
          OR (SELECT "targetStationId" FROM "ProductCategory" WHERE id = '${EVENT_INTEGRITY_SEED.categoryId}')
            IS DISTINCT FROM '${EVENT_INTEGRITY_SEED.otherStationId}' THEN
         RAISE EXCEPTION 'Der Migrationsabbruch hat den absichtlich ungültigen Altbestand verändert.';
       END IF;
     END $$;`,
  );

  console.log(
    `Migrationstest auf ${target.hostname}: vorhandene Betriebsart/Testflag-Verletzung (Issue #157)`,
  );
  recreateDatabase(target, EVENT_STATUS_TESTMODE_VIOLATION_DATABASE);
  for (const migrationName of migrationNames.slice(
    0,
    eventStatusTestModeMigrationIndex,
  )) {
    const sql = readFileSync(
      resolve(migrationsDir, migrationName, "migration.sql"),
      "utf8",
    );
    psql(target, EVENT_STATUS_TESTMODE_VIOLATION_DATABASE, sql);
  }
  psql(
    target,
    EVENT_STATUS_TESTMODE_VIOLATION_DATABASE,
    seedEventStatusTestModeViolationSql(EVENT_STATUS_TESTMODE_VIOLATION_SEED),
  );
  const eventStatusTestModeOutput = psqlExpectFailure(
    target,
    EVENT_STATUS_TESTMODE_VIOLATION_DATABASE,
    readFileSync(
      resolve(migrationsDir, eventStatusTestModeMigration, "migration.sql"),
      "utf8",
    ),
    "Der Betriebsart-Constraint fuer Veranstaltungen kann nicht aktiviert werden",
  );
  for (const expectedDetail of [
    EVENT_STATUS_TESTMODE_VIOLATION_SEED.eventId,
    "status=ACTIVE, testMode=t",
  ]) {
    if (!eventStatusTestModeOutput.includes(expectedDetail)) {
      fail(
        `Der verständliche Migrationsabbruch nennt das erwartete Detail nicht: ${expectedDetail}`,
      );
    }
  }
  psql(
    target,
    EVENT_STATUS_TESTMODE_VIOLATION_DATABASE,
    `DO $$
     BEGIN
       IF EXISTS (
         SELECT 1 FROM pg_constraint WHERE conname = 'Event_status_testMode_check'
       ) THEN
         RAISE EXCEPTION 'Nach dem erwarteten Migrationsabbruch wurde der Constraint dennoch angelegt.';
       END IF;
       IF NOT EXISTS (
         SELECT 1 FROM "Event"
         WHERE id = '${EVENT_STATUS_TESTMODE_VIOLATION_SEED.eventId}'
           AND status = 'ACTIVE'::"EventStatus"
           AND "testMode"
       ) THEN
         RAISE EXCEPTION 'Der Migrationsabbruch hat den absichtlich ungültigen Altbestand verändert.';
       END IF;
     END $$;`,
  );

  console.log(
    `Migrationstest auf ${target.hostname}: vorhandene Zahlungs-Tenderregel-Verletzung (Issue #165)`,
  );
  recreateDatabase(target, PAYMENT_TENDER_VIOLATION_DATABASE);
  for (const migrationName of migrationNames.slice(
    0,
    paymentTenderMigrationIndex,
  )) {
    const sql = readFileSync(
      resolve(migrationsDir, migrationName, "migration.sql"),
      "utf8",
    );
    psql(target, PAYMENT_TENDER_VIOLATION_DATABASE, sql);
  }
  psql(
    target,
    PAYMENT_TENDER_VIOLATION_DATABASE,
    seedPaymentTenderViolationSql(PAYMENT_TENDER_VIOLATION_SEED),
  );
  const paymentTenderOutput = psqlExpectFailure(
    target,
    PAYMENT_TENDER_VIOLATION_DATABASE,
    readFileSync(
      resolve(migrationsDir, paymentTenderMigration, "migration.sql"),
      "utf8",
    ),
    "Der Tender-Constraint fuer Zahlungen kann nicht aktiviert werden",
  );
  for (const expectedDetail of [
    PAYMENT_TENDER_VIOLATION_SEED.paymentId,
    "method=CASH",
  ]) {
    if (!paymentTenderOutput.includes(expectedDetail)) {
      fail(
        `Der verständliche Migrationsabbruch nennt das erwartete Detail nicht: ${expectedDetail}`,
      );
    }
  }
  psql(
    target,
    PAYMENT_TENDER_VIOLATION_DATABASE,
    `DO $$
     BEGIN
       IF EXISTS (
         SELECT 1 FROM pg_constraint WHERE conname = 'Payment_tender_check'
       ) THEN
         RAISE EXCEPTION 'Nach dem erwarteten Migrationsabbruch wurde der Constraint dennoch angelegt.';
       END IF;
       IF NOT EXISTS (
         SELECT 1 FROM "Payment"
         WHERE id = '${PAYMENT_TENDER_VIOLATION_SEED.paymentId}'
           AND method = 'CASH'::"PaymentMethod"
           AND "tenderedAmount" = 500
       ) THEN
         RAISE EXCEPTION 'Der Migrationsabbruch hat den absichtlich ungültigen Altbestand verändert.';
       END IF;
     END $$;`,
  );

  console.log(
    "Migrationstest erfolgreich: leerer Stand, Upgrade-Stand und verständliche Abbrüche bei Duplikaten, veranstaltungsfremden Referenzen sowie einer bestehenden Betriebsart/Testflag- und Zahlungs-Tenderregel-Verletzung sind geprüft.",
  );
} finally {
  dropDatabase(target, EMPTY_DATABASE);
  dropDatabase(target, UPGRADE_DATABASE);
  dropDatabase(target, DUPLICATE_DATABASE);
  dropDatabase(target, INVALID_EVENT_DATABASE);
  dropDatabase(target, EVENT_STATUS_TESTMODE_VIOLATION_DATABASE);
  dropDatabase(target, PAYMENT_TENDER_VIOLATION_DATABASE);
}
