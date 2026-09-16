import { describe, expect, it } from "vitest";

import {
  formatPrinterTime,
  getFailingActivePrinters,
  getPrinterDiagState,
} from "./printerAdminModel";

// Fester Bezugszeitpunkt in Ortszeit: 16.09.2026, 14:32:00.
const NOW = new Date(2026, 8, 16, 14, 32, 0).getTime();
const at = (hours: number, minutes: number, day = 16) =>
  new Date(2026, 8, day, hours, minutes, 0);

const basePrinter = {
  id: "p-kueche",
  name: "Küche",
  type: "ESC_POS_NETWORK",
  isActive: true,
  fallbackPrinterId: null as string | null,
  lastOkAt: null as Date | string | null,
  lastErrorAt: null as Date | string | null,
  lastErrorCode: null as string | null,
};

const printer = (overrides: Partial<typeof basePrinter>) => ({
  ...basePrinter,
  ...overrides,
});

const allText = (state: ReturnType<typeof getPrinterDiagState>) =>
  [state.label, state.timeText, state.hint ?? "", ...state.details].join("\n");

describe("getPrinterDiagState (Issue #265)", () => {
  it("1: eingeschaltet, Fehler jünger als Erfolg → Druckt nicht", () => {
    const state = getPrinterDiagState(
      printer({
        lastOkAt: at(13, 0),
        lastErrorAt: at(14, 10),
        lastErrorCode: "CONNECTION_REFUSED",
      }),
      {},
      NOW,
    );
    expect(state.kind).toBe("FAILING");
    expect(state.label).toBe("Druckt nicht");
    expect(state.tone).toBe("failing");
    expect(state.details).toContain(
      "Letzter Druckversuch fehlgeschlagen: Drucker nimmt keine Verbindung an",
    );
    expect(state.details).toContain(
      "Fehlversuch: vor 22 Min. · Zuletzt erfolgreich: heute, 13:00",
    );
    expect(state.timeText).toBe("vor 22 Min.");
    expect(state.errorCode).toBe("CONNECTION_REFUSED");
  });

  it("2: Erfolg jünger als Fehler → Bereit", () => {
    const state = getPrinterDiagState(
      printer({ lastOkAt: at(14, 10), lastErrorAt: at(13, 0) }),
      {},
      NOW,
    );
    expect(state.kind).toBe("READY");
    expect(state.label).toBe("Bereit");
    expect(state.details).toEqual(["Zuletzt gedruckt: vor 22 Min."]);
    expect(state.hint).toBeUndefined();
  });

  it("3: Gleichstand von Fehler und Erfolg → Bereit", () => {
    const state = getPrinterDiagState(
      printer({ lastOkAt: at(14, 10), lastErrorAt: at(14, 10) }),
      {},
      NOW,
    );
    expect(state.kind).toBe("READY");
  });

  it("4: nur Fehler, nie Erfolg → Druckt nicht mit „Zuletzt erfolgreich: noch nie“", () => {
    const state = getPrinterDiagState(
      printer({ lastErrorAt: at(14, 31), lastErrorCode: "TIMEOUT" }),
      {},
      NOW,
    );
    expect(state.kind).toBe("FAILING");
    expect(state.label).toBe("Druckt nicht");
    expect(state.details).toContain(
      "Fehlversuch: vor 1 Min. · Zuletzt erfolgreich: noch nie",
    );
  });

  it("5: weder Erfolg noch Fehler → Noch nicht getestet", () => {
    const state = getPrinterDiagState(printer({}), {}, NOW);
    expect(state.kind).toBe("UNCONFIRMED");
    expect(state.label).toBe("Noch nicht getestet");
    expect(state.details).toEqual([
      "Noch kein Bon gedruckt. Vor dem Fest einen Testbon drucken.",
    ]);
  });

  it("6: ausgeschaltet mit jüngerem Fehler → Ausgeschaltet mit Zusatzzeile, nicht „Druckt nicht“", () => {
    const state = getPrinterDiagState(
      printer({
        isActive: false,
        lastOkAt: at(12, 0),
        lastErrorAt: at(14, 0),
        lastErrorCode: "UNREACHABLE",
      }),
      {},
      NOW,
    );
    expect(state.kind).toBe("OFF");
    expect(state.label).toBe("Ausgeschaltet");
    expect(state.details).toContain("Von Hand ausgeschaltet.");
    expect(state.hint).toBe(
      "Letzter Druckversuch fehlgeschlagen (vor 32 Min.): Drucker ist im Netzwerk nicht erreichbar",
    );
    expect(allText(state)).not.toContain("Druckt nicht");
  });

  it("7: ausgeschaltet ohne Fehler → Ausgeschaltet ohne Zusatzzeile", () => {
    const state = getPrinterDiagState(
      printer({ isActive: false, lastOkAt: at(12, 0) }),
      {},
      NOW,
    );
    expect(state.kind).toBe("OFF");
    expect(state.hint).toBeUndefined();
    expect(state.details).toEqual([
      "Von Hand ausgeschaltet.",
      "Zuletzt gedruckt: heute, 12:00",
    ]);
  });

  it("8: ISO-Zeichenketten und Date-Werte ergeben denselben Zustand", () => {
    const fromDates = getPrinterDiagState(
      printer({ lastOkAt: at(13, 0), lastErrorAt: at(14, 10) }),
      {},
      NOW,
    );
    const fromStrings = getPrinterDiagState(
      printer({
        lastOkAt: at(13, 0).toISOString(),
        lastErrorAt: at(14, 10).toISOString(),
      }),
      {},
      NOW,
    );
    expect(fromDates.kind).toBe("FAILING");
    expect(fromStrings.kind).toBe(fromDates.kind);
    expect(fromStrings.details).toEqual(fromDates.details);
    expect(fromStrings.timeText).toBe(fromDates.timeText);
  });

  it("9: nennt den Ersatzdrucker in vier Fällen, ohne „umgangen“ oder „gehen aktuell an“", () => {
    const failing = { lastErrorAt: at(14, 0), lastErrorCode: "TIMEOUT" };
    const schank = { id: "p-schank", name: "Schank", isActive: true };
    const bar = { id: "p-bar", name: "Bar", isActive: false };
    const byId = { "p-schank": schank, "p-bar": bar };

    const cases: Array<[string | null, string]> = [
      ["p-schank", 'Ersatzdrucker: „Schank"'],
      ["p-bar", 'Ersatzdrucker „Bar" ist ausgeschaltet.'],
      [null, "Kein Ersatzdrucker hinterlegt."],
      ["p-weg", "Ersatzdrucker: unbekannt"],
    ];

    for (const [fallbackPrinterId, expected] of cases) {
      const state = getPrinterDiagState(
        printer({ ...failing, fallbackPrinterId }),
        byId,
        NOW,
      );
      expect(state.details).toContain(expected);
      expect(allText(state)).not.toMatch(/umgangen|gehen aktuell an/);
    }
  });

  it("10: übersetzt Fehlercodes, unbekannte mit Rohcode, fehlende als „Ursache nicht gemeldet“", () => {
    const withCode = (lastErrorCode: string | null) =>
      getPrinterDiagState(
        printer({ lastErrorAt: at(14, 0), lastErrorCode }),
        {},
        NOW,
      );

    expect(withCode("PRINTER_CONFIGURATION").details).toContain(
      "Letzter Druckversuch fehlgeschlagen: Druckereinstellungen sind unvollständig oder ungültig",
    );
    expect(withCode("PRINTER_CONFIG_ERROR").details).toContain(
      "Letzter Druckversuch fehlgeschlagen: Druckereinstellungen sind unvollständig oder ungültig",
    );

    const unknown = withCode("SOMETHING_NEW");
    expect(unknown.details).toContain(
      "Letzter Druckversuch fehlgeschlagen: Unbekannter Fehler",
    );
    expect(unknown.errorCode).toBe("SOMETHING_NEW");

    const missing = withCode(null);
    expect(missing.details).toContain(
      "Letzter Druckversuch fehlgeschlagen: Ursache nicht gemeldet",
    );
    expect(missing.errorCode).toBeUndefined();
  });
});

