import { PrintJobsService } from "./print-jobs.service";

/**
 * Wächtertests gegen Issue #64 (Architekturvorgabe Abschnitt 3.1/3.2, M1).
 *
 * Der frühere zeitgesteuerte Requeue wählte zusätzlich zu PENDING auch
 * PROCESSING-Zeilen aus, deren updatedAt älter als ein festes Zeitfenster
 * war ("D3 - Abschneiden eines laufenden Versuchs" und "D4 - der unklare
 * Ausgang wird automatisch wiederholt"). M1 verlangt, dass claimNextJob
 * AUSSCHLIESSLICH über status = 'PENDING' auswählt; jede Rückkehr eines
 * Zeitfensters auf updatedAt oder von PROCESSING in dieser Auswahl wäre der
 * exakte Rückfall in D3/D4.
 *
 * Diese Tests prüfen NICHT das Verhalten (das tut
 * print-jobs.service.spec.ts bereits), sondern die tatsächlich erzeugte SQL
 * der Fencing-Anweisung - nur so lässt sich der Bruch der Invariante
 * unabhängig vom gemockten Rückgabewert erkennen.
 */

function makePrisma() {
  return {
    $transaction: jest.fn((callback: any) => callback(prisma)),
    $queryRaw: jest.fn().mockResolvedValue([]),
    printJob: {
      findUniqueOrThrow: jest.fn(),
    },
  } as any;
}

let prisma: any;
let service: PrintJobsService;

describe("PrintJobsService.claimNextJob – Wächter gegen den zeitgesteuerten Requeue (D3/D4)", () => {
  beforeEach(() => {
    prisma = makePrisma();
    service = new PrintJobsService(prisma, { log: jest.fn() } as any);
  });

  function claimSql(): string {
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    const fragment = prisma.$queryRaw.mock.calls[0][0];
    const sqlText: string = fragment.sql ?? String(fragment);
    expect(typeof sqlText).toBe("string");
    return sqlText;
  }

  function selectionSubquery(sqlText: string): string {
    // Isoliert die Auswahl-Subquery (FOR UPDATE SKIP LOCKED) von der
    // äußeren UPDATE-Anweisung. Wichtig: "PROCESSING" darf im äußeren SET
    // "status" = 'PROCESSING' legitim vorkommen - Aussage 6 betrifft
    // ausschließlich die Auswahlbedingung, nicht den Zielzustand.
    const match = sqlText.match(/SELECT\s+"id"[\s\S]*?FOR UPDATE SKIP LOCKED/i);
    expect(match).not.toBeNull();
    return match![0];
  }

  it("wählt ausschließlich status = PENDING aus - kein Zeitfenster, kein PROCESSING in der Auswahl (Aussage 6)", async () => {
    await service.claimNextJob();

    const subquery = selectionSubquery(claimSql());
    expect(subquery).toContain(`"status" = 'PENDING'`);
    expect(subquery).not.toMatch(/PROCESSING/);
    expect(subquery).not.toMatch(/INTERVAL/i);
    expect(subquery).not.toMatch(/updatedAt/);
  });

  it("löscht beim Claim nicht errorCode/errorMessage/outcomeClass/failover*-Felder - das wäre die letzte Diagnose (Aussage 7)", async () => {
    await service.claimNextJob();

    const sqlText = claimSql();
    const setMatch = sqlText.match(/SET([\s\S]*?)WHERE/i);
    expect(setMatch).not.toBeNull();
    const setClause = setMatch![1];

    for (const preservedField of [
      "errorCode",
      "errorMessage",
      "outcomeClass",
      "failoverCount",
      "failoverAt",
      "failoverReason",
      "failoverFromPrinterId",
    ]) {
      expect(setClause).not.toContain(`"${preservedField}"`);
    }
  });
});
