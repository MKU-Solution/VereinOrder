import { PaperProfile } from "./profiles";

export type Alignment = "left" | "center" | "right";

export interface TextBlock {
  kind: "text";
  text: string;
  /** Einrückung in Zeichen, bleibt auch nach dem Umbruch erhalten. */
  indent?: number;
  align?: Alignment;
  bold?: boolean;
  doubleHeight?: boolean;
  doubleWidth?: boolean;
}

/** Zweispaltige Zeile, z. B. Position links und Betrag rechts. */
export interface ColumnsBlock {
  kind: "columns";
  left: string;
  right: string;
  /** Füllzeichen zwischen den Spalten, Standard ist ein Leerzeichen. */
  fill?: string;
  bold?: boolean;
}

export interface RuleBlock {
  kind: "rule";
  char?: string;
}

export interface FeedBlock {
  kind: "feed";
  lines?: number;
}

export type DocumentBlock = TextBlock | ColumnsBlock | RuleBlock | FeedBlock;

export interface PrintDocument {
  /** Kurzbezeichnung für Protokolle und Simulatorkopf. */
  title: string;
  blocks: DocumentBlock[];
}

/**
 * Eine fertig umgebrochene Zeile. Diese Darstellung ist die gemeinsame
 * Grundlage von Simulator und ESC/POS-Transport: beide erhalten exakt
 * dieselben Zeilen und unterscheiden sich nur in der Ausgabe.
 */
export interface RenderedLine {
  text: string;
  align: Alignment;
  bold: boolean;
  doubleHeight: boolean;
  doubleWidth: boolean;
}

function emptyLine(overrides: Partial<RenderedLine> = {}): RenderedLine {
  return {
    text: "",
    align: "left",
    bold: false,
    doubleHeight: false,
    doubleWidth: false,
    ...overrides,
  };
}

/**
 * Bricht Text auf die verfügbare Spaltenzahl um. Wörter, die länger als
 * eine Zeile sind (etwa lange Produktnamen ohne Leerzeichen), werden hart
 * getrennt, damit der Drucker nicht selbst umbricht.
 */
export function wrapText(text: string, columns: number): string[] {
  const width = Math.max(1, columns);
  const lines: string[] = [];

  for (const paragraph of String(text ?? "").split("\n")) {
    const words = paragraph.split(/\s+/).filter((word) => word.length > 0);
    if (words.length === 0) {
      lines.push("");
      continue;
    }

    let current = "";
    for (const word of words) {
      let rest = word;
      while (rest.length > width) {
        if (current.length > 0) {
          lines.push(current);
          current = "";
        }
        lines.push(rest.slice(0, width));
        rest = rest.slice(width);
      }
      if (current.length === 0) {
        current = rest;
      } else if (current.length + 1 + rest.length <= width) {
        current = `${current} ${rest}`;
      } else {
        lines.push(current);
        current = rest;
      }
    }
    lines.push(current);
  }

  return lines;
}

function renderColumns(block: ColumnsBlock, columns: number): string[] {
  const right = String(block.right ?? "");
  const fill = (block.fill ?? " ").charAt(0) || " ";
  const available = Math.max(1, columns - right.length - 1);
  const leftLines = wrapText(String(block.left ?? ""), available);
  const lines = leftLines.slice(0, -1);
  const last = leftLines[leftLines.length - 1] ?? "";
  const gap = Math.max(1, columns - last.length - right.length);
  lines.push(`${last}${fill.repeat(gap)}${right}`);
  return lines;
}

/**
 * Erzeugt aus einem Dokument die endgültigen Zeilen für ein Papierprofil.
 */
export function renderDocument(
  document: PrintDocument,
  profile: PaperProfile,
): RenderedLine[] {
  const lines: RenderedLine[] = [];

  for (const block of document.blocks) {
    switch (block.kind) {
      case "text": {
        const full = block.doubleWidth
          ? Math.floor(profile.columns / 2)
          : profile.columns;
        const indent = Math.max(0, Math.min(full - 1, block.indent ?? 0));
        const prefix = " ".repeat(indent);
        for (const text of wrapText(block.text, full - indent)) {
          lines.push(
            emptyLine({
              text: `${prefix}${text}`,
              align: block.align ?? "left",
              bold: Boolean(block.bold),
              doubleHeight: Boolean(block.doubleHeight),
              doubleWidth: Boolean(block.doubleWidth),
            }),
          );
        }
        break;
      }
      case "columns": {
        for (const text of renderColumns(block, profile.columns)) {
          lines.push(emptyLine({ text, bold: Boolean(block.bold) }));
        }
        break;
      }
      case "rule": {
        const char = (block.char ?? "-").charAt(0) || "-";
        lines.push(emptyLine({ text: char.repeat(profile.columns) }));
        break;
      }
      case "feed": {
        const count = Math.max(1, Math.min(10, block.lines ?? 1));
        for (let index = 0; index < count; index += 1) {
          lines.push(emptyLine());
        }
        break;
      }
    }
  }

  return lines;
}

/**
 * Stellt eine Zeile so dar, wie der Drucker sie ausgibt. Der Simulator
 * übernimmt damit die Ausrichtung, die der Drucker per Befehl erledigt.
 */
export function alignLine(line: RenderedLine, columns: number): string {
  const width = line.doubleWidth ? Math.floor(columns / 2) : columns;
  const text = line.text;
  if (line.align === "center") {
    const padding = Math.max(0, Math.floor((width - text.length) / 2));
    return `${" ".repeat(padding)}${text}`;
  }
  if (line.align === "right") {
    return `${" ".repeat(Math.max(0, width - text.length))}${text}`;
  }
  return text;
}
