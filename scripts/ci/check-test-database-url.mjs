import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CONFIRMATION = "VEREINORDER_TEST_ONLY";
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "postgres"]);

export function assertTestDatabaseUrl(
  rawUrl = process.env.DATABASE_URL,
  confirmation = process.env.TEST_DATABASE_CONFIRMATION,
) {
  if (confirmation !== CONFIRMATION) {
    throw new Error(
      `Destruktiver Datenbanktest verweigert: TEST_DATABASE_CONFIRMATION muss exakt ${CONFIRMATION} sein.`,
    );
  }
  if (!rawUrl) throw new Error("DATABASE_URL fehlt.");

  const parsed = new URL(rawUrl);
  if (!LOCAL_HOSTS.has(parsed.hostname)) {
    throw new Error(
      `Destruktiver Datenbanktest verweigert: Host ${parsed.hostname} ist keine erlaubte lokale Testinstanz.`,
    );
  }

  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (
    !/^(vereinorder|VereinOrder)(?:_[a-z0-9]+)*_test(?:_[a-z0-9]+)*$/i.test(
      database,
    )
  ) {
    throw new Error(
      `Destruktiver Datenbanktest verweigert: Datenbank ${database || "<leer>"} ist nicht eindeutig als VereinOrder-Testdatenbank benannt.`,
    );
  }

  return { host: parsed.hostname, database };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
) {
  try {
    const target = assertTestDatabaseUrl();
    console.log(`Geprüfte Testdatenbank: ${target.host}/${target.database}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
