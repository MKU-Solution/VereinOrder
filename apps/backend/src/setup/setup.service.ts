import { ConflictException, Inject, Injectable, Logger } from "@nestjs/common";
import { Prisma, PrismaClient, Role } from "@vereinorder/database";
import * as bcrypt from "bcryptjs";
import { PRISMA_CLIENT } from "../prisma/prisma.module";
import { AuditService } from "../audit/audit.service";
import { CreateSetupAdminDto, SetupStatus } from "./setup.dto";

/** Kostenfaktor wie in `UsersService.create` - dieselbe PIN, dieselbe Haerte. */
const BCRYPT_COST = 10;

/**
 * EINE Ablehnungsmeldung fuer alle Faelle, in denen die Ersteinrichtung nicht
 * (mehr) offen ist: Tabelle war schon vorher gefuellt, Tabelle wurde waehrend
 * der Transaktion gefuellt, Serialisierungskonflikt, Namenskollision. Der
 * Anrufer erfaehrt damit "nicht mehr moeglich" und nichts darueber, welcher
 * der vier Faelle eingetreten ist - insbesondere nicht, ob gerade jemand
 * anderes dabei ist, sich als Administrator einzutragen.
 */
export const SETUP_ALREADY_DONE_MESSAGE =
  "Die Ersteinrichtung ist bereits abgeschlossen.";

/**
 * Der Verlierer eines Wettlaufs erreicht uns nicht als saubere Fachausnahme,
 * sondern als Datenbankfehler. Zwei Formen sind moeglich:
 *
 * - `P2034` - Prismas Abbildung von SQLSTATE 40001 (Serialisierungskonflikt)
 *   und 40P01 (Deadlock). Genau das wirft PostgreSQL, wenn die
 *   SERIALIZABLE-Pruefung den Zyklus aus "beide haben leer gelesen, beide
 *   haben geschrieben" aufloest.
 * - `P2002` - beide wollten denselben Benutzernamen; dann greift schon der
 *   eindeutige Index auf `User.username`.
 *
 * Beide Codes sind der belastbare Weg und sprachunabhaengig.
 *
 * ## Warum der Rueckfall den SQLSTATE prueft, nicht den Klartext
 *
 * welchen Prisma-Code eine kuenftige Fassung fuer 40001 vergibt, ist nicht
 * unser Vertrag. Ein unbehandelter 40001 wuerde als 500 nach draussen gehen
 * und damit den Wettlauf verraten, statt ihn zu verschweigen - der Rueckfall
 * soll das auffangen. Er prueft aber NICHT mehr den englischen Klartext
 * ("could not serialize", "deadlock detected"), denn der war dafuer
 * untauglich, gemessen auf diesem Server (Issue #227,
 * `lc_messages = German_Germany.1252`, PostgreSQL 18):
 *
 * - Einen echten 40001 liefert Prisma 5.22 als `P2034` mit LEEREM `meta` und
 *   einer von Prisma selbst verfassten, englischen Meldung ("Transaction
 *   failed due to a write conflict or a deadlock. Please retry your
 *   transaction"). Der PostgreSQL-Klartext taucht darin ueberhaupt nicht auf;
 *   der englische Abgleich haette selbst auf einem englischen Server nichts
 *   gefunden - er war eine Illusion von Sicherheit, kein zweites Netz.
 * - Reicht Prisma einen rohen Datenbankfehler durch (`P2010`), steht der
 *   PostgreSQL-Klartext in der Landessprache dort (gemessen fuer eine fehlende
 *   Relation: "Relation »...« existiert nicht"). Der 40001-Klartext lautet auf
 *   diesem Server "konnte Zugriff nicht serialisieren wegen
 *   Lese-/Schreib-Abhaengigkeiten zwischen Transaktionen". Sprachunabhaengig
 *   ist an dieser Form nur der SQLSTATE: als `meta.code` ("40001") und als
 *   Ziffernfolge in der Meldung ("Code: `40001`").
 *
 * Der Rueckfall prueft deshalb den SQLSTATE: `meta.code` fuer den P2010-Weg
 * und die Ziffern `40001`/`40P01` in der Meldung als letztes Netz (etwa fuer
 * einen `PrismaClientUnknownRequestError`, der den SQLSTATE in Klammern
 * mitfuehrt). Eine Liste uebersetzter Klartexte waere keine Loesung - sie
 * verschoebe die Luecke nur auf die naechste Serversprache.
 */
