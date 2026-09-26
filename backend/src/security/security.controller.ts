import { Body, Controller, Get, Headers, Post } from '@nestjs/common';
import { Throttle } from '../common/decorators/throttle.decorator';
import { Public } from '../common/decorators/public.decorator';
import { SecurityService } from './security.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { MfaEnableChallengeDto } from './dto/mfa-enable-challenge.dto';
import { MfaVerifyDto } from './dto/mfa-verify.dto';
import { MfaLoginChallengeDto } from './dto/mfa-login-challenge.dto';
import { MfaDisableDto } from './dto/mfa-disable.dto';
import { AuthUserService } from '../common/auth-user.service';

const CREDENTIAL_THROTTLE = { ttl: 60_000, limit: 5 } as const;
const MFA_ENABLE_THROTTLE = { ttl: 60_000, limit: 3 } as const;
const MFA_VERIFY_THROTTLE = { ttl: 60_000, limit: 10 } as const;
const MFA_LOGIN_THROTTLE = { ttl: 60_000, limit: 5 } as const;
const MFA_DISABLE_THROTTLE = { ttl: 60_000, limit: 5 } as const;

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

  @Post('mfa/enable-challenge')
  @Throttle(MFA_ENABLE_THROTTLE)
  async startMfaEnrollment(
    @Headers('authorization') authHeader: string | undefined,
    @Body() body: MfaEnableChallengeDto,
  ) {
    const context =
      await this.authUserService.getAuthContextFromAuthHeader(authHeader);
    const data = await this.securityService.startMfaEnrollment(
      context.userId,
      context.sessionId,
      body,
    );
    return { success: true, data };
  }

  @Public()
  @Post('mfa/login-challenge')
  @Throttle(MFA_LOGIN_THROTTLE)
  async startMfaLoginChallenge(@Body() body: MfaLoginChallengeDto) {
    const data = await this.securityService.startMfaLoginChallenge(body.email);
    return { success: true, data };
  }

  @Post('mfa/verify')
  @Throttle(MFA_VERIFY_THROTTLE)
  async verifyMfaChallenge(
    @Headers('authorization') authHeader: string | undefined,
    @Body() body: MfaVerifyDto,
  ) {
    const context =
      await this.authUserService.getAuthContextFromAuthHeader(authHeader);
    const data = await this.securityService.verifyMfaChallenge(
      context.userId,
      context.sessionId,
      body,
    );
    return { success: true, data };
  }

  @Post('mfa/disable')
  @Throttle(MFA_DISABLE_THROTTLE)
  async disableMfa(
    @Headers('authorization') authHeader: string | undefined,
    @Body() body: MfaDisableDto,
  ) {
    const context =
      await this.authUserService.getAuthContextFromAuthHeader(authHeader);
    const data = await this.securityService.disableMfa(
      context.userId,
      context.sessionId,
      body,
    );
    return { success: true, data };
  }
}
