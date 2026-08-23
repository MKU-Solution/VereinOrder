import { TrimmedText } from "../common/validation/validation-decorators";
import { IsString, MaxLength, MinLength } from "class-validator";

/**
 * PINs beim Anmelden werden absichtlich nicht auf Ziffern beschraenkt.
 * Auch falsch formatierte Eingaben muessen AuthService erreichen, damit
 * dessen Dummy-Bcrypt-Vergleich und Drosselung nicht umgangen werden.
 */
export class LoginDto {
  @TrimmedText(64)
  username: string;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  pin: string;
}

export class SwitchUserDto extends LoginDto {}
