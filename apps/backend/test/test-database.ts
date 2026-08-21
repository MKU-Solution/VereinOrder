const CONFIRMATION = "VEREINORDER_TEST_ONLY";
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "postgres"]);

export function assertTestDatabaseUrl(
  rawUrl = process.env.DATABASE_URL,
  confirmation = process.env.TEST_DATABASE_CONFIRMATION,
) {
  if (confirmation !== CONFIRMATION) {
    throw new Error(
      `TEST_DATABASE_CONFIRMATION muss exakt ${CONFIRMATION} sein.`,
    );
  }
  if (!rawUrl) throw new Error("DATABASE_URL fehlt.");

  const parsed = new URL(rawUrl);
  if (!LOCAL_HOSTS.has(parsed.hostname)) {
    throw new Error(`Nicht-lokaler Testdatenbankhost: ${parsed.hostname}`);
  }

  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (
    !/^(vereinorder|VereinOrder)(?:_[a-z0-9]+)*_test(?:_[a-z0-9]+)*$/i.test(
      database,
    )
  ) {
    throw new Error(`Nicht eindeutig als Testdatenbank benannt: ${database}`);
  }

  return { host: parsed.hostname, database };
}
