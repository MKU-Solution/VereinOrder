import { ConflictException } from "@nestjs/common";
import { PrintJobsService } from "./print-jobs.service";

/**
 * Wächtertest gegen Issue #64 (Architekturvorgabe Abschnitt 3.2 M2, 5.5):
 * eine Ergebnismeldung mit fremdem leaseId muss abgewiesen werden und darf
 * den Auftrag nicht verändern.
 *
 * Grund für eine eigene Datei statt Ergänzung des bestehenden Tests
 * "weist eine PRINTED-Meldung mit fremdem Token zurück (409)" in
 * print-jobs.service.spec.ts: jener Test setzt den gemockten Auftrag auf
 * status "PROCESSING", das liegt bereits außerhalb der akzeptierten
 * Zielzustände (["PRINTED"]) - der Test schlägt schon deshalb fehl,
 * unabhängig davon, ob leaseId geprüft wird. Er weist NICHT nach, dass die
 * leaseId-Prüfung selbst greift. Probe: den Vergleich
 * `job.leaseId === leaseId` in resolveIdempotentOrConflict entfernt zu haben
 * hätte diesen bestehenden Test unverändert grün gelassen (siehe
 * Abschlussbericht). Dieser Test isoliert die leaseId-Prüfung, indem der
 * gemockte Auftrag bereits im akzeptierten Zielzustand steht und NUR die
 * leaseId abweicht.
 */

function makePrisma() {
  return {
    $transaction: jest.fn((callback: any) => callback(prisma)),
    $queryRaw: jest.fn(),
    printJob: {
      findUniqueOrThrow: jest.fn(),
      findUnique: jest.fn(),
      updateMany: jest.fn(),
    },
  } as any;
}

let prisma: any;
let service: PrintJobsService;

describe("PrintJobsService.reportOutcome – fremdes leaseId wird abgewiesen (Aussage 9)", () => {
  beforeEach(() => {
    prisma = makePrisma();
    service = new PrintJobsService(prisma, { log: jest.fn() } as any);
  });

  it("weist eine PRINTED-Meldung mit fremdem leaseId ab, obwohl der Auftrag bereits im Zielzustand steht", async () => {
    // Die gefenchte Fencing-UPDATE trifft 0 Zeilen - wie es die reale
    // Datenbank tut, wenn "leaseId" in der WHERE-Klausel nicht passt.
    prisma.$queryRaw.mockResolvedValue([]);
    // Der Auftrag steht bereits im akzeptierten Zielzustand (PRINTED) - ein
    // Bruch, der nur die Statusprüfung entfernt, würde diesen Test NICHT
    // fangen. Nur die abweichende leaseId darf die Ablehnung auslösen.
    prisma.printJob.findUnique.mockResolvedValue({
      id: "job-1",
      leaseId: "fremdes-token",
      status: "PRINTED",
    });

    await expect(
      service.reportOutcome("job-1", {
        leaseId: "lease-1",
        outcome: "PRINTED",
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    // Kein weiterer Schreibversuch - der Auftrag bleibt unverändert.
    expect(prisma.printJob.updateMany).not.toHaveBeenCalled();
    expect(prisma.printJob.findUniqueOrThrow).not.toHaveBeenCalled();
  });
});
