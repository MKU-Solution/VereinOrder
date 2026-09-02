import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import { MaintenancePublic } from "../maintenance/maintenance.decorator";
import {
  HEALTH_OK,
  HEALTH_UNAVAILABLE,
  HealthResponse,
  HealthService,
} from "./health.service";

/**
 * Bereitschaftsweg (#184). Vor dieser Änderung meldete kein Dienst des
 * Bündels außer PostgreSQL einen Zustand: `frontend` und `print-worker`
 * warteten in `docker-compose.yml` nur darauf, dass der Backend-Container
 * GESTARTET wurde, nicht darauf, dass er antwortet. Der Print-Worker lief
 * deshalb bei jedem Hochfahren zwangsläufig ins Leere und füllte sein
 * Protokoll von der ersten Sekunde an mit `backend.claim_failed` — Fehlern,
 * die keine sind.
 *
 * ## Warum kein `JwtAuthGuard`
 *
 * Ein Healthcheck läuft im Container ohne Anmeldedaten. Ein Weg mit
 * Anmeldepflicht verlangte ein hinterlegtes Administrator-Token in
 * `docker-compose.yml` — ein dauerhaftes Token für eine Prüfung, die nichts
 * darf, wäre der schlechtere Tausch. `GET /diagnostics/status` bleibt genau
 * dafür verriegelt: Wer Einzelheiten will, meldet sich an.
 *
 * Was dieser Weg preisgibt, steht abschließend in `health.service.ts`:
 * `{"status":"ok"}` oder `{"status":"unavailable"}`, sonst nichts.
 *
 * ## Warum `@MaintenancePublic()`
 *
 * Der Wartungsguard läuft als `APP_GUARD` vor jedem controllergebundenen
 * Guard (`maintenance.module.ts`) und weist bei LOCKED jede Anfrage mit 503
 * ab. Ohne diese Markierung gälte der Container während JEDER Wartung als
 * ungesund — obwohl der Prozess läuft, die Datenbank steht und der
 * Wartungsmodus genau der Zustand ist, in dem jemand von außen nachsieht, ob
 * das System noch lebt. Die Wartungssperre schützt vor schreibenden
 * Zugriffen; dieser Weg schreibt nichts.
 *
 * ## Warum 503 und nicht 200 mit einem Feld
 *
 * `docker-compose.yml` ruft den Weg mit BusyBox-`wget` ab, und dessen
 * Rückgabewert hängt am HTTP-Status. Eine Antwort "200 mit
 * `status: unavailable`" wäre für Docker eine gesunde Antwort. Der Status
 * IST hier die Aussage; der Rumpf ist für den Menschen, der die Adresse im
 * Browser öffnet.
 */
@MaintenancePublic()
@Controller("health")
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  async getHealth(): Promise<HealthResponse> {
    if (await this.healthService.isReady()) {
      return HEALTH_OK;
    }
    // Ein Objekt als Argument wird von Nest unveraendert zum Antwortrumpf -
    // ohne die sonst ergaenzten Felder "message", "error" und "statusCode".
    // Genau das ist hier gewollt: nichts ausser dem Zustand.
    throw new ServiceUnavailableException(HEALTH_UNAVAILABLE);
  }
}
