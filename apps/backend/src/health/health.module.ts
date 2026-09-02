import { Module } from "@nestjs/common";
import { HealthController } from "./health.controller";
import { HealthService } from "./health.service";

/**
 * Bereitschaftsprüfung (#184). Ohne eigene Importe: `PrismaModule` ist
 * `@Global()`.
 *
 * Ein eigenes Modul und keine zweite Route in `DiagnosticsModule`, aus
 * demselben Grund, den `setup.module.ts` für die Ersteinrichtung nennt: Die
 * Diagnose ist vollständig hinter `JwtAuthGuard` und `RolesGuard`
 * (`@Roles("ADMINISTRATOR")`) verriegelt. Ein unangemeldeter Weg mitten in
 * einer sonst geschlossenen Fläche ist leicht zu übersehen, wenn jemand dort
 * später etwas hinzufügt — und was er hinzufügt, stünde dann versehentlich
 * offen im Netz. Getrennte Module halten die Ausnahme dort sichtbar, wo sie
 * hingehört.
 */
@Module({
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
