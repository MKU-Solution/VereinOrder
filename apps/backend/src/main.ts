import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { createApiValidationPipe } from "./common/validation/api-validation";
import { BadRequestFilter } from "./common/validation/bad-request.filter";
import { ensureBackendSecrets } from "./secrets/ensure-secrets";

// #175: Die Sicherheitsgeheimnisse muessen stehen, BEVOR AppModule geladen
// wird. `auth.module.ts` und `maintenance.module.ts` lesen JWT_SECRET in
// ihren Decorator-Argumenten, also bereits waehrend des Ladens des Moduls -
// gemessen mit einem Proxy auf `process.env`: zwei Lesezugriffe fallen an,
// bevor die erste Zeile von `bootstrap()` laeuft. Im Festbetrieb hat
// `apps/backend/docker-entrypoint.sh` das bereits erledigt und die Werte in
// die Prozessumgebung gestellt; dieser Aufruf ist dann wirkungslos. Er
// deckt jeden Start ausserhalb von Docker ab (Entwicklung, `start:prod`,
// Browsertests).
ensureBackendSecrets();

// AppModule wird bewusst per `require()` geladen und NICHT per `import`:
// Ein statischer Import wuerde ans Dateianfang hochgezogen und liefe vor
// `ensureBackendSecrets()` - eine spaetere Umsortierung der Importe durch
// einen Menschen oder eine Lint-Regel koennte die Zusage sonst still
// brechen. Diese Zeile ist eine Anweisung und bleibt, wo sie steht.
// `ensure-secrets.spec.ts` bewacht genau das.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { AppModule } = require("./app.module") as typeof import("./app.module");

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
