import { Injectable, Logger } from '@nestjs/common';

/**
 * PayMongo API wrapper for subscription billing.
 *
 * Uses PayMongo's Subscriptions API (v1):
 *   - Plans: create, list
 *   - Subscriptions: create, retrieve, cancel, update plan
 *   - Test cycles for sandbox testing
 *
 * API docs: https://developers.paymongo.com/reference
 */

const PAYMONGO_BASE = 'https://api.paymongo.com/v1';
const XENDIT_BASE = 'https://api.xendit.co';

/** Maps our BillingInterval to PayMongo interval/count */
const INTERVAL_MAP: Record<
  string,
  { interval: string; interval_count: number }
> = {
  MONTHLY: { interval: 'month', interval_count: 1 },
  QUARTERLY: { interval: 'month', interval_count: 3 },
  ANNUALLY: { interval: 'year', interval_count: 1 },
};

@Injectable()
export class PaymongoService {
  private readonly logger = new Logger(PaymongoService.name);
  private readonly paymongoSecretKey: string;
  private readonly xenditSecretKey: string;
  private readonly paymongoAuthHeader: string;
  private readonly xenditAuthHeader: string;
  private readonly provider: 'paymongo' | 'xendit' | 'none';

  /** In-memory cache of planKey → PayMongo plan ID */
  private planCache = new Map<string, string>();

  constructor() {
    this.paymongoSecretKey = (
      process.env.PAYMONGO_SECRET_KEY ||
      process.env.PAYMONGO_API_KEY ||
      process.env.PAYMONGO_SECRET ||
      ''
    ).trim();
    this.xenditSecretKey = (process.env.XENDIT_SECRET_KEY || '').trim();

    this.paymongoAuthHeader = `Basic ${Buffer.from(this.paymongoSecretKey + ':').toString('base64')}`;
    this.xenditAuthHeader = `Basic ${Buffer.from(this.xenditSecretKey + ':').toString('base64')}`;

    const configuredProvider = (process.env.PAYMENT_PROVIDER || '').trim().toLowerCase();
    if (configuredProvider && configuredProvider !== 'xendit') {
      this.logger.warn(
        `PAYMENT_PROVIDER=${configuredProvider} is ignored. This deployment is configured for Xendit checkout only.`,
      );
    }

    this.provider = this.xenditSecretKey ? 'xendit' : 'none';

    if (this.provider === 'none') {
      this.logger.warn('XENDIT_SECRET_KEY not set — Xendit checkout integration disabled.');
    } else {
      this.logger.log(`Payment provider active: ${this.provider}`);
    }
  }

  /** Whether PayMongo integration is active */
  get isEnabled(): boolean {
    return this.provider !== 'none';
  }

  /** Whether current PayMongo credentials are sandbox/test mode */
  get isTestMode(): boolean {
    if (this.provider === 'xendit') {
      return this.xenditSecretKey.startsWith('xnd_development_');
    }
    if (this.provider === 'paymongo') {
      return this.paymongoSecretKey.startsWith('sk_test_');
    }
    return false;
  }

  // ─── Low-level request ─────────────────────────────────────

  private async requestPaymongo<T = any>(
    method: string,
    path: string,
    body?: Record<string, any>,
  ): Promise<T> {
    const url = `${PAYMONGO_BASE}${path}`;
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: this.paymongoAuthHeader,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

    const json = await res.json();

    if (!res.ok) {
      const errMsg =
        json?.errors?.[0]?.detail || json?.errors?.[0]?.code || res.statusText;
      const fullErr = `PayMongo ${method} ${path} (${res.status}): ${errMsg}`;
      this.logger.error(fullErr);
      this.logger.debug(`Full response: ${JSON.stringify(json)}`);
      throw new Error(fullErr);
    }

    return json as T;
  }

