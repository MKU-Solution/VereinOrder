import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { timingSafeEqual } from "crypto";

@Injectable()
export class PrintWorkerGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const expected = process.env.PRINT_WORKER_TOKEN;
    if (!expected || expected.length < 32) {
      throw new ServiceUnavailableException(
        "Print worker authentication is not configured",
      );
    }

    const supplied = context.switchToHttp().getRequest().headers[
      "x-print-worker-token"
    ];
    if (typeof supplied !== "string") {
      throw new UnauthorizedException("Invalid print worker token");
    }

    const expectedBuffer = Buffer.from(expected);
    const suppliedBuffer = Buffer.from(supplied);
    if (
      expectedBuffer.length !== suppliedBuffer.length ||
      !timingSafeEqual(expectedBuffer, suppliedBuffer)
    ) {
      throw new UnauthorizedException("Invalid print worker token");
    }
    return true;
  }
}
