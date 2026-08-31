import { ConflictException } from "@nestjs/common";
import { Prisma } from "@vereinorder/database";
import * as bcrypt from "bcryptjs";
import {
  SETUP_ALREADY_DONE_MESSAGE,
  SetupService,
  isFirstAdministratorRaceLost,
} from "./setup.service";

/**
 * Einheitentests der Ersteinrichtung (Issue #173), im Zuschnitt von
 * `users.service.spec.ts` und `auth.service.spec.ts`: gemocktes Prisma, echte
 * bcrypt-Berechnung.
 *
 * Was hier NICHT bewiesen werden kann und deshalb bewusst nicht behauptet
 * wird: dass zwei gleichzeitige Anfragen nicht zwei Administratoren ergeben.
 * Ein gemocktes `$transaction` ist kein PostgreSQL und kennt weder
 * Praedikatlocks noch Serialisierungskonflikte. Diese Zusage wird in
 * `test/setup-first-admin-concurrency.integration-spec.ts` gegen eine echte
 * Datenbank mit erzwungener Ueberlappung geprueft. Hier wird nur geprueft,
 * dass die Transaktion mit der Isolationsstufe geoeffnet wird, auf der jene
 * Zusage beruht, und dass der Verlierer sauber abgewiesen statt als
 * Serverfehler durchgereicht wird.
 */
