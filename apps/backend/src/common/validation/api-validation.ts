import {
  BadRequestException,
  ValidationError,
  ValidationPipe,
} from "@nestjs/common";

export interface ApiValidationFieldError {
  field: string;
  code: string;
  message: string;
}

const PUBLIC_CONSTRAINT_MESSAGES: Record<string, string> = {
  arrayMaxSize: "Die Liste enthält zu viele Einträge.",
  arrayMinSize: "Die Liste enthält zu wenige Einträge.",
  arrayNotEmpty: "Die Liste darf nicht leer sein.",
  isArray: "Muss eine Liste sein.",
  isBoolean: "Muss ein Wahrheitswert sein.",
  isDateString: "Muss ein gültiger ISO-8601-Zeitpunkt sein.",
  isDefined: "Ist erforderlich.",
  isEnum: "Enthält einen nicht erlaubten Wert.",
  isIn: "Enthält einen nicht erlaubten Wert.",
  isInt: "Muss eine ganze Zahl sein.",
  isNotEmpty: "Darf nicht leer sein.",
  isNumber: "Muss eine Zahl sein.",
  isObject: "Muss ein Objekt sein.",
  isString: "Muss Text sein.",
  isUUID: "Muss eine gültige UUID sein.",
  matches: "Hat ein ungültiges Format.",
  max: "Ist größer als der erlaubte Höchstwert.",
  maxLength: "Ist länger als erlaubt.",
  min: "Ist kleiner als der erlaubte Mindestwert.",
  minLength: "Ist kürzer als erlaubt.",
  nestedValidation: "Enthält ungültige Unterfelder.",
  whitelistValidation: "Feld ist nicht erlaubt.",
};

function collectValidationErrors(
  errors: ValidationError[],
  parent = "",
): ApiValidationFieldError[] {
  return errors.flatMap((error) => {
    const field = parent
      ? `${parent}.${error.property || "Eingabe"}`
      : error.property || "Eingabe";
    const own = Object.keys(error.constraints || {}).map((constraint) => ({
      field,
      code: constraint,
      message: PUBLIC_CONSTRAINT_MESSAGES[constraint] || "Wert ist ungültig.",
    }));
    return [...own, ...collectValidationErrors(error.children || [], field)];
  });
}

export function createApiValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    transform: true,
    transformOptions: { enableImplicitConversion: false },
    whitelist: true,
    forbidNonWhitelisted: true,
    forbidUnknownValues: true,
    validateCustomDecorators: true,
    validationError: { target: false, value: false },
    exceptionFactory: (errors) =>
      new BadRequestException({
        statusCode: 400,
        error: "Bad Request",
        code: "VALIDATION_ERROR",
        message: "Die Eingabe ist ungültig.",
        errors: collectValidationErrors(errors).sort(
          (left, right) =>
            left.field.localeCompare(right.field) ||
            left.code.localeCompare(right.code),
        ),
      }),
  });
}
