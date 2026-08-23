import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ExceptionFilter,
} from "@nestjs/common";

interface ValidationResponse {
  code?: unknown;
  message?: unknown;
  errors?: unknown;
}

@Catch(BadRequestException)
export class BadRequestFilter implements ExceptionFilter {
  catch(exception: BadRequestException, host: ArgumentsHost): void {
    const reply = host.switchToHttp().getResponse<{
      status: (code: number) => { send: (body: unknown) => void };
    }>();
    const response = exception.getResponse();
    const details =
      response && typeof response === "object"
        ? (response as ValidationResponse)
        : undefined;

    if (
      details?.code === "VALIDATION_ERROR" &&
      typeof details.message === "string" &&
      Array.isArray(details.errors)
    ) {
      reply.status(400).send({
        statusCode: 400,
        error: "Bad Request",
        code: "VALIDATION_ERROR",
        message: details.message,
        errors: details.errors,
      });
      return;
    }

    const safeMessage =
      typeof response === "string"
        ? response
        : typeof details?.message === "string"
          ? details.message
          : "Die Anfrage ist ungültig.";
    reply.status(400).send({
      statusCode: 400,
      error: "Bad Request",
      code: "BAD_REQUEST",
      message: safeMessage,
      errors: [],
    });
  }
}
