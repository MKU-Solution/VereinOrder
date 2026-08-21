import { decodeFromCodepage } from "./charset";
import { renderDocument } from "./document";
import { encodeEscPos, resolveCutMode } from "./escpos";
import { PAPER_PROFILES } from "./profiles";

const ESC = 0x1b;
const GS = 0x1d;

function indexOfSequence(buffer: Buffer, sequence: number[]): number {
  return buffer.indexOf(Buffer.from(sequence));
}

function countSequence(buffer: Buffer, sequence: number[]): number {
  const needle = Buffer.from(sequence);
  let count = 0;
  let position = buffer.indexOf(needle);
  while (position !== -1) {
    count += 1;
    position = buffer.indexOf(needle, position + needle.length);
  }
  return count;
}

const lines = renderDocument(
  {
    title: "Test",
    blocks: [
      { kind: "text", text: "Kopf", align: "center", bold: true },
      { kind: "columns", left: "Pommes groß", right: "3,50 €", fill: "." },
      { kind: "rule" },
    ],
  },
  PAPER_PROFILES[80],
);

describe("ESC/POS-Kodierung", () => {
  it("beginnt jede Ausfertigung mit Initialisierung und Codepage-Auswahl", () => {
    const bytes = encodeEscPos(lines, { codepage: "CP858" });

    expect(bytes.subarray(0, 2)).toEqual(Buffer.from([ESC, 0x40]));
    expect(bytes.subarray(2, 5)).toEqual(Buffer.from([ESC, 0x74, 19]));
  });

  it("überträgt Umlaute und Eurozeichen als Codepage-Bytes", () => {
    const bytes = encodeEscPos(lines, { codepage: "CP858" });
    const text = decodeFromCodepage(bytes, "CP858");

    expect(text).toContain("Pommes groß");
    expect(text).toContain("3,50 €");
    expect(bytes.includes(0xd5)).toBe(true);
  });

  it("setzt Ausrichtung und Fettdruck nur bei Wechseln", () => {
    const bytes = encodeEscPos(lines);

    // Zentriert für den Kopf, danach genau einmal zurück auf links.
    expect(countSequence(bytes, [ESC, 0x61, 0x01])).toBe(1);
    expect(countSequence(bytes, [ESC, 0x45, 0x01])).toBe(1);
    expect(indexOfSequence(bytes, [ESC, 0x61, 0x00])).toBeGreaterThan(
      indexOfSequence(bytes, [ESC, 0x61, 0x01]),
    );
  });

  it("schneidet je Ausfertigung einmal und wiederholt den Bon", () => {
    const single = encodeEscPos(lines, { cutMode: "PARTIAL", copies: 1 });
    const double = encodeEscPos(lines, { cutMode: "PARTIAL", copies: 2 });

    expect(countSequence(single, [GS, 0x56, 66])).toBe(1);
    expect(countSequence(double, [GS, 0x56, 66])).toBe(2);
    expect(countSequence(double, [ESC, 0x40])).toBe(2);
  });

  it("kennt Vollschnitt und Verzicht auf den Schnitt", () => {
    const full = encodeEscPos(lines, { cutMode: "FULL" });
    const none = encodeEscPos(lines, { cutMode: "NONE" });

    expect(countSequence(full, [GS, 0x56, 65])).toBe(1);
    expect(countSequence(none, [GS, 0x56, 66])).toBe(0);
    expect(countSequence(none, [GS, 0x56, 65])).toBe(0);
    // Ohne Schnitt bleibt der Vorschub, damit der Bon abgerissen werden kann.
    expect(countSequence(none, [ESC, 0x64, 4])).toBe(1);
  });

  it("erzwingt gültige Schnittarten und begrenzt die Kopienzahl", () => {
    expect(resolveCutMode("SCHERE")).toBe("PARTIAL");
    expect(resolveCutMode("NONE")).toBe("NONE");

    const many = encodeEscPos(lines, { copies: 99 });
    expect(countSequence(many, [ESC, 0x40])).toBe(9);

    const zero = encodeEscPos(lines, { copies: 0 });
    expect(countSequence(zero, [ESC, 0x40])).toBe(1);
  });

  it("markiert doppelte Zeichenhöhe über GS !", () => {
    const big = renderDocument(
      {
        title: "Test",
        blocks: [{ kind: "text", text: "GROSS", doubleHeight: true }],
      },
      PAPER_PROFILES[58],
    );

    expect(countSequence(encodeEscPos(big), [GS, 0x21, 0x01])).toBe(1);
  });
});
