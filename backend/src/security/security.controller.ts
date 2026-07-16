import { Body, Controller, Get, Headers, Post } from '@nestjs/common';
import { SecurityService } from './security.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { AuthUserService } from '../common/auth-user.service';

@Controller('security')
export class SecurityController {
  constructor(
    private readonly securityService: SecurityService,
    private readonly authUserService: AuthUserService,
  ) {}

  @Post('change-password')
  async changeMyPassword(
    @Headers('authorization') authHeader: string | undefined,
    @Body() body: ChangePasswordDto,
  ) {
    const userId =
      await this.authUserService.getUserIdFromAuthHeader(authHeader);
    return this.securityService.changeMyPassword(userId, body);
  }

  @Get('activity-log')
  async getMySecurityLogs(
    @Headers('authorization') authHeader: string | undefined,
  ) {
    const userId =
      await this.authUserService.getUserIdFromAuthHeader(authHeader);
    return this.securityService.getMySecurityLogs(userId);
  }
}
