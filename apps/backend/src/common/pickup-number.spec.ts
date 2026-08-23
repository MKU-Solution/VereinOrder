import { BadRequestException } from "@nestjs/common";
import { ORDER_REJECTION_MESSAGES } from "@vereinorder/shared";
import { MAX_PICKUP_NUMBER, drawPickupNumber } from "./pickup-number";

// Diese Datei prueft nur, was ohne Datenbank pruefbar ist: die Form der
// abgesetzten Anweisung und die Ueberlaufreissleine. Die eigentlichen Zusagen
// der Vergabe - zwei gleichzeitige Kassen bekommen verschiedene,
// aufeinanderfolgende Nummern, ein Rollback hinterlaesst keine Luecke, Test-
// und Echtzaehler bleiben getrennt - lassen sich gegen ein Mock strukturell
// nicht pruefen und stehen deshalb in
// apps/backend/test/pickup-number.integration-spec.ts gegen ein echtes
// PostgreSQL.

function createTransactionClient(rows: unknown) {
  return {
    $queryRaw: jest.fn().mockResolvedValue(rows),
  };
}

describe("drawPickupNumber – Vergabe der Abholnummer (Issue #66)", () => {
  it("zieht die Nummer mit genau einer Anweisung auf dem übergebenen Transaktionsclient", async () => {
    const tx = createTransactionClient([{ lastNumber: 1 }]);

    await expect(drawPickupNumber(tx as any, "event-1", "LIVE")).resolves.toBe(
      1,
    );

    // Genau eine Anweisung: ein getrenntes SELECT mit anschliessendem UPDATE
    // liesse zwischen den beiden Aufrufen genau das Fenster offen, in dem zwei
    // Kassen denselben Stand lesen.
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);

    const statement = tx.$queryRaw.mock.calls[0][0];
    const sql = statement.strings.join(" ");
    expect(sql).toContain('INSERT INTO "EventPickupCounter"');
    expect(sql).toContain('ON CONFLICT ("eventId", "dataMode")');
    expect(sql).toContain("DO UPDATE SET");
    expect(sql).toContain('RETURNING "lastNumber"');
    expect(statement.values).toEqual(["event-1", "LIVE"]);
  });

  it("reicht die Betriebsart als Parameter durch, damit Test- und Echtzähler getrennt bleiben", async () => {
    const tx = createTransactionClient([{ lastNumber: 7 }]);

    await expect(drawPickupNumber(tx as any, "event-1", "TEST")).resolves.toBe(
      7,
    );
    expect(tx.$queryRaw.mock.calls[0][0].values).toEqual(["event-1", "TEST"]);
  });

  it("lehnt oberhalb der Obergrenze ab, statt die Nummer umbrechen zu lassen", async () => {
    const tx = createTransactionClient([{ lastNumber: MAX_PICKUP_NUMBER + 1 }]);

    await expect(
      drawPickupNumber(tx as any, "event-1", "LIVE"),
    ).rejects.toThrow(BadRequestException);
    await expect(
      drawPickupNumber(
        createTransactionClient([{ lastNumber: MAX_PICKUP_NUMBER + 1 }]) as any,
        "event-1",
        "LIVE",
      ),
    ).rejects.toThrow(ORDER_REJECTION_MESSAGES.PICKUP_NUMBER_EXHAUSTED);
  });

  it("gibt die Obergrenze selbst noch aus", async () => {
    const tx = createTransactionClient([{ lastNumber: MAX_PICKUP_NUMBER }]);

    await expect(drawPickupNumber(tx as any, "event-1", "LIVE")).resolves.toBe(
      MAX_PICKUP_NUMBER,
    );
  });

  it("lehnt ab, wenn die Anweisung keine Nummer zurückgibt", async () => {
    const tx = createTransactionClient([]);

    await expect(
      drawPickupNumber(tx as any, "event-1", "LIVE"),
    ).rejects.toThrow(BadRequestException);
  });
});
