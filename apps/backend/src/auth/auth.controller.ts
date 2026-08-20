import {
  Controller,
  ForbiddenException,
  Post,
  Body,
  UnauthorizedException,
  HttpCode,
  HttpStatus,
  Request,
  UseGuards,
} from "@nestjs/common";
import { AuthService } from "./auth.service";
import { JwtAuthGuard } from "./jwt-auth.guard";

@Controller("auth")
export class AuthController {
  constructor(private authService: AuthService) {}

  @HttpCode(HttpStatus.OK)
  @Post("login")
  async login(@Body() body: any) {
    const { username, pin } = body;
    const user = await this.authService.validateUser(username, pin);
    if (!user) {
      throw new UnauthorizedException("Ungültiger Benutzername oder PIN");
    }
    return this.authService.login(user);
  }

  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @Post("switch")
  async switchUser(@Request() req: any, @Body() body: any) {
    const user = await this.authService.validateUser(body?.username, body?.pin);
    if (!user) {
      throw new ForbiddenException("Ungültiger Benutzername oder PIN");
    }
    const previousUserId = req.user?.userId;
    const action = previousUserId === user.id ? "SCREEN_UNLOCK" : "USER_SWITCH";
    return this.authService.login(user, action, previousUserId);
  }
}
