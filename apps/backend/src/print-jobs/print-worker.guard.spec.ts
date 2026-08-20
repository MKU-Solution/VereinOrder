import {
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { PrintWorkerGuard } from "./print-worker.guard";

describe("PrintWorkerGuard", () => {
  const previousToken = process.env.PRINT_WORKER_TOKEN;
  const token = "issue52-test-worker-token-32-characters";
  const context = (supplied?: string) =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({
          headers: supplied ? { "x-print-worker-token": supplied } : {},
        }),
      }),
    }) as any;

  afterAll(() => {
    if (previousToken === undefined) delete process.env.PRINT_WORKER_TOKEN;
    else process.env.PRINT_WORKER_TOKEN = previousToken;
  });

  it("verweigert den Worker-Endpunkt ohne sichere Serverkonfiguration", () => {
    delete process.env.PRINT_WORKER_TOKEN;
    expect(() => new PrintWorkerGuard().canActivate(context(token))).toThrow(
      ServiceUnavailableException,
    );
  });

  it("vergleicht das konfigurierte Worker-Token und lehnt Abweichungen ab", () => {
    process.env.PRINT_WORKER_TOKEN = token;
    const guard = new PrintWorkerGuard();
    expect(() => guard.canActivate(context("wrong-token"))).toThrow(
      UnauthorizedException,
    );
    expect(guard.canActivate(context(token))).toBe(true);
  });
});
