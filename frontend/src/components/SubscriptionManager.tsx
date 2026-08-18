/**
 * SubscriptionManager -- SaaS subscription & billing management.
 *
 * Features:
 *   - Current plan overview
 *   - Plans comparison grid
 *   - Upgrade / downgrade tier
 *   - Cancel subscription
 *   - Usage & limits display
 *   - Billing history
 */

import { useState, useCallback, useEffect } from 'react';
import {
  Crown,
  Zap,
  RefreshCw,
  ArrowUpCircle,
  XCircle,
  Check,
  Star,
  Shield,
  Loader2,
  AlertTriangle,
  Sparkles,
  CreditCard,
  BarChart3,
  Link as LinkIcon,
  Copy,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import Swal from 'sweetalert2';
import api from '@/lib/apiClient';
import useApi from '@/lib/useApi';
import { formatCurrency, formatDate, statusColor, humanizeStatus } from '@/lib/formatters';
import type { Subscription, SubscriptionPlan, SubscriptionLimits, SubscriptionTier, BillingInterval } from '@/lib/types';
import { useToast } from '../App';

const TIER_ICONS: Record<string, React.ReactNode> = {
  FREE: <Shield className="w-6 h-6 text-[#6B655C]" />,
  TRIAL: <Sparkles className="w-6 h-6 text-[#C9A05C]" />,
  BASIC: <Star className="w-6 h-6 text-sky-500" />,
  PROFESSIONAL: <Zap className="w-6 h-6 text-[#C9A05C]" />,
  ENTERPRISE: <Crown className="w-6 h-6 text-amber-500" />,
};

const TIER_COLORS: Record<string, string> = {
  FREE: 'border-[rgba(201,160,92,0.12)] bg-[#1C1C26]',
  TRIAL: 'border-[#C9A05C]/50 bg-[#C9A05C]/10',
  BASIC: 'border-sky-200 bg-sky-50',
  PROFESSIONAL: 'border-[rgba(201,160,92,0.2)] bg-[#C9A05C]/10',
  ENTERPRISE: 'border-amber-200 bg-amber-50',
};

interface SubscriptionManagerProps {
  branchId: string | null;
  onSubscriptionChange?: () => void;
}

const CANCEL_REASONS = [
  'Too expensive - Not enough value for the price',
  'Found a cheaper alternative',
  'No longer need the service',
  'Switching to another service',
  'Missing features I need',
  'Financial constraints',
  'Change in priorities',
  'Personal circumstances',
  'Others',
] as const;

export function SubscriptionManager({ branchId: _branchId, onSubscriptionChange }: SubscriptionManagerProps) {
  const { showToast } = useToast();

  // â”€â”€ State â”€â”€
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showChangeDialog, setShowChangeDialog] = useState(false);
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [cancelReason, setCancelReason] = useState<string>('');
  const [cancelReasonOther, setCancelReasonOther] = useState('');
  const [creating, setCreating] = useState(false);
  const [paymentStatus, setPaymentStatus] = useState<any>(null);
  const [pollingPaymentStatus, setPollingPaymentStatus] = useState(false);
  const [autoRenewUpdating, setAutoRenewUpdating] = useState(false);
  // Create form
  const [createForm, setCreateForm] = useState({
    tier: 'BASIC' as SubscriptionTier,
    billingInterval: 'MONTHLY' as BillingInterval,
    billingEmail: '',
    trialAutoChargeConsent: false,
  });

  // Change tier
  const [changeTier, setChangeTier] = useState<SubscriptionTier>('PROFESSIONAL');

  // â”€â”€ Data â”€â”€
  const { data: currentSub, loading: _subLoading, refetch: refetchSub } = useApi<Subscription>('/subscriptions/current');
  const { data: plans, loading: _plansLoading } = useApi<SubscriptionPlan[]>('/subscriptions/plans');
  const { data: limits, refetch: refetchLimits } = useApi<SubscriptionLimits>('/subscriptions/limits');

  const plansList: SubscriptionPlan[] = Array.isArray(plans) ? plans : [];

  const refetchAll = useCallback(() => {
    refetchSub();
    refetchLimits();
    onSubscriptionChange?.();
  }, [refetchSub, refetchLimits, onSubscriptionChange]);

  const handleToggleAutoRenew = async (next: boolean) => {
    setAutoRenewUpdating(true);
    try {
      await api.patch('/subscriptions', { autoRenew: next });
      showToast(next ? 'Auto-renew enabled' : 'Auto-renew disabled', 'success');
      refetchAll();
    } catch (err: unknown) {
      showToast((err instanceof Error ? err.message : String(err)) || 'Failed to update auto-renew', 'error');
      refetchAll();
    } finally {
      setAutoRenewUpdating(false);
    }
  };

  // â”€â”€ Handlers â”€â”€
  const handleCreate = async () => {
    if (!createForm.billingEmail.trim()) {
      showToast('Billing email is required to continue to checkout.', 'error');
      return;
    }

    setCreating(true);
    try {
      const res = await api.post('/subscriptions', {
        tier: createForm.tier,
        billingInterval: createForm.billingInterval,
        billingEmail: createForm.billingEmail || undefined,
        trialAutoChargeConsent: createForm.trialAutoChargeConsent,
      }) as any;
      setShowCreateDialog(false);

      // If checkout URL was returned, redirect to complete payment
      if (res?.checkoutUrl) {
        showToast('Redirecting to payment...', 'success');
        window.open(res.checkoutUrl, '_blank', 'noopener');
      } else {
        showToast(
          res?.paymentError ||
            res?.checkoutError ||
            'Subscription was created, but no checkout URL was returned.',
          'error',
        );
      }
      refetchAll();
    } catch (err: unknown) {
      showToast((err instanceof Error ? err.message : String(err)) || 'Failed to create subscription', 'error');
    } finally {
      setCreating(false);
    }
  };

  const handleChangeTier = async () => {
    if (currentSub && currentSub.canChangeTier === false) {
      showToast(
        'Plan changes are available after the current subscription period ends.',
        'error',
      );
      return;
    }

    try {
      const res = await api.post('/subscriptions/change-tier', { tier: changeTier }) as any;

      // If checkout URL returned, redirect to payment (trial→paid flow)
      if (res?.checkoutUrl) {
        showToast('Complete payment to activate your new plan.', 'success');
        window.open(res.checkoutUrl, '_blank', 'noopener');
        setShowChangeDialog(false);
        refetchAll();
        return;
      }

      if (res?.paymentError) {
        showToast(res.paymentError, 'error');
        return;
      }

      showToast(`Plan changed to ${changeTier}`, 'success');
      setShowChangeDialog(false);
      refetchAll();
    } catch (err: unknown) {
      showToast((err instanceof Error ? err.message : String(err)) || 'Failed to change tier', 'error');
    }
  };

  const handleGenerateCheckout = async () => {
    try {
      const res = await api.post('/subscriptions/generate-checkout', {
        billingEmail: createForm.billingEmail || undefined,
      }) as any;

      if (res?.checkoutUrl) {
        showToast('Redirecting to payment...', 'success');
        window.open(res.checkoutUrl, '_blank', 'noopener');
        refetchAll();
        return;
      }

      showToast(
        res?.paymentError || res?.checkoutError || 'No payment link was generated.',
        'error',
      );
    } catch (err: unknown) {
      showToast((err instanceof Error ? err.message : String(err)) || 'Failed to generate payment link', 'error');
    }
  };

  const handleCopyCheckoutLink = async () => {
    const checkoutUrl =
      paymentStatus?.checkoutUrl ||
      (currentSub as any)?.checkoutUrl ||
      null;

    if (!checkoutUrl) {
      showToast('No checkout link available to copy.', 'error');
      return;
    }

    try {
      await navigator.clipboard.writeText(String(checkoutUrl));
      showToast('Payment link copied.', 'success');
    } catch {
      showToast('Unable to copy link. Please open checkout directly.', 'error');
    }
  };

  const pollPaymentLinkStatus = useCallback(async () => {
    try {
      const status = await api.get('/subscriptions/payment-link-status') as any;
      setPaymentStatus(status);

      if (String(status?.status || '').toLowerCase() === 'paid') {
        showToast('Payment confirmed. Subscription is now active.', 'success');
        refetchAll();
      }
    } catch {
      // Keep UX non-blocking if status endpoint is temporarily unavailable.
    }
  }, [refetchAll, showToast]);

  useEffect(() => {
    if (!currentSub?.canCompletePayment) {
      setPollingPaymentStatus(false);
      return;
    }

    setPollingPaymentStatus(true);
    void pollPaymentLinkStatus();
    const timer = window.setInterval(() => {
      void pollPaymentLinkStatus();
    }, 12000);

    return () => {
      window.clearInterval(timer);
      setPollingPaymentStatus(false);
    };
  }, [currentSub?.canCompletePayment, pollPaymentLinkStatus]);

  const handleCancel = async () => {
    const selectedReason = cancelReason.trim();
    if (!selectedReason) {
      showToast('Please select a cancellation reason.', 'error');
      return;
    }

    const isOthers = selectedReason === 'Others';
    const details = cancelReasonOther.trim();

    if (isOthers && details.length < 3) {
      showToast('Please specify your reason under Others.', 'error');
      return;
    }

    const finalReason = isOthers ? `Others: ${details}` : selectedReason;

    const confirm = await Swal.fire({
      icon: 'warning',
      title: 'Cancel Subscription?',
      html: `Your <b>${currentPlanLabel}</b> subscription will be cancelled immediately and you will lose access to paid features.${isTrialSubscription ? ' You will not be charged.' : ''}<br/><br/><span class="text-sm text-[#6B655C]">Reason: ${finalReason}</span>`,
      showCancelButton: true,
      confirmButtonText: 'Yes, cancel it',
      cancelButtonText: 'Keep my plan',
      confirmButtonColor: '#dc2626',
      cancelButtonColor: '#6B655C',
    });

    if (!confirm.isConfirmed) return;

    try {
      await api.post('/subscriptions/cancel', { reason: finalReason });
      showToast('Subscription cancelled. Trial access has ended.', 'success');
      setShowCancelDialog(false);
      setCancelReason('');
      setCancelReasonOther('');
      refetchAll();
    } catch (err: unknown) {
      showToast((err instanceof Error ? err.message : String(err)) || 'Failed to cancel', 'error');
    }
  };

  const currentTier = (currentSub as any)?.tier ?? 'FREE';
  const isFreeTier = currentTier === 'FREE' && !currentSub?.id;
  const isTrialSubscription = String(currentSub?.status || '').toUpperCase() === 'TRIAL';
  const isAwaitingPaymentAuthorization =
    String(currentSub?.status || '').toUpperCase() === 'PAST_DUE';
  const isSubscriptionClosed =
    String(currentSub?.status || '').toUpperCase() === 'CANCELLED' ||
    String(currentSub?.status || '').toUpperCase() === 'EXPIRED';
  const currentPlanLabel = isTrialSubscription ? 'TRIAL' : currentTier;
  const plansForDisplay = plansList.filter((p) => p.tier !== 'FREE');
  const checkoutUrl =
    paymentStatus?.checkoutUrl ||
    (currentSub as any)?.checkoutUrl ||
    null;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black text-[#EAE2D6] tracking-tight">Subscription & Billing</h1>
          <p className="text-[#6B655C] mt-1">Manage your pawnshop's SaaS subscription plan</p>
          <p className="text-xs text-[#6B655C] mt-2">
            Owner billing is consolidated per pawnshop. One payment covers the main branch and all connected active branches.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={refetchAll}>
          <RefreshCw className="w-4 h-4 mr-2" /> Refresh
        </Button>
      </div>

      {/* Current Plan Card */}
      <Card className={`border-2 ${TIER_COLORS[currentTier] || 'border-[rgba(201,160,92,0.12)]'}`}>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-2xl bg-[#14141B] shadow-sm">
                {TIER_ICONS[currentTier] || TIER_ICONS.FREE}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-2xl font-black text-[#EAE2D6]">{currentPlanLabel} Plan</h2>
                  {currentSub?.status && (
                    <Badge className={statusColor(currentSub.status)}>{humanizeStatus(currentSub.status)}</Badge>
                  )}
                </div>
                {currentSub?.currentPeriodEnd && !isTrialSubscription && (
                  <div className="flex items-center gap-3 mt-1 flex-wrap">
                    <p className="text-sm text-[#6B655C]">
                      {currentSub.billingInterval} · Renews {formatDate(currentSub.currentPeriodEnd)}
                    </p>
                    {!isFreeTier && !isSubscriptionClosed && (
                      <label className="flex items-center gap-2 cursor-pointer select-none">
                        <Switch
                          checked={currentSub.autoRenew !== false}
                          onCheckedChange={(v) => void handleToggleAutoRenew(v)}
                          disabled={autoRenewUpdating}
                        />
                        <span className="text-xs text-[#6B655C]">
                          {autoRenewUpdating ? 'Saving…' : 'Auto-renew'}
                        </span>
                      </label>
                    )}
                  </div>
                )}
                {!isTrialSubscription && currentSub?.trialEndsAt && new Date(currentSub.trialEndsAt) > new Date() && (
                  <p className="text-sm text-[#C9A05C] font-medium mt-1">
                    <Sparkles className="w-4 h-4 inline mr-1" />
                    Trial ends {formatDate(currentSub.trialEndsAt)}
                  </p>
                )}
                {isTrialSubscription && currentSub?.trialEndsAt && new Date(currentSub.trialEndsAt) > new Date() && (
                  <p className="text-xs text-amber-700 font-semibold mt-2">
                    Trial ends {formatDate(currentSub.trialEndsAt)}. Upgrade to a paid plan anytime to continue.
                  </p>
                )}
                {isFreeTier && (
                  <p className="text-sm text-[#6B655C] mt-1">No trial or paid subscription is active yet.</p>
                )}
                {isAwaitingPaymentAuthorization && (
                  <p className="text-xs text-amber-700 font-semibold mt-2">
                    Awaiting payment authorization. Your subscription will activate only after payment is confirmed.
                  </p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-3">
              {isTrialSubscription ? (
                <div className="text-right">
                  <p className="text-3xl font-black text-[#EAE2D6]">Free</p>
                  <p className="text-xs text-[#6B655C]">15-day trial</p>
                </div>
              ) : currentSub?.currentPrice != null && (
                <div className="text-right">
                  <p className="text-3xl font-black text-[#EAE2D6]">{formatCurrency(currentSub.currentPrice)}</p>
                  <p className="text-xs text-[#6B655C]">/{(currentSub.billingInterval || 'MONTHLY').toLowerCase()}</p>
                </div>
              )}
            </div>
          </div>

          <div className="flex gap-3 mt-6">
            {isFreeTier ? (
              <Button onClick={() => setShowCreateDialog(true)} className="bg-[#C9A05C] hover:bg-[#E5C88C]">
                <Sparkles className="w-4 h-4 mr-2" /> Subscribe
              </Button>
            ) : (
              <>
                {currentSub?.canCompletePayment && (
                  <div className="flex items-center gap-2 flex-wrap">
                    <Button
                      className="bg-emerald-600 hover:bg-emerald-700"
                      onClick={handleGenerateCheckout}
                    >
                      <CreditCard className="w-4 h-4 mr-2" />
                      {(currentSub as any)?.checkoutUrl ? 'Open Payment Link' : 'Generate Payment Link'}
                    </Button>
                    <Button variant="outline" onClick={() => void pollPaymentLinkStatus()}>
                      {pollingPaymentStatus ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <RefreshCw className="w-4 h-4" />
                      )}
                    </Button>
                  </div>
                )}
                <Button
                  variant="outline"
                  onClick={() => setShowChangeDialog(true)}
                  disabled={currentSub?.canChangeTier === false}
                  title={
                    currentSub?.canChangeTier === false
                      ? 'You can switch plans after the current period ends.'
                      : undefined
                  }
                >
                  <ArrowUpCircle className="w-4 h-4 mr-2" /> Change Plan
                </Button>
                <Button variant="ghost" className="text-rose-600" onClick={() => setShowCancelDialog(true)}>
                  <XCircle className="w-4 h-4 mr-2" /> Cancel
                </Button>
              </>
            )}
          </div>
          {!isFreeTier && currentSub?.canCompletePayment === false && currentSub?.completePaymentReason && (
            <p className="text-xs text-[#6B655C] mt-2">{currentSub.completePaymentReason}</p>
          )}
          {isAwaitingPaymentAuthorization && currentSub?.canCompletePayment && (
            <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
              <p className="text-xs font-semibold text-amber-800">
                Payment pending authorization
              </p>
              <p className="text-[11px] text-amber-700 mt-1">
                Open the checkout page and complete authorization to activate your subscription.
              </p>
            </div>
          )}
          {currentSub?.canCompletePayment && paymentStatus && (
            <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2">
              <p className="text-xs font-semibold text-emerald-800">
                Payment Link Status: {humanizeStatus(String(paymentStatus.status || 'pending'))}
              </p>
              {paymentStatus.amount != null && (
                <p className="text-xs text-emerald-700 mt-1">
                  Amount: {formatCurrency(paymentStatus.amount)} {paymentStatus.currency || 'PHP'}
                </p>
              )}
              <p className="text-[11px] text-emerald-700 mt-1">
                Open the payment link and complete authorization. Status updates automatically.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    if (!checkoutUrl) {
                      showToast('No checkout link available yet.', 'error');
                      return;
                    }
                    window.open(String(checkoutUrl), '_blank', 'noopener');
                  }}
                >
                  <LinkIcon className="w-4 h-4 mr-2" />
                  Open Checkout Page
                </Button>
                <Button size="sm" variant="outline" onClick={handleCopyCheckoutLink}>
                  <Copy className="w-4 h-4 mr-2" />
                  Copy Payment Link
                </Button>
              </div>
              {checkoutUrl && (
                <div className="mt-3">
                  <p className="text-[11px] text-emerald-700 mb-1 font-semibold">
                    Manual typing fallback (phone browser):
                  </p>
                  <Input
                    readOnly
                    value={String(checkoutUrl)}
                    className="bg-[#14141B] text-[11px] font-mono"
                  />
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Usage Limits */}
      {limits && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <BarChart3 className="w-5 h-5" /> Usage & Limits
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {Object.entries(limits.limits || {}).map(([key, max]) => {
                const used = (limits.usage as any)?.[key] ?? 0;
                const isUnlimited = max === null;
                const pct = isUnlimited ? 0 : max ? (used / (max as number) * 100) : 0;
                const isNearLimit = pct >= 80;
                const isExceeded = !isUnlimited && max != null && used > (max as number);
                return (
                  <div key={key} className="p-4 bg-[#1C1C26] rounded-xl">
                    <p className="text-xs text-[#6B655C] capitalize">{key.replace(/_/g, ' ')}</p>
                    <div className="flex items-baseline gap-1 mt-1">
                      <span className={`text-lg font-black ${isExceeded ? 'text-rose-600' : 'text-[#EAE2D6]'}`}>{used}</span>
                      <span className="text-sm text-[#6B655C]">/ {isUnlimited ? 'Unlimited' : max}</span>
                    </div>
                    {!isUnlimited && (
                      <div className="mt-2 h-1.5 bg-[#222228] rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${isExceeded ? 'bg-rose-500' : isNearLimit ? 'bg-amber-500' : 'bg-[#C9A05C]'}`}
                          style={{ width: `${Math.min(pct, 100)}%` }}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {limits.exceededLimits && limits.exceededLimits.length > 0 && (
              <div className="mt-4 p-3 bg-rose-50 rounded-xl flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-500" />
                <p className="text-sm text-rose-700">
                  You've exceeded: <span className="font-bold">{limits.exceededLimits.join(', ')}</span>. Upgrade to continue using these features.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Plans Comparison */}
      <div>
        <h2 className="text-xl font-bold text-[#EAE2D6] mb-4">Available Plans</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {plansForDisplay.map((plan) => {
            const isCurrentPlan = plan.tier === currentTier && !isTrialSubscription;
            const isTrialPlan = isTrialSubscription && plan.tier === currentTier;
            return (
              <Card
                key={plan.tier}
                className={`relative overflow-hidden ${isCurrentPlan ? 'border-2 border-indigo-500 shadow-xl' : isTrialPlan ? 'border-2 border-[#C9A05C]/60 shadow-xl' : 'border border-[rgba(201,160,92,0.12)]'}`}
              >
                {(isCurrentPlan || isTrialPlan) && (
                  <div className="absolute top-0 left-0 right-0 bg-[#C9A05C] text-white text-center text-[10px] font-black py-1 uppercase tracking-widest">
                    {isTrialPlan ? 'Current Trial' : 'Current Plan'}
                  </div>
                )}
                <CardContent className={`pt-${isCurrentPlan || isTrialPlan ? '10' : '6'}`}>
                  <div className="flex items-center gap-2 mb-3">
                    {TIER_ICONS[plan.tier]}
                    <h3 className="font-black text-lg">{plan.name || plan.tier}</h3>
                  </div>
                  {plan.tier === 'TRIAL' ? (
                    <p className="text-3xl font-black text-[#EAE2D6]">
                      Free
                      <span className="text-sm text-[#6B655C] font-normal ml-2">15-day trial</span>
                    </p>
                  ) : plan.tier !== 'FREE' && (
                    <p className="text-3xl font-black text-[#EAE2D6]">
                      {formatCurrency(plan.monthlyPrice)}
                      <span className="text-sm text-[#6B655C] font-normal">/mo</span>
                    </p>
                  )}
                  {plan.description && (
                    <p className="text-sm text-[#6B655C] mt-2">{plan.description}</p>
                  )}
                  {plan.tagline && (
                    <p className="text-xs text-[#999186] mt-1 italic">{plan.tagline}</p>
                  )}
                  {isTrialPlan && (
                    <p className="text-xs text-amber-700 font-semibold mt-2">
                      You're on this plan free for 15 days — you'll only be billed if you upgrade after the trial ends.
                    </p>
                  )}

                  <div className="mt-4 space-y-2">
                    {Object.entries(plan.features || {}).map(([feature, enabled]) => {
                      const featureLabels: Record<string, string> = {
                        pawn_ticketing: 'Pawn Ticketing & Loans',
                        loan_management: 'Loan Lifecycle Management',
                        basic_analytics: 'Basic Analytics Dashboard',
                        advanced_analytics: 'Advanced Analytics & Reports',
                        queue_management: 'Customer Queue Management',
                        auction_access: 'Auction House Access',
                        api_access: 'API Access for Integrations',
                        priority_support: 'Priority Support',
                        custom_branding: 'Custom Branding & White-label',
                      };
                      return (
                        <div key={feature} className="flex items-center gap-2 text-sm">
                          {enabled ? (
                            <Check className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                          ) : (
                            <XCircle className="w-4 h-4 text-slate-300 flex-shrink-0" />
                          )}
                          <span className={enabled ? 'text-[#6B655C]' : 'text-slate-400'}>
                            {featureLabels[feature] || feature.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  {plan.limits && (
                    <div className="mt-3 pt-3 border-t">
                      {Object.entries(plan.limits).map(([key, val]) => {
                        if (val === null && key !== 'daily_transaction_limit') return null;
                        const limitLabels: Record<string, string> = {
                          max_branches: 'Branches',
                          max_staff: 'Staff Members',
                          max_transactions: 'Transactions/mo',
                          daily_transaction_limit: 'Transactions/day',
                        };
                        const label = limitLabels[key] || key.replace(/_/g, ' ');
                        if (plan.tier === 'FREE') return null;
                        if (plan.tier !== 'TRIAL' && key === 'daily_transaction_limit') return null;
                        return (
                          <div key={key} className="flex justify-between text-xs text-[#6B655C]">
                            <span>{label}</span>
                            <span className="font-mono">{val === null ? 'Unlimited' : val}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {plan.tier !== 'TRIAL' && plan.tier !== 'FREE' && !isCurrentPlan && !isTrialPlan && (
                    <Button
                      className="w-full mt-4"
                      variant={plan.tier === 'ENTERPRISE' ? 'default' : 'outline'}
                      disabled={!isFreeTier && currentSub?.canChangeTier === false}
                      onClick={() => {
                        if (isFreeTier) {
                          setCreateForm({ ...createForm, tier: plan.tier });
                          setShowCreateDialog(true);
                        } else {
                          setChangeTier(plan.tier);
                          setShowChangeDialog(true);
                        }
                      }}
                    >
                      {isFreeTier ? 'Subscribe' : (
                        ['FREE', 'TRIAL', 'BASIC'].includes(currentTier) && ['PROFESSIONAL', 'ENTERPRISE'].includes(plan.tier) ? 'Upgrade' : 'Switch'
                      )}
                    </Button>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      {/* Billing History */}
      {currentSub?.payments && currentSub.payments.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <CreditCard className="w-5 h-5" /> Billing History
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {currentSub.payments.map((payment) => (
                <div key={payment.id} className="flex items-center justify-between py-2 border-b border-[rgba(201,160,92,0.08)] last:border-0">
                  <div>
                    <p className="font-mono text-sm">{formatCurrency(payment.amount)}</p>
                    <p className="text-xs text-[#6B655C]">{formatDate(payment.paidAt || payment.createdAt)}</p>
                  </div>
                  <Badge className={statusColor(payment.status)}>{humanizeStatus(payment.status)}</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Create Subscription Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Start Subscription</DialogTitle>
            <DialogDescription>
              Choose a paid plan to continue after your trial ends.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <label className="text-sm font-medium text-[#6B655C]">Plan</label>
              <Select value={createForm.tier} onValueChange={(v) => setCreateForm({ ...createForm, tier: v as SubscriptionTier })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(['BASIC', 'PROFESSIONAL', 'ENTERPRISE'] as SubscriptionTier[]).map((t) => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium text-[#6B655C]">Billing Interval</label>
              <Select value={createForm.billingInterval} onValueChange={(v) => setCreateForm({ ...createForm, billingInterval: v as BillingInterval })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="MONTHLY">Monthly</SelectItem>
                  <SelectItem value="QUARTERLY">Quarterly (5% off)</SelectItem>
                  <SelectItem value="ANNUALLY">Annual (10% off)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium text-[#6B655C]">Billing Email</label>
              <Input
                type="email"
                placeholder="billing@company.com"
                value={createForm.billingEmail}
                onChange={(e) => setCreateForm({ ...createForm, billingEmail: e.target.value })}
              />
            </div>
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-3">
              <label className="flex items-start gap-2 text-sm text-amber-900">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4"
                  checked={createForm.trialAutoChargeConsent}
                  onChange={(e) =>
                    setCreateForm({
                      ...createForm,
                      trialAutoChargeConsent: e.target.checked,
                    })
                  }
                />
                <span>
                  I understand that after trial, my subscription is automatically charged based on the selected billing interval. I can cancel before trial ends to avoid being charged.
                </span>
              </label>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={handleCreate} disabled={creating || !createForm.trialAutoChargeConsent}>
              {creating ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Sparkles className="w-4 h-4 mr-2" />}
              Subscribe & Pay
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Change Tier Dialog */}
      <Dialog open={showChangeDialog} onOpenChange={setShowChangeDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Change Plan</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <label className="text-sm font-medium text-[#6B655C]">New Tier</label>
            <Select value={changeTier} onValueChange={(v) => setChangeTier(v as SubscriptionTier)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {(['BASIC', 'PROFESSIONAL', 'ENTERPRISE'] as SubscriptionTier[]).filter((t) => t !== currentTier).map((t) => (
                  <SelectItem key={t} value={t}>{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {isTrialSubscription && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-3">
              <p className="text-sm text-amber-900 font-semibold">Payment required to activate</p>
              <p className="text-xs text-amber-700 mt-1">
                Your trial will end permanently once payment is confirmed. You must complete payment before the new plan becomes active.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button onClick={handleChangeTier}>
              <ArrowUpCircle className="w-4 h-4 mr-2" /> {isTrialSubscription ? 'Pay & Activate Plan' : 'Change Plan (Next Billing)'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel Dialog */}
      <Dialog open={showCancelDialog} onOpenChange={setShowCancelDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-rose-600">Cancel Subscription</DialogTitle>
            <DialogDescription>
              Cancellation is immediate and stops automatic renewal. If you cancel before trial end, you will not be charged.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <label className="text-sm font-medium text-[#6B655C]">Cancellation Reason</label>
            <Select value={cancelReason || undefined} onValueChange={(value) => {
              setCancelReason(value);
              if (value !== 'Others') {
                setCancelReasonOther('');
              }
            }}>
              <SelectTrigger>
                <SelectValue placeholder="Select reason" />
              </SelectTrigger>
              <SelectContent>
                {CANCEL_REASONS.map((reason) => (
                  <SelectItem key={reason} value={reason}>{reason}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {cancelReason === 'Others' && (
              <Input
                value={cancelReasonOther}
                onChange={(e) => setCancelReasonOther(e.target.value)}
                placeholder="Please specify"
                minLength={3}
                maxLength={500}
              />
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCancelDialog(false)}>Keep Plan</Button>
            <Button
              variant="destructive"
              onClick={handleCancel}
              disabled={!cancelReason || (cancelReason === 'Others' && cancelReasonOther.trim().length < 3)}
            >
              <XCircle className="w-4 h-4 mr-2" /> Cancel Subscription
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default SubscriptionManager;
