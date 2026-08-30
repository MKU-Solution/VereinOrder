import { Module } from "@nestjs/common";
import { SetupController } from "./setup.controller";
import { SetupService } from "./setup.service";

/**
 * Ersteinrichtung (Issue #173). Ohne eigene Importe: `PrismaModule` und
 * `AuditModule` sind `@Global()`, und `SetupService` braucht sonst nichts.
 *
 * Bewusst ein eigenes Modul und keine zweite Route in `UsersModule`: Die
 * Benutzerverwaltung ist dauerhaft und vollstaendig hinter `JwtAuthGuard`
 * und `RolesGuard` verriegelt (`users.controller.ts`). Ein unangemeldeter
 * Weg in demselben Controller waere eine Ausnahme mitten in einer sonst
 * geschlossenen Flaeche - leicht zu uebersehen, wenn jemand spaeter dort
 * etwas hinzufuegt. Getrennte Module halten die Ausnahme dort sichtbar, wo
 * sie hingehoert.
 */
@Module({
  controllers: [SetupController],
  providers: [SetupService],
})
export class SetupModule {}
