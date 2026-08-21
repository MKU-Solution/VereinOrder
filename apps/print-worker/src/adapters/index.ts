import { PrintTarget } from "../target";
import { createSimulatorAdapter } from "./simulator";
import { createTcpAdapter } from "./tcp";
import { PrinterAdapter } from "./types";

export * from "./types";
export { createSimulatorAdapter, renderSimulation } from "./simulator";
export { createTcpAdapter } from "./tcp";

/**
 * Hält je Transportart genau einen Adapter bereit. Die Auswahl erfolgt über
 * das aufgelöste Ziel, nicht über den Rohwert aus der Datenbank.
 */
export function createAdapterRegistry(): Map<string, PrinterAdapter> {
  const registry = new Map<string, PrinterAdapter>();
  for (const adapter of [createTcpAdapter(), createSimulatorAdapter()]) {
    registry.set(adapter.kind, adapter);
  }
  return registry;
}

export function selectAdapter(
  registry: Map<string, PrinterAdapter>,
  target: PrintTarget,
): PrinterAdapter {
  const adapter = registry.get(target.kind);
  if (!adapter) {
    throw new Error(`Kein Adapter für Transportart "${target.kind}".`);
  }
  return adapter;
}
