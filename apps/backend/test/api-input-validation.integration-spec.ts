import {
  BadRequestException,
  Body,
  Controller,
  INestApplication,
  Module,
  Post,
} from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsUUID,
  ValidateNested,
} from "class-validator";
import { createApiValidationPipe } from "../src/common/validation/api-validation";
import { BadRequestFilter } from "../src/common/validation/bad-request.filter";
import {
  NonNegativeInt32,
  Quantity,
  TrimmedText,
} from "../src/common/validation/validation-decorators";

class ValidationItemDto {
  @IsUUID("4")
  productId: string;

  @Quantity()
  quantity: number;
}

class ValidationBodyDto {
  @TrimmedText(20)
  name: string;

  @NonNegativeInt32()
  amount: number;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(2)
  @ValidateNested({ each: true })
  @Type(() => ValidationItemDto)
  items: ValidationItemDto[];
}

@Controller("validation-test")
class ValidationTestController {
  @Post()
  accept(@Body() body: ValidationBodyDto) {
    return body;
  }

  @Post("business-error")
  rejectBusinessRequest() {
    throw new BadRequestException("Fachlich ungültig.");
  }
}

@Module({ controllers: [ValidationTestController] })
class ValidationTestModule {}

describe("globale API-Eingabevalidierung (Issue #69)", () => {
  let app: INestApplication;
  let server: {
    inject(options: {
      method: string;
      url: string;
      payload: string;
      headers: Record<string, string>;
    }): Promise<{
      statusCode: number;
      // Fastifys Testantwort wird hier nur innerhalb dieser Testgrenze gelesen.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      json(): any;
    }>;
  };

  const validBody = {
    name: "Ausschank",
    amount: 500,
    items: [
      {
        productId: "10000000-0000-4000-8000-000000000001",
        quantity: 1,
      },
    ],
  };

  beforeAll(async () => {
    app = await NestFactory.create<NestFastifyApplication>(
      ValidationTestModule,
      new FastifyAdapter(),
      { logger: false },
    );
    app.useGlobalPipes(createApiValidationPipe());
    app.useGlobalFilters(new BadRequestFilter());
    await app.init();
    const adapter = app.getHttpAdapter();
    await adapter.getInstance().ready();
    server = adapter.getInstance() as typeof server;
  });

  afterAll(async () => {
    await app.close();
  });

  async function post(payload: unknown, path = "/validation-test") {
    return server.inject({
      method: "POST",
      url: path,
      payload: JSON.stringify(payload),
      headers: { "content-type": "application/json" },
    });
  }

  it("akzeptiert dokumentierte Felder und trimmt Texte", async () => {
    const response = await post({ ...validBody, name: "  Ausschank  " });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ name: "Ausschank", amount: 500 });
  });

  it.each([
    ["unbekanntes Top-Level-Feld", { ...validBody, pinHash: "geheim" }],
    [
      "unbekanntes verschachteltes Feld",
      {
        ...validBody,
        items: [{ ...validBody.items[0], totalAmount: 500 }],
      },
    ],
    ["numerischer String", { ...validBody, amount: "500" }],
    [
      "gebrochene Menge",
      { ...validBody, items: [{ ...validBody.items[0], quantity: 1.5 }] },
    ],
    ["Array statt Objekt", [validBody]],
    ["Primitivwert statt Objekt", "token SQL Prisma pinHash"],
  ])("verwirft %s mit sicherem 400-Format", async (_label, payload) => {
    const response = await post(payload);
    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body).toMatchObject({
      statusCode: 400,
      error: "Bad Request",
      code: "VALIDATION_ERROR",
      message: "Die Eingabe ist ungültig.",
    });
    expect(Array.isArray(body.errors)).toBe(true);
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("geheim");
    expect(serialized).not.toContain("token SQL Prisma pinHash");
    expect(serialized).not.toContain("stack");
    expect(serialized).not.toContain("target");
  });

  it("normalisiert fachliche 400-Antworten ohne interne Details", async () => {
    const response = await post({}, "/validation-test/business-error");
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      statusCode: 400,
      error: "Bad Request",
      code: "BAD_REQUEST",
      message: "Fachlich ungültig.",
      errors: [],
    });
  });
});
