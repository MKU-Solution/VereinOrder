import {
  PostgreSqlBackupTools,
  PostgreSqlToolError,
  buildPostgreSqlConnectionEnvironment,
  buildPostgreSqlDatabaseUrl,
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

  it("ersetzt für die Prüfinstanz nur den Datenbanknamen und behält die Verbindungsoptionen", () => {
    expect(
      buildPostgreSqlDatabaseUrl(
        "postgresql://user:p%40ss@postgres:5432/vereinorder?schema=public&sslmode=require",
        "vereinorder_restorecheck_0123456789abcdef",
      ),
    ).toBe(
      "postgresql://user:p%40ss@postgres:5432/vereinorder_restorecheck_0123456789abcdef?schema=public&sslmode=require",
    );
  });

  it.each([
    "vereinorder",
    "vereinorder_restorecheck_0123456789abcdeg",
    'vereinorder_restorecheck_0123456789abcdef";DROP DATABASE vereinorder',
  ])("verwirft nicht intern erzeugte Prüfdatenbanknamen: %s", (name) => {
    expect(() =>
      buildPostgreSqlDatabaseUrl(
        "postgresql://user:secret@postgres/vereinorder",
        name,
      ),
    ).toThrow(PostgreSqlToolError);
  });

  it("führt Anlage, Restore und Entfernen nur gegen getrennte Datenbanken aus", async () => {
    const tools = new PostgreSqlBackupTools();
    const run = jest
      .spyOn(tools as any, "run")
      .mockResolvedValue({ stdout: "" });
    const url = "postgresql://user:secret@postgres:5432/vereinorder";
    const databaseName = "vereinorder_restorecheck_0123456789abcdef";

    await tools.createVerificationDatabase(url, databaseName);
    await tools.restoreDump(url, databaseName, "C:\\backup\\safe.dump");
    await tools.dropVerificationDatabase(url, databaseName);

    expect(run).toHaveBeenNthCalledWith(
      1,
      expect.any(String),
      expect.arrayContaining([
        `--command=CREATE DATABASE "${databaseName}" TEMPLATE template0`,
      ]),
      expect.objectContaining({ PGDATABASE: "postgres", PGPASSWORD: "secret" }),
      expect.any(Number),
    );
    expect(run).toHaveBeenNthCalledWith(
      2,
      expect.any(String),
      expect.arrayContaining([
        `--dbname=${databaseName}`,
        "--single-transaction",
        "--exit-on-error",
        "C:\\backup\\safe.dump",
      ]),
      expect.objectContaining({ PGDATABASE: databaseName }),
      expect.any(Number),
    );
    expect(run).toHaveBeenNthCalledWith(
      3,
      expect.any(String),
      expect.arrayContaining([
        `--command=DROP DATABASE IF EXISTS "${databaseName}"`,
      ]),
      expect.objectContaining({ PGDATABASE: "postgres" }),
      expect.any(Number),
    );
    expect(JSON.stringify(run.mock.calls)).not.toContain("DATABASE_URL");
  });

  it("listet, trennt und benennt nur streng begrenzte Restore-Datenbanken um", async () => {
    const tools = new PostgreSqlBackupTools();
    const run = jest
      .spyOn(tools as any, "run")
      .mockResolvedValueOnce({
        stdout:
          "vereinorder_issue67_test\nvereinorder_restore_0123456789abcdef\n",
      })
      .mockResolvedValue({ stdout: "" });
    const url =
      "postgresql://user:secret@postgres:5432/vereinorder_issue67_test";

    await expect(tools.listDatabaseNames(url)).resolves.toEqual([
      "vereinorder_issue67_test",
      "vereinorder_restore_0123456789abcdef",
    ]);
    await tools.terminateDatabaseConnections(url, "vereinorder_issue67_test");
    await tools.renameDatabase(
      url,
      "vereinorder_issue67_test",
      "vereinorder_pre_0123456789abcdef",
    );

    expect(run).toHaveBeenNthCalledWith(
      2,
      expect.any(String),
      expect.arrayContaining([expect.stringContaining("pg_terminate_backend")]),
      expect.objectContaining({ PGDATABASE: "postgres", PGPASSWORD: "secret" }),
      expect.any(Number),
    );
    expect(run).toHaveBeenNthCalledWith(
      3,
      expect.any(String),
      expect.arrayContaining([
        '--command=ALTER DATABASE "vereinorder_issue67_test" RENAME TO "vereinorder_pre_0123456789abcdef"',
      ]),
      expect.objectContaining({ PGDATABASE: "postgres", PGPASSWORD: "secret" }),
      expect.any(Number),
    );
    await expect(
      tools.renameDatabase(
        url,
        'vereinorder_issue67_test";DROP DATABASE postgres',
        "vereinorder_pre_0123456789abcdef",
      ),
    ).rejects.toBeInstanceOf(PostgreSqlToolError);
    expect(run).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(run.mock.calls)).not.toContain("DATABASE_URL");
  });
});
