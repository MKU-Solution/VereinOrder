import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import {
  MAINTENANCE_BLOCKED_DURING_DRAINING_KEY,
  MAINTENANCE_PUBLIC_KEY,
} from "./maintenance.decorator";
import { MaintenanceStateService } from "./maintenance-state.service";
import { MaintenanceState } from "./maintenance.types";

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Vorgabe, solange keine `expectedUntil` bekannt ist. */
const DEFAULT_RETRY_AFTER_SECONDS = 30;

/**
 * Globaler Guard (registriert über `APP_GUARD` in `MaintenanceModule`).
 * NestJS führt global registrierte Guards immer vor controller- und
 * routengebundenen Guards aus (hier also vor `JwtAuthGuard`/`RolesGuard`,
 * `PrintWorkerGuard` usw.) — das ist die technische Grundlage für die Zusage
 * aus Ergänzung 2 der Projektleitung: bei LOCKED und fehlendem Token kommt
 * 503, nicht 401. Ein eigener Integrationstest
 * (`test/maintenance.guard-order.integration-spec.ts`) belegt das gegen die
 * tatsächliche Modulregistrierung, weil diese Zusage bei einer künftigen
 * Umstellung von global auf `@UseGuards(...)` lautlos kippen könnte.
 *
 * Ausnahmen laut Entwurf Abschnitt 6:
 * - OPEN: alles durch.
 * - DRAINING: nur lesende Anfragen (GET/HEAD/OPTIONS) dürfen durch; neue
 *   schreibende Vorgänge werden abgewiesen. GENAU EINE benannte Ausnahme von
 *   dieser Regel: `GET /sessions/context` (markiert mit
 *   `@MaintenanceBlockedDuringDraining()`, siehe dort für die Begründung —
 *   Entscheidung der Projektleitung, Runde 2) bleibt auch als lesende
 *   Anfrage gesperrt, weil sonst genau der Zustandswechsel entsteht, den die
 *   Sperre um jeden Preis verhindern soll.
 * - LOCKED: alles außer per `@MaintenancePublic()` markierten Routen bekommt
 *   503. Das schließt `GET /sessions/context` ausdrücklich ein (Entwurf,
 *   wichtigster Einzelentschluss des Abschnitts) — dafür ist keine
 *   Sonderbehandlung nötig, weil der Endpunkt nirgends als öffentlich
 *   markiert ist.
 */
@Injectable()
export class MaintenanceGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly maintenanceState: MaintenanceStateService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(
      MAINTENANCE_PUBLIC_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (isPublic) return true;

    const state = this.maintenanceState.read();
    if (state.phase === "OPEN") return true;

    if (state.phase === "DRAINING") {
      const blockedDuringDraining = this.reflector.getAllAndOverride<boolean>(
        MAINTENANCE_BLOCKED_DURING_DRAINING_KEY,
        [context.getHandler(), context.getClass()],
      );
      if (!blockedDuringDraining) {
        const request = context.switchToHttp().getRequest();
        const method = String(request?.method ?? "GET").toUpperCase();
        if (READ_METHODS.has(method)) return true;
      }
    }

    this.reject(context, state);
  }

  private reject(context: ExecutionContext, state: MaintenanceState): never {
    const response = context.switchToHttp().getResponse();
    const retryAfterSeconds = this.computeRetryAfterSeconds(state);
    if (typeof response?.header === "function") {
      response.header("Retry-After", String(retryAfterSeconds));
    } else if (typeof response?.setHeader === "function") {
      response.setHeader("Retry-After", String(retryAfterSeconds));
    }
    throw new ServiceUnavailableException(
      "Wartungsmodus aktiv: Das System ist vorübergehend nicht erreichbar.",
    );
  }

  private computeRetryAfterSeconds(state: MaintenanceState): number {
    if (!state.expectedUntil) return DEFAULT_RETRY_AFTER_SECONDS;
    const remainingMs = new Date(state.expectedUntil).getTime() - Date.now();
    if (!Number.isFinite(remainingMs) || remainingMs <= 0) {
      return DEFAULT_RETRY_AFTER_SECONDS;
    }
    return Math.ceil(remainingMs / 1000);
  }
}
