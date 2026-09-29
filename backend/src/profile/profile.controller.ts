import { Body, Controller, Get, Headers, Patch, Query } from '@nestjs/common';
import { ProfileService } from './profile.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { AuthUserService } from '../common/auth-user.service';

@Controller('profile')
export class ProfileController {
  constructor(
    private readonly profileService: ProfileService,
    private readonly authUserService: AuthUserService,
  ) {}

  @Get('me')
  async getMyProfile(@Headers('authorization') authHeader: string | undefined) {
    const userId =
      await this.authUserService.getUserIdFromAuthHeader(authHeader);
    return this.profileService.getMyProfile(userId);
  }

  /**
   * The session bootstrap payload: the caller's own role, staff specialisation,
   * shop and branch.
   *
   * The browser used to assemble this by reading `profiles` directly, first by
   * id and then falling back to a lookup by email. That fallback is an
   * enumeration oracle and cannot be made safe by a Row Level Security policy,
   * because the policy has to decide who may ask before the caller has proved
   * anything. Resolving it here also gives the browser one field list instead of
   * two hand-written selects that can drift apart.
   */
  @Get('session-context')
  async getSessionContext(@Headers('authorization') authHeader: string | undefined) {
    const userId =
      await this.authUserService.getUserIdFromAuthHeader(authHeader);
    return this.profileService.getSessionContext(userId);
  }

  @Patch('me')
  async updateMyProfile(
    @Headers('authorization') authHeader: string | undefined,
    @Body() body: UpdateProfileDto,
  ) {
    const userId =
      await this.authUserService.getUserIdFromAuthHeader(authHeader);
    return this.profileService.updateMyProfile(userId, body);
  }

  @Get('verify-email')
  async verifyBidderEmail(@Query() query: VerifyEmailDto) {
    return this.profileService.verifyBidderEmail(query.email);
  }
}
