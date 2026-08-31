import { Module } from "@nestjs/common";
import { AuthService } from "./auth.service";
import { AuthController } from "./auth.controller";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { JwtStrategy } from "./jwt.strategy";
import { requireJwtSecret } from "../secrets/ensure-secrets";

@Module({
  imports: [
    PassportModule,
    JwtModule.register({
      // #175: kein Rueckfall auf einen festen Wert mehr. Dieser Ausdruck
      // wird zur MODUL-Ladezeit ausgewertet - der Schluessel muss also
      // bereits stehen, bevor main.ts AppModule laedt.
      secret: requireJwtSecret(),
      signOptions: { expiresIn: "12h" },
    }),
  ],
  providers: [AuthService, JwtStrategy],
  controllers: [AuthController],
})
export class AuthModule {}