describe("formatPrinterTime (Issue #265)", () => {
  const secondsAgo = (s: number) => new Date(NOW - s * 1000);

  it("11: Grenzen bei 59/60 Sekunden, 59/60 Minuten und am Tageswechsel", () => {
    expect(formatPrinterTime(secondsAgo(59), NOW)).toBe("gerade eben");
    expect(formatPrinterTime(secondsAgo(60), NOW)).toBe("vor 1 Min.");
    expect(formatPrinterTime(secondsAgo(59 * 60), NOW)).toBe("vor 59 Min.");
    expect(formatPrinterTime(secondsAgo(60 * 60), NOW)).toBe("heute, 13:32");

    const shortlyAfterMidnight = new Date(2026, 8, 16, 0, 30, 0).getTime();
    expect(
      formatPrinterTime(new Date(2026, 8, 15, 23, 0, 0), shortlyAfterMidnight),
    ).toBe("gestern, 23:00");
    expect(
      formatPrinterTime(new Date(2026, 8, 14, 23, 0, 0), shortlyAfterMidnight),
    ).toBe("14.09., 23:00");
    expect(formatPrinterTime(null, NOW)).toBe("noch nie");
    expect(formatPrinterTime(undefined, NOW)).toBe("noch nie");
  });
});

describe("getFailingActivePrinters (Issue #265)", () => {
  it("liefert nur eingeschaltete Drucker mit ungelöstem Fehler", () => {
    const list = [
      printer({ id: "a", lastErrorAt: at(14, 0) }),
      printer({ id: "b", isActive: false, lastErrorAt: at(14, 0) }),
      printer({ id: "c", lastErrorAt: at(13, 0), lastOkAt: at(14, 0) }),
      printer({ id: "d" }),
    ];
    expect(getFailingActivePrinters(list).map((p) => p.id)).toEqual(["a"]);
  });
});
