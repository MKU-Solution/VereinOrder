import { Injectable } from "@nestjs/common";
import { Subject, Observable, interval, merge } from "rxjs";
import { filter, map } from "rxjs/operators";

export interface RealtimeMessage {
  eventId?: string;
  type: string;
  data: any;
}

/**
 * #186: apps/frontend/nginx.conf beendet eine stille Verbindung in der
 * Location /realtime/ nach ihrem proxy_read_timeout/proxy_send_timeout -
 * `broadcast()` allein liefert dafür keinen Takt, wenn längere Zeit weder
 * Bestellung noch Druckauftrag noch Bestandsänderung anfällt. Dieser Wert
 * ist an den dortigen nginx-Wert GEBUNDEN und muss deutlich darunter
 * bleiben (nicht nur knapp): ändert sich einer, muss der andere
 * nachgezogen werden, sonst reisst die Verbindung nach einer Ruhephase
 * wieder ab, ohne dass ein Test das im Entwicklungsbetrieb ohne nginx
 * bemerken würde.
 */
export const REALTIME_HEARTBEAT_INTERVAL_MS = 20_000;

/**
 * Eigener Nachrichtentyp für den Herzschlag - kein fachliches Ereignis.
 * Alle vier Verbraucher (Dashboard.tsx, QuickSaleDashboard.tsx,
 * StationSaleDashboard.tsx, TableSelectionModal.tsx) werten den
 * Nachrichtentyp bereits ausdrücklich aus und ignorieren jeden ihnen
 * unbekannten Typ folgenlos - dieser hier eingeschlossen.
 */
export const REALTIME_HEARTBEAT_TYPE = "HEARTBEAT";

@Injectable()
export class RealtimeService {
  private eventSubject = new Subject<RealtimeMessage>();

  broadcast(eventId: string | undefined, type: string, data: any) {
    this.eventSubject.next({ eventId, type, data });
  }

  getStream(filterEventId?: string): Observable<any> {
    // Eigener Timer je Verbindung: endet, sobald der Aufrufer (die
    // SSE-Verbindung in RealtimeController) das Abonnement beim
    // Verbindungsende beendet - kein zusätzliches Aufräumen nötig.
    const heartbeat$: Observable<RealtimeMessage> = interval(
      REALTIME_HEARTBEAT_INTERVAL_MS,
    ).pipe(map(() => ({ type: REALTIME_HEARTBEAT_TYPE, data: null })));

    return merge(this.eventSubject.asObservable(), heartbeat$).pipe(
      filter(
        (msg) =>
          !filterEventId || !msg.eventId || msg.eventId === filterEventId,
      ),
      map((msg) => ({
        data: {
          type: msg.type,
          data: msg.data,
          timestamp: new Date().toISOString(),
        },
      })),
    );
  }
}
