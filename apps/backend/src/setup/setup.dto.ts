import { Matches } from "class-validator";
import { TrimmedText } from "../common/validation/validation-decorators";
import { PIN_PATTERN } from "../users/users.dto";

/**
 * Eingabe der Ersteinrichtung (Issue #173).
 *
 * Die Regeln werden aus `users.dto.ts` IMPORTIERT und nicht abgeschrieben:
 * `AuthService.validateUser` prueft die PIN beim Anmelden gegen genau dieses
 * Muster (`/^\d{4,12}$/`, siehe `auth.service.ts`). Eine hier abweichende
 * Regel ergaebe ein Konto, das angelegt werden kann, sich aber nie anmelden
 * kann - ein Fehler, den keine Pruefung dieses Moduls bemerken wuerde, weil
 * beide Seiten fuer sich betrachtet in Ordnung waeren. Ein Import kann nicht
 * auseinanderlaufen, zwei Literale koennen es.
 *
 * Bewusst KEIN `role`-Feld: Die Rolle ist auf diesem Weg nicht waehlbar,
 * sondern fest ADMINISTRATOR (siehe `SetupService`). Weil die globale
 * Eingabepruefung mit `forbidNonWhitelisted` laeuft
 * (`common/validation/api-validation.ts`), fuehrt ein mitgeschicktes `role`
 * nicht etwa zu stillem Verwerfen, sondern zu 400 - der Versuch ist damit
 * sichtbar und nicht nur wirkungslos.
 */
export class CreateSetupAdminDto {
  @TrimmedText(64)
  username: string;

  @Matches(PIN_PATTERN)
  pin: string;
}

/**
 * Antwort von `GET /setup/status`. Genau ein Wahrheitswert, sonst nichts:
 * Der Weg ist unangemeldet erreichbar, also darf er weder Benutzernamen noch
 * Anzahl noch Zeitpunkte preisgeben.
 */
export interface SetupStatus {
  setupRequired: boolean;
}
