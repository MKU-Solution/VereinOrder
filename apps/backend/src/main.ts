import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { AppModule } from "./app.module";
import { createApiValidationPipe } from "./common/validation/api-validation";
import { BadRequestFilter } from "./common/validation/bad-request.filter";

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
  );
  app.useGlobalPipes(createApiValidationPipe());
  app.useGlobalFilters(new BadRequestFilter());
  app.enableCors();

  const port = process.env.PORT || 3000;
  await app.listen(port, "0.0.0.0");
  console.log(`Backend is running on: http://localhost:${port}`);
}
bootstrap();