describe("SetupService (Issue #173)", () => {
  let prisma: any;
  let tx: any;
  let audit: any;
  let service: SetupService;

  beforeEach(() => {
    tx = {
      user: { count: jest.fn().mockResolvedValue(0), create: jest.fn() },
    };
    tx.user.create.mockImplementation(async ({ data }: any) => ({
      id: "admin-1",
      username: data.username,
      role: data.role,
      isActive: data.isActive,
      createdAt: new Date("2026-08-30T10:00:00.000Z"),
    }));
    prisma = {
      user: { count: jest.fn().mockResolvedValue(0) },
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) =>
        callback(tx),
      ),
    };
    audit = { log: jest.fn().mockResolvedValue({}) };
    service = new SetupService(prisma, audit);
  });

  describe("getStatus", () => {
    it("meldet ausstehende Ersteinrichtung bei leerer Benutzertabelle", async () => {
      prisma.user.count.mockResolvedValue(0);

      await expect(service.getStatus()).resolves.toEqual({
        setupRequired: true,
      });
    });

    it("kippt, sobald ein Benutzer existiert, und gibt sonst nichts preis", async () => {
      prisma.user.count.mockResolvedValue(1);

      const status = await service.getStatus();

      expect(status).toEqual({ setupRequired: false });
      expect(Object.keys(status)).toEqual(["setupRequired"]);
    });

    it("reicht einen Datenbankfehler durch, statt ersatzweise die Kontoanlage zu oeffnen", async () => {
      prisma.user.count.mockRejectedValue(new Error("Verbindung verloren"));

      await expect(service.getStatus()).rejects.toThrow("Verbindung verloren");
    });
  });

  describe("createFirstAdministrator", () => {
    it("legt auf leerer Tabelle genau einen ADMINISTRATOR an", async () => {
      const created = await service.createFirstAdministrator({
        username: "betreiber",
        pin: "13570",
      });

      expect(tx.user.create).toHaveBeenCalledTimes(1);
      const data = tx.user.create.mock.calls[0][0].data;
      expect(data.username).toBe("betreiber");
      expect(data.role).toBe("ADMINISTRATOR");
      expect(data.isActive).toBe(true);
      expect(created).toMatchObject({
        username: "betreiber",
        role: "ADMINISTRATOR",
        isActive: true,
      });
    });

    it("hasht die PIN mit bcrypt und gibt sie nirgends im Klartext weiter", async () => {
      const created: any = await service.createFirstAdministrator({
        username: "betreiber",
        pin: "13570",
      });

      const data = tx.user.create.mock.calls[0][0].data;
      expect(data.pin).toBeUndefined();
      expect(data.pinHash).not.toBe("13570");
      // Kostenfaktor 10 wie in UsersService.create - im Praefix des Hashes
      // ablesbar. Eine leisere Runde hier waere ein schwaecheres Konto als
      // jedes ueber die Verwaltung angelegte.
      expect(data.pinHash.startsWith("$2a$10$")).toBe(true);
      await expect(bcrypt.compare("13570", data.pinHash)).resolves.toBe(true);
      await expect(bcrypt.compare("13571", data.pinHash)).resolves.toBe(false);
      expect(JSON.stringify(created)).not.toContain("13570");
      expect(created.pinHash).toBeUndefined();
    });

    it("oeffnet die Transaktion serialisierbar - darauf beruht die Nebenlaeufigkeitszusage", async () => {
      await service.createFirstAdministrator({
        username: "betreiber",
        pin: "13570",
      });

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.$transaction.mock.calls[0][1]).toEqual({
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    });

    it("prueft die Schranke NOCH EINMAL innerhalb der Transaktion", async () => {
      await service.createFirstAdministrator({
        username: "betreiber",
        pin: "13570",
      });

      // Erste Zaehlung ausserhalb (Lastschutz), zweite innerhalb der
      // Transaktion (die verbindliche Schranke).
      expect(prisma.user.count).toHaveBeenCalledTimes(1);
      expect(tx.user.count).toHaveBeenCalledTimes(1);
    });

    it("schreibt einen Auditeintrag in derselben Transaktion, auf den neuen Administrator gebucht", async () => {
      await service.createFirstAdministrator({
        username: "betreiber",
        pin: "13570",
      });

      expect(audit.log).toHaveBeenCalledTimes(1);
      expect(audit.log).toHaveBeenCalledWith(
        {
          action: "SETUP_ADMIN_CREATED",
          entityId: "admin-1",
          entityType: "User",
          userId: "admin-1",
          details: { username: "betreiber", role: "ADMINISTRATOR" },
        },
        tx,
      );
    });

    it("weist den zweiten Aufruf ab und legt nichts an", async () => {
      prisma.user.count.mockResolvedValue(1);

      await expect(
        service.createFirstAdministrator({
          username: "zweiter",
          pin: "13570",
        }),
      ).rejects.toMatchObject({ message: SETUP_ALREADY_DONE_MESSAGE });

      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(tx.user.create).not.toHaveBeenCalled();
      expect(audit.log).not.toHaveBeenCalled();
    });

    it("berechnet auf einem eingerichteten System keinen bcrypt-Hash (Lastschutz)", async () => {
      prisma.user.count.mockResolvedValue(1);
      const genSalt = jest.spyOn(bcrypt, "genSalt");
      const hash = jest.spyOn(bcrypt, "hash");

      await expect(
        service.createFirstAdministrator({
          username: "zweiter",
          pin: "13570",
        }),
      ).rejects.toBeInstanceOf(ConflictException);

      // Der Weg ist unangemeldet erreichbar und faellt nicht unter den
      // Fehlversuchszaehler aus AuthService. Wuerde er vor der Ablehnung
      // hashen, kostete jede Anfrage rund eine Zehntelsekunde CPU.
      expect(genSalt).not.toHaveBeenCalled();
      expect(hash).not.toHaveBeenCalled();
      genSalt.mockRestore();
      hash.mockRestore();
    });

    it("weist ab, wenn die Tabelle erst innerhalb der Transaktion gefuellt ist", async () => {
      prisma.user.count.mockResolvedValue(0);
      tx.user.count.mockResolvedValue(1);

      await expect(
        service.createFirstAdministrator({
          username: "zweiter",
          pin: "13570",
        }),
      ).rejects.toMatchObject({ message: SETUP_ALREADY_DONE_MESSAGE });

      expect(tx.user.create).not.toHaveBeenCalled();
      expect(audit.log).not.toHaveBeenCalled();
    });

    it("uebersetzt einen Serialisierungskonflikt in dieselbe Ablehnung wie eine gefuellte Tabelle", async () => {
      prisma.$transaction.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError(
          "Transaction failed due to a write conflict or a deadlock.",
          { code: "P2034", clientVersion: "5.22.0" },
        ),
      );

      const rejection = await service
        .createFirstAdministrator({ username: "verlierer", pin: "13570" })
        .catch((error) => error);

      // Gleiche Ausnahme, gleicher Wortlaut: Der Anrufer darf nicht
      // unterscheiden koennen, ob er gegen eine gefuellte Tabelle oder gegen
      // einen gleichzeitigen zweiten Versuch gelaufen ist.
      expect(rejection).toBeInstanceOf(ConflictException);
      expect(rejection.message).toBe(SETUP_ALREADY_DONE_MESSAGE);
    });

    it("uebersetzt eine Namenskollision ebenfalls in die Ablehnung", async () => {
      prisma.$transaction.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError(
          "Unique constraint failed on the fields: (`username`)",
          { code: "P2002", clientVersion: "5.22.0" },
        ),
      );

      await expect(
        service.createFirstAdministrator({
          username: "betreiber",
          pin: "13570",
        }),
      ).rejects.toMatchObject({ message: SETUP_ALREADY_DONE_MESSAGE });
    });

    it("verschluckt keinen fremden Fehler", async () => {
      prisma.$transaction.mockRejectedValue(new Error("Platte voll"));

      await expect(
        service.createFirstAdministrator({
          username: "betreiber",
          pin: "13570",
        }),
      ).rejects.toThrow("Platte voll");
    });

    it("versucht es nach einem Serialisierungskonflikt NICHT erneut", async () => {
      prisma.$transaction.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError("40001", {
          code: "P2034",
          clientVersion: "5.22.0",
        }),
      );

      await expect(
        service.createFirstAdministrator({
          username: "verlierer",
          pin: "13570",
        }),
      ).rejects.toBeInstanceOf(ConflictException);

      // Ein erneuter Anlauf soll gerade nicht gelingen: der Verlierer des
      // Wettlaufs bleibt der Verlierer.
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });
  });

  describe("isFirstAdministratorRaceLost", () => {
    it("erkennt 40001 auch dann, wenn Prisma es nicht als P2034 meldet", () => {
      expect(
        isFirstAdministratorRaceLost(
          new Prisma.PrismaClientUnknownRequestError(
            "could not serialize access due to read/write dependencies among transactions (SQLSTATE 40001)",
            { clientVersion: "5.22.0" },
          ),
        ),
      ).toBe(true);
    });

    it("haelt gewoehnliche Fehler nicht faelschlich fuer einen Wettlauf", () => {
      expect(isFirstAdministratorRaceLost(new Error("40001"))).toBe(false);
      expect(
        isFirstAdministratorRaceLost(
          new Prisma.PrismaClientKnownRequestError("Record not found", {
            code: "P2025",
            clientVersion: "5.22.0",
          }),
        ),
      ).toBe(false);
    });
  });
});
