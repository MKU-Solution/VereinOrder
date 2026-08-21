import { alignLine } from "../printing/document";
import { PreparedDocument } from "../printing/prepare";
import { PrintTarget } from "../target";
import { DeliveryResult, PrinterAdapter, PrintTransportError } from "./types";

export interface SimulatorOptions {
  /** Ausgabefunktion, standardmäßig die Standardausgabe. */
  write?: (text: string) => void;
}

/**
 * Rendert einen Bon so, wie ihn der Drucker ausgeben würde.
 *
 * Die Ausgabe hängt ausschließlich vom Dokument und vom Papierprofil ab –
 * keine Zeitstempel, keine Zufallswerte, keine künstlichen Wartezeiten.
 * Derselbe Auftrag ergibt damit in Entwicklung und CI immer denselben Text.
 */
export function renderSimulation(
  prepared: PreparedDocument,
  target: PrintTarget,
): string {
  const columns = target.profile.columns;
  const border = "+".padEnd(columns + 3, "-") + "+";
  const head = `${target.name} | ${target.profile.label} | ${target.codepage} | ${target.copies}x`;

  const lines = [
    border,
    `| ${head.slice(0, columns).padEnd(columns)} |`,
    border,
    ...prepared.lines.map(
      (line) => `| ${alignLine(line, columns).padEnd(columns)} |`,
    ),
    border,
    `| ${`Schnitt: ${target.cutMode} | ${prepared.bytes.length} Byte ESC/POS`
      .slice(0, columns)
      .padEnd(columns)} |`,
    border,
  ];

  return `${lines.join("\n")}\n`;
}

export function createSimulatorAdapter(
  options: SimulatorOptions = {},
): PrinterAdapter {
  const write = options.write ?? ((text: string) => process.stdout.write(text));

  return {
    kind: "simulator",
    async deliver(
      prepared: PreparedDocument,
      target: PrintTarget,
    ): Promise<DeliveryResult> {
      try {
        write(renderSimulation(prepared, target));
      } catch (error) {
        throw new PrintTransportError(
          "OUTPUT_FAILED",
          `Simulierter Druck konnte nicht ausgegeben werden: ${(error as Error).message}`,
        );
      }
      return { transport: "simulator", bytes: prepared.bytes.length };
    },
  };
}
