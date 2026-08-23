import {
  PostgreSqlToolError,
  buildPostgreSqlConnectionEnvironment,
} from "./postgresql-backup.tools";

describe("PostgreSQL-Werkzeugumgebung (Issue #67)", () => {
  it("übergibt das Passwort nur als libpq-Variable und erbt keine Anwendungsgeheimnisse", () => {
    const previousJwt = process.env.JWT_SECRET;
    const previousWorkerToken = process.env.PRINT_WORKER_TOKEN;
    process.env.JWT_SECRET = "jwt-darf-nicht-zum-kindprozess";
    process.env.PRINT_WORKER_TOKEN = "worker-darf-nicht-zum-kindprozess";
    try {
      const result = buildPostgreSqlConnectionEnvironment(
        "postgresql://backup-user:p%40ssword@postgres:5432/vereinorder?schema=public&sslmode=require",
      );
      expect(result.databaseName).toBe("vereinorder");
      expect(result.environment).toMatchObject({
        PGHOST: "postgres",
        PGPORT: "5432",
        PGDATABASE: "vereinorder",
        PGUSER: "backup-user",
        PGPASSWORD: "p@ssword",
        PGSSLMODE: "require",
        PGCONNECT_TIMEOUT: "15",
        LC_ALL: "C",
      });
      expect(result.environment).not.toHaveProperty("DATABASE_URL");
      expect(result.environment).not.toHaveProperty("JWT_SECRET");
      expect(result.environment).not.toHaveProperty("PRINT_WORKER_TOKEN");
    } finally {
      if (previousJwt === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = previousJwt;
      if (previousWorkerToken === undefined)
        delete process.env.PRINT_WORKER_TOKEN;
      else process.env.PRINT_WORKER_TOKEN = previousWorkerToken;
    }
  });

  it.each([
    "not-a-url",
    "https://postgres/db",
    "postgresql://postgres@postgres",
  ])(
    "verwirft eine ungeeignete Datenbankadresse ohne sie auszugeben: %s",
    (url) => {
      expect(() => buildPostgreSqlConnectionEnvironment(url)).toThrow(
        PostgreSqlToolError,
      );
    },
  );
});
