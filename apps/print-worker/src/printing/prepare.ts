import { PrintTarget } from "../target";
import { buildDocument, PrintJobLike } from "./documents";
import { PrintDocument, RenderedLine, renderDocument } from "./document";
import { encodeEscPos } from "./escpos";

/**
 * Das Ergebnis der Aufbereitung. `lines` ist die gemeinsame formatierte
 * Darstellung: der Simulator gibt genau diese Zeilen aus, `bytes` ist
 * dieselbe Darstellung in ESC/POS übersetzt.
 */
export interface PreparedDocument {
  document: PrintDocument;
  lines: RenderedLine[];
  bytes: Buffer;
}

export function prepareDocument(
  job: PrintJobLike,
  target: PrintTarget,
): PreparedDocument {
  const document = buildDocument(job);
  const lines = renderDocument(document, target.profile);
  const bytes = encodeEscPos(lines, {
    codepage: target.codepage,
    cutMode: target.cutMode,
    copies: target.copies,
  });
  return { document, lines, bytes };
}
