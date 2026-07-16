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
