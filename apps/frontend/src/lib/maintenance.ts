import { useEffect, useRef, useState } from "react";
import { api } from "./api";

/**
 * Issue #67 (Wartungsmodus), Entwurf `docs/development/datensicherung.md`,
 * Abschnitt 6: `GET /maintenance` ist unangemeldet erreichbar und antwortet
 * in jeder Phase — die Oberfläche fragt ihn regelmäßig ab, um eine
 * ganzseitige Anzeige zu zeigen und, nach dem Ende der Wartung, den
 * Betriebskontext jeder Kasse neu zu laden.
 */
export type MaintenancePhase = "OPEN" | "DRAINING" | "LOCKED";

export interface MaintenanceStatus {
  phase: MaintenancePhase;
  since: string | null;
  expectedUntil: string | null;
  // Nur vorhanden, wenn der Aufruf angemeldet erfolgte (Ergänzung 1 der
  // Projektleitung filtert das unangemeldet serverseitig heraus).
  byUserId?: string | null;
  byUsername?: string | null;
  reason?: string | null;
}

const POLL_INTERVAL_MS = 5000;

/**
 * Wird ausgelöst, sobald die Wartung endet (Phasenwechsel von DRAINING/LOCKED
 * zurück nach OPEN). Jede Kasse muss danach ihren Kontext neu laden —
 * Veranstaltung, Sitzung und Sortiment können sich um Stunden zurückbewegt
 * haben (Entwurf Abschnitt 6). Ein Browser-Ereignis statt eines globalen
 * Zustandsspeichers, damit Dashboard.tsx und CashierDashboard.tsx unabhängig
 * voneinander reagieren können, ohne dass dieses Modul ihre jeweiligen
 * Ladefunktionen kennen muss.
 */
export const MAINTENANCE_ENDED_EVENT = "vereinorder:maintenance-ended";

/**
 * Fragt `GET /maintenance` regelmäßig ab. Läuft unabhängig davon, ob eine
 * gültige Anmeldung besteht — der Endpunkt antwortet immer, nur der
 * Detailgrad unterscheidet sich serverseitig.
 */
export function useMaintenanceStatus(): MaintenanceStatus | null {
  const [status, setStatus] = useState<MaintenanceStatus | null>(null);
  const previousPhaseRef = useRef<MaintenancePhase | null>(null);

  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      try {
        const res = await api.get<MaintenanceStatus>("/maintenance");
        if (cancelled) return;
        const next = res.data;
        const previousPhase = previousPhaseRef.current;
        if (
          previousPhase &&
          previousPhase !== "OPEN" &&
          next.phase === "OPEN"
        ) {
          window.dispatchEvent(new Event(MAINTENANCE_ENDED_EVENT));
        }
        previousPhaseRef.current = next.phase;
        setStatus(next);
      } catch (err) {
        // Ein einzelner fehlgeschlagener Abruf darf die zuletzt bekannte
        // Anzeige nicht löschen - der nächste Umlauf versucht es erneut.
        console.error("Failed to load maintenance status", err);
      }
    };

    poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return status;
}
