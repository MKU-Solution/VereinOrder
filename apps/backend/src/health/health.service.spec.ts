import { ServiceUnavailableException } from "@nestjs/common";
import { GUARDS_METADATA } from "@nestjs/common/constants";
import { Prisma } from "@vereinorder/database";
import { MAINTENANCE_PUBLIC_KEY } from "../maintenance/maintenance.decorator";
import { HealthController } from "./health.controller";
import {
  HEALTH_OK,
  HEALTH_UNAVAILABLE,
  HealthService,
  describeFailure,
} from "./health.service";

/**
 * Einheitentests der Bereitschaftsprüfung (#184).
 *
 * Die tragende Aussage steht in "meldet unavailable, wenn das Schema fehlt":
 * Genau dieser Fall — Verbindung steht, Tabelle fehlt — ist der Grund, warum
 * der Weg eine Tabelle abfragt statt `SELECT 1`. Ein Test, der nur den guten
 * Fall prüft, hätte die billigere und falsche Umsetzung durchgelassen.
 */
describe("HealthService (#184)", () => {
  function bauen(count: jest.Mock) {
    const prisma = { user: { count } } as any;
    const service = new HealthService(prisma);
    // Das Warnprotokoll gehört zur Zusage (der Betreiber braucht eine Spur),
    // soll die Testausgabe aber nicht fluten.
    jest.spyOn((service as any).logger, "warn").mockImplementation(() => {});
    return { prisma, service };
  }

  it("meldet bereit, wenn die Tabelle antwortet", async () => {
    const count = jest.fn().mockResolvedValue(3);
    const { service } = bauen(count);

    await expect(service.isReady()).resolves.toBe(true);
    expect(count).toHaveBeenCalledTimes(1);
  });

  it("meldet unavailable, wenn das Schema fehlt (der Zustand aus #172)", async () => {
    // P2021 ist Prismas Abbildung von PostgreSQL 42P01, "relation does not
    // exist". Ein "SELECT 1" wuerde hier durchlaufen - deshalb steht dieser
    // Fall hier und nicht nur der Verbindungsabbruch.
    const count = jest.fn().mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("relation does not exist", {
        code: "P2021",
        clientVersion: "5.0.0",
      }),
    );
    const { service } = bauen(count);

    await expect(service.isReady()).resolves.toBe(false);
  });

  it("meldet unavailable, wenn die Datenbank nicht erreichbar ist", async () => {
    const count = jest
      .fn()
      .mockRejectedValue(new Error("connect ECONNREFUSED"));
    const { service } = bauen(count);

    await expect(service.isReady()).resolves.toBe(false);
  });

  it("wirft nie - ein Healthcheck braucht eine Antwort, keine Ausnahme", async () => {
    const count = jest.fn().mockRejectedValue("kein Error-Objekt");
    const { service } = bauen(count);

    await expect(service.isReady()).resolves.toBe(false);
  });
});

describe("describeFailure (#184)", () => {
  /**
   * Der eigentliche Zweck dieser Gruppe: Prisma legt bei Verbindungsfehlern
   * die Datenquelle SAMT ZUGANGSDATEN in den Meldungstext. Was ins
   * Containerprotokoll geht, darf deshalb nur der Fehlercode sein.
   */
  it("nennt den Code einer abgewiesenen Abfrage, nicht ihre Meldung", () => {
    const error = new Prisma.PrismaClientKnownRequestError(
      'relation "User" does not exist',
      { code: "P2021", clientVersion: "5.0.0" },
    );

    expect(describeFailure(error)).toBe("Prisma-Code P2021");
  });

  it("gibt die Meldung eines Verbindungsfehlers nicht weiter", () => {
    const error = new Prisma.PrismaClientInitializationError(
      "Can't reach database server at postgresql://postgres:geheim@postgres:5432",
      "5.0.0",
      "P1001",
    );

    const beschreibung = describeFailure(error);
    expect(beschreibung).toBe("Prisma-Code P1001");
    expect(beschreibung).not.toContain("geheim");
    expect(beschreibung).not.toContain("postgresql://");
  });

  it("faellt auf den Klassennamen zurueck, nicht auf die Meldung", () => {
    expect(describeFailure(new TypeError("etwas mit Details"))).toBe(
      "TypeError",
    );
    expect(describeFailure("kein Error-Objekt")).toBe("unbekannter Fehler");
  });
});

describe("HealthController (#184)", () => {
  // Zwei Waechtertests fuer Entscheidungen, die spaeter lautlos kippen
  // koennten - im Zuschnitt von setup.controller.spec.ts.
  it("traegt keinen Guard (ein Healthcheck hat keine Anmeldedaten)", () => {
    // Ein "@UseGuards(JwtAuthGuard)" der Ordnung halber machte den Weg fuer
    // den Healthcheck in docker-compose.yml unerreichbar; der Container
    // gaelte dauerhaft als ungesund und der Print-Worker startete nie.
    expect(
      Reflect.getMetadata(GUARDS_METADATA, HealthController),
    ).toBeUndefined();
    expect(
      Reflect.getMetadata(
        GUARDS_METADATA,
        HealthController.prototype.getHealth,
      ),
    ).toBeUndefined();
  });

  it("ist vom Wartungsguard ausgenommen", () => {
    // Ohne diese Markierung weist der APP_GUARD den Weg bei LOCKED mit 503
    // ab. Der Container gaelte dann waehrend JEDER Wartung als ungesund -
    // obwohl der Prozess laeuft und die Wartung genau der Zustand ist, in dem
    // jemand von aussen nachsieht, ob das System noch lebt.
    expect(Reflect.getMetadata(MAINTENANCE_PUBLIC_KEY, HealthController)).toBe(
      true,
    );
  });

  it("antwortet mit genau {status: ok}", async () => {
    const service = { isReady: jest.fn().mockResolvedValue(true) } as any;
    const controller = new HealthController(service);

    await expect(controller.getHealth()).resolves.toEqual(HEALTH_OK);
  });

  it("antwortet mit 503 und einem Rumpf, der nichts ausser dem Zustand traegt", async () => {
    const service = { isReady: jest.fn().mockResolvedValue(false) } as any;
    const controller = new HealthController(service);

    await expect(controller.getHealth()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );

    let rumpf: unknown;
    let status: number | undefined;
    try {
      await controller.getHealth();
    } catch (error) {
      rumpf = (error as ServiceUnavailableException).getResponse();
      status = (error as ServiceUnavailableException).getStatus();
    }

    expect(status).toBe(503);
    // toEqual statt toMatchObject: Ein zusaetzliches Feld - "message",
    // "error", ein Migrationsstand, eine Datenbankmeldung - soll diesen Test
    // umwerfen. Der Weg liegt unangemeldet im Festzelt-WLAN.
    expect(rumpf).toEqual(HEALTH_UNAVAILABLE);
    expect(Object.keys(rumpf as object)).toEqual(["status"]);
  });
});
