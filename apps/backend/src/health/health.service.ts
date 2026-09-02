import { Inject, Injectable, Logger } from "@nestjs/common";
import { Prisma, PrismaClient } from "@vereinorder/database";
import { PRISMA_CLIENT } from "../prisma/prisma.module";

export type HealthStatus = "ok" | "unavailable";

export interface HealthResponse {
  status: HealthStatus;
}

/**
 * Die beiden einzigen Antworten dieses Weges (#184). Eingefroren, damit
 * niemand versehentlich ein Feld anhängt: Was hier steht, steht im Festzelt
 * unangemeldet im Netz.
 */
export const HEALTH_OK: HealthResponse = Object.freeze({ status: "ok" });
export const HEALTH_UNAVAILABLE: HealthResponse = Object.freeze({
  status: "unavailable",
});

/**
 * Bereitschaftsprüfung (#184).
 *
 * ## Warum die Prüfung bis auf eine Tabelle durchgeht
 *
 * Die naheliegende Prüfung wäre `SELECT 1`. Sie beantwortet aber nicht die
 * Frage, wegen der dieser Weg entstanden ist. Der Zustand aus #172 — leere
 * Datenbank, jede fachliche Anfrage 500, `42P01 relation "PrintJob" does not
 * exist` — lässt `SELECT 1` anstandslos passieren: Die Verbindung steht ja,
 * es fehlt nur jede Tabelle. Ein Backend in genau der Lage, die den Betrieb
 * unbrauchbar macht, hätte sich als gesund gemeldet.
 *
 * Deshalb wird eine Tabelle abgefragt, die es geben MUSS. `User.count()` ist
 * die billigste solche Abfrage: ein Index-Count auf einer Tabelle, die im
 * Festbetrieb eine Handvoll Zeilen hat. Fehlt das Schema, antwortet
 * PostgreSQL mit 42P01, Prisma macht daraus P2021, und der Weg meldet
 * "unavailable" — was er soll.
 *
 * ## Was der Weg nach draußen gibt, und was nicht
 *
 * Nach draußen gehen ausschließlich {@link HEALTH_OK} und
 * {@link HEALTH_UNAVAILABLE}. Keine Verbindungszeichenfolge, kein
 * Migrationsstand, keine Fehlermeldung der Datenbank. Der Weg ist
 * unangemeldet erreichbar und liegt damit im selben WLAN wie die
 * Bediengeräte und die Gäste; er darf dort nichts erzählen, was beim
 * Einbruch hilft.
 *
 * Dieselbe Trennung wie in `maintenance.controller.ts`: Was ein Angemeldeter
 * wissen darf, steht in `GET /diagnostics/status` hinter
 * `@Roles("ADMINISTRATOR")`.
 *
 * ## Ins Containerprotokoll darf mehr — aber auch nicht alles
 *
 * Ohne jede Spur wäre der Weg im Ernstfall wertlos: "unavailable" allein sagt
 * dem Betreiber nicht, ob die Datenbank weg ist oder das Schema fehlt.
 * Protokolliert wird deshalb der Prisma-Fehlercode (P1001 "nicht
 * erreichbar", P2021 "Tabelle fehlt"), NICHT die Fehlermeldung: Prisma legt
 * bei Verbindungsfehlern die Datenquelle samt Zugangsdaten in den Meldungstext,
 * und die hat auch im Containerprotokoll nichts zu suchen.
 */
@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  /**
   * `true`, sobald die Anwendung läuft UND das Schema in der Datenbank
   * ansprechbar ist. Wirft nie — der Aufrufer ist ein Healthcheck, der eine
   * Antwort braucht, keine Ausnahme.
   *
   * Bewusst ohne eigenes Zeitlimit: Hängt die Datenbank, hängt diese Abfrage,
   * und das Zeitlimit des Healthchecks in `docker-compose.yml` (`timeout`)
   * beendet den Abruf. Ein zweites Zeitlimit hier wäre eine zweite Zahl, die
   * beim Ändern der ersten vergessen wird.
   */
  async isReady(): Promise<boolean> {
    try {
      await this.prisma.user.count();
      return true;
    } catch (error: unknown) {
      this.logger.warn(
        `Bereitschaftsprüfung fehlgeschlagen (${describeFailure(error)}).`,
      );
      return false;
    }
  }
}

/**
 * Verdichtet einen Fehler auf das, was protokolliert werden darf: den
 * Prisma-Fehlercode, sonst den Klassennamen. Niemals `error.message` — siehe
 * die Begründung am Klassenkopf.
 */
export function describeFailure(error: unknown): string {
  // Zwei Prisma-Fehlerklassen, zwei verschiedene Felder: Der abgewiesene
  // Aufruf traegt "code" (P2021, wenn die Tabelle fehlt), der gescheiterte
  // Verbindungsaufbau "errorCode" (P1001, wenn die Datenbank nicht antwortet).
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return `Prisma-Code ${error.code}`;
  }
  if (error instanceof Prisma.PrismaClientInitializationError) {
    return `Prisma-Code ${error.errorCode ?? "unbekannt"}`;
  }
  if (error instanceof Error) return error.name;
  return "unbekannter Fehler";
}
