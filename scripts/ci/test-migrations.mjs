import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CONFIRMATION = "VEREINORDER_TEST_ONLY";
const EMPTY_DATABASE = "vereinorder_ci_test_empty";
const UPGRADE_DATABASE = "vereinorder_ci_test_upgrade";
const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const migrationsDir = resolve(repoRoot, "packages/database/prisma/migrations");
const pnpmEntryPoint = process.env.npm_execpath;

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

function fail(message) {
  throw new Error(message);
}

function parseAdminTarget() {
  if (process.env.TEST_DATABASE_CONFIRMATION !== CONFIRMATION) {
    fail(`TEST_DATABASE_CONFIRMATION muss exakt ${CONFIRMATION} sein.`);
  }
  const rawUrl = process.env.MIGRATION_TEST_ADMIN_URL;
  if (!rawUrl) fail("MIGRATION_TEST_ADMIN_URL fehlt.");
  const parsed = new URL(rawUrl);
  if (!["127.0.0.1", "localhost"].includes(parsed.hostname)) {
    fail(
      `Nur eine lokale PostgreSQL-Testinstanz ist erlaubt, nicht ${parsed.hostname}.`,
    );
  }
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (database !== "postgres") {
    fail(
      "MIGRATION_TEST_ADMIN_URL muss auf die Verwaltungsdatenbank postgres zeigen.",
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
      `${command} wurde nicht gefunden. PostgreSQL-Client und pnpm müssen im PATH liegen.`,
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
  return run("psql", postgresArgs(target, database), {
    input: sql,
    env: {
      ...process.env,
      PGPASSWORD: decodeURIComponent(target.password),
    },
  });
}

function databaseUrl(target, database) {
  const url = new URL(target.toString());
  url.pathname = `/${database}`;
  url.searchParams.set("schema", "public");
  return url.toString();
}

function prisma(args, targetUrl) {
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
  if (![EMPTY_DATABASE, UPGRADE_DATABASE].includes(database)) {
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
  for (const migrationName of migrationNames.slice(0, -1)) {
    const sql = readFileSync(
      resolve(migrationsDir, migrationName, "migration.sql"),
      "utf8",
    );
    psql(target, UPGRADE_DATABASE, sql);
    prisma(["migrate", "resolve", "--applied", migrationName], upgradeUrl);
  }

  // Die letzte Migration ("20260821140000_add_product_option_groups")
  // uebernimmt "ProductVariant"/"ProductExtra" nach
  // "ProductOptionGroup"/"ProductOption". Dieser Pfad verliert sonst nie
  // Daten in einem Testlauf, weil die Datenbank bis hierher leer ist. Der
  // repraesentative Altstand wird deshalb genau hier eingespielt: nach der
  // vorletzten Migration, vor "migrate deploy" der letzten. Rueckt eine
  // weitere Migration nach, muss diese Seed-/Verifikationslogik mit ihr
  // wandern, sonst laeuft die Einfuegung gegen bereits entfernte Tabellen.
  const lastMigrationName = migrationNames[migrationNames.length - 1];
  if (lastMigrationName !== "20260821140000_add_product_option_groups") {
    fail(
      `Die Datenuebernahmepruefung ist an die Migration "20260821140000_add_product_option_groups" gebunden, ` +
        `letzte Migration ist aber "${lastMigrationName}". Seed-/Verifikationslogik in scripts/ci/test-migrations.mjs muss migriert werden.`,
    );
  }
  console.log(
    "Migrationstest: repräsentativen Altstand für Produktoptionen einspielen",
  );
  psql(target, UPGRADE_DATABASE, seedLegacyProductOptionsSql(LEGACY_SEED));

  prisma(["migrate", "deploy"], upgradeUrl);
  prisma(["migrate", "status"], upgradeUrl);

  console.log("Migrationstest: Datenübernahme der Produktoptionen prüfen");
  psql(target, UPGRADE_DATABASE, verifyProductOptionMigrationSql(LEGACY_SEED));

  console.log(
    "Migrationstest erfolgreich: leerer Stand und Upgrade-Stand sind aktuell.",
  );
} finally {
  dropDatabase(target, EMPTY_DATABASE);
  dropDatabase(target, UPGRADE_DATABASE);
}
