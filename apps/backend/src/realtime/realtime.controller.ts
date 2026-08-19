import { Controller, Sse, Query } from '@nestjs/common';
import { Observable } from 'rxjs';
import { RealtimeService } from './realtime.service';

@Controller('realtime')
export class RealtimeController {
  constructor(private readonly realtimeService: RealtimeService) {}

  @Sse('stream')
  stream(@Query('eventId') eventId?: string): Observable<any> {
    return this.realtimeService.getStream(eventId);
  }
}
