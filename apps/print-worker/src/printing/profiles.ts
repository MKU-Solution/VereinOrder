/**
 * Papierprofile der unterstützten Bonbreiten. Die Spaltenzahl gilt für
 * Font A (12 Punkt Zeichenbreite) und ist damit auf allen gängigen
 * ESC/POS-Bondruckern identisch.
 */
export type PaperWidth = 58 | 80;

export interface PaperProfile {
  /** Papierbreite in Millimetern. */
  width: PaperWidth;
  /** Zeichen pro Zeile in der Standardschrift. */
  columns: number;
  /** Sprechender Name für Protokolle und Simulator. */
  label: string;
}

export const PAPER_PROFILES: Record<PaperWidth, PaperProfile> = {
  58: { width: 58, columns: 32, label: "58 mm" },
  80: { width: 80, columns: 48, label: "80 mm" },
};

export const DEFAULT_PAPER_WIDTH: PaperWidth = 80;

export function resolvePaperProfile(width: unknown): PaperProfile {
  const parsed = Number(width);
  if (parsed === 58 || parsed === 80) {
    return PAPER_PROFILES[parsed];
  }
  return PAPER_PROFILES[DEFAULT_PAPER_WIDTH];
}
