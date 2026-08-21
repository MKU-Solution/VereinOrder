import { decodeFromCodepage } from "../printing/charset";
import { alignLine } from "../printing/document";
import { prepareDocument } from "../printing/prepare";
import { resolveTarget } from "../target";
import { createSimulatorAdapter, renderSimulation } from "./simulator";

const job = {
  id: "job-1",
  jobType: "RECEIPT",
  createdAt: new Date(2026, 7, 21, 18, 5, 9).toISOString(),
  content: {
    eventName: "Frühlingsfest",
    orderNumber: 7,
    items: [{ productName: "Käsekrainer", quantity: 2, totalPrice: 900 }],
    totalAmount: 900,
    payments: [{ method: "CASH", amount: 900 }],
  },
};

const simulatorTarget = resolveTarget({
  id: "p1",
  name: "Testdrucker",
  type: "CONSOLE",
  paperWidth: 58,
});

describe("Druckersimulator", () => {
  it("gibt bei gleichem Auftrag immer dieselbe Ausgabe", () => {
    const first = renderSimulation(
      prepareDocument(job, simulatorTarget),
      simulatorTarget,
    );
    const second = renderSimulation(
      prepareDocument(job, simulatorTarget),
      simulatorTarget,
    );

    expect(first).toBe(second);
    expect(first).toContain("Käsekrainer");
  });

  it("zeigt genau die Zeilen, die auch der Drucker erhält", () => {
    const prepared = prepareDocument(job, simulatorTarget);
    const simulation = renderSimulation(prepared, simulatorTarget);

    for (const line of prepared.lines) {
      const printed = alignLine(line, simulatorTarget.profile.columns);
      if (printed.length === 0) continue;
      expect(simulation).toContain(printed);
    }
  });

  it("liefert dieselbe formatierte Darstellung wie der ESC/POS-Datenstrom", () => {
    const prepared = prepareDocument(job, simulatorTarget);
    const fromBytes = decodeFromCodepage(
      prepared.bytes,
      simulatorTarget.codepage,
    );

    for (const line of prepared.lines) {
      if (line.text.length === 0) continue;
      expect(fromBytes).toContain(line.text);
    }
  });

  it("hält die Papierbreite des Profils ein", () => {
    const wide = resolveTarget({
      id: "p2",
      name: "Bondrucker",
      type: "CONSOLE",
      paperWidth: 80,
    });

    const narrow = renderSimulation(
      prepareDocument(job, simulatorTarget),
      simulatorTarget,
    ).split("\n");
    const broad = renderSimulation(prepareDocument(job, wide), wide).split(
      "\n",
    );

    expect(narrow[0].length).toBe(36); // 32 Spalten plus Rahmen
    expect(broad[0].length).toBe(52); // 48 Spalten plus Rahmen
  });

  it("schreibt den Bon über die konfigurierte Ausgabe", async () => {
    const written: string[] = [];
    const adapter = createSimulatorAdapter({
      write: (text) => written.push(text),
    });

    const prepared = prepareDocument(job, simulatorTarget);
    const result = await adapter.deliver(prepared, simulatorTarget);

    expect(result.transport).toBe("simulator");
    expect(result.bytes).toBe(prepared.bytes.length);
    expect(written).toHaveLength(1);
    expect(written[0]).toContain("Testdrucker");
  });

  it("meldet einen Fehler, wenn die Ausgabe scheitert", async () => {
    const adapter = createSimulatorAdapter({
      write: () => {
        throw new Error("Pipe geschlossen");
      },
    });

    await expect(
      adapter.deliver(prepareDocument(job, simulatorTarget), simulatorTarget),
    ).rejects.toThrow(/Pipe geschlossen/);
  });
});
