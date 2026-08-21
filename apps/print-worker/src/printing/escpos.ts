import {
  Codepage,
  CODEPAGE_COMMAND,
  DEFAULT_CODEPAGE,
  encodeForCodepage,
} from "./charset";
import { RenderedLine } from "./document";

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

export type CutMode = "NONE" | "PARTIAL" | "FULL";

export const SUPPORTED_CUT_MODES: CutMode[] = ["NONE", "PARTIAL", "FULL"];

export const DEFAULT_CUT_MODE: CutMode = "PARTIAL";

export function resolveCutMode(value: unknown): CutMode {
  return SUPPORTED_CUT_MODES.includes(value as CutMode)
    ? (value as CutMode)
    : DEFAULT_CUT_MODE;
}

export interface EncodeOptions {
  codepage?: Codepage;
  cutMode?: CutMode;
  /** Anzahl identischer Ausfertigungen, jede mit eigenem Schnitt. */
  copies?: number;
  /** Zeilenvorschub vor dem Schnitt, damit der Bon aus dem Messer läuft. */
  feedBeforeCut?: number;
}

const ALIGNMENT_CODES: Record<RenderedLine["align"], number> = {
  left: 0,
  center: 1,
  right: 2,
};

function characterSize(line: RenderedLine): number {
  // GS ! n: oberes Nibble Breite, unteres Nibble Höhe.
  return (line.doubleWidth ? 0x10 : 0x00) | (line.doubleHeight ? 0x01 : 0x00);
}

function encodeLines(lines: RenderedLine[], codepage: Codepage): Buffer[] {
  const chunks: Buffer[] = [];
  let align = -1;
  let bold = -1;
  let size = -1;

  for (const line of lines) {
    const lineAlign = ALIGNMENT_CODES[line.align] ?? 0;
    if (lineAlign !== align) {
      chunks.push(Buffer.from([ESC, 0x61, lineAlign]));
      align = lineAlign;
    }

    const lineBold = line.bold ? 1 : 0;
    if (lineBold !== bold) {
      chunks.push(Buffer.from([ESC, 0x45, lineBold]));
      bold = lineBold;
    }

    const lineSize = characterSize(line);
    if (lineSize !== size) {
      chunks.push(Buffer.from([GS, 0x21, lineSize]));
      size = lineSize;
    }

    chunks.push(encodeForCodepage(line.text, codepage));
    chunks.push(Buffer.from([LF]));
  }

  return chunks;
}

function cutCommand(mode: CutMode, feedBeforeCut: number): Buffer[] {
  if (mode === "NONE") {
    return [
      Buffer.from([ESC, 0x64, Math.max(0, Math.min(255, feedBeforeCut))]),
    ];
  }
  return [
    // GS V m n: Schnitt mit vorherigem Vorschub, m = 65 voll, 66 teilweise.
    Buffer.from([
      GS,
      0x56,
      mode === "FULL" ? 65 : 66,
      Math.max(0, Math.min(255, feedBeforeCut * 8)),
    ]),
  ];
}

/**
 * Wandelt bereits umgebrochene Zeilen in ESC/POS-Bytes.
 *
 * Die Zeilen stammen aus {@link renderDocument} und sind damit identisch mit
 * der Darstellung des Simulators; hier kommen ausschließlich Steuerbefehle
 * für Ausrichtung, Auszeichnung, Codepage und Schnitt hinzu.
 */
export function encodeEscPos(
  lines: RenderedLine[],
  options: EncodeOptions = {},
): Buffer {
  const codepage = options.codepage ?? DEFAULT_CODEPAGE;
  const cutMode = resolveCutMode(options.cutMode);
  const copies = Math.max(1, Math.min(9, Math.trunc(options.copies ?? 1) || 1));
  const feedBeforeCut = options.feedBeforeCut ?? 4;

  const chunks: Buffer[] = [];
  for (let copy = 0; copy < copies; copy += 1) {
    chunks.push(Buffer.from([ESC, 0x40])); // ESC @: Drucker zurücksetzen
    chunks.push(Buffer.from([ESC, 0x74, CODEPAGE_COMMAND[codepage]]));
    chunks.push(Buffer.from([ESC, 0x52, 0x00])); // Internationaler Zeichensatz USA
    chunks.push(...encodeLines(lines, codepage));
    chunks.push(Buffer.from([ESC, 0x61, 0x00])); // Ausrichtung zurücksetzen
    chunks.push(Buffer.from([ESC, 0x45, 0x00])); // Fettdruck aus
    chunks.push(Buffer.from([GS, 0x21, 0x00])); // Zeichengröße zurücksetzen
    chunks.push(...cutCommand(cutMode, feedBeforeCut));
  }

  return Buffer.concat(chunks);
}
