import { ConflictException } from "@nestjs/common";
import { Prisma, PrismaClient } from "@vereinorder/database";
import { AuditService } from "../src/audit/audit.service";
import {
  SETUP_ALREADY_DONE_MESSAGE,
  SetupService,
} from "../src/setup/setup.service";
import { TemporaryDatabase } from "./temporary-database";

const DATABASE = "vereinorder_ci_test_setup_concurrency";

/** Rollback-Signal der Sperrschleuse - sie darf selbst nichts veraendern. */
class GateRollback extends Error {}

type Settled<T> =
  | { status: "fulfilled"; value: T }
  | { status: "rejected"; reason: any };

function settle<T>(promise: Promise<T>): Promise<Settled<T>> {
  return promise.then(
    (value) => ({ status: "fulfilled" as const, value }),
    (reason) => ({ status: "rejected" as const, reason }),
  );
}

/**
 * Waechtertest fuer die Nebenlaeufigkeitszusage aus Issue #173: Zwei
 * gleichzeitige `POST /setup/admin` duerfen nicht zwei Administratoren
 * ergeben.
 *
 * ## Warum dieser Test so aufwendig ist
 *
 * Die Zusage haengt an einer Eigenschaft von PostgreSQL, nicht an einer
 * Zeile Anwendungscode: `SELECT count(*) FROM "User"` nimmt unter
 * SERIALIZABLE einen Praedikatlock auf die Relation, ein anschliessendes
 * `INSERT` der jeweils anderen Transaktion erzeugt in beide Richtungen eine
 * rw-Abhaengigkeit, und PostgreSQL loest diesen Zyklus mit SQLSTATE 40001
 * auf. Ein gemocktes Prisma kann davon nichts wissen - ein Einheitentest
 * koennte hier nur so tun, als pruefe er etwas.
 *
 * Ebenso wenig genuegt es, zwei Aufrufe mit `Promise.all` loszuschicken und
 * zu hoffen, dass sie sich ueberlappen: Ist die erste Transaktion
 * bestaetigt, bevor die zweite ihre Zaehlung ausfuehrt, weist die zweite
 * ganz gewoehnlich ab - der Test waere gruen, ohne die Zusage je beruehrt zu
 * haben, und bliebe gruen, wenn jemand SERIALIZABLE gegen READ COMMITTED
 * tauschte. Die Ueberlappung wird deshalb ERZWUNGEN, nach dem Vorbild von
 * `inventory-stock-concurrency.integration-spec.ts`: Eine dritte Verbindung
 * haelt `LOCK TABLE "User" IN SHARE ROW EXCLUSIVE MODE`. Dieser Sperrmodus
 * laesst lesende Zugriffe (ACCESS SHARE, also die Zaehlung) durch und
 * blockiert schreibende (ROW EXCLUSIVE, also das Einfuegen). Beide Anfragen
 * zaehlen also nachweislich, bevor irgendeine einfuegt, und warten
 * nachweislich gleichzeitig in der Warteschlange (`pg_stat_activity`).
 * Erst dann wird die Schleuse zurueckgerollt.
 *
 * Rotprobe: Mit `isolationLevel` auf `ReadCommitted` statt `Serializable` in
 * `SetupService.createFirstAdministrator` legen beide Anfragen an, und der
 * erste Fall unten schlaegt fehl (zwei Administratoren).
 */
