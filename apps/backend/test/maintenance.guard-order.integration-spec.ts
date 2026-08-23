import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { Test } from "@nestjs/testing";
import {
  FastifyAdapter,
  NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { assertTestDatabaseUrl } from "./test-database";
import { PrismaModule, PRISMA_CLIENT } from "../src/prisma/prisma.module";
import { AuditModule } from "../src/audit/audit.module";
import { AuthModule } from "../src/auth/auth.module";
import { MaintenanceModule } from "../src/maintenance/maintenance.module";
import { SessionsModule } from "../src/sessions/sessions.module";
import { MaintenanceStateService } from "../src/maintenance/maintenance-state.service";

/**
 * Ergänzung 2 der Projektleitung: die Zusage "Wartungsguard vor
 * JwtAuthGuard" hängt an der tatsächlichen Modulregistrierung
 * (`MaintenanceGuard` als `APP_GUARD`, siehe `maintenance.module.ts`) und
 * kann bei einem künftigen Umbau lautlos kippen — zum Beispiel, wenn jemand
 * `MaintenanceGuard` versehentlich nur noch per `@UseGuards(...)` an
 * einzelnen Controllern registriert, wo er NACH lokalen Guards liefe.
 *
 * Das lässt sich nur an einer echten HTTP-Anfrage durch den tatsächlichen
 * Nest-Aufbau nachweisen, nicht an isolierten Unit-Tests der einzelnen
 * Guards — deshalb hier ein echter Testserver (Fastify, ohne `app.listen()`,
 * über `.inject()`) mit den tatsächlichen Modulen `MaintenanceModule` und
 * `SessionsModule`, genau wie in `AppModule` registriert.
 */
describe("Guard-Reihenfolge: Wartungsguard vor JwtAuthGuard (Issue #67)", () => {
  assertTestDatabaseUrl();

  let app: NestFastifyApplication;
  let stateService: MaintenanceStateService;
  let stateDir: string;
  let previousStateDir: string | undefined;

  beforeAll(async () => {
    previousStateDir = process.env.STATE_DIR;
    stateDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "vereinorder-guard-order-it-"),
    );
    process.env.STATE_DIR = stateDir;

    const moduleRef = await Test.createTestingModule({
      imports: [
        PrismaModule,
        AuditModule,
        AuthModule,
        MaintenanceModule,
        SessionsModule,
      ],
    }).compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    stateService = app.get(MaintenanceStateService);
  });

  afterAll(async () => {
    const prisma = app.get(PRISMA_CLIENT);
    await app.close();
    await prisma.$disconnect();
    if (previousStateDir === undefined) delete process.env.STATE_DIR;
    else process.env.STATE_DIR = previousStateDir;
    fs.rmSync(stateDir, { recursive: true, force: true });
  });

  afterEach(() => {
    stateService.clear();
  });

  function inject(method: "GET" | "POST", url: string) {
    return app.getHttpAdapter().getInstance().inject({ method, url });
  }

  it("liefert ohne Token normalerweise 401 (JwtAuthGuard greift, Kontrollmessung)", async () => {
    const response = await inject("GET", "/sessions/context");
    expect(response.statusCode).toBe(401);
  });

  it("liefert bei LOCKED und fehlendem Token 503, NICHT 401 (GET /sessions/context, eigens benannt)", async () => {
    stateService.write({
      phase: "LOCKED",
      since: new Date().toISOString(),
      byUserId: null,
      byUsername: null,
      reason: "Integrationstest",
      expectedUntil: null,
    });

    const response = await inject("GET", "/sessions/context");

    expect(response.statusCode).toBe(503);
    expect(response.statusCode).not.toBe(401);
  });

  it("liefert bei DRAINING ebenfalls 503 für GET /sessions/context (Ergänzung Runde 2)", async () => {
    stateService.write({
      phase: "DRAINING",
      since: new Date().toISOString(),
      byUserId: null,
      byUsername: null,
      reason: "Integrationstest",
      expectedUntil: null,
    });

    const response = await inject("GET", "/sessions/context");

    expect(response.statusCode).toBe(503);
    expect(response.statusCode).not.toBe(401);
  });

  it("lässt bei DRAINING eine andere, nicht eigens gesperrte Leseanfrage durch (GET /sessions/active)", async () => {
    stateService.write({
      phase: "DRAINING",
      since: new Date().toISOString(),
      byUserId: null,
      byUsername: null,
      reason: "Integrationstest",
      expectedUntil: null,
    });

    // Ohne Token: der Wartungsguard lässt die Anfrage durch, JwtAuthGuard
    // greift danach normal - 401, nicht 503. Das zeigt, dass die Sperre bei
    // DRAINING wirklich nur GET /sessions/context trifft, nicht jede
    // Leseanfrage im Sessions-Controller.
    const response = await inject("GET", "/sessions/active?eventId=x");

    expect(response.statusCode).toBe(401);
  });

  it("blockiert bei LOCKED auch eine andere, nicht ausgenommene Route (POST /sessions)", async () => {
    stateService.write({
      phase: "LOCKED",
      since: new Date().toISOString(),
      byUserId: null,
      byUsername: null,
      reason: "Integrationstest",
      expectedUntil: null,
    });

    const response = await inject("POST", "/sessions");

    expect(response.statusCode).toBe(503);
  });

  it("liefert bei OPEN weiterhin normal 401 ohne Token", async () => {
    stateService.clear();
    const response = await inject("GET", "/sessions/context");
    expect(response.statusCode).toBe(401);
  });
});
