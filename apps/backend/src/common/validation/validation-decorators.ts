import { Transform } from "class-transformer";
import {
  IsInt,
  IsNotEmpty,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidationOptions,
} from "class-validator";

export const INT32_MIN = -2_147_483_648;
export const INT32_MAX = 2_147_483_647;
export const MAX_QUANTITY = 100;

export function TrimmedText(
  maxLength: number,
  minLength = 1,
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return (target, propertyKey) => {
    Transform(({ value }) =>
      typeof value === "string" ? value.trim() : value,
    )(target, propertyKey);
    IsString(validationOptions)(target, propertyKey);
    IsNotEmpty(validationOptions)(target, propertyKey);
    MinLength(minLength, validationOptions)(target, propertyKey);
    MaxLength(maxLength, validationOptions)(target, propertyKey);
  };
}

export function Int32(
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return (target, propertyKey) => {
    IsInt(validationOptions)(target, propertyKey);
    Min(INT32_MIN, validationOptions)(target, propertyKey);
    Max(INT32_MAX, validationOptions)(target, propertyKey);
  };
}

export function NonNegativeInt32(
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return (target, propertyKey) => {
    IsInt(validationOptions)(target, propertyKey);
    Min(0, validationOptions)(target, propertyKey);
    Max(INT32_MAX, validationOptions)(target, propertyKey);
  };
}

export function SortOrder(
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return NonNegativeInt32(validationOptions);
}

export function Quantity(
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return (target, propertyKey) => {
    IsInt(validationOptions)(target, propertyKey);
    Min(1, validationOptions)(target, propertyKey);
    Max(MAX_QUANTITY, validationOptions)(target, propertyKey);
  };
}
