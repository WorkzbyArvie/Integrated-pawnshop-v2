import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ReviewsService } from './reviews.service';
import { AuthUserService } from '../common/auth-user.service';
import { Public } from '../common/decorators/public.decorator';
import { RequiresPermission } from '../common/decorators/requires-permission.decorator';
import { PERMISSIONS } from '../common/permissions/permissions.const';
import { CreateReviewDto, ModerateReviewDto } from './dto/create-review.dto';

@Controller('reviews')
export class ReviewsController {
  constructor(
    private readonly reviewsService: ReviewsService,
    private readonly authUser: AuthUserService,
  ) {}

  @Get()
  @Public()
  listApproved() {
    return this.reviewsService.listApproved();
  }

  @Post()
  @RequiresPermission(PERMISSIONS['review.create'])
  async create(
    @Headers('authorization') authHeader: string | undefined,
    @Body() dto: CreateReviewDto,
  ) {
    const userId = await this.authUser.getUserIdFromAuthHeader(authHeader);
    return this.reviewsService.create(userId, dto);
  }

  @Get('mine')
  @RequiresPermission(PERMISSIONS['review.view'])
  async myReview(@Headers('authorization') authHeader: string | undefined) {
    const userId = await this.authUser.getUserIdFromAuthHeader(authHeader);
    return this.reviewsService.mine(userId);
  }

  @Get('admin')
  @RequiresPermission(PERMISSIONS['review.moderate'])
  async listAll(@Headers('authorization') authHeader: string | undefined) {
    const userId = await this.authUser.getUserIdFromAuthHeader(authHeader);
    return this.reviewsService.listAll(userId);
  }

  @Patch(':id/status')
  @RequiresPermission(PERMISSIONS['review.moderate'])
  async moderate(
    @Headers('authorization') authHeader: string | undefined,
    @Param('id') id: string,
    @Body() dto: ModerateReviewDto,
  ) {
    const userId = await this.authUser.getUserIdFromAuthHeader(authHeader);
    return this.reviewsService.moderate(userId, id, dto);
  }
}