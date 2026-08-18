import { Controller, Post, Body, UnauthorizedException, HttpCode, HttpStatus } from '@nestjs/common';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @HttpCode(HttpStatus.OK)
  @Post('login')
  async login(@Body() body: any) {
    const { username, pin } = body;
    const user = await this.authService.validateUser(username, pin);
    if (!user) {
      throw new UnauthorizedException('Ungültiger Benutzername oder PIN');
    }
    return this.authService.login(user);
  }
}
