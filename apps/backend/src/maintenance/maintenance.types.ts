/**
 * Issue #67, Stufe 1: Wartungsmodus (Entwurf `docs/development/datensicherung.md`,
 * Abschnitt 6).
 *
 * Drei Phasen:
 * - OPEN: Normalbetrieb.
 * - DRAINING: neue schreibende Vorgänge werden abgewiesen, laufende dürfen zu
 *   Ende laufen. Übergangsphase auf dem Weg nach LOCKED.
 * - LOCKED: alles außer der Ausnahmenliste in `maintenance.guard.ts` bekommt
 *   503. Erst in diesem Zustand ist die Datenbank für eine Wiederherstellung
 *   frei.
 */
export type MaintenancePhase = "OPEN" | "DRAINING" | "LOCKED";

/**
 * Vollständiger Zustand, wie er in `maintenance.json` steht. Bewusst OHNE
 * einen Bezug zur Datenbank (siehe `maintenance-state.service.ts`): eine
 * Wiederherstellung ersetzt die Datenbank vollständig, ein Datenbankfeld
 * würde dabei mit überschrieben — mitten im gefährlichsten Augenblick.
 */
export interface MaintenanceState {
  phase: MaintenancePhase;
  since: string | null;
  byUserId: string | null;
  byUsername: string | null;
  reason: string | null;
  expectedUntil: string | null;
}

/**
 * Öffentlich sichtbarer Ausschnitt für unangemeldete Aufrufer von
 * `GET /maintenance` (Ergänzung 1 der Projektleitung): NUR diese drei Felder,
 * niemals `byUserId`, `byUsername` oder `reason` — der Endpunkt ist von
 * außen erreichbar, und wer wartet und warum, geht einen unangemeldeten
 * Aufrufer nichts an. Ein Benutzername ist die halbe Anmeldung.
 */
export interface PublicMaintenanceState {
  phase: MaintenancePhase;
  since: string | null;
  expectedUntil: string | null;
}

/** Fehlt die Zustandsdatei, gilt OPEN (Entwurf Abschnitt 6). */
export const OPEN_MAINTENANCE_STATE: MaintenanceState = {
  phase: "OPEN",
  since: null,
  byUserId: null,
  byUsername: null,
  reason: null,
  expectedUntil: null,
};

export function toPublicMaintenanceState(
  state: MaintenanceState,
): PublicMaintenanceState {
  return {
    phase: state.phase,
    since: state.since,
    expectedUntil: state.expectedUntil,
  };
}