export function isFirstAdministratorRaceLost(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2034" || error.code === "P2002") return true;
    // P2010 (roher Datenbankfehler): der SQLSTATE steht sprachunabhaengig in
    // `meta.code`, waehrend der Meldungstext in der Serversprache vorliegt.
    const sqlState = (error.meta as { code?: unknown } | undefined)?.code;
    if (sqlState === "40001" || sqlState === "40P01") return true;
  }
  if (
    error instanceof Prisma.PrismaClientKnownRequestError ||
    error instanceof Prisma.PrismaClientUnknownRequestError
  ) {
    return /40001|40P01/.test(error.message || "");
  }
  return false;
}

@Injectable()
export class SetupService {
  private readonly logger = new Logger(SetupService.name);

  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    private readonly audit: AuditService,
  ) {}

  /**
   * Die einzige Auskunft, die dieser Weg gibt: steht die Ersteinrichtung noch
   * aus? Bewusst als Zaehlung und nicht als "gibt es einen ADMINISTRATOR":
   * Die Schranke des Anlegewegs unten ist "Tabelle leer", und eine Auskunft,
   * die eine ANDERE Frage beantwortet als die Schranke, waere eine Einladung,
   * sich auf sie zu verlassen.
   *
   * Faellt die Datenbank aus, wirft dieser Aufruf. Er darf auf keinen Fall
   * ersatzweise `true` melden - das hiesse, ein voll eingerichtetes System
   * mit gestoerter Datenbank praesentierte der Oberflaeche die Kontoanlage.
   */
  async getStatus(): Promise<SetupStatus> {
    const users = await this.prisma.user.count();
    return { setupRequired: users === 0 };
  }

  /**
   * Legt den ersten Benutzer an - und zwar genau dann, wenn es noch keinen
   * gibt.
   *
   * ## Warum SERIALIZABLE und nicht bloss "eine Transaktion"
   *
   * Die Schranke ist ein Praedikat ueber eine Tabelle ("es gibt keine Zeile"),
   * nicht eine bestimmte Zeile. Damit versagen die einfacheren Mittel:
   *
   * - READ COMMITTED: Beide Anfragen zaehlen 0, beide fuegen ein. Zwei
   *   Administratoren. Die Transaktion allein aendert daran nichts - sie
   *   macht jede Anfrage fuer sich atomar, nicht die beiden gegeneinander.
   * - REPEATABLE READ: In PostgreSQL Snapshot-Isolation. Sie erkennt nur
   *   Aenderungen an DERSELBEN Zeile ("first updater wins"). Zwei EINFUEGUNGEN
   *   verschiedener Zeilen kollidieren nirgends - genau diese Luecke heisst
   *   Write Skew, und sie ist hier der Normalfall, weil zwei Angreifer
   *   verschiedene Benutzernamen waehlen.
   * - Der eindeutige Index auf `User.username` faengt nur den Sonderfall
   *   gleicher Namen ab (`schema.prisma`). Er ist die zweite Schicht, nicht
   *   die erste.
   *
   * SERIALIZABLE ist in PostgreSQL Serializable Snapshot Isolation. Das
   * `SELECT count(*) FROM "User"` laeuft auf einer leeren Tabelle
   * zwangslaeufig als Sequential Scan und nimmt dabei einen SIREAD-Praedikat-
   * lock auf die gesamte Relation. Fuegt die jeweils andere Transaktion
   * danach eine Zeile in dieselbe Relation ein, entsteht in beide Richtungen
   * eine rw-Abhaengigkeit; dieser Zyklus ist genau das Muster, das PostgreSQL
   * beim Bestaetigen erkennt und mit 40001 aufloest. Eine der beiden
   * Transaktionen wird zurueckgerollt, ihr `INSERT` erreicht die Tabelle
   * nicht. Das ist keine Wahrscheinlichkeitsaussage, sondern die Zusage von
   * SSI, und `test/setup-first-admin-concurrency.integration-spec.ts` erzwingt
   * die Ueberlappung ueber eine Sperrschleuse, statt sie zu erhoffen.
   *
   * Bewusst KEIN erneuter Versuch nach 40001: Der uebliche Rat "retry your
   * transaction" gilt fuer Vorgaenge, die beim zweiten Anlauf gelingen
   * sollen. Hier soll der Verlierer gerade NICHT gelingen - der zweite Anlauf
   * saehe die inzwischen gefuellte Tabelle und wiese ohnehin ab. Der Konflikt
   * wird deshalb unmittelbar in dieselbe Ablehnung uebersetzt.
   *
   * ## Warum vor der Transaktion noch einmal gezaehlt wird
   *
   * Die Vorpruefung ist KEINE Sicherheitsschranke (die steht unten in der
   * Transaktion), sondern ein Schutz vor Rechenlastangriffen: Der Weg ist
   * unangemeldet erreichbar und faellt nicht unter den Fehlversuchszaehler
   * aus `AuthService`. Ohne Vorpruefung kostete jede Anfrage gegen ein
   * laengst eingerichtetes System eine bcrypt-Berechnung mit Kostenfaktor 10
   * - rund eine Zehntelsekunde CPU, beliebig oft ausloesbar, mit immer
   * derselben Antwort 409. Mit Vorpruefung kostet sie eine Zaehlung.
   * Zusaetzlich haelt sie die eigentliche Transaktion kurz: bcrypt gehoert
   * nicht in eine SERIALIZABLE-Transaktion, deren Konfliktfenster man klein
   * halten will.
   */
  async createFirstAdministrator(data: CreateSetupAdminDto) {
    if ((await this.prisma.user.count()) > 0) {
      throw new ConflictException(SETUP_ALREADY_DONE_MESSAGE);
    }

    const salt = await bcrypt.genSalt(BCRYPT_COST);
    const pinHash = await bcrypt.hash(data.pin, salt);

    try {
      const created = await this.prisma.$transaction(
        async (tx) => {
          // Die verbindliche Schranke. Alles darueber ist Vorsorge.
          if ((await tx.user.count()) > 0) {
            throw new ConflictException(SETUP_ALREADY_DONE_MESSAGE);
          }

          const user = await tx.user.create({
            data: {
              username: data.username,
              pinHash,
              // Nicht aus der Eingabe uebernommen: Dieser Weg legt einen
              // ADMINISTRATOR an oder gar nichts.
              role: Role.ADMINISTRATOR,
              // Ausdruecklich gesetzt statt auf die Schemavorgabe vertraut -
              // ein inaktives Konto koennte sich nicht anmelden
              // (`AuthService.validateUser` prueft `isActive`), und die
              // Ersteinrichtung waere abgeschlossen, ohne dass jemand
              // hineinkaeme.
              isActive: true,
            },
            select: {
              id: true,
              username: true,
              role: true,
              isActive: true,
              createdAt: true,
            },
          });

          // Im selben `tx` - der Eintrag darf nicht ohne den Benutzer und der
          // Benutzer nicht ohne den Eintrag entstehen. `AuditService.log`
          // nimmt dafuer bereits einen Transaktionsclient entgegen.
          //
          // `userId` ist der neu erzeugte Administrator selbst, nicht `null`:
          // `AuditLog.userId` ist ein Fremdschluessel auf `User`, die Zeile
          // existiert innerhalb dieser Transaktion also bereits.
          // `AuthService` setzt `null` fuer Vorgaenge ohne bekannten
          // Urheber (fehlgeschlagene Anmeldungen); hier ist der Urheber
          // bekannt und in der Uebersicht sichtbar zu machen - sonst stuende
          // beim einzigen sicherheitsrelevanten Vorgang der ganzen
          // Installation "System".
          await this.audit.log(
            {
              action: "SETUP_ADMIN_CREATED",
              entityId: user.id,
              entityType: "User",
              userId: user.id,
              details: { username: user.username, role: user.role },
            },
            tx,
          );

          return user;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );

      // Ohne Benutzernamen: Das Protokoll haelt fest, DASS die Ersteinrichtung
      // stattgefunden hat - der Auditeintrag oben haelt fest, mit wem.
      this.logger.log(
        "Ersteinrichtung abgeschlossen: erster Administrator angelegt.",
      );
      return created;
    } catch (error) {
      if (isFirstAdministratorRaceLost(error)) {
        throw new ConflictException(SETUP_ALREADY_DONE_MESSAGE);
      }
      throw error;
    }
  }
}
