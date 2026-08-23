import {
  BadRequestException,
  ConflictException,
  ExecutionContext,
  ForbiddenException,
  InternalServerErrorException,
  UnauthorizedException,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import {
  FastifyAdapter,
  NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { ORDER_REJECTION_CODES } from "@vereinorder/shared";
import { OrdersController } from "../src/orders/orders.controller";
import { OrdersService } from "../src/orders/orders.service";
import { OrderSubmissionExceptionFilter } from "../src/orders/order-submission-exception.filter";
import { orderRejection } from "../src/orders/order-rejection";
import { JwtAuthGuard } from "../src/auth/jwt-auth.guard";
import { RolesGuard } from "../src/common/guards/roles.guard";
import { createApiValidationPipe } from "../src/common/validation/api-validation";
import { BadRequestFilter } from "../src/common/validation/bad-request.filter";

describe("stabile Fehlerkennungen von POST /orders (Issue #93)", () => {
  let app: NestFastifyApplication;
  let server: {
    inject(options: {
      method: string;
      url: string;
      payload: string;
      headers: Record<string, string>;
    }): Promise<{
      statusCode: number;
      // Fastifys Testantwort wird nur innerhalb dieser Testgrenze gelesen.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      json(): any;
    }>;
  };
  const ordersService = {
    createOrder: jest.fn(),
    createQuickSale: jest.fn(),
  };

  const authGuard = {
    canActivate(context: ExecutionContext) {
      const request = context.switchToHttp().getRequest<{
        headers: Record<string, string | undefined>;
        user?: { userId: string; role: string };
      }>();
      const authMode = request.headers["x-test-auth"];
      if (!authMode) throw new UnauthorizedException();
      request.user = {
        userId: "10000000-0000-4000-8000-000000000001",
        role: authMode === "forbidden" ? "STATION" : "WAITER",
      };
      return true;
    },
  };

  const rolesGuard = {
    canActivate(context: ExecutionContext) {
      const request = context.switchToHttp().getRequest<{
        user?: { role?: string };
      }>();
      if (request.user?.role === "STATION") {
        throw new ForbiddenException();
      }
      return true;
    },
  };

  const validOrder = {
    eventId: "20000000-0000-4000-8000-000000000002",
    items: [
      {
        productId: "30000000-0000-4000-8000-000000000003",
        quantity: 1,
      },
    ],
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [OrdersController],
      providers: [
        OrderSubmissionExceptionFilter,
        { provide: OrdersService, useValue: ordersService },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(authGuard)
      .overrideGuard(RolesGuard)
      .useValue(rolesGuard)
      .compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    app.useGlobalPipes(createApiValidationPipe());
    app.useGlobalFilters(new BadRequestFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    server = app.getHttpAdapter().getInstance() as typeof server;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.resetAllMocks();
  });

  function post(
    url: string,
    payload: unknown,
    authMode?: "allowed" | "forbidden",
  ) {
    return server.inject({
      method: "POST",
      url,
      payload: JSON.stringify(payload),
      headers: {
        "content-type": "application/json",
        ...(authMode ? { "x-test-auth": authMode } : {}),
      },
    });
  }

  it("liefert für eine abgelaufene oder fehlende Anmeldung AUTH_EXPIRED", async () => {
    const response = await post("/orders", validOrder);

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      statusCode: 401,
      code: ORDER_REJECTION_CODES.AUTH_EXPIRED,
      message: expect.any(String),
      errors: [],
    });
    expect(ordersService.createOrder).not.toHaveBeenCalled();
  });

  it("liefert bei fehlender Rolle FORBIDDEN", async () => {
    const response = await post("/orders", validOrder, "forbidden");

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      statusCode: 403,
      code: ORDER_REJECTION_CODES.FORBIDDEN,
      message: expect.any(String),
      errors: [],
    });
    expect(ordersService.createOrder).not.toHaveBeenCalled();
  });

  it("übersetzt DTO-Fehler sicher in VALIDATION und behält Feldfehler", async () => {
    const response = await post(
      "/orders",
      {
        ...validOrder,
        items: [{ ...validOrder.items[0], quantity: "eins" }],
        token: "geheim",
      },
      "allowed",
    );
    const body = response.json();

    expect(response.statusCode).toBe(400);
    expect(body).toMatchObject({
      statusCode: 400,
      code: ORDER_REJECTION_CODES.VALIDATION,
      message: "Die Eingabe ist ungültig.",
    });
    expect(body.errors.length).toBeGreaterThan(0);
    expect(JSON.stringify(body)).not.toContain("geheim");
    expect(JSON.stringify(body)).not.toContain("target");
    expect(ordersService.createOrder).not.toHaveBeenCalled();
  });

  it.each([
    [
      BadRequestException,
      400,
      ORDER_REJECTION_CODES.EVENT_MODE,
      "Der Veranstaltungstext wurde umformuliert.",
    ],
    [
      ConflictException,
      409,
      ORDER_REJECTION_CODES.SESSION_CLOSED,
      "Der Sitzungstext wurde umformuliert.",
    ],
    [
      BadRequestException,
      400,
      ORDER_REJECTION_CODES.PRODUCT_UNAVAILABLE,
      "Der Produkttext wurde umformuliert.",
    ],
    [
      BadRequestException,
      400,
      ORDER_REJECTION_CODES.PRICE_OR_OPTION,
      "Der Auswahltext wurde umformuliert.",
    ],
    [
      BadRequestException,
      400,
      ORDER_REJECTION_CODES.DUPLICATE_KEY_MISMATCH,
      "Für dieses Kennzeichen liegt eine andere Anfrage vor.",
    ],
  ] as const)(
    "liefert %p als stabilen HTTP-Code %s",
    async (ExceptionType, status, code, message) => {
      ordersService.createOrder.mockRejectedValueOnce(
        new ExceptionType(orderRejection(code, message)),
      );

      const response = await post("/orders", validOrder, "allowed");

      expect(response.statusCode).toBe(status);
      expect(response.json()).toEqual({
        statusCode: status,
        error: status === 409 ? "Conflict" : "Bad Request",
        code,
        message,
        errors: [],
      });
    },
  );

  it("gibt bei unbekanntem fachlichem 400 keine fremden Details aus", async () => {
    ordersService.createOrder.mockRejectedValueOnce(
      new BadRequestException({
        code: "INTERNER_CODE",
        message: "Sichere Meldung.",
        stack: "at OrdersService.createOrder",
        existingOrder: { id: "foreign-order", totalAmount: 12345 },
      }),
    );

    const response = await post("/orders", validOrder, "allowed");
    const body = response.json();

    expect(body).toEqual({
      statusCode: 400,
      error: "Bad Request",
      code: ORDER_REJECTION_CODES.VALIDATION,
      message: "Sichere Meldung.",
      errors: [],
    });
    expect(JSON.stringify(body)).not.toContain("foreign-order");
    expect(JSON.stringify(body)).not.toContain("12345");
    expect(JSON.stringify(body)).not.toContain("stack");
  });

  it("ändert weder Nachbarendpunkte noch 5xx-Antworten", async () => {
    ordersService.createQuickSale.mockRejectedValueOnce(
      new BadRequestException(
        orderRejection(
          ORDER_REJECTION_CODES.PRODUCT_UNAVAILABLE,
          "Produkt nicht verfügbar.",
        ),
      ),
    );
    const quickSale = await post(
      "/orders/quick-sale",
      {
        ...validOrder,
        idempotencyKey: "quick-sale-key",
        paymentMethod: "CASH",
      },
      "allowed",
    );
    expect(quickSale.statusCode).toBe(400);
    expect(quickSale.json().code).toBe("BAD_REQUEST");

    ordersService.createOrder.mockRejectedValueOnce(
      new InternalServerErrorException("Interner Fehler."),
    );
    const serverError = await post("/orders", validOrder, "allowed");
    expect(serverError.statusCode).toBe(500);
    expect(serverError.json().code).toBeUndefined();
  });
});