  private async requestXendit<T = any>(
    method: string,
    path: string,
    body?: Record<string, any>,
  ): Promise<T> {
    const url = `${XENDIT_BASE}${path}`;
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: this.xenditAuthHeader,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

    const json = await res.json();
    if (!res.ok) {
      const errMsg =
        json?.message ||
        json?.error_code ||
        json?.errors?.[0]?.message ||
        res.statusText;
      const fullErr = `Xendit ${method} ${path} (${res.status}): ${errMsg}`;
      this.logger.error(fullErr);
      this.logger.debug(`Full response: ${JSON.stringify(json)}`);
      throw new Error(fullErr);
    }

    return json as T;
  }

  // ─── Plans ─────────────────────────────────────────────────

  /**
   * Get or create a PayMongo Plan for a given tier + interval.
   * Caches plan IDs to avoid re-creating.
   */
  async getOrCreatePlan(
    tier: string,
    billingInterval: string,
    amountCentavos: number,
    forceRefresh = false,
  ): Promise<string> {
    if (this.provider !== 'paymongo') {
      throw new Error('Plan API is only available for PayMongo provider.');
    }

    const cacheKey = `${tier}_${billingInterval}`;
    if (forceRefresh) {
      this.planCache.delete(cacheKey);
    }

    if (this.planCache.has(cacheKey)) {
      return this.planCache.get(cacheKey);
    }

    // Try listing existing plans and find a match by name
    try {
      const listRes = await this.requestPaymongo<any>('GET', '/plans');
      const existing = (listRes.data || []).find(
        (p: any) => p.attributes?.name === cacheKey,
      );
      if (existing) {
        this.planCache.set(cacheKey, existing.id);
        return existing.id;
      }
    } catch {
      // list failed, create fresh
    }

    const { interval, interval_count } =
      INTERVAL_MAP[billingInterval] || INTERVAL_MAP.MONTHLY;

    const res = await this.requestPaymongo<any>('POST', '/plans', {
      data: {
        attributes: {
          name: cacheKey,
          amount: amountCentavos, // in centavos (PHP)
          currency: 'PHP',
          interval,
          interval_count,
        },
      },
    });

    const planId: string = res.data.id;
    this.planCache.set(cacheKey, planId);
    this.logger.log(`Created PayMongo plan ${planId} for ${cacheKey}`);
    return planId;
  }

  // ─── Subscriptions ─────────────────────────────────────────

  /**
   * Create a PayMongo subscription.
   * Returns { subscriptionId, checkoutUrl }.
   */
  async createSubscription(opts: {
    planId: string;
    customerEmail: string;
    description?: string;
  }): Promise<{ subscriptionId: string; checkoutUrl: string }> {
    if (this.provider !== 'paymongo') {
      throw new Error(
        'createSubscription API is only available for PayMongo provider. Use createPaymentLink for Xendit checkout.',
      );
    }

    const res = await this.requestPaymongo<any>('POST', '/subscriptions', {
      data: {
        attributes: {
          plan: opts.planId,
          customer_email: opts.customerEmail,
          description: opts.description || 'Pawnshop SaaS subscription',
        },
      },
    });

    const checkoutUrl =
      res?.data?.attributes?.checkout_url ||
      res?.data?.attributes?.hosted_url ||
      res?.data?.attributes?.latest_invoice?.hosted_url ||
      '';

    return {
      subscriptionId: res.data.id,
      checkoutUrl,
    };
  }

