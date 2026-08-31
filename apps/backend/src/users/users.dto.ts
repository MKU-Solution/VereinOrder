import { Role } from "@vereinorder/database";
import { Transform } from "class-transformer";
import { IsBoolean, IsEnum, IsOptional, Matches } from "class-validator";
import { TrimmedText } from "../common/validation/validation-decorators";

/**
 * Issue #173: exportiert, damit die Ersteinrichtung (`setup.dto.ts`) genau
 * dieselbe PIN-Form verlangt, statt sie abzuschreiben. `AuthService` prueft
 * beim Anmelden gegen dasselbe Muster; drei Literale an drei Stellen waeren
 * drei Gelegenheiten, ein nicht anmeldbares Konto zu erzeugen.
 */
export const PIN_PATTERN = /^\d{4,12}$/;

export class CreateUserDto {
  @TrimmedText(64)
  username: string;

  @Matches(PIN_PATTERN)
  pin: string;

  @IsEnum(Role)
  role: Role;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateUserDto {
  @IsOptional()
  @TrimmedText(64)
  username?: string;

  @IsOptional()
  @IsEnum(Role)
  role?: Role;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateUserPinDto {
  @Transform(({ value }) => value)
  @Matches(PIN_PATTERN)
  pin: string;
}
