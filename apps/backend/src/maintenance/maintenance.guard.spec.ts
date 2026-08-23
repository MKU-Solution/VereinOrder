import { ExecutionContext, ServiceUnavailableException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { MaintenanceGuard } from "./maintenance.guard";
import { MaintenanceState } from "./maintenance.types";
import { AuthController } from "../auth/auth.controller";
import { BackupController } from "../backup/backup.controller";
import { DiagnosticsController } from "../diagnostics/diagnostics.controller";
import { SessionsController } from "../sessions/sessions.controller";
import { PrintJobsController } from "../print-jobs/print-jobs.controller";
import { MaintenanceController } from "./maintenance.controller";

function makeMaintenanceState(state: Partial<MaintenanceState> = {}) {
  const full: MaintenanceState = {
    phase: "OPEN",
    since: null,
    byUserId: null,
    byUsername: null,
    reason: null,
    expectedUntil: null,
    ...state,
  };
  return { read: jest.fn(() => full) };
}

/**
 * Baut einen minimalen `ExecutionContext`, der `getHandler()`/`getClass()`
 * auf die tatsächlichen, im Quellcode dekorierten Controller-Methoden zeigt.
 * Das ist bewusst kein Ausdenken einer eigenen Beispielklasse: die
 * Ausnahmentabelle aus Entwurf Abschnitt 6 wird damit gegen den echten
 * Bestand geprüft. Ändert jemand künftig `@MaintenancePublic()` an der
 * falschen Stelle, schlägt genau dieser Test fehl.
 */
function makeContext(
  target: new (...args: never[]) => unknown,
  methodName: string,
  options: { method?: string; response?: any } = {},
): ExecutionContext {
  const handler = (target.prototype as any)[methodName];
  const response = options.response ?? {
    header: jest.fn(),
    setHeader: jest.fn(),
  };
  return {
    getHandler: () => handler,
    getClass: () => target,
    switchToHttp: () => ({
      getRequest: () => ({ method: options.method ?? "GET" }),
      getResponse: () => response,
    }),
  } as unknown as ExecutionContext;
}

describe("MaintenanceGuard (Issue #67, Entwurf Abschnitt 6)", () => {
  const reflector = new Reflector();

  describe("Ausnahmentabelle bei LOCKED", () => {
    const cases: Array<{
      label: string;
      target: new (...args: never[]) => unknown;
      method: string;
      httpMethod?: string;
      allowed: boolean;
    }> = [
      {
        label: "GET /maintenance",
        target: MaintenanceController,
        method: "getStatus",
        allowed: true,
      },
      {
        label:
          "POST /maintenance/end (Ausstieg aus LOCKED muss möglich bleiben)",
        target: MaintenanceController,
        method: "end",
        httpMethod: "POST",
        allowed: true,
      },
      {
        label: "POST /auth/login",
        target: AuthController,
        method: "login",
        httpMethod: "POST",
        allowed: true,
      },
      {
        label:
          "POST /auth/switch (Ergänzung Runde 2: Entsperren muss möglich bleiben)",
        target: AuthController,
        method: "switchUser",
        httpMethod: "POST",
        allowed: true,
      },
      {
        label: "alles unter /backup, hier: POST /backup/create",
        target: BackupController,
        method: "createBackup",
        httpMethod: "POST",
        allowed: true,
      },
      {
        label: "GET /diagnostics/status",
        target: DiagnosticsController,
        method: "getStatus",
        allowed: true,
      },
      {
        label:
          "POST /diagnostics/retry-failed-print-jobs (NICHT ausgenommen laut Tabelle)",
        target: DiagnosticsController,
        method: "retryFailedPrintJobs",
        httpMethod: "POST",
        allowed: false,
      },
      {
        label: "GET /sessions/context — eigens benannte Sperre",
        target: SessionsController,
        method: "getContext",
        allowed: false,
      },
      {
        label: "POST /print-jobs/claim (Druck-Arbeiter)",
        target: PrintJobsController,
        method: "claimNextJob",
        httpMethod: "POST",
        allowed: false,
      },
    ];

    it.each(cases)(
      "$label -> $allowed",
      ({ target, method, httpMethod, allowed }) => {
        const guard = new MaintenanceGuard(
          reflector,
          makeMaintenanceState({ phase: "LOCKED" }) as any,
        );
        const context = makeContext(target, method, { method: httpMethod });

        if (allowed) {
          expect(guard.canActivate(context)).toBe(true);
        } else {
          expect(() => guard.canActivate(context)).toThrow(
            ServiceUnavailableException,
          );
        }
      },
    );
  });

  /**
   * Eigene, benannte Prüfung (Entwurf Abschnitt 6 + Ergänzung der
   * Projektleitung, Runde 2): GET /sessions/context bekommt 503 in BEIDEN
   * Phasen ungleich OPEN, nicht erst ab LOCKED. Nicht nur als Zeile in der
   * Tabelle oben, weil genau dieser Endpunkt der wichtigste Einzelentschluss
   * des Abschnitts ist - ein Regressions-Fund an dieser einen Zeile darf
   * nicht in der Menge der übrigen Fälle untergehen.
   */
  describe("GET /sessions/context — eigens benannte Sperre in DRAINING UND LOCKED", () => {
    it.each([["DRAINING"], ["LOCKED"]] as const)(
      "bekommt 503 bei %s, obwohl es eine lesende Anfrage ist",
      (phase) => {
        const guard = new MaintenanceGuard(
          reflector,
          makeMaintenanceState({ phase }) as any,
        );
        const context = makeContext(SessionsController, "getContext", {
          method: "GET",
        });
        expect(() => guard.canActivate(context)).toThrow(
          ServiceUnavailableException,
        );
      },
    );
  });

  describe("Phasenlogik", () => {
    it("lässt bei OPEN jede Anfrage durch, auch nicht ausgenommene", () => {
      const guard = new MaintenanceGuard(
        reflector,
        makeMaintenanceState({ phase: "OPEN" }) as any,
      );
      const context = makeContext(SessionsController, "getContext");
      expect(guard.canActivate(context)).toBe(true);
    });

    it("lässt bei DRAINING lesende Anfragen durch, die nicht eigens gesperrt sind", () => {
      const guard = new MaintenanceGuard(
        reflector,
        makeMaintenanceState({ phase: "DRAINING" }) as any,
      );
      // getActiveSession trägt keine @MaintenanceBlockedDuringDraining() -
      // anders als getContext (siehe eigene Tests unten) bleibt die
      // allgemeine Regel "lesend = durch" für diese Route in Kraft.
      const context = makeContext(SessionsController, "getActiveSession", {
        method: "GET",
      });
      expect(guard.canActivate(context)).toBe(true);
    });

    it("weist bei DRAINING einen neuen schreibenden Vorgang ab", () => {
      const guard = new MaintenanceGuard(
        reflector,
        makeMaintenanceState({ phase: "DRAINING" }) as any,
      );
      const context = makeContext(SessionsController, "startSession", {
        method: "POST",
      });
      expect(() => guard.canActivate(context)).toThrow(
        ServiceUnavailableException,
      );
    });

    it("setzt bei einer Ablehnung Retry-After", () => {
      const guard = new MaintenanceGuard(
        reflector,
        makeMaintenanceState({ phase: "LOCKED" }) as any,
      );
      const response = { header: jest.fn(), setHeader: jest.fn() };
      const context = makeContext(SessionsController, "getContext", {
        response,
      });

      expect(() => guard.canActivate(context)).toThrow(
        ServiceUnavailableException,
      );
      expect(response.header).toHaveBeenCalledWith(
        "Retry-After",
        expect.any(String),
      );
    });
  });
});