  /**
   * Create a one-time PayMongo payment link as fallback when Subscriptions API
   * is unavailable for the current account/key.
   */
  async createPaymentLink(opts: {
    amountCentavos: number;
    description: string;
    remarks?: string;
    metadata?: Record<string, any>;
    paymentMethodTypes?: string[];
  }): Promise<{ linkId: string; checkoutUrl: string }> {
    if (this.provider === 'xendit') {
      const mappedMethods = this.mapXenditPaymentMethods(opts.paymentMethodTypes);
      const hasExplicitMethodPreference =
        Array.isArray(opts.paymentMethodTypes) && opts.paymentMethodTypes.length > 0;

      const amount = Number((opts.amountCentavos / 100).toFixed(2));
      const externalId =
        String(opts.metadata?.subscriptionId || 'sub') + '-' + Date.now();

      try {
        const invoice = await this.requestXendit<any>('POST', '/v2/invoices', {
          external_id: externalId,
          amount,
          description: opts.description,
          currency: 'PHP',
          success_redirect_url: process.env.XENDIT_SUCCESS_REDIRECT_URL || undefined,
          failure_redirect_url: process.env.XENDIT_FAILURE_REDIRECT_URL || undefined,
          available_payment_methods: mappedMethods,
          metadata: opts.metadata || {},
        });

        return {
          linkId: invoice.id,
          checkoutUrl: invoice.invoice_url,
        };
      } catch (error) {
        if (hasExplicitMethodPreference) {
          throw new Error(
            `Requested payment method is unavailable for this payment account. Requested: ${(opts.paymentMethodTypes || []).join(', ')}`,
          );
        }
        throw error;
      }
    }

    if (this.provider !== 'paymongo') {
      throw new Error('No payment provider is configured.');
    }

    const configuredMethods = (process.env.PAYMONGO_LINK_PAYMENT_METHOD_TYPES || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);

    const paymentMethodTypes =
      opts.paymentMethodTypes && opts.paymentMethodTypes.length > 0
        ? opts.paymentMethodTypes
        : configuredMethods.length > 0
          ? configuredMethods
          : ['card', 'gcash', 'paymaya', 'grab_pay'];
    const hasExplicitMethodPreference =
      Array.isArray(opts.paymentMethodTypes) && opts.paymentMethodTypes.length > 0;

    const baseAttributes: Record<string, any> = {
      amount: opts.amountCentavos,
      currency: 'PHP',
      description: opts.description,
      remarks: opts.remarks || 'PawnGold subscription payment',
      metadata: opts.metadata || {},
    };

    let res: any;
    try {
      res = await this.requestPaymongo<any>('POST', '/links', {
        data: {
          attributes: {
            ...baseAttributes,
            payment_method_types: paymentMethodTypes,
          },
        },
      });

      if (hasExplicitMethodPreference) {
        const actualTypes = Array.isArray(res?.data?.attributes?.payment_method_types)
          ? res.data.attributes.payment_method_types
          : [];
        const hasRequestedType = paymentMethodTypes.some((type) =>
          actualTypes.includes(type),
        );

        if (!hasRequestedType) {
          throw new Error(
            `Requested payment method is unavailable for this PayMongo account. Requested: ${paymentMethodTypes.join(', ')}`,
          );
        }
      }
    } catch (error) {
      if (hasExplicitMethodPreference) {
        throw error;
      }

      // Some accounts or API versions reject explicit payment method types.
      // Retry with minimal attributes so checkout remains usable.
      this.logger.warn(
        `PayMongo payment method type override failed, retrying default link creation: ${(error as Error).message}`,
      );
      res = await this.requestPaymongo<any>('POST', '/links', {
        data: {
          attributes: baseAttributes,
        },
      });
    }

    return {
      linkId: res.data.id,
      checkoutUrl: res.data.attributes.checkout_url,
    };
  }

  /** Retrieve a PayMongo payment link by ID */
  async retrievePaymentLink(linkId: string): Promise<any> {
    if (this.provider === 'xendit') {
      const invoice = await this.requestXendit<any>('GET', `/v2/invoices/${linkId}`);
      const statusMap: Record<string, string> = {
        PAID: 'paid',
        SETTLED: 'paid',
        EXPIRED: 'expired',
        FAILED: 'failed',
        PENDING: 'pending',
      };

      return {
        id: invoice.id,
        attributes: {
          status: statusMap[String(invoice.status || '').toUpperCase()] || 'pending',
          amount:
            typeof invoice.amount === 'number'
              ? Math.round(invoice.amount * 100)
              : undefined,
          currency: invoice.currency || 'PHP',
          paid_at: invoice.paid_at || null,
          metadata: invoice.metadata || {},
        },
      };
    }

    const res = await this.requestPaymongo<any>('GET', `/links/${linkId}`);
    return res.data;
  }

