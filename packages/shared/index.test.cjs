// Issue #265: Grenzfaelle der gemeinsamen Ableitung "Drucker hat einen
// ungeloesten Fehler". Laeuft mit `node --test` gegen das uebersetzte
// Paket (dist/), weil die CI unter Node 20 keine TypeScript-Dateien direkt
// ausfuehren kann; `pretest` baut das Paket vorher.
const test = require("node:test");
const assert = require("node:assert/strict");

const { hasUnrecoveredPrinterError } = require("./dist/index.js");

const OLDER = new Date("2026-09-16T10:00:00.000Z");
const NEWER = new Date("2026-09-16T10:05:00.000Z");

test("Fehler juenger als letzter Erfolg gilt als ungeloest", () => {
  assert.equal(
    hasUnrecoveredPrinterError({ lastErrorAt: NEWER, lastOkAt: OLDER }),
    true,
  );
});

test("Erfolg juenger als letzter Fehler gilt als behoben", () => {
  assert.equal(
    hasUnrecoveredPrinterError({ lastErrorAt: OLDER, lastOkAt: NEWER }),
    false,
  );
});

test("Gleichstand von Fehler und Erfolg gilt nicht als ungeloest", () => {
  assert.equal(
    hasUnrecoveredPrinterError({
      lastErrorAt: new Date(OLDER.getTime()),
      lastOkAt: new Date(OLDER.getTime()),
    }),
    false,
  );
});

test("Fehler ohne jeden Erfolg gilt als ungeloest, ohne Fehler nie", () => {
  assert.equal(
    hasUnrecoveredPrinterError({ lastErrorAt: OLDER, lastOkAt: null }),
    true,
  );
  assert.equal(
    hasUnrecoveredPrinterError({ lastErrorAt: OLDER, lastOkAt: undefined }),
    true,
  );
  assert.equal(
    hasUnrecoveredPrinterError({ lastErrorAt: null, lastOkAt: null }),
    false,
  );
  assert.equal(hasUnrecoveredPrinterError({}), false);
  assert.equal(
    hasUnrecoveredPrinterError({ lastErrorAt: null, lastOkAt: NEWER }),
    false,
  );
});

test("ISO-Zeichenketten werden wie Date-Werte verglichen", () => {
  assert.equal(
    hasUnrecoveredPrinterError({
      lastErrorAt: NEWER.toISOString(),
      lastOkAt: OLDER.toISOString(),
    }),
    true,
  );
  assert.equal(
    hasUnrecoveredPrinterError({
      lastErrorAt: OLDER.toISOString(),
      lastOkAt: NEWER,
    }),
    false,
  );
});
