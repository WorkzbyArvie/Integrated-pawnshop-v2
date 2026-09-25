import { Body, Controller, Get, Headers, Post } from '@nestjs/common';
import { Throttle } from '../common/decorators/throttle.decorator';
import { SecurityService } from './security.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { AuthUserService } from '../common/auth-user.service';

const CREDENTIAL_THROTTLE = { ttl: 60_000, limit: 5 } as const;

@Controller('security')
export class SecurityController {
  constructor(
    private readonly securityService: SecurityService,
    private readonly authUserService: AuthUserService,
  ) {}

  @Get('credential-status')
  async getMyCredentialStatus(
    @Headers('authorization') authHeader: string | undefined,
  ) {
    const profileId =
      await this.authUserService.getUserIdFromAuthHeader(authHeader);
    const data = await this.securityService.getCredentialStatus(profileId);
    return { success: true, data };
  }

  @Post('change-password')
  @Throttle(CREDENTIAL_THROTTLE)
  async changeMyPassword(
    @Headers('authorization') authHeader: string | undefined,
    @Body() body: ChangePasswordDto,
  ) {
    const profileId =
      await this.authUserService.getUserIdFromAuthHeader(authHeader);
    const data = await this.securityService.changeMyPassword(profileId, body);
    return { success: true, data };
  }

  @Post('recovery/complete')
  @Throttle(CREDENTIAL_THROTTLE)
  async completeRecovery(
    @Headers('authorization') authHeader: string | undefined,
    @Body() body: ResetPasswordDto,
  ) {
    const profileId =
      await this.authUserService.getUserIdFromAuthHeader(authHeader);
    const data = await this.securityService.completeRecovery(profileId, body);
    return { success: true, data };
  }

  @Get('activity')
  async getMyActivity(
    @Headers('authorization') authHeader: string | undefined,
  ) {
    const profileId =
      await this.authUserService.getUserIdFromAuthHeader(authHeader);
    const data = await this.securityService.getMyActivity(profileId);
    return { success: true, data };
  }

  @Get('activity-log')
  async getMyActivityLog(
    @Headers('authorization') authHeader: string | undefined,
  ) {
    const profileId =
      await this.authUserService.getUserIdFromAuthHeader(authHeader);
    return this.securityService.getMyActivityLog(profileId);
  }
}
