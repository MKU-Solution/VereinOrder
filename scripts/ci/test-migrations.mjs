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
  prisma(["migrate", "deploy"], upgradeUrl);
  prisma(["migrate", "status"], upgradeUrl);
  console.log(
    "Migrationstest erfolgreich: leerer Stand und Upgrade-Stand sind aktuell.",
  );
} finally {
  dropDatabase(target, EMPTY_DATABASE);
  dropDatabase(target, UPGRADE_DATABASE);
}
