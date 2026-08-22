import { AuditService } from "../../audit/audit.service";

/**
 * Gemeinsame Testattrappe fuer AuditService.
 *
 * Seit Issue #65 (discardOfflineQueueEntry) ist AuditService eine
 * verpflichtende Abhaengigkeit von OrdersService - ein Audit-Ereignis darf
 * nicht vom Gelingen einer optionalen Einbindung abhaengen (siehe
 * orders.service.ts, Konstruktor). Tests, die OrdersService direkt per
 * Konstruktor aufbauen, brauchen deshalb immer ein zweites Argument, auch
 * wenn der jeweilige Testfall keinen Audit-Pfad ausloest.
 */
export function createAuditServiceStub(): jest.Mocked<
  Pick<AuditService, "log">
> {
  return {
    log: jest.fn().mockResolvedValue({} as any),
  } as unknown as jest.Mocked<Pick<AuditService, "log">>;
}
