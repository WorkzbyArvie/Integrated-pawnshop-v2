import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Headers,
  Param,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { SubscriptionService } from './subscription.service';
import {
  CreateSubscriptionDto,
  UpdateSubscriptionDto,
  CancelSubscriptionDto,
} from './dto/subscription.dto';
import { SubscriptionTier } from '@prisma/client';
import { AuthUserService } from '../common/auth-user.service';
import { Public } from '../common/decorators/public.decorator';

@Controller('subscriptions')
export class SubscriptionController {
  private readonly logger = new Logger(SubscriptionController.name);

  constructor(
    private readonly subscriptionService: SubscriptionService,
    private readonly authUserService: AuthUserService,
  ) {}

  /**
   * Get available plans
   * GET /subscriptions/plans
   */
  @Public()
  @Get('plans')
  getPlans() {
    return this.subscriptionService.getPlans();
  }

  /**
   * Get current subscription
   * GET /subscriptions/current
   */
  @Get('current')
  async getCurrent(
    @Headers('authorization') authHeader: string | undefined,
    @Headers('pawnshop-id') pawnshopId: string | undefined,
  ) {
    const userId =
      await this.authUserService.getUserIdFromAuthHeader(authHeader);
    return this.subscriptionService.getCurrent(pawnshopId, userId);
  }

  /**
   * Get current tenant access status.
   * GET /subscriptions/access-status
   */
  @Get('access-status')
  async getAccessStatus(
    @Headers('authorization') authHeader: string | undefined,
    @Headers('pawnshop-id') pawnshopId: string | undefined,
  ) {
    const userId =
      await this.authUserService.getUserIdFromAuthHeader(authHeader);
    return this.subscriptionService.getAccessStatus(pawnshopId, userId);
  }

  /**
   * Create subscription
   * POST /subscriptions
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Headers('authorization') authHeader: string | undefined,
    @Headers('pawnshop-id') pawnshopId: string,
    @Body() dto: CreateSubscriptionDto,
  ) {
    const userId =
      await this.authUserService.getUserIdFromAuthHeader(authHeader);
    return this.subscriptionService.create(pawnshopId, dto, userId);
  }

  /**
   * Update subscription
   * PATCH /subscriptions
   */
  @Patch()
  async update(
    @Headers('authorization') authHeader: string | undefined,
    @Headers('pawnshop-id') pawnshopId: string,
    @Body() dto: UpdateSubscriptionDto,
  ) {
    const userId =
      await this.authUserService.getUserIdFromAuthHeader(authHeader);
    return this.subscriptionService.update(pawnshopId, dto, userId);
  }

  /**
   * Change subscription tier
   * POST /subscriptions/change-tier
   */
  @Post('change-tier')
  async changeTier(
    @Headers('authorization') authHeader: string | undefined,
    @Headers('pawnshop-id') pawnshopId: string,
    @Body() body: { tier: SubscriptionTier },
  ) {
    const userId =
      await this.authUserService.getUserIdFromAuthHeader(authHeader);
    return this.subscriptionService.changeTier(pawnshopId, body.tier, userId);
  }

  /**
   * Generate or retry a checkout link for existing subscription
   * POST /subscriptions/generate-checkout
   */
  @Post('generate-checkout')
  async generateCheckout(
    @Headers('authorization') authHeader: string | undefined,
    @Headers('pawnshop-id') pawnshopId: string,
    @Body()
    body: {
      billingEmail?: string;
      preferredMethod?: 'AUTO' | 'CARD' | 'E_WALLET';
    },
  ) {
    const userId =
      await this.authUserService.getUserIdFromAuthHeader(authHeader);
    return this.subscriptionService.generateCheckoutLink(
      pawnshopId,
      body?.billingEmail,
      body?.preferredMethod,
      userId,
    );
  }

  /**
   * Poll status for the latest generated payment link
   * GET /subscriptions/payment-link-status
   */
  @Get('payment-link-status')
  async getPaymentLinkStatus(
    @Headers('authorization') authHeader: string | undefined,
    @Headers('pawnshop-id') pawnshopId: string,
  ) {
    const userId =
      await this.authUserService.getUserIdFromAuthHeader(authHeader);
    return this.subscriptionService.getPaymentLinkStatus(pawnshopId, userId);
  }

  /**
   * Cancel subscription
   * POST /subscriptions/cancel
   */
  @Post('cancel')
  async cancel(
    @Headers('authorization') authHeader: string | undefined,
    @Headers('pawnshop-id') pawnshopId: string,
    @Body() dto: CancelSubscriptionDto,
  ) {
    const userId =
      await this.authUserService.getUserIdFromAuthHeader(authHeader);
    return this.subscriptionService.cancel(pawnshopId, dto.reason, userId);
  }

  /**
   * Check feature access
   * GET /subscriptions/feature/:feature
   */
  @Get('feature/:feature')
  async hasFeature(
    @Headers('authorization') authHeader: string | undefined,
    @Headers('pawnshop-id') pawnshopId: string,
    @Param('feature') feature: string,
  ) {
    const userId =
      await this.authUserService.getUserIdFromAuthHeader(authHeader);
    const hasAccess = await this.subscriptionService.hasFeature(
      pawnshopId,
      feature,
      userId,
    );
    return { feature, hasAccess };
  }

  /**
   * Check usage limits
   * GET /subscriptions/limits
   */
  @Get('limits')
  async checkLimits(
    @Headers('authorization') authHeader: string | undefined,
    @Headers('pawnshop-id') pawnshopId: string,
  ) {
    const userId =
      await this.authUserService.getUserIdFromAuthHeader(authHeader);
    return this.subscriptionService.checkLimits(pawnshopId, userId);
  }

  /**
   * Payment webhook receiver
   * POST /subscriptions/webhook
   *
   * Payment provider sends events here when payment status changes.
   * No auth header required — verified via webhook signature when configured.
   */
  @Public()
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async handleWebhook(@Body() body: any) {
    const isXendit =
      typeof body?.event === 'string' &&
      (body.event.startsWith('invoice.') || body.event.startsWith('payment.'));

    if (isXendit) {
      this.logger.log(`Xendit webhook received: ${body.event}`);
      await this.subscriptionService.handleXenditWebhook(body);
      return { received: true };
    }

    const event = body?.data?.attributes?.type
      ? { type: body.data.attributes.type, data: body.data.attributes.data }
      : body;

    this.logger.log(`Webhook received: ${event.type || 'unknown'}`);
    await this.subscriptionService.handlePaymongoWebhook(event);
    return { received: true };
  }
}
