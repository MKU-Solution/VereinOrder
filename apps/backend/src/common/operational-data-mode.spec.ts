import { BadRequestException } from "@nestjs/common";
import { resolveOperationalDataMode } from "./operational-data-mode";

describe("resolveOperationalDataMode – Ableitung nach Issue #152", () => {
  it("liefert LIVE für eine im Echtbetrieb laufende Veranstaltung (ACTIVE, testMode false)", () => {
    expect(
      resolveOperationalDataMode({ status: "ACTIVE", testMode: false }),
    ).toBe("LIVE");
  });

  it("liefert TEST für eine im Testbetrieb laufende Veranstaltung (TEST_MODE, testMode true)", () => {
    expect(
      resolveOperationalDataMode({ status: "TEST_MODE", testMode: true }),
    ).toBe("TEST");
  });

  it.each([
    { status: "DRAFT", testMode: false },
    { status: "DRAFT", testMode: true },
    { status: "PREPARED", testMode: false },
    { status: "PREPARED", testMode: true },
    { status: "PAUSED", testMode: false },
    { status: "PAUSED", testMode: true },
    { status: "COMPLETED", testMode: false },
    { status: "COMPLETED", testMode: true },
    { status: "ARCHIVED", testMode: false },
    { status: "ARCHIVED", testMode: true },
  ])(
    "liefert null für $status/testMode=$testMode - die Veranstaltung läuft gerade nicht, das ist kein Defekt",
    ({ status, testMode }) => {
      expect(resolveOperationalDataMode({ status, testMode })).toBeNull();
    },
  );

  it("liefert null, wenn keine Veranstaltung übergeben wird (undefined)", () => {
    expect(resolveOperationalDataMode(undefined)).toBeNull();
  });

  it("liefert null, wenn keine Veranstaltung übergeben wird (null)", () => {
    expect(resolveOperationalDataMode(null)).toBeNull();
  });

  it.each([
    { status: "ACTIVE", testMode: true },
    { status: "TEST_MODE", testMode: false },
  ])(
    "wirft bei der unmöglichen Kombination $status/testMode=$testMode statt sie als null zu behandeln",
    ({ status, testMode }) => {
      expect(() => resolveOperationalDataMode({ status, testMode })).toThrow(
        BadRequestException,
      );
    },
  );
});
