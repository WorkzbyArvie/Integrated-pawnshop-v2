import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma.service';
import {
  CreateSubscriptionDto,
  UpdateSubscriptionDto,
} from './dto/subscription.dto';
import {
  SubscriptionTier,
  SubscriptionStatus,
  BillingInterval,
  LedgerEntryType,
  LedgerCategory,
} from '@prisma/client';
import { FinanceService } from '../finance/finance.service';
import { PaymongoService } from './paymongo.service';

/**
 * Subscription tier configuration
 */
const TIER_CONFIG: Record<
  SubscriptionTier,
  {
    name: string;
    description: string;
    tagline: string;
    monthlyPrice: number;
    maxBranches: number | null;
    maxStaff: number | null;
    maxTransactions: number | null;
    dailyTransactionLimit: number | null;
    features: Record<string, boolean>;
  }
> = {
  FREE: {
    name: 'Free',
    description: 'No active subscription',
    tagline: 'Subscribe or start a trial to unlock features',
    monthlyPrice: 0,
    maxBranches: 0,
    maxStaff: 0,
    maxTransactions: 0,
    dailyTransactionLimit: 0,
    features: {
      pawn_ticketing: false,
      loan_management: false,
      basic_analytics: false,
      queue_management: false,
      auction_access: false,
      api_access: false,
      priority_support: false,
      custom_branding: false,
    },
  },
  TRIAL: {
    name: 'Trial',
    description: '15-day evaluation with core pawn operations',
    tagline: 'No credit card required',
    monthlyPrice: 0,
    maxBranches: 1,
    maxStaff: 3,
    maxTransactions: 50,
    dailyTransactionLimit: 50,
    features: {
      pawn_ticketing: true,
      loan_management: true,
      basic_analytics: true,
      queue_management: true,
      auction_access: false,
      api_access: false,
      priority_support: false,
      custom_branding: false,
    },
  },
  BASIC: {
    name: 'Basic',
    description: 'For single-branch pawnshops ready to go digital',
    tagline: 'Essential tools for daily operations',
    monthlyPrice: 2999,
    maxBranches: 3,
    maxStaff: 10,
    maxTransactions: null,
    dailyTransactionLimit: null,
    features: {
      pawn_ticketing: true,
      loan_management: true,
      basic_analytics: true,
      queue_management: true,
      auction_access: false,
      api_access: false,
      priority_support: false,
      custom_branding: false,
    },
  },
  PROFESSIONAL: {
    name: 'Professional',
    description: 'For growing pawnshop networks with multiple branches',
    tagline: 'Scale with confidence and data',
    monthlyPrice: 7999,
    maxBranches: 10,
    maxStaff: 50,
    maxTransactions: null,
    dailyTransactionLimit: null,
    features: {
      pawn_ticketing: true,
      loan_management: true,
      basic_analytics: true,
      advanced_analytics: true,
      queue_management: true,
      auction_access: true,
      api_access: true,
      priority_support: true,
      custom_branding: false,
    },
  },
  ENTERPRISE: {
    name: 'Enterprise',
    description: 'For large-scale operations requiring full control',
    tagline: 'Unlimited power, dedicated support',
    monthlyPrice: 19999,
    maxBranches: null,
    maxStaff: null,
    maxTransactions: null,
    dailyTransactionLimit: null,
    features: {
      pawn_ticketing: true,
      loan_management: true,
      basic_analytics: true,
      advanced_analytics: true,
      queue_management: true,
      auction_access: true,
      api_access: true,
      priority_support: true,
      custom_branding: true,
    },
  },
};

const INTERVAL_MULTIPLIER: Record<BillingInterval, number> = {
  MONTHLY: 1,
  QUARTERLY: 2.85, // ~5% discount
  ANNUALLY: 10.8, // ~10% discount
};

const INTERVAL_MONTHS: Record<BillingInterval, number> = {
  MONTHLY: 1,
  QUARTERLY: 3,
  ANNUALLY: 12,
};

@Injectable()
export class SubscriptionService {
  private readonly logger = new Logger(SubscriptionService.name);

  constructor(
    private prisma: PrismaService,
    private financeService: FinanceService,
    private paymongoService: PaymongoService,
  ) {}

