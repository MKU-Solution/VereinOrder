import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ConflictException,
  ExceptionFilter,
  ForbiddenException,
  UnauthorizedException,
} from "@nestjs/common";
import {
  ORDER_REJECTION_CODES,
  type OrderRejectionCode,
} from "@vereinorder/shared";

interface ExceptionDetails {
  code?: unknown;
  error?: unknown;
  errors?: unknown;
  message?: unknown;
}

type OrderSubmissionException =
  | BadRequestException
  | UnauthorizedException
  | ForbiddenException
  | ConflictException;

const ERROR_NAMES: Record<number, string> = {
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  409: "Conflict",
};

const ORDER_REJECTION_CODE_VALUES = new Set<string>(
  Object.values(ORDER_REJECTION_CODES),
);

function isOrderRejectionCode(value: unknown): value is OrderRejectionCode {
  return typeof value === "string" && ORDER_REJECTION_CODE_VALUES.has(value);
}

function codeFor(
  statusCode: number,
  details: ExceptionDetails | undefined,
): OrderRejectionCode {
  if (statusCode === 401) return ORDER_REJECTION_CODES.AUTH_EXPIRED;
  if (statusCode === 403) return ORDER_REJECTION_CODES.FORBIDDEN;
  if (isOrderRejectionCode(details?.code)) return details.code;
  return ORDER_REJECTION_CODES.VALIDATION;
}

/**
 * Schmale Fehlergrenze fuer die Bestellannahme. Sie ist nur an POST /orders
 * gebunden und laesst 5xx sowie alle anderen Endpunkte beim bestehenden
 * globalen Verhalten. Unbekannte Exception-Felder werden nie serialisiert.
 */
@Catch(
  BadRequestException,
  UnauthorizedException,
  ForbiddenException,
  ConflictException,
)
export class OrderSubmissionExceptionFilter implements ExceptionFilter {
  catch(exception: OrderSubmissionException, host: ArgumentsHost): void {
    const reply = host.switchToHttp().getResponse<{
      status: (code: number) => { send: (body: unknown) => void };
    }>();
    const statusCode = exception.getStatus();
    const response = exception.getResponse();
    const details =
      response && typeof response === "object"
        ? (response as ExceptionDetails)
        : undefined;
    const validationErrors =
      details?.code === "VALIDATION_ERROR" && Array.isArray(details.errors)
        ? details.errors
        : [];
    const message =
      typeof response === "string"
        ? response
        : typeof details?.message === "string"
          ? details.message
          : "Die Bestellung wurde abgelehnt.";

    reply.status(statusCode).send({
      statusCode,
      error: ERROR_NAMES[statusCode] ?? "Request Error",
      code: codeFor(statusCode, details),
      message,
      errors: validationErrors,
    });
  }
}
