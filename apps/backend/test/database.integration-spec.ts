import { randomUUID } from "node:crypto";
import { PrismaClient } from "@vereinorder/database";
import { assertTestDatabaseUrl } from "./test-database";

describe("PostgreSQL-Testdatenbank", () => {
  const prisma = new PrismaClient();
  const target = assertTestDatabaseUrl();

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("ist mit dem tatsächlich verbundenen Datenbanknamen identisch", async () => {
    const result = await prisma.$queryRaw<Array<{ database: string }>>`
      SELECT current_database() AS database
    `;
    expect(result[0]?.database).toBe(target.database);
  });

  it("führt eine fehlgeschlagene Transaktion vollständig zurück", async () => {
    const scopeId = `integration-${randomUUID()}`;
    const key = randomUUID();

    await expect(
      prisma.$transaction(async (tx) => {
        await tx.configOperation.create({
          data: {
            scopeId,
            action: "INTEGRATION_ROLLBACK",
            idempotencyKey: key,
            payloadHash: "integration-test",
            response: { test: true },
          },
        });
        throw new Error("rollback-proof");
      }),
    ).rejects.toThrow("rollback-proof");

    await expect(
      prisma.configOperation.findUnique({
        where: {
          scopeId_action_idempotencyKey: {
            scopeId,
            action: "INTEGRATION_ROLLBACK",
            idempotencyKey: key,
          },
        },
      }),
    ).resolves.toBeNull();
  });
});

describe("Testdatenbank-Schutz", () => {
  it("verweigert eine nicht markierte Datenbank", () => {
    expect(() =>
      assertTestDatabaseUrl(
        "postgresql://postgres:postgres@localhost:5432/vereinorder",
        "VEREINORDER_TEST_ONLY",
      ),
    ).toThrow("Nicht eindeutig als Testdatenbank benannt");
  });

  it("verweigert einen nicht-lokalen Host", () => {
    expect(() =>
      assertTestDatabaseUrl(
        "postgresql://postgres:postgres@db.example.org:5432/vereinorder_test",
        "VEREINORDER_TEST_ONLY",
      ),
    ).toThrow("Nicht-lokaler Testdatenbankhost");
  });

  it("verlangt die ausdrückliche Testbestätigung", () => {
    expect(() =>
      assertTestDatabaseUrl(
        "postgresql://postgres:postgres@localhost:5432/vereinorder_test",
        "wrong",
      ),
    ).toThrow("TEST_DATABASE_CONFIRMATION");
  });
});
