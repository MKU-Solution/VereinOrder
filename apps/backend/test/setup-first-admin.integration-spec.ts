import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Test } from "@nestjs/testing";
import {
  FastifyAdapter,
  NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { PrismaClient } from "@vereinorder/database";
import { PrismaModule, PRISMA_CLIENT } from "../src/prisma/prisma.module";
import { AuditModule } from "../src/audit/audit.module";
import { AuthModule } from "../src/auth/auth.module";
import { MaintenanceModule } from "../src/maintenance/maintenance.module";
import { MaintenanceStateService } from "../src/maintenance/maintenance-state.service";
import { SetupModule } from "../src/setup/setup.module";
import { createApiValidationPipe } from "../src/common/validation/api-validation";
import { BadRequestFilter } from "../src/common/validation/bad-request.filter";
import { TemporaryDatabase } from "./temporary-database";

const DATABASE = "vereinorder_ci_test_setup_first_admin";
const USERNAME = "festbetrieb-leitung";
const PIN = "845213";

/**
 * Ersteinrichtung von aussen (Issue #173), gegen echtes PostgreSQL und durch
 * den tatsaechlichen Nest-Aufbau - Fastify ohne `listen()`, ueber `inject()`,
 * mit derselben Eingabepruefung und demselben Fehlerfilter, die `main.ts`
 * global setzt.
 *
 * Warum ueberhaupt ein Integrationstest und nicht nur Einheitentests: Die
 * tragende Zusage aus #173 lautet, dass sich das erzeugte Konto anschliessend
 * ueber `POST /auth/login` anmelden KANN. Sie beruht auf dem Zusammenspiel
 * zweier Module - PIN-Form, Kostenfaktor, `isActive` und Benutzername muessen
 * auf beiden Seiten zusammenpassen - und ein gemocktes Prisma kann darueber
 * nichts aussagen. Genau dieser Fehler waere der teuerste: ein Konto, das
 * angelegt wird und sich nicht anmelden kann, laesst eine Installation
 * unbenutzbar zurueck, ohne dass irgendwo ein Fehler gemeldet wird.
 *
 * Der Test braucht eine LEERE Benutzertabelle und legt deshalb eine eigene,
 * ausdruecklich als Testdatenbank gefuehrte Wegwerfdatenbank an (siehe
 * `temporary-database.ts`), statt den gemeinsamen Bestand zu leeren.
 */
describe("Ersteinrichtung von aussen (Issue #173)", () => {
  const database = TemporaryDatabase.forName(DATABASE);

  let app: NestFastifyApplication;
  let prisma: PrismaClient;
  let stateService: MaintenanceStateService;
  let stateDir: string;
  let previousDatabaseUrl: string | undefined;
  let previousStateDir: string | undefined;
  let createdAdminId: string;

  beforeAll(async () => {
    await database.create();

    // PrismaModule erzeugt seinen Client ueber `new PrismaClient()`, liest
    // DATABASE_URL also beim Aufbau des Moduls. Die Umstellung muss deshalb
    // VOR `compile()` geschehen.
    previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = database.url;
    previousStateDir = process.env.STATE_DIR;
    stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "vereinorder-setup-it-"));
    process.env.STATE_DIR = stateDir;

    const moduleRef = await Test.createTestingModule({
      imports: [
        PrismaModule,
        AuditModule,
        AuthModule,
        MaintenanceModule,
        SetupModule,
      ],
    }).compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    app.useGlobalPipes(createApiValidationPipe());
    app.useGlobalFilters(new BadRequestFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    prisma = app.get(PRISMA_CLIENT);
    stateService = app.get(MaintenanceStateService);
  }, 180_000);

  afterAll(async () => {
    stateService?.clear();
    await app?.close();
    await prisma?.$disconnect().catch(() => undefined);
    if (previousStateDir === undefined) delete process.env.STATE_DIR;
    else process.env.STATE_DIR = previousStateDir;
    fs.rmSync(stateDir, { recursive: true, force: true });
    await database.drop();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    await expect(database.leftovers()).resolves.toEqual([]);
  }, 180_000);

  function inject(method: "GET" | "POST", url: string, payload?: unknown) {
    return app
      .getHttpAdapter()
      .getInstance()
      .inject({ method, url, payload: payload as any });
  }

  it("meldet auf einer frisch migrierten Datenbank die ausstehende Ersteinrichtung", async () => {
    const response = await inject("GET", "/setup/status");

    expect(response.statusCode).toBe(200);
    // Genau dieser eine Wahrheitswert, kein Benutzername, keine Anzahl.
    expect(JSON.parse(response.body)).toEqual({ setupRequired: true });
  });

  it.each([
    ["zu kurze PIN", { username: USERNAME, pin: "123" }],
    ["nicht numerische PIN", { username: USERNAME, pin: "geheim" }],
    ["zu lange PIN", { username: USERNAME, pin: "1234567890123" }],
    ["leerer Benutzername", { username: "   ", pin: PIN }],
    ["zu langer Benutzername", { username: "b".repeat(65), pin: PIN }],
    ["mitgeschickte Rolle", { username: USERNAME, pin: PIN, role: "WAITER" }],
    [
      "mitgeschickter PIN-Hash",
      { username: USERNAME, pin: PIN, pinHash: "$2a$10$x" },
    ],
  ])("weist eine Anfrage mit %s ab, ohne etwas anzulegen", async (_b, body) => {
    const response = await inject("POST", "/setup/admin", body);

    expect(response.statusCode).toBe(400);
    await expect(prisma.user.count()).resolves.toBe(0);
  });

  it("legt genau einen ADMINISTRATOR an", async () => {
    const response = await inject("POST", "/setup/admin", {
      username: `  ${USERNAME}  `,
      pin: PIN,
    });

    expect(response.statusCode).toBe(201);
    const created = JSON.parse(response.body);
    expect(created).toMatchObject({
      username: USERNAME,
      role: "ADMINISTRATOR",
      isActive: true,
    });
    expect(created.pinHash).toBeUndefined();
    createdAdminId = created.id;

    const users = await prisma.user.findMany();
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({
      username: USERNAME,
      role: "ADMINISTRATOR",
      isActive: true,
    });
  }, 30_000);

  it("hat den Vorgang auditierbar auf den neuen Administrator gebucht", async () => {
    const entries = await prisma.auditLog.findMany({
      where: { action: "SETUP_ADMIN_CREATED" },
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      entityType: "User",
      entityId: createdAdminId,
      userId: createdAdminId,
      details: { username: USERNAME, role: "ADMINISTRATOR" },
    });
  });

  it("kippt danach den Setup-Status", async () => {
    const response = await inject("GET", "/setup/status");

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ setupRequired: false });
  });

  it("laesst das erzeugte Konto sich ueber POST /auth/login anmelden", async () => {
    // Die tragende Zusage aus #173. Sie faellt, sobald PIN-Form,
    // Kostenfaktor, `isActive` oder der getrimmte Benutzername zwischen
    // Ersteinrichtung und Anmeldung auseinanderlaufen.
    const response = await inject("POST", "/auth/login", {
      username: USERNAME,
      pin: PIN,
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(typeof body.access_token).toBe("string");
    const payload = JSON.parse(
      Buffer.from(body.access_token.split(".")[1], "base64url").toString(
        "utf8",
      ),
    );
    expect(payload).toMatchObject({
      sub: createdAdminId,
      username: USERNAME,
      role: "ADMINISTRATOR",
    });
  }, 30_000);

  it("weist einen zweiten Aufruf ab und legt nichts an", async () => {
    const response = await inject("POST", "/setup/admin", {
      username: "zweiter-administrator",
      pin: "998877",
    });

    expect(response.statusCode).toBe(409);
    await expect(prisma.user.count()).resolves.toBe(1);
    await expect(
      prisma.user.count({ where: { role: "ADMINISTRATOR" } }),
    ).resolves.toBe(1);
    await expect(
      prisma.auditLog.count({ where: { action: "SETUP_ADMIN_CREATED" } }),
    ).resolves.toBe(1);
  });

  it("laesst den Anmeldeschutz unberuehrt: kein Fehlversuchszaehler durch Setup-Anfragen", async () => {
    // AuthService fuehrt seinen Zaehler in `AuthThrottle`. Nach einer
    // erfolgreichen Anmeldung und mehreren abgewiesenen Setup-Anfragen darf
    // dort nichts stehen - der Setup-Weg darf den Anmeldeschutz weder
    // fuettern noch umgehen.
    await inject("POST", "/setup/admin", { username: "dritter", pin: "4711" });

    await expect(prisma.authThrottle.count()).resolves.toBe(0);
  });

  it("bleibt bei beschaedigter Wartungszustandsdatei erreichbar (Entscheidung zu MaintenancePublic)", async () => {
    // `MaintenanceStateService.read()` liefert bei unlesbarem Inhalt mit
    // Absicht LOCKED. Ohne `@MaintenancePublic()` waere die Ersteinrichtung
    // dann gesperrt - und der einzige Ausstieg, POST /maintenance/end,
    // verlangt ein Token, das ohne Benutzer nicht existieren kann.
    fs.writeFileSync(
      path.join(stateDir, "maintenance.json"),
      "{ kaputt",
      "utf-8",
    );
    expect(stateService.read().phase).toBe("LOCKED");

    // Kontrollmessung: ein nicht ausgenommener Weg bekommt in derselben Lage
    // 503 - der Wartungsguard greift also tatsaechlich.
    const blocked = await inject("GET", "/audit/logs");
    expect(blocked.statusCode).toBe(503);

    const status = await inject("GET", "/setup/status");
    expect(status.statusCode).toBe(200);
    expect(JSON.parse(status.body)).toEqual({ setupRequired: false });

    // Auch der schreibende Weg ist ausgenommen - er weist hier mit 409 ab,
    // weil die Tabelle gefuellt ist, und nicht mit 503.
    const admin = await inject("POST", "/setup/admin", {
      username: "vierter",
      pin: "4711",
    });
    expect(admin.statusCode).toBe(409);

    stateService.clear();
  });
});
