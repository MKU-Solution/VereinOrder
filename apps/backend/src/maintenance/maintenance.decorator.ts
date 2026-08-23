import { SetMetadata } from "@nestjs/common";

export const MAINTENANCE_PUBLIC_KEY = "maintenancePublic";

/**
 * Markiert einen Controller oder eine einzelne Route als von der
 * Wartungssperre ausgenommen (Entwurf Abschnitt 6, Ausnahmentabelle). Auf
 * Klassenebene angewendet gilt die Ausnahme für alle Routen des Controllers
 * (wie `/backup/*`), auf Methodenebene nur für die eine Route.
 */
export const MaintenancePublic = () =>
  SetMetadata(MAINTENANCE_PUBLIC_KEY, true);

export const MAINTENANCE_BLOCKED_DURING_DRAINING_KEY =
  "maintenanceBlockedDuringDraining";

/**
 * Entscheidung der Projektleitung (Runde 2): `DRAINING` lässt lesende
 * Anfragen grundsätzlich durch — mit GENAU dieser benannten Ausnahme.
 *
 * `GET /sessions/context` ist der Endpunkt, dessen Sperre die
 * Offline-Sendeschleife OHNE jeden Zustandswechsel abbrechen lässt (kein
 * `attempt` erhöht, kein Eintrag angefasst) — das ist der ganze Zweck der
 * Sperre. Liefe der Kontext in DRAINING normal durch, käme die Schleife bis
 * `POST /orders`, bekäme dort 503 (schreibender Vorgang, in DRAINING
 * abgewiesen) und stufte das als gewöhnlichen, wiederholbaren Fehler ein —
 * ein verbrannter Versuch von sechs, ohne dass irgendetwas wiederhergestellt
 * wurde. `DRAINING` dauert mindestens 20 Sekunden, in der Praxis länger; das
 * sind ein bis drei der sechs Versuche, bevor die Wartung überhaupt bei
 * `LOCKED` angekommen ist. Der Zähler wandert nicht zurück, wenn die Wartung
 * endet — der Eintrag geht schneller nach `FAILED`, als er müsste.
 *
 * Der Preis, den Endpunkt schon in DRAINING zu sperren, ist null: die
 * Schleife wartet einfach und versucht es beim nächsten Umlauf erneut. Ein
 * Nutzen ohne Preis wird genommen — deshalb diese Ausnahme von der
 * Ausnahme, statt die allgemeine "lesend = durch"-Regel für DRAINING
 * aufzuweichen.
 */
export const MaintenanceBlockedDuringDraining = () =>
  SetMetadata(MAINTENANCE_BLOCKED_DURING_DRAINING_KEY, true);
