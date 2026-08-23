import { EventStatus } from "@vereinorder/database";
import { Transform } from "class-transformer";
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsObject,
  IsOptional,
  IsUUID,
  registerDecorator,
  ValidateIf,
} from "class-validator";
import { TrimmedText } from "../common/validation/validation-decorators";

function optionalText(value: unknown) {
  return typeof value === "string" && value.trim() === "" ? undefined : value;
}

/** Validiert die dynamische UUID-zu-UUID/null-Struktur der Stationsabbildung. */
function IsStationMapping(): PropertyDecorator {
  return (target, propertyKey) =>
    registerDecorator({
      name: "isStationMapping",
      target: target.constructor,
      propertyName: propertyKey as string,
      validator: {
        validate(value: unknown) {
          if (!value || typeof value !== "object" || Array.isArray(value))
            return false;
          return Object.entries(value as Record<string, unknown>).every(
            ([sourceId, targetId]) =>
              /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
                sourceId,
              ) &&
              (targetId === null ||
                (typeof targetId === "string" &&
                  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
                    targetId,
                  ))),
          );
        },
      },
    });
}

export class CreateEventDto {
  @TrimmedText(200)
  name: string;

  @IsOptional()
  @Transform(({ value }) => optionalText(value))
  @TrimmedText(200)
  organizer?: string;

  @IsOptional()
  @Transform(({ value }) => optionalText(value))
  @TrimmedText(200)
  location?: string;

  @IsOptional()
  @IsDateString()
  startTime?: string;

  @IsOptional()
  @IsDateString()
  endTime?: string;

  @IsOptional()
  @TrimmedText(100)
  timezone?: string;
}

export class UpdateEventDto {
  @IsOptional()
  @TrimmedText(200)
  name?: string;

  @IsOptional()
  @Transform(({ value }) => optionalText(value))
  @TrimmedText(200)
  organizer?: string | null;

  @IsOptional()
  @Transform(({ value }) => optionalText(value))
  @TrimmedText(200)
  location?: string | null;

  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsDateString()
  startTime?: string | null;

  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsDateString()
  endTime?: string | null;

  @IsOptional()
  @TrimmedText(100)
  timezone?: string;
}

export class DuplicateEventDto {
  @IsOptional()
  @Transform(({ value }) => optionalText(value))
  @TrimmedText(200)
  name?: string;
}

export class CopyAssortmentDto {
  @IsUUID("4")
  targetEventId: string;

  @IsObject()
  @IsStationMapping()
  stationMappings: Record<string, string | null>;
}

export class ActivateEventDto {
  @IsBoolean()
  confirmed: boolean;

  @IsOptional()
  @TrimmedText(64)
  disclaimerVersion?: string;
}

export class ChangeEventStatusDto {
  @IsEnum(EventStatus)
  status: EventStatus;
}

export class CleanTestDataDto {
  @TrimmedText(200)
  confirmationName: string;
}

/**
 * Der Import bleibt absichtlich unknown: EventsService.parseImport() ist der
 * versionsabhaengige, vollstaendige Parser und die einzige Freigabestelle.
 */
export type EventConfigImportPayload = unknown;
