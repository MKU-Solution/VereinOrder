import { Injectable } from '@nestjs/common';
import { Subject, Observable } from 'rxjs';
import { filter, map } from 'rxjs/operators';

export interface RealtimeMessage {
  eventId?: string;
  type: string;
  data: any;
}

@Injectable()
export class RealtimeService {
  private eventSubject = new Subject<RealtimeMessage>();

  broadcast(eventId: string | undefined, type: string, data: any) {
    this.eventSubject.next({ eventId, type, data });
  }

  getStream(filterEventId?: string): Observable<any> {
    return this.eventSubject.asObservable().pipe(
      filter(msg => !filterEventId || !msg.eventId || msg.eventId === filterEventId),
      map(msg => ({
        data: {
          type: msg.type,
          data: msg.data,
          timestamp: new Date().toISOString()
        }
      }))
    );
  }
}