describe("Ersteinrichtung – PostgreSQL-Nebenlaeufigkeit (Issue #173)", () => {
  const database = TemporaryDatabase.forName(DATABASE);

  let prisma: PrismaClient;

  beforeAll(async () => {
    await database.create();
    prisma = new PrismaClient({ datasources: { db: { url: database.url } } });
    await prisma.$connect();
  }, 180_000);

  afterAll(async () => {
    await prisma?.$disconnect().catch(() => undefined);
    await database.drop();
    await expect(database.leftovers()).resolves.toEqual([]);
  }, 180_000);

  beforeEach(async () => {
    await prisma.auditLog.deleteMany();
    await prisma.user.deleteMany();
  });

  it("ergibt bei zwei erzwungen gleichzeitigen Anlagen genau einen Administrator", async () => {
    const gate = await holdUserTableLock();

    const first = settle(createOnSeparateConnection("erste-leitung", "845213"));
    const blockedAfterFirst = await waitForBlockedBackends(
      1,
      "erste Anlage wartet auf die Benutzertabelle",
    );
    const second = settle(
      createOnSeparateConnection("zweite-leitung", "998877"),
    );
    const blockedDuringRace = await waitForBlockedBackends(
      2,
      "beide Anlagen warten gleichzeitig auf die Benutzertabelle",
    );
    await gate.release();
    const results = await Promise.all([first, second]);

    // Beide haben nachweislich gezaehlt (sonst waeren sie nicht bis zum
    // INSERT gekommen) und warteten gleichzeitig - der Wettlauf hat also
    // wirklich stattgefunden.
    expect(blockedAfterFirst).toBeGreaterThanOrEqual(1);
    expect(blockedDuringRace).toBeGreaterThanOrEqual(2);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.filter((r) => r.status === "rejected");
    expect(rejected).toHaveLength(1);
    // Keine rohe Datenbankausnahme nach draussen: der Verlierer bekommt
    // dieselbe Fachablehnung wie jemand, der zu spaet kommt.
    expect(rejected[0].reason).toBeInstanceOf(ConflictException);
    expect(rejected[0].reason.message).toBe(SETUP_ALREADY_DONE_MESSAGE);

    const users = await prisma.user.findMany();
    expect(users).toHaveLength(1);
    expect(users[0].role).toBe("ADMINISTRATOR");
    await expect(
      prisma.user.count({ where: { role: "ADMINISTRATOR" } }),
    ).resolves.toBe(1);
    // Der Auditeintrag des Verlierers muss mit seiner Transaktion
    // zurueckgerollt worden sein.
    const audits = await prisma.auditLog.findMany({
      where: { action: "SETUP_ADMIN_CREATED" },
    });
    expect(audits).toHaveLength(1);
    expect(audits[0].entityId).toBe(users[0].id);
    expect(audits[0].userId).toBe(users[0].id);
  }, 120_000);

  it("ergibt auch bei acht gleichzeitigen Anlagen genau einen Administrator", async () => {
    // Breitere Messung ohne Schleuse: Sie beweist die Zusage nicht (die
    // Ueberlappung ist hier nicht erzwungen), zeigt aber, dass die
    // Absicherung auch unter gewoehnlicher Last keine zweite Anlage
    // durchlaesst - und dass kein Aufruf mit einem 500er endet.
    const attempts = Array.from({ length: 8 }, (_, index) =>
      settle(createOnSeparateConnection(`andrang-${index}`, "845213")),
    );
    const results = await Promise.all(attempts);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    for (const result of results) {
      if (result.status === "rejected") {
        expect(result.reason).toBeInstanceOf(ConflictException);
        expect(result.reason.message).toBe(SETUP_ALREADY_DONE_MESSAGE);
      }
    }
    await expect(prisma.user.count()).resolves.toBe(1);
    await expect(
      prisma.auditLog.count({ where: { action: "SETUP_ADMIN_CREATED" } }),
    ).resolves.toBe(1);
  }, 120_000);

  it("weist gegen einen bereits vorhandenen Benutzer jede Anlage ab, auch gleichzeitige", async () => {
    await prisma.user.create({
      data: {
        username: "bereits-vorhanden",
        pinHash: "unbenutzt",
        // Ausdruecklich KEIN Administrator: die Schranke ist "Tabelle leer",
        // nicht "es gibt einen Administrator". Ein Kellnerkonto muss den
        // Setup-Weg genauso schliessen wie ein Administratorkonto - sonst
        // koennte man sich nach einer Herabstufung wieder hineinschreiben.
        role: "WAITER",
      },
    });

    const results = await Promise.all(
      Array.from({ length: 4 }, (_, index) =>
        settle(createOnSeparateConnection(`nachzuegler-${index}`, "845213")),
      ),
    );

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(0);
    await expect(prisma.user.count()).resolves.toBe(1);
    await expect(
      prisma.user.count({ where: { role: "ADMINISTRATOR" } }),
    ).resolves.toBe(0);
    await expect(
      prisma.auditLog.count({ where: { action: "SETUP_ADMIN_CREATED" } }),
    ).resolves.toBe(0);
  }, 120_000);

  /**
   * Jede Anfrage bekommt eine eigene Verbindung, damit die Transaktionen
   * wirklich nebeneinander laufen und nicht nur innerhalb eines Pools.
   */
  async function createOnSeparateConnection(username: string, pin: string) {
    const connection = new PrismaClient({
      datasources: { db: { url: database.url } },
    });
    await connection.$connect();
    const service = new SetupService(connection, new AuditService(connection));
    try {
      return await service.createFirstAdministrator({ username, pin });
    } finally {
      await connection.$disconnect().catch(() => undefined);
    }
  }

  /**
   * Haelt eine Tabellensperre, die Lesen erlaubt und Schreiben blockiert.
   * Die Transaktion wird beim Freigeben zurueckgerollt und veraendert nichts.
   */
  async function holdUserTableLock() {
    const gate = new PrismaClient({
      datasources: { db: { url: database.url } },
    });
    await gate.$connect();
    let markLocked!: () => void;
    const locked = new Promise<void>((resolve) => {
      markLocked = resolve;
    });
    let markReleased!: () => void;
    const released = new Promise<void>((resolve) => {
      markReleased = resolve;
    });
    const finished = gate
      .$transaction(
        async (tx) => {
          await tx.$executeRaw(
            Prisma.sql`LOCK TABLE "User" IN SHARE ROW EXCLUSIVE MODE`,
          );
          markLocked();
          await released;
          throw new GateRollback();
        },
        { timeout: 60_000, maxWait: 60_000 },
      )
      .catch((error) => {
        if (!(error instanceof GateRollback)) throw error;
      })
      .finally(() => gate.$disconnect().catch(() => undefined));
    await locked;
    return {
      async release() {
        markReleased();
        await finished;
      },
    };
  }

  /** Wartet aktiv darauf, dass die erwartete Anzahl Verbindungen blockiert. */
  async function waitForBlockedBackends(expected: number, hint: string) {
    const deadline = Date.now() + 30_000;
    let waiting = 0;
    while (Date.now() < deadline) {
      const rows = await prisma.$queryRaw<{ waiting: number }[]>(Prisma.sql`
        SELECT count(*)::int AS waiting
        FROM pg_stat_activity
        WHERE datname = ${DATABASE}
          AND wait_event_type = 'Lock'
      `);
      waiting = rows[0]?.waiting ?? 0;
      if (waiting >= expected) return waiting;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(
      `Erwartete ${expected} blockierte Verbindungen (${hint}), beobachtet: ${waiting}`,
    );
  }
});