  private extractPaymongoLinkId(checkoutUrl?: string | null): string | null {
    if (!checkoutUrl) return null;
    const match =
      checkoutUrl.match(/\/links\/([^/?#]+)/i) ||
      checkoutUrl.match(/\/invoices\/([^/?#]+)/i) ||
      checkoutUrl.match(/\/web\/([^/?#]+)/i);
    return match?.[1] ?? null;
  }

  private async logSubscriptionAudit(params: {
    pawnshopId: string;
    actorUserId?: string;
    action: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    if (!params.actorUserId) return;

    try {
      await this.prisma.$executeRaw`
        INSERT INTO public.tenant_audit_logs
        (id, pawnshop_id, actor_user_id, action, metadata)
        VALUES (
          gen_random_uuid(),
          ${params.pawnshopId}::uuid,
          ${params.actorUserId}::uuid,
          ${params.action},
          ${JSON.stringify(params.metadata || {})}::jsonb
        )
      `;
    } catch (error) {
      this.logger.warn(
        `Subscription audit logging skipped: ${(error as Error).message}`,
      );
    }
  }

  private async assertSubscriptionAccess(
    pawnshopId: string | undefined,
    actorUserId?: string,
  ): Promise<string> {
    if (!actorUserId) {
      if (!pawnshopId) {
        throw new ForbiddenException('Pawnshop context is required');
      }
      return pawnshopId;
    }

    const actor = await this.prisma.profile.findUnique({
      where: { id: actorUserId },
      select: {
        id: true,
        role: true,
        pawnshopId: true,
      },
    });

    if (!actor) {
      throw new ForbiddenException('Authenticated profile not found');
    }

    const role = (actor.role || '').toUpperCase();

    // Super Admin is intentionally blocked from tenant subscription financial data.
    if (role === 'SUPER_ADMIN') {
      throw new ForbiddenException(
        'Super Admin cannot access tenant subscription financial data directly.',
      );
    }

    if (role !== 'OWNER') {
      throw new ForbiddenException(
        'Only OWNER can access subscription and billing actions for a pawnshop.',
      );
    }

    const effectivePawnshopId = pawnshopId || actor.pawnshopId || undefined;

    if (!effectivePawnshopId) {
      throw new ForbiddenException(
        'Pawnshop context is required for subscription access.',
      );
    }

    if (!actor.pawnshopId || actor.pawnshopId !== effectivePawnshopId) {
      throw new ForbiddenException(
        'You can only access subscription data for your own pawnshop.',
      );
    }

    return effectivePawnshopId;
  }

  private async hasUsedTrialBefore(pawnshopId: string): Promise<boolean> {
    const priorTrial = await this.prisma.subscription.findFirst({
      where: {
        pawnshopId,
        trialEndDate: { not: null },
      },
      select: { id: true },
    });

    return Boolean(priorTrial);
  }

  private computePaymentAction(subscription: any): {
    canCompletePayment: boolean;
    completePaymentReason: string | null;
  } {
    const payments = Array.isArray(subscription?.payments)
      ? subscription.payments
      : [];
    const hasPendingPayment = payments.some(
      (p: any) => String(p.status).toLowerCase() === 'pending',
    );

    if (subscription.status === SubscriptionStatus.TRIAL) {
      const hasCompleted = payments.some(
        (p: any) => String(p.status).toLowerCase() === 'completed',
      );
      const hasPendingPayment = payments.some(
        (p: any) => String(p.status).toLowerCase() === 'pending',
      );
      const hasCheckout = Boolean((subscription as any).paymongoCheckoutUrl);

      return {
        canCompletePayment: hasPendingPayment || hasCheckout,
        completePaymentReason: hasCompleted
          ? 'Trial has already been converted to a paid subscription.'
          : null,
      };
    }

    if (hasPendingPayment) {
      return {
        canCompletePayment: true,
        completePaymentReason: null,
      };
    }

    if (
      subscription.status !== SubscriptionStatus.TRIAL &&
      (subscription as any).tier === SubscriptionTier.TRIAL &&
      Boolean((subscription as any).paymongoCheckoutUrl)
    ) {
      return {
        canCompletePayment: true,
        completePaymentReason: 'A confirmed plan upgrade is pending activation.',
      };
    }

    if (subscription.status === SubscriptionStatus.PAST_DUE) {
      return {
        canCompletePayment: true,
        completePaymentReason: null,
      };
    }

    return {
      canCompletePayment: false,
      completePaymentReason: 'No pending payment at this time.',
    };
  }

  private hasUnlimitedTransactions(subscription: {
    status?: SubscriptionStatus;
    tier?: SubscriptionTier;
  }): boolean {
    return (
      subscription.status === SubscriptionStatus.ACTIVE &&
      subscription.tier !== SubscriptionTier.FREE
    );
  }

  /**
   * Create a new subscription (starts with trial)
   */
  async create(
    pawnshopId: string,
    dto: CreateSubscriptionDto,
    actorUserId?: string,
  ): Promise<any> {
    try {
      await this.assertSubscriptionAccess(pawnshopId, actorUserId);

      // Check if pawnshop already has an active subscription
      const existing = await this.prisma.subscription.findFirst({
        where: {
          pawnshopId,
          status: {
            in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIAL],
          },
        },
      });

      if (existing) {
        throw new BadRequestException(
          'Pawnshop already has an active subscription',
        );
      }

      if (dto.tier === SubscriptionTier.TRIAL) {
        throw new BadRequestException(
          'The trial plan cannot be purchased. It is granted automatically when you start.',
        );
      }

      const tierConfig = TIER_CONFIG[dto.tier];
      const intervalMultiplier = INTERVAL_MULTIPLIER[dto.billingInterval];
      const intervalMonths = INTERVAL_MONTHS[dto.billingInterval];
      const price = tierConfig.monthlyPrice * intervalMultiplier;

      const now = new Date();
      const alreadyUsedTrial = await this.hasUsedTrialBefore(pawnshopId);

      if (!alreadyUsedTrial && dto.trialAutoChargeConsent !== true) {
        throw new BadRequestException(
          'Please confirm automatic billing after trial before starting your subscription. You can cancel anytime before trial ends to avoid charges.',
        );
      }

      const trialEndDate = alreadyUsedTrial ? null : new Date(now);
      if (trialEndDate) {
        trialEndDate.setDate(trialEndDate.getDate() + 15); // 15-day trial
      }

      const endDate = new Date(now);
      endDate.setMonth(endDate.getMonth() + intervalMonths);

      // ── PayMongo integration ──
      // Always use payment links for checkout to keep authorization flow
      // consistent with status polling and avoid hosted subscription loop issues.
      let paymongoSubscriptionId: string | null = null;
      let paymongoCheckoutUrl: string | null = null;
      let paymongoPlanId: string | null = null;
      let paymongoError: string | null = null;

      const subscription = await (this.prisma.subscription as any).create({
        data: {
          pawnshopId,
          tier: dto.tier,
          status: alreadyUsedTrial
            ? SubscriptionStatus.PAST_DUE
            : SubscriptionStatus.TRIAL,
          billingInterval: dto.billingInterval,
          price,
          startDate: now,
          endDate,
          trialEndDate,
          maxBranches: tierConfig.maxBranches,
          maxStaff: tierConfig.maxStaff,
          maxTransactions: tierConfig.maxTransactions,
          features: tierConfig.features,
          nextBillingDate: trialEndDate || endDate,
          billingEmail: dto.billingEmail,
          paymentMethodId: dto.paymentMethodId,
          paymongoSubscriptionId,
          paymongoCheckoutUrl,
          paymongoPlanId,
        },
      });

      if (this.paymongoService.isEnabled) {
        try {
          const amountCentavos = Math.round(price * 100);
          const preferredMethod = dto.preferredMethod || 'AUTO';
          const preferredMethodMap: Record<string, string[] | undefined> = {
            AUTO: undefined,
            CARD: ['card'],
            E_WALLET: ['gcash', 'paymaya', 'grab_pay'],
          };

          const requestedMethodTypes = preferredMethodMap[preferredMethod];
          let link: { linkId: string; checkoutUrl: string };

          try {
            link = await this.paymongoService.createPaymentLink({
              amountCentavos,
              description: `${dto.tier} plan (${dto.billingInterval})`,
              remarks: 'PawnGold subscription checkout',
              paymentMethodTypes: requestedMethodTypes,
              metadata: {
                pawnshopId,
                subscriptionId: subscription.id,
                tier: dto.tier,
                billingInterval: dto.billingInterval,
                preferredMethod,
              },
            });
          } catch (methodErr: any) {
            const methodMsg = String(methodErr?.message || '');
            const methodUnavailable =
              requestedMethodTypes &&
              methodMsg.toLowerCase().includes('requested payment method is unavailable');

            if (!methodUnavailable) {
              throw methodErr;
            }

            this.logger.warn(
              `Preferred method ${preferredMethod} unavailable. Falling back to AUTO checkout methods.`,
            );

            link = await this.paymongoService.createPaymentLink({
              amountCentavos,
              description: `${dto.tier} plan (${dto.billingInterval})`,
              remarks: 'PawnGold subscription checkout',
              paymentMethodTypes: undefined,
              metadata: {
                pawnshopId,
                subscriptionId: subscription.id,
                tier: dto.tier,
                billingInterval: dto.billingInterval,
                preferredMethod: 'AUTO',
                preferredMethodFallbackFrom: preferredMethod,
              },
            });
          }

          paymongoCheckoutUrl = link.checkoutUrl;

          await (this.prisma.subscription as any).update({
            where: { id: subscription.id },
            data: {
              paymongoCheckoutUrl,
            },
          });
        } catch (pmErr: any) {
          paymongoError =
            pmErr?.message || 'Checkout link creation failed';
          this.logger.warn(
            `Checkout link creation failed — continuing without: ${paymongoError}`,
          );
        }
      }

      await this.syncTenantAuctionModule(pawnshopId, dto.tier);

      this.logger.log(
        `Subscription created for pawnshop ${pawnshopId}: ${dto.tier} (${dto.billingInterval})` +
          (paymongoSubscriptionId
            ? ` [PayMongo: ${paymongoSubscriptionId}]`
            : ''),
      );

      const result = {
        ...subscription,
        checkoutUrl: paymongoCheckoutUrl,
        paymentError: paymongoError,
        paymongoError,
        trialEligible: !alreadyUsedTrial,
        autoChargePolicy: {
          autoChargeAfterTrial: !alreadyUsedTrial,
          canCancelBeforeTrialEndToAvoidCharge: !alreadyUsedTrial,
          trialEndDate,
        },
      };

      await this.logSubscriptionAudit({
        pawnshopId,
        actorUserId,
        action: 'SUBSCRIPTION_CREATED',
        metadata: {
          tier: dto.tier,
          billingInterval: dto.billingInterval,
          trialEligible: !alreadyUsedTrial,
          status: result.status,
        },
      });

      return result;
    } catch (error: any) {
      this.logger.error(
        `Failed to create subscription: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Get current subscription for a pawnshop
   */
  async getCurrent(pawnshopId: string | undefined, actorUserId?: string): Promise<any> {
    const effectivePawnshopId = await this.assertSubscriptionAccess(
      pawnshopId,
      actorUserId,
    );

    const subscription = await this.prisma.subscription.findFirst({
      where: {
        pawnshopId: effectivePawnshopId,
        status: {
          in: [
            SubscriptionStatus.ACTIVE,
            SubscriptionStatus.TRIAL,
            SubscriptionStatus.PAST_DUE,
          ],
        },
      },
      include: {
        payments: {
          orderBy: { createdAt: 'desc' },
          take: 5,
        },
      },
    });

    if (!subscription) {
      const historicalSubscription = await this.prisma.subscription.findFirst({
        where: { pawnshopId: effectivePawnshopId },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      });

      if (historicalSubscription) {
        return {
          tier: SubscriptionTier.FREE,
          status: SubscriptionStatus.CANCELLED,
          features: TIER_CONFIG.FREE.features,
          maxBranches: TIER_CONFIG.FREE.maxBranches,
          maxStaff: TIER_CONFIG.FREE.maxStaff,
          maxTransactions: TIER_CONFIG.FREE.maxTransactions,
          canChangeTier: true,
          canCompletePayment: false,
          completePaymentReason: 'No active subscription',
        };
      }

      const now = new Date();
      const trialEndDate = new Date(now);
      trialEndDate.setDate(trialEndDate.getDate() + 15);
      const endDate = new Date(now);
      endDate.setMonth(endDate.getMonth() + 1);

      const autoTrial = await this.prisma.subscription.create({
        data: {
          pawnshopId: effectivePawnshopId,
          tier: SubscriptionTier.TRIAL,
          status: SubscriptionStatus.TRIAL,
          billingInterval: BillingInterval.MONTHLY,
          price: 0,
          startDate: now,
          endDate,
          trialEndDate,
          nextBillingDate: trialEndDate,
          autoRenew: false,
          maxBranches: TIER_CONFIG.TRIAL.maxBranches,
          maxStaff: TIER_CONFIG.TRIAL.maxStaff,
          maxTransactions: TIER_CONFIG.TRIAL.maxTransactions,
          features: {
            ...(TIER_CONFIG.TRIAL.features as Record<string, boolean>),
          },
        },
      });

      await this.logSubscriptionAudit({
        pawnshopId: effectivePawnshopId,
        actorUserId,
        action: 'SUBSCRIPTION_TRIAL_AUTO_PROVISIONED',
        metadata: {
          subscriptionId: autoTrial.id,
          tier: autoTrial.tier,
          status: autoTrial.status,
          reason: 'missing_subscription_row_after_owner_approval',
        },
      });

      const paymentAction = this.computePaymentAction(autoTrial);
      return {
        ...autoTrial,
        checkoutUrl: (autoTrial as any).paymongoCheckoutUrl ?? null,
        currentPrice: autoTrial.price,
        currentPeriodEnd: autoTrial.endDate,
        trialEndsAt: autoTrial.trialEndDate,
        canChangeTier: false,
        canCompletePayment: paymentAction.canCompletePayment,
        completePaymentReason: paymentAction.completePaymentReason,
      };
    }

    const now = new Date();
    const canChangeTier =
      subscription.status === SubscriptionStatus.TRIAL
        ? true
        : now >= new Date(subscription.endDate);
    const paymentAction = this.computePaymentAction(subscription);

    // Map database fields to frontend field names
    return {
      ...subscription,
      checkoutUrl: (subscription as any).paymongoCheckoutUrl ?? null,
      currentPrice: subscription.price,
      currentPeriodEnd: subscription.endDate,
      trialEndsAt: subscription.trialEndDate,
      canChangeTier,
      canCompletePayment: paymentAction.canCompletePayment,
      completePaymentReason: paymentAction.completePaymentReason,
    };
  }

  /**
   * Resolve tenant access status for any authenticated tenant role.
   * Super Admin is never blocked by tenant subscription state.
   */
  async getAccessStatus(
    pawnshopId: string | undefined,
    actorUserId?: string,
  ): Promise<{
    pawnshopId: string | null;
    frozen: boolean;
    canOperate: boolean;
    latestStatus: SubscriptionStatus | null;
    latestTier: SubscriptionTier | null;
  }> {
    if (!actorUserId) {
      throw new ForbiddenException('Authenticated user is required');
    }

    const actor = await this.prisma.profile.findUnique({
      where: { id: actorUserId },
      select: {
        role: true,
        pawnshopId: true,
      },
    });

    if (!actor) {
      throw new ForbiddenException('Authenticated profile not found');
    }

    const role = String(actor.role || '').toUpperCase().replace(/[\s-]+/g, '_');
    if (role === 'SUPER_ADMIN') {
      return {
        pawnshopId: null,
        frozen: false,
        canOperate: true,
        latestStatus: null,
        latestTier: null,
      };
    }

    const effectivePawnshopId = pawnshopId || actor.pawnshopId || null;
    if (!effectivePawnshopId) {
      return {
        pawnshopId: null,
        frozen: true,
        canOperate: false,
        latestStatus: null,
        latestTier: null,
      };
    }

    if (actor.pawnshopId && actor.pawnshopId !== effectivePawnshopId) {
      throw new ForbiddenException(
        'You can only access subscription data for your own pawnshop.',
      );
    }

    const latestSubscription = await this.prisma.subscription.findFirst({
      where: { pawnshopId: effectivePawnshopId },
      orderBy: { createdAt: 'desc' },
      select: {
        status: true,
        tier: true,
        endDate: true,
        autoRenew: true,
      },
    });

    const now = new Date();
    const isActive = latestSubscription?.status === SubscriptionStatus.ACTIVE;
    const isTrial = latestSubscription?.status === SubscriptionStatus.TRIAL;
    const hasEndDatePassed = latestSubscription?.endDate
      ? now > new Date(latestSubscription.endDate) && !latestSubscription.autoRenew
      : false;

    const isOperable = Boolean(
      latestSubscription &&
        (isActive || isTrial) &&
        !hasEndDatePassed,
    );

    return {
      pawnshopId: effectivePawnshopId,
      frozen: !isOperable,
      canOperate: isOperable,
      latestStatus: latestSubscription?.status ?? null,
      latestTier: latestSubscription?.tier ?? null,
    };
  }

  /**
   * Upgrade or downgrade subscription tier.
   * When changing from trial to a paid plan, payment must be completed first.
   * Trial is permanently ended once payment is confirmed.
   */
  async changeTier(
    pawnshopId: string,
    newTier: SubscriptionTier,
    actorUserId?: string,
  ): Promise<any> {
    try {
      await this.assertSubscriptionAccess(pawnshopId, actorUserId);

      const current = await this.prisma.subscription.findFirst({
        where: {
          pawnshopId,
          status: {
            in: [
              SubscriptionStatus.ACTIVE,
              SubscriptionStatus.TRIAL,
              SubscriptionStatus.PAST_DUE,
            ],
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      if (!current) {
        const latest = await this.prisma.subscription.findFirst({
          where: { pawnshopId },
          orderBy: { createdAt: 'desc' },
        });

        if (
          latest &&
          (latest.status === SubscriptionStatus.CANCELLED ||
            latest.status === SubscriptionStatus.EXPIRED)
        ) {
          return latest;
        }

        throw new NotFoundException('No active subscription found');
      }

      if (newTier === SubscriptionTier.TRIAL) {
        throw new BadRequestException(
          'The trial plan cannot be selected. Choose a paid plan or stay on your trial.',
        );
      }

      const now = new Date();
      if (
        current.status !== SubscriptionStatus.TRIAL &&
        now < new Date(current.endDate)
      ) {
        throw new BadRequestException(
          'You can only switch plans after your current subscription period ends',
        );
      }

      const isTrialToPaid = current.status === SubscriptionStatus.TRIAL;
      const tierConfig = TIER_CONFIG[newTier];
      const intervalMultiplier = INTERVAL_MULTIPLIER[current.billingInterval];
      const newPrice = tierConfig.monthlyPrice * intervalMultiplier;

      // ── Trial-to-paid: require payment first ──
      // Generate a payment link but do NOT change the tier yet.
      // Tier activates only after payment is confirmed via webhook or polling.
      if (isTrialToPaid) {
        let checkoutUrl: string | null = null;
        let paymentError: string | null = null;

        if (this.paymongoService.isEnabled) {
          try {
            const amountCentavos = Math.round(newPrice * 100);
            const link = await this.paymongoService.createPaymentLink({
              amountCentavos,
              description: `${newTier} plan (${current.billingInterval}) — upgrade from trial`,
              remarks: 'Trial-to-paid upgrade — PawnGold',
              metadata: {
                pawnshopId,
                subscriptionId: current.id,
                tier: newTier,
                billingInterval: current.billingInterval,
                action: 'TRIAL_UPGRADE',
              },
            });

            checkoutUrl = link.checkoutUrl;

            // Store pending tier change on the subscription so webhook can apply it
            await (this.prisma.subscription as any).update({
              where: { id: current.id },
              data: {
                paymongoCheckoutUrl: checkoutUrl,
                billingEmail: current.billingEmail,
                pendingTier: newTier,
              },
            });
          } catch (pmErr: any) {
            paymentError = pmErr?.message || 'Payment link creation failed';
            this.logger.warn(`Trial upgrade checkout failed: ${paymentError}`);
          }
        } else {
          paymentError = 'Payment provider not configured';
        }

        await this.logSubscriptionAudit({
          pawnshopId,
          actorUserId,
          action: 'SUBSCRIPTION_TRIAL_UPGRADE_INITIATED',
          metadata: {
            subscriptionId: current.id,
            fromTier: current.tier,
            toTier: newTier,
            checkoutUrl,
            paymentError,
          },
        });

        return {
          id: current.id,
          status: current.status,
          tier: current.tier,
          pendingTier: newTier,
          checkoutUrl,
          paymentError,
          message: paymentError
            ? paymentError
            : 'Complete payment to activate the new plan. Your trial will end permanently once payment is confirmed.',
        };
      }

      // ── Non-trial tier change (existing paid → different paid) ──
      let newPaymongoPlanId = (current as any).paymongoPlanId;
      if (
        this.paymongoService.isEnabled &&
        (current as any).paymongoSubscriptionId
      ) {
        try {
          const amountCentavos = Math.round(newPrice * 100);
          newPaymongoPlanId = await this.paymongoService.getOrCreatePlan(
            newTier,
            current.billingInterval,
            amountCentavos,
          );
          await this.paymongoService.updateSubscriptionPlan(
            (current as any).paymongoSubscriptionId,
            newPaymongoPlanId,
          );
        } catch (pmErr: any) {
          this.logger.warn(`PayMongo plan change failed: ${pmErr.message}`);
        }
      }

      const updated = await (this.prisma.subscription as any).update({
        where: { id: current.id },
        data: {
          tier: newTier,
          price: newPrice,
          maxBranches: tierConfig.maxBranches,
          maxStaff: tierConfig.maxStaff,
          maxTransactions: tierConfig.maxTransactions,
          features: tierConfig.features,
          paymongoPlanId: newPaymongoPlanId,
        },
      });

      await this.syncTenantAuctionModule(pawnshopId, newTier);

      this.logger.log(
        `Subscription ${current.id} upgraded from ${current.tier} to ${newTier}`,
      );

      await this.logSubscriptionAudit({
        pawnshopId,
        actorUserId,
        action: 'SUBSCRIPTION_TIER_CHANGED',
        metadata: {
          subscriptionId: current.id,
          previousTier: current.tier,
          newTier,
        },
      });

      return updated;
    } catch (error: any) {
      this.logger.error(`Failed to change tier: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Generate a PayMongo checkout link for an existing trial/active subscription
   * that was created without a checkout URL.
   */
  async generateCheckoutLink(
    pawnshopId: string,
    billingEmail?: string,
    preferredMethod: 'AUTO' | 'CARD' | 'E_WALLET' = 'AUTO',
    actorUserId?: string,
  ): Promise<{
    checkoutUrl?: string;
    paymentError?: string;
    paymongoError?: string;
    subscriptionId: string;
  }> {
    await this.assertSubscriptionAccess(pawnshopId, actorUserId);

    const current = await (this.prisma.subscription as any).findFirst({
      where: {
        pawnshopId,
        status: {
          in: [
            SubscriptionStatus.ACTIVE,
            SubscriptionStatus.TRIAL,
            SubscriptionStatus.PAST_DUE,
          ],
        },
      },
    });

    if (!current) {
      throw new NotFoundException('No active subscription found');
    }

    if (!this.paymongoService.isEnabled) {
      return {
        subscriptionId: current.id,
        paymentError:
          'Checkout provider is disabled. Set XENDIT_SECRET_KEY in backend environment.',
        paymongoError:
          'Checkout provider is disabled. Set XENDIT_SECRET_KEY in backend environment.',
      };
    }

    // Always generate a fresh link to avoid opening expired/deleted checkout URLs.

    try {
      const amountCentavos = Math.round((current.price || 0) * 100);

      const preferredMethodMap: Record<string, string[] | undefined> = {
        AUTO: undefined,
        CARD: ['card'],
        E_WALLET: ['gcash', 'paymaya', 'grab_pay'],
      };

      const requestedMethodTypes = preferredMethodMap[preferredMethod];
      
      // Use direct payment links to avoid stale subscription plan IDs.
      this.logger.log(`Generating payment link for ${current.tier} subscription (direct payment link bypass)`);
      let link: { linkId: string; checkoutUrl: string };
      try {
        link = await this.paymongoService.createPaymentLink({
          amountCentavos,
          description: `${current.tier} plan (${current.billingInterval})`,
          remarks: 'Direct payment link - PawnGold subscription',
          paymentMethodTypes: requestedMethodTypes,
          metadata: {
            pawnshopId: pawnshopId,
            subscriptionId: current.id,
            tier: current.tier,
            preferredMethod,
          },
        });
      } catch (methodErr: any) {
        const methodMsg = String(methodErr?.message || '');
        const methodUnavailable =
          requestedMethodTypes &&
          methodMsg.toLowerCase().includes('requested payment method is unavailable');

        if (!methodUnavailable) {
          throw methodErr;
        }

        this.logger.warn(
          `Preferred checkout method ${preferredMethod} unavailable. Falling back to AUTO checkout methods.`,
        );

        link = await this.paymongoService.createPaymentLink({
          amountCentavos,
          description: `${current.tier} plan (${current.billingInterval})`,
          remarks: 'Direct payment link - PawnGold subscription',
          paymentMethodTypes: undefined,
          metadata: {
            pawnshopId: pawnshopId,
            subscriptionId: current.id,
            tier: current.tier,
            preferredMethod: 'AUTO',
            preferredMethodFallbackFrom: preferredMethod,
          },
        });
      }

      await (this.prisma.subscription as any).update({
        where: { id: current.id },
        data: {
          paymongoCheckoutUrl: link.checkoutUrl,
          billingEmail: billingEmail || current.billingEmail,
        },
      });

      await this.logSubscriptionAudit({
        pawnshopId,
        actorUserId,
        action: 'SUBSCRIPTION_CHECKOUT_GENERATED',
        metadata: {
          subscriptionId: current.id,
          checkoutUrl: link.checkoutUrl,
          paymongoLinkId: link.linkId,
            preferredMethod,
        },
      });

      return {
        subscriptionId: current.id,
        checkoutUrl: link.checkoutUrl,
      };
    } catch (pmErr: any) {
      const msg = pmErr?.message || 'PayMongo checkout generation failed';
      this.logger.error(`Checkout generation failed: ${msg}`);
      return {
        subscriptionId: current.id,
        paymentError: msg,
        paymongoError: msg,
      };
    }
  }

  /**
   * Update subscription details
   */
  async update(
    pawnshopId: string,
    dto: UpdateSubscriptionDto,
    actorUserId?: string,
  ): Promise<any> {
    try {
      await this.assertSubscriptionAccess(pawnshopId, actorUserId);

      const current = await this.prisma.subscription.findFirst({
        where: {
          pawnshopId,
          status: {
            in: [
              SubscriptionStatus.ACTIVE,
              SubscriptionStatus.TRIAL,
              SubscriptionStatus.PAST_DUE,
            ],
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      if (!current) {
        const latest = await this.prisma.subscription.findFirst({
          where: { pawnshopId },
          orderBy: { createdAt: 'desc' },
        });

        if (
          latest &&
          (latest.status === SubscriptionStatus.CANCELLED ||
            latest.status === SubscriptionStatus.EXPIRED)
        ) {
          return latest;
        }

        throw new NotFoundException('No active subscription found');
      }

      const updateData: any = {};

      if (dto.autoRenew !== undefined) updateData.autoRenew = dto.autoRenew;
      if (dto.billingEmail) updateData.billingEmail = dto.billingEmail;

      if (dto.tier) {
        const tierConfig = TIER_CONFIG[dto.tier];
        updateData.tier = dto.tier;
        updateData.maxBranches = tierConfig.maxBranches;
        updateData.maxStaff = tierConfig.maxStaff;
        updateData.maxTransactions = tierConfig.maxTransactions;
        updateData.features = tierConfig.features;

        if (dto.billingInterval) {
          updateData.billingInterval = dto.billingInterval;
          updateData.price =
            tierConfig.monthlyPrice * INTERVAL_MULTIPLIER[dto.billingInterval];
        } else {
          updateData.price =
            tierConfig.monthlyPrice *
            INTERVAL_MULTIPLIER[current.billingInterval];
        }
      }

      const updated = await this.prisma.subscription.update({
        where: { id: current.id },
        data: updateData,
      });

      this.logger.log(
        `Subscription ${current.id} updated for pawnshop ${pawnshopId}`,
      );

      await this.logSubscriptionAudit({
        pawnshopId,
        actorUserId,
        action: 'SUBSCRIPTION_UPDATED',
        metadata: {
          subscriptionId: current.id,
          updatedFields: Object.keys(updateData),
        },
      });

      return updated;
    } catch (error: any) {
      this.logger.error(
        `Failed to update subscription: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Cancel subscription
   */
  async cancel(
    pawnshopId: string,
    reason: string,
    actorUserId?: string,
  ): Promise<any> {
    try {
      await this.assertSubscriptionAccess(pawnshopId, actorUserId);

      const trimmedReason = reason.trim();

      const current = await this.prisma.subscription.findFirst({
        where: {
          pawnshopId,
          status: {
            in: [
              SubscriptionStatus.ACTIVE,
              SubscriptionStatus.TRIAL,
              SubscriptionStatus.PAST_DUE,
            ],
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      if (!current) {
        const latest = await this.prisma.subscription.findFirst({
          where: { pawnshopId },
          orderBy: { createdAt: 'desc' },
        });

        if (
          latest &&
          (latest.status === SubscriptionStatus.CANCELLED ||
            latest.status === SubscriptionStatus.EXPIRED)
        ) {
          return latest;
        }

        throw new NotFoundException('No active subscription found');
      }

      // ── Cancel on PayMongo if integrated ──
      if (
        this.paymongoService.isEnabled &&
        (current as any).paymongoSubscriptionId
      ) {
        try {
          await this.paymongoService.cancelSubscription(
            (current as any).paymongoSubscriptionId,
          );
        } catch (pmErr: any) {
          this.logger.warn(`PayMongo cancellation failed: ${pmErr.message}`);
        }
      }

      const now = new Date();

      const updated = await this.prisma.subscription.update({
        where: { id: current.id },
        data: {
          status: SubscriptionStatus.CANCELLED,
          cancelledAt: now,
          autoRenew: false,
          trialEndDate:
            current.status === SubscriptionStatus.TRIAL
              ? now
              : current.trialEndDate,
          endDate: now,
          // Prisma schema requires nextBillingDate to be non-null.
          nextBillingDate: now,
        },
      });

      this.logger.log(
        `Subscription ${current.id} cancelled for pawnshop ${pawnshopId}`,
      );

      await this.logSubscriptionAudit({
        pawnshopId,
        actorUserId,
        action: 'SUBSCRIPTION_CANCELLED',
        metadata: {
          subscriptionId: current.id,
          previousStatus: current.status,
          reason: trimmedReason,
        },
      });

      return updated;
    } catch (error: any) {
      this.logger.error(
        `Failed to cancel subscription: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Get available subscription plans
   */
  getPlans(): any {
    return Object.entries(TIER_CONFIG).map(([tier, config]) => ({
      tier,
      name: config.name,
      description: config.description,
      tagline: config.tagline,
      monthlyPrice: config.monthlyPrice,
      quarterlyPrice: config.monthlyPrice * INTERVAL_MULTIPLIER.QUARTERLY,
      annualPrice: config.monthlyPrice * INTERVAL_MULTIPLIER.ANNUALLY,
      features: config.features,
      limits: {
        max_branches: config.maxBranches,
        max_staff: config.maxStaff,
        max_transactions: config.maxTransactions,
        daily_transaction_limit: config.dailyTransactionLimit,
      },
    }));
  }

  /**
   * Check feature access
   */
  async hasFeature(
    pawnshopId: string,
    feature: string,
    actorUserId?: string,
  ): Promise<boolean> {
    const subscription = await this.getCurrent(pawnshopId, actorUserId);
    const features = subscription.features as Record<string, boolean>;
    return features[feature] === true;
  }

  /**
   * Toggle the tenant-level `auction_enabled` module switch whenever a paid tier
   * that includes auction access becomes active. Pawnshops created during a trial
   * keep `auction_enabled: false` in their settings, so without this sync an
   * upgraded Enterprise/Professional subscriber would never see auction modules.
   */
  private async syncTenantAuctionModule(
    pawnshopId: string,
    tier: SubscriptionTier,
  ): Promise<void> {
    const tierConfig = TIER_CONFIG[tier];
    if (!tierConfig?.features?.auction_access) return;

    try {
      const rows = await this.prisma.$queryRaw<Array<{ settings: unknown }>>`
        SELECT settings
        FROM public.pawnshops
        WHERE id = ${pawnshopId}::uuid
        LIMIT 1
      `;
      const current = (rows[0]?.settings as Record<string, unknown> | undefined) || {};
      const merged = { ...current, auction_enabled: true };
      await this.prisma.$executeRaw`
        UPDATE public.pawnshops
        SET settings = ${JSON.stringify(merged)}::jsonb, updated_at = NOW()
        WHERE id = ${pawnshopId}::uuid
      `;
      this.logger.log(
        `Enabled auction_enabled module for pawnshop ${pawnshopId} (${tier})`,
      );
    } catch (error) {
      this.logger.warn(
        `Failed to sync auction module for pawnshop ${pawnshopId}: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Check if within usage limits
   */
  async checkLimits(pawnshopId: string, actorUserId?: string): Promise<{
    billingScope: {
      unit: string;
      onePaymentCoversAllConnectedBranches: boolean;
    };
    limits: Record<string, number | null>;
    usage: Record<string, number>;
    exceededLimits: string[];
  }> {
    const subscription = await this.getCurrent(pawnshopId, actorUserId);

    const [activeBranchCountRows, staffCount] = await Promise.all([
      this.prisma.$queryRaw<Array<{ count: number }>>`
        SELECT COUNT(*)::int AS count
        FROM public.branch
        WHERE pawnshop_id = ${pawnshopId}::uuid
          AND COALESCE(is_active, true) = true
      `,
      this.prisma.staff.count({
        where: { branch: { pawnshopId } },
      }),
    ]);

    // Plan branch usage counts the main pawnshop branch plus additional branch records.
    const additionalBranchCount = activeBranchCountRows[0]?.count ?? 0;
    const branchCount = additionalBranchCount + 1;

    const unlimitedTransactions = this.hasUnlimitedTransactions(subscription);
    const isTrial = subscription.status === SubscriptionStatus.TRIAL;

    let transactionCount = 0;
    if (isTrial) {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const todayRows = await this.prisma.$queryRaw<Array<{ count: number }>>`
        SELECT COUNT(*)::int AS count FROM public.cash_ledger_entries
        WHERE pawnshop_id = ${pawnshopId}::uuid
          AND transaction_date >= ${todayStart}
      `;
      transactionCount = todayRows[0]?.count ?? 0;
    } else {
      const totalRows = await this.prisma.$queryRaw<Array<{ count: number }>>`
        SELECT COUNT(*)::int AS count FROM public.cash_ledger_entries
        WHERE pawnshop_id = ${pawnshopId}::uuid
      `;
      transactionCount = totalRows[0]?.count ?? 0;
    }

    const txnLimit = isTrial ? 50 : (unlimitedTransactions ? null : subscription.maxTransactions);

    const limits = {
      max_branches: subscription.maxBranches,
      max_staff: subscription.maxStaff,
      max_transactions: txnLimit,
    };

    const usage = {
      max_branches: branchCount,
      max_staff: staffCount,
      max_transactions: transactionCount,
    };

    const exceededLimits: string[] = [];

    if (
      limits.max_branches !== null &&
      usage.max_branches > limits.max_branches
    ) {
      exceededLimits.push('Branches');
    }

    if (limits.max_staff !== null && usage.max_staff > limits.max_staff) {
      exceededLimits.push('Staff');
    }

    if (
      limits.max_transactions !== null &&
      usage.max_transactions > limits.max_transactions
    ) {
      exceededLimits.push('Transactions');
    }

    return {
      billingScope: {
        unit: 'PAWNSHOP',
        onePaymentCoversAllConnectedBranches: true,
      },
      limits,
      usage,
      exceededLimits,
    };
  }

  /**
   * Expire subscriptions that have passed their end date without renewal.
   * Runs hourly to catch expired subscriptions promptly.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async expireOverdueSubscriptions(): Promise<void> {
    try {
      const now = new Date();

      const expiredSubscriptions = await this.prisma.subscription.findMany({
        where: {
          status: {
            in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIAL],
          },
          endDate: { lt: now },
          autoRenew: false,
        },
      });

      for (const sub of expiredSubscriptions) {
        try {
          await this.prisma.subscription.update({
            where: { id: sub.id },
            data: {
              status: SubscriptionStatus.EXPIRED,
              autoRenew: false,
            },
          });

          await this.logSubscriptionAudit({
            pawnshopId: sub.pawnshopId,
            action: 'SUBSCRIPTION_EXPIRED',
            metadata: {
              subscriptionId: sub.id,
              tier: sub.tier,
              endDate: sub.endDate.toISOString(),
            },
          });

          this.logger.log(`Subscription ${sub.id} expired (ended ${sub.endDate.toISOString()})`);
        } catch (err: any) {
          this.logger.warn(`Failed to expire subscription ${sub.id}: ${err.message}`);
        }
      }

      if (expiredSubscriptions.length > 0) {
        this.logger.log(`Expired ${expiredSubscriptions.length} overdue subscriptions`);
      }
    } catch (error: any) {
      this.logger.error(`Failed to expire subscriptions: ${error.message}`, error.stack);
    }
  }

  /**
   * Process billing for due subscriptions
   * Runs daily at 6 AM
   */
  @Cron('0 6 * * *')
  async processBilling(): Promise<void> {
    try {
      const now = new Date();

      // Find subscriptions due for billing
      const dueSubscriptions = await this.prisma.subscription.findMany({
        where: {
          status: {
            in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIAL],
          },
          nextBillingDate: {
            lte: now,
          },
          autoRenew: true,
        },
      });

      for (const subscription of dueSubscriptions) {
        try {
          // Handle trial ending
          if (subscription.status === SubscriptionStatus.TRIAL) {
            await this.prisma.subscription.update({
              where: { id: subscription.id },
              data: {
                status: SubscriptionStatus.ACTIVE,
              },
            });
          }

          // Create payment record
          const intervalMonths = INTERVAL_MONTHS[subscription.billingInterval];
          const nextBilling = new Date(subscription.nextBillingDate);
          nextBilling.setMonth(nextBilling.getMonth() + intervalMonths);

          await this.prisma.subscriptionPayment.create({
            data: {
              subscriptionId: subscription.id,
              amount: subscription.price,
              status: 'pending',
              paymentMethod: subscription.paymentMethodId || 'manual',
              billingDate: now,
            },
          });

          // Record subscription payment in finance ledger
          try {
            await this.financeService.createEntry(subscription.pawnshopId, {
              entryType: LedgerEntryType.DEBIT,
              category: LedgerCategory.SUBSCRIPTION_PAYMENT,
              amount: subscription.price,
              description: `Subscription billing: ${subscription.tier} tier (${subscription.billingInterval})`,
              performedBy: 'system',
              referenceType: 'SUBSCRIPTION',
              referenceId: subscription.id,
            });
          } catch (ledgerErr) {
            this.logger.error(
              `Failed to create ledger entry for subscription ${subscription.id}: ${ledgerErr}`,
            );
          }

          // Update next billing date
          await this.prisma.subscription.update({
            where: { id: subscription.id },
            data: {
              lastBilledAt: now,
              nextBillingDate: nextBilling,
            },
          });

          this.logger.log(
            `Billing processed for subscription ${subscription.id}`,
          );
        } catch (error: any) {
          this.logger.error(
            `Failed to bill subscription ${subscription.id}: ${error.message}`,
          );
        }
      }

      if (dueSubscriptions.length > 0) {
        this.logger.log(
          `Processed ${dueSubscriptions.length} subscription billings`,
        );
      }
    } catch (error: any) {
      this.logger.error(
        `Failed to process billing: ${error.message}`,
        error.stack,
      );
    }
  }

  /**
   * Check for expiring subscriptions and send notifications
   * Runs daily at 9 AM
   */
  @Cron('0 9 * * *')
  async checkExpiringSubscriptions(): Promise<void> {
    try {
      const now = new Date();
      const sevenDaysFromNow = new Date(now);
      sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);

      const expiring = await this.prisma.subscription.findMany({
        where: {
          status: SubscriptionStatus.ACTIVE,
          endDate: {
            lte: sevenDaysFromNow,
            gte: now,
          },
          autoRenew: false,
        },
        include: {
          pawnshop: {
            select: {
              name: true,
              ownerEmail: true,
            },
          },
        },
      });

      for (const subscription of expiring) {
        this.logger.log(
          `Subscription ${subscription.id} for ${subscription.pawnshop.name} expiring on ${subscription.endDate.toISOString()}`,
        );
        // TODO: Send expiration notification
      }
    } catch (error: any) {
      this.logger.error(
        `Failed to check expiring subscriptions: ${error.message}`,
        error.stack,
      );
    }
  }

  // ─── PayMongo Webhook Handling ───────────────────────────────

  /**
   * Handle inbound PayMongo webhook events.
   * Updates local subscription status based on payment events.
   */
  async handlePaymongoWebhook(event: {
    type: string;
    data: any;
  }): Promise<void> {
    const eventType = event.type;
    const attrs = event.data?.attributes || {};
    const paymongoSubId: string | undefined =
      attrs.subscription_id || event.data?.id;

    this.logger.log(`PayMongo webhook: ${eventType} for ${paymongoSubId}`);

    if (!paymongoSubId) return;

    const subscription = await (this.prisma.subscription as any).findFirst({
      where: { paymongoSubscriptionId: paymongoSubId },
    });

    if (!subscription) {
      this.logger.warn(
        `No local subscription found for PayMongo ID ${paymongoSubId}`,
      );
      return;
    }

    switch (eventType) {
      case 'subscription.payment.paid': {
        // Check for pending trial upgrade — apply tier change and end trial permanently
        const pendingTier = (subscription as any).pendingTier as SubscriptionTier | null;
        const wasTrial = subscription.status === SubscriptionStatus.TRIAL;

        const updateData: any = {
          status: SubscriptionStatus.ACTIVE,
        };

        // If there was a pending tier change (trial→paid), apply it now
        if (pendingTier) {
          const tierConfig = TIER_CONFIG[pendingTier];
          updateData.tier = pendingTier;
          updateData.maxBranches = tierConfig.maxBranches;
          updateData.maxStaff = tierConfig.maxStaff;
          updateData.maxTransactions = tierConfig.maxTransactions;
          updateData.features = tierConfig.features;
          updateData.pendingTier = null; // Clear pending
        }

        // End trial permanently — set trialEndDate to now so trial can never be used again
        if (wasTrial) {
          updateData.trialEndDate = new Date();
        }

        await this.prisma.subscription.update({
          where: { id: subscription.id },
          data: updateData,
        });

        const appliedTier =
          pendingTier || (subscription.tier as SubscriptionTier);
        await this.syncTenantAuctionModule(subscription.pawnshopId, appliedTier);

        const amount = (attrs.amount || 0) / 100; // centavos → PHP
        await this.prisma.subscriptionPayment.create({
          data: {
            subscriptionId: subscription.id,
            amount,
            status: 'completed',
            paymentMethod: attrs.payment_method_type || 'paymongo',
            paymentReference: attrs.payment_intent_id || null,
            transactionId: event.data?.id || null,
            billingDate: new Date(),
            paidAt: new Date(),
          },
        });

        // Record in finance ledger
        try {
          await this.financeService.createEntry(subscription.pawnshopId, {
            entryType: LedgerEntryType.DEBIT,
            category: LedgerCategory.SUBSCRIPTION_PAYMENT,
            amount,
            description: `PayMongo payment: ${updateData.tier || subscription.tier} tier`,
            performedBy: 'paymongo',
            referenceType: 'SUBSCRIPTION',
            referenceId: subscription.id,
          });
        } catch (ledgerErr) {
          this.logger.error(`Failed to record ledger entry: ${ledgerErr}`);
        }

        this.logger.log(
          `Subscription ${subscription.id} activated via PayMongo payment` +
            (wasTrial ? ' (trial ended permanently)' : '') +
            (pendingTier ? ` (tier changed to ${pendingTier})` : ''),
        );
        break;
      }

      case 'subscription.payment.failed': {
        await this.prisma.subscription.update({
          where: { id: subscription.id },
          data: { status: SubscriptionStatus.PAST_DUE },
        });

        await this.prisma.subscriptionPayment.create({
          data: {
            subscriptionId: subscription.id,
            amount: (attrs.amount || 0) / 100,
            status: 'failed',
            paymentMethod: attrs.payment_method_type || 'paymongo',
            billingDate: new Date(),
            failedAt: new Date(),
            failureReason: attrs.failure_reason || 'Payment failed',
          },
        });

        this.logger.warn(`Payment failed for subscription ${subscription.id}`);
        break;
      }

      case 'subscription.cancelled':
      case 'subscription.expired': {
        const newStatus =
          eventType === 'subscription.cancelled'
            ? SubscriptionStatus.CANCELLED
            : SubscriptionStatus.EXPIRED;

        await this.prisma.subscription.update({
          where: { id: subscription.id },
          data: {
            status: newStatus,
            cancelledAt:
              newStatus === SubscriptionStatus.CANCELLED
                ? new Date()
                : undefined,
            autoRenew: false,
          },
        });

        this.logger.log(
          `Subscription ${subscription.id} ${eventType.split('.')[1]}`,
        );
        break;
      }

      case 'subscription.activated': {
        await this.prisma.subscription.update({
          where: { id: subscription.id },
          data: { status: SubscriptionStatus.ACTIVE },
        });
        this.logger.log(`Subscription ${subscription.id} activated`);
        break;
      }

      default:
        this.logger.log(`Unhandled PayMongo event: ${eventType}`);
    }
  }

  /**
   * Handle inbound Xendit invoice/payment webhooks.
   * Activates the subscription and applies any pending tier upgrade.
   */
  async handleXenditWebhook(payload: any): Promise<void> {
    const event = String(payload?.event || payload?.type || '').toLowerCase();
    const data = payload?.data || payload || {};

    const isPaidEvent =
      event.includes('invoice.paid') ||
      event.includes('payment.settled') ||
      event.includes('payment.paid') ||
      String(data?.status || '').toUpperCase() === 'PAID' ||
      String(data?.status || '').toUpperCase() === 'SETTLED';

    if (!isPaidEvent) {
      this.logger.log(`Xendit webhook (unhandled): ${event}`);
      return;
    }

    const invoiceId: string | undefined = data?.id;
    const externalId: string | undefined = data?.external_id;
    const metadata = data?.metadata || {};

    let subscription: any = null;

    const metadataSubId =
      metadata?.subscriptionId || metadata?.subscription_id || null;
    if (metadataSubId) {
      subscription = await (this.prisma.subscription as any).findFirst({
        where: { id: metadataSubId },
      });
    }

    if (!subscription && externalId) {
      const subIdFromExternal = String(externalId).replace(/-\d+$/, '');
      subscription = await (this.prisma.subscription as any).findFirst({
        where: { id: subIdFromExternal },
      });
    }

    if (!subscription && invoiceId) {
      subscription = await (this.prisma.subscription as any).findFirst({
        where: { paymongoCheckoutUrl: { contains: invoiceId } },
      });
    }

    if (!subscription) {
      this.logger.warn(
        `Xendit webhook: no subscription found (event=${event}, external_id=${externalId})`,
      );
      return;
    }

    const rawMetaTier = metadata?.tier;
    const metaTier = Object.values(SubscriptionTier).includes(rawMetaTier)
      ? (rawMetaTier as SubscriptionTier)
      : undefined;
    const storedPendingTier = (subscription as any).pendingTier as
      | SubscriptionTier
      | null;
    const pendingTier =
      storedPendingTier ||
      metaTier ||
      (subscription.tier as SubscriptionTier);
    const wasTrial = subscription.status === SubscriptionStatus.TRIAL;

    const updateData: any = {
      status: SubscriptionStatus.ACTIVE,
    };

    if (pendingTier && pendingTier !== SubscriptionTier.TRIAL) {
      const tierConfig = TIER_CONFIG[pendingTier];
      updateData.tier = pendingTier;
      updateData.maxBranches = tierConfig.maxBranches;
      updateData.maxStaff = tierConfig.maxStaff;
      updateData.maxTransactions = tierConfig.maxTransactions;
      updateData.features = tierConfig.features;
      updateData.pendingTier = null;
    }

    if (wasTrial) {
      updateData.trialEndDate = new Date();
    }

    await this.prisma.subscription.update({
      where: { id: subscription.id },
      data: updateData,
    });

    const appliedTier =
      pendingTier === SubscriptionTier.TRIAL
        ? (subscription.tier as SubscriptionTier)
        : pendingTier;
    await this.syncTenantAuctionModule(subscription.pawnshopId, appliedTier);

    const amount = Number(data?.amount) || subscription.price;
    const paymentReference = invoiceId || String(externalId || '');

    const existingCompleted = await this.prisma.subscriptionPayment.findFirst({
      where: {
        subscriptionId: subscription.id,
        paymentReference,
        status: 'completed',
      },
      select: { id: true },
    });

    if (!existingCompleted) {
      await this.prisma.subscriptionPayment.create({
        data: {
          subscriptionId: subscription.id,
          amount,
          status: 'completed',
          paymentMethod:
            data?.payment_channel || data?.payment_method || 'xendit',
          paymentReference,
          transactionId: invoiceId || String(externalId || ''),
          billingDate: new Date(),
          paidAt: data?.paid_at ? new Date(data.paid_at) : new Date(),
        },
      });

      try {
        await this.financeService.createEntry(subscription.pawnshopId, {
          entryType: LedgerEntryType.DEBIT,
          category: LedgerCategory.SUBSCRIPTION_PAYMENT,
          amount,
          description: `Xendit payment: ${appliedTier} tier`,
          performedBy: 'xendit',
          referenceType: 'SUBSCRIPTION',
          referenceId: subscription.id,
        });
      } catch (ledgerErr) {
        this.logger.error(
          `Failed to record ledger entry: ${(ledgerErr as Error).message}`,
        );
      }

      await this.logSubscriptionAudit({
        pawnshopId: subscription.pawnshopId,
        action: 'SUBSCRIPTION_PAYMENT_CONFIRMED',
        metadata: {
          subscriptionId: subscription.id,
          provider: 'xendit',
          paymentReference,
          amount,
        },
      });
    }

    this.logger.log(
      `Subscription ${subscription.id} activated via Xendit` +
        (wasTrial ? ' (trial ended permanently)' : '') +
        (pendingTier && pendingTier !== SubscriptionTier.TRIAL
          ? ` (tier changed to ${pendingTier})`
          : ''),
    );
  }

  /**
   * Trigger a test billing cycle (sandbox only).
   * Useful for thesis demo.
   */
  async triggerTestCycle(pawnshopId: string, actorUserId?: string): Promise<void> {
    await this.assertSubscriptionAccess(pawnshopId, actorUserId);

    const sub = await (this.prisma.subscription as any).findFirst({
      where: {
        pawnshopId,
        paymongoSubscriptionId: { not: null },
        status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIAL] },
      },
    });

    if (!sub?.paymongoSubscriptionId) {
      throw new NotFoundException('No PayMongo subscription found');
    }

    await this.paymongoService.createTestCycle(sub.paymongoSubscriptionId);

    await this.logSubscriptionAudit({
      pawnshopId,
      actorUserId,
      action: 'SUBSCRIPTION_TEST_CYCLE_TRIGGERED',
      metadata: {
        subscriptionId: sub.id,
        paymongoSubscriptionId: sub.paymongoSubscriptionId,
      },
    });
  }

  async getPaymentLinkStatus(
    pawnshopId: string,
    actorUserId?: string,
  ): Promise<{
    subscriptionId: string;
    checkoutUrl: string | null;
    paymongoLinkId: string | null;
    status: string;
    amount?: number;
    currency?: string;
    paidAt?: string | null;
  }> {
    await this.assertSubscriptionAccess(pawnshopId, actorUserId);

    const current = await (this.prisma.subscription as any).findFirst({
      where: {
        pawnshopId,
        status: {
          in: [
            SubscriptionStatus.ACTIVE,
            SubscriptionStatus.TRIAL,
            SubscriptionStatus.PAST_DUE,
          ],
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!current) {
      throw new NotFoundException('No active subscription found');
    }

    const checkoutUrl: string | null = current.paymongoCheckoutUrl ?? null;
    const paymongoLinkId = this.extractPaymongoLinkId(checkoutUrl);

    if (!checkoutUrl || !paymongoLinkId || !this.paymongoService.isEnabled) {
      return {
        subscriptionId: current.id,
        checkoutUrl,
        paymongoLinkId,
        status: checkoutUrl ? 'pending' : 'unavailable',
      };
    }

    const link = await this.paymongoService.retrievePaymentLink(paymongoLinkId);
    const attributes = link?.attributes || {};
    const amount = typeof attributes.amount === 'number'
      ? attributes.amount / 100
      : undefined;
    const status = String(attributes.status || 'pending').toLowerCase();
    const paidAt = attributes.paid_at || null;

    if (status === 'paid') {
      const existingCompleted = await this.prisma.subscriptionPayment.findFirst({
        where: {
          subscriptionId: current.id,
          paymentReference: paymongoLinkId,
          status: 'completed',
        },
        select: { id: true },
      });

      const rawMetaTier = attributes.metadata?.tier;
      const metaTier = Object.values(SubscriptionTier).includes(rawMetaTier)
        ? (rawMetaTier as SubscriptionTier)
        : undefined;
      const storedPendingTier = (current as any).pendingTier as SubscriptionTier | null;
      const pendingTier = storedPendingTier || metaTier || null;

      const stuckOnTrial =
        (current as any).tier === SubscriptionTier.TRIAL &&
        current.status !== SubscriptionStatus.TRIAL &&
        !!pendingTier &&
        pendingTier !== SubscriptionTier.TRIAL;

      if (!existingCompleted || stuckOnTrial) {
        const wasTrial = current.status === SubscriptionStatus.TRIAL;

        const updateData: any = {};

        if (pendingTier) {
          const tierConfig = TIER_CONFIG[pendingTier];
          updateData.tier = pendingTier;
          updateData.maxBranches = tierConfig.maxBranches;
          updateData.maxStaff = tierConfig.maxStaff;
          updateData.maxTransactions = tierConfig.maxTransactions;
          updateData.features = tierConfig.features;
          updateData.pendingTier = null;
        }

        if (current.status !== SubscriptionStatus.ACTIVE) {
          updateData.status = SubscriptionStatus.ACTIVE;
        }

        // End trial permanently
        if (wasTrial) {
          updateData.trialEndDate = new Date();
        }

        if (Object.keys(updateData).length > 0) {
          await this.prisma.subscription.update({
            where: { id: current.id },
            data: updateData,
          });
        }

        if (!existingCompleted) {
          await this.prisma.subscriptionPayment.create({
            data: {
              subscriptionId: current.id,
              amount: amount ?? current.price,
              status: 'completed',
              paymentMethod: 'paymongo_link',
              paymentReference: paymongoLinkId,
              transactionId: String(link?.id || paymongoLinkId),
              billingDate: new Date(),
              paidAt: paidAt ? new Date(paidAt) : new Date(),
            },
          });

          await this.logSubscriptionAudit({
            pawnshopId,
            actorUserId,
            action: 'SUBSCRIPTION_PAYMENT_CONFIRMED',
            metadata: {
              subscriptionId: current.id,
              paymongoLinkId,
              amount: amount ?? current.price,
            },
          });
        } else if (stuckOnTrial) {
          await this.logSubscriptionAudit({
            pawnshopId,
            actorUserId,
            action: 'SUBSCRIPTION_TIER_RECOVERED',
            metadata: {
              subscriptionId: current.id,
              paymongoLinkId,
              tier: pendingTier,
            },
          });
        }
      }
    }

    return {
      subscriptionId: current.id,
      checkoutUrl,
      paymongoLinkId,
      status,
      amount,
      currency: attributes.currency || 'PHP',
      paidAt,
    };
  }
}