  /** Retrieve a subscription by PayMongo ID */
  async retrieveSubscription(subscriptionId: string): Promise<any> {
    if (this.provider !== 'paymongo') {
      throw new Error('retrieveSubscription is only available for PayMongo provider.');
    }

    const res = await this.requestPaymongo<any>(
      'GET',
      `/subscriptions/${subscriptionId}`,
    );
    return res.data;
  }

  /** Cancel a PayMongo subscription */
  async cancelSubscription(subscriptionId: string): Promise<void> {
    if (this.provider !== 'paymongo') {
      return;
    }

    await this.requestPaymongo('POST', `/subscriptions/${subscriptionId}/cancel`);
    this.logger.log(`Cancelled PayMongo subscription ${subscriptionId}`);
  }

  /** Update plan on an existing PayMongo subscription */
  async updateSubscriptionPlan(
    subscriptionId: string,
    newPlanId: string,
  ): Promise<void> {
    if (this.provider !== 'paymongo') {
      throw new Error('updateSubscriptionPlan is only available for PayMongo provider.');
    }

    await this.requestPaymongo('PUT', `/subscriptions/${subscriptionId}/plan`, {
      data: {
        attributes: {
          plan: newPlanId,
        },
      },
    });
    this.logger.log(
      `Updated PayMongo subscription ${subscriptionId} to plan ${newPlanId}`,
    );
  }

  /**
   * Trigger a test billing cycle (sandbox only).
   * Useful for thesis demo — simulates the next billing without waiting.
   */
  async createTestCycle(subscriptionId: string): Promise<void> {
    if (this.provider !== 'paymongo') {
      throw new Error('test cycle is only available for PayMongo provider.');
    }

    await this.requestPaymongo('POST', `/subscriptions/${subscriptionId}/test_cycle`);
    this.logger.log(`Test cycle created for subscription ${subscriptionId}`);
  }

  private mapXenditPaymentMethods(
    paymentMethodTypes?: string[],
  ): string[] | undefined {
    const configuredMethods = (process.env.XENDIT_AVAILABLE_PAYMENT_METHODS || '')
      .split(',')
      .map((value) => value.trim().toUpperCase())
      .filter(Boolean);

    const mapper: Record<string, string> = {
      card: 'CARDS',
      gcash: 'GCASH',
      paymaya: 'PAYMAYA',
      grab_pay: 'GRABPAY',
    };

    if (paymentMethodTypes && paymentMethodTypes.length > 0) {
      const mapped = paymentMethodTypes
        .map((method) => mapper[String(method).toLowerCase()])
        .filter(Boolean);
      return mapped.length > 0 ? mapped : undefined;
    }

    if (configuredMethods.length > 0) {
      return configuredMethods;
    }

    return ['CARDS', 'GCASH', 'PAYMAYA', 'GRABPAY'];
  }

  // ─── Webhook verification ──────────────────────────────────

  /**
   * Verify a PayMongo webhook signature (optional but recommended).
   * For thesis/test mode this can be skipped.
   */
  verifyWebhookSignature(
    payload: string,
    signature: string,
    webhookSecret: string,
  ): boolean {
    // PayMongo uses HMAC-SHA256 for webhook signatures
    // For local/dev, verification can be bypassed only when no secret is configured.
    if (!webhookSecret) {
      if (process.env.NODE_ENV === 'production') {
        this.logger.error(
          'PAYMONGO_WEBHOOK_SECRET is required in production for webhook verification',
        );
        return false;
      }
      this.logger.warn(
        'PAYMONGO_WEBHOOK_SECRET not set; webhook signature check bypassed in non-production mode',
      );
      return true;
    }

    try {
      const crypto = require('crypto');
      const [, sigValue] = signature
        .split(',')
        .map((s: string) => s.split('=')[1]);
      const hmac = crypto
        .createHmac('sha256', webhookSecret)
        .update(payload)
        .digest('hex');
      return hmac === sigValue;
    } catch {
      this.logger.warn('Webhook signature verification failed');
      return false;
    }
  }
}
