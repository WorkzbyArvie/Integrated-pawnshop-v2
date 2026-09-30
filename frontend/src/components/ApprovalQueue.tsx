import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  FileText,
  Loader2,
  RefreshCw,
  Search,
} from 'lucide-react';
import api from '../lib/apiClient';
import { supabase } from '../lib/supabaseClient';
import { formatCurrency, formatDateTime, humanizeStatus, statusColor } from '../lib/formatters';
import { getDisplayableStorageUrl } from '../lib/storageUrls';
import { useToast } from '../App';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { Input } from './ui/input';
import { Skeleton } from './ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { Tabs, TabsList, TabsTrigger } from './ui/tabs';
import { ContractViewer } from './ContractViewer';
import {
  DeclineReasonPicker,
  DECLINE_REASON_SETS,
  formatDeclineReason,
  isDeclineReasonComplete,
  type DeclineReason,
} from './DeclineReasonPicker';

interface ApprovalQueueItem {
  id: number;
  targetType: 'APPRAISAL' | 'REDEMPTION' | 'LISTING_EDIT';
  targetId?: number | string;
  status?: string;
  amount?: number;
  createdAt?: string;
  ticketNumber?: string;
  itemName?: string;
  photoUrls?: string[];
  category?: string;
  weight?: string | number;
  customer?: { fullName?: string; contactNumber?: string; loyaltyTier?: string };
  requestedBy?: { id?: string; fullName?: string };
  decidedBy?: { id?: string; fullName?: string };
  decidedAt?: string;
  appraisedValue?: number;
  recommendedLoanAmount?: number;
  riskScore?: number;
  isHighRisk?: boolean;
  appraisalNotes?: string;
  amountPaid?: number;
  threshold?: number;
  decisionComment?: string;
  payload?: Record<string, unknown>;
  listingTitle?: string | null;
  listingId?: number | null;
  listingEdit?: {
    itemCondition?: string | null;
    itemSpecifications?: string | null;
    provenanceDetails?: string | null;
    disclosureNotes?: string | null;
    previous?: {
      itemCondition?: string | null;
      itemSpecifications?: string | null;
      provenanceDetails?: string | null;
      disclosureNotes?: string | null;
    };
  } | null;
}

interface ApprovalQueueProps {
  branchId?: string | null;
  activeBranchId?: number | null;
  userRole?: string;
}

const ticketNumber = (item: ApprovalQueueItem): string =>
  item.ticketNumber ?? String(item.payload?.ticketNumber ?? `#${item.id}`);

/**
 * The figure a reviewer decides on.
 *
 * This read `item.amount`, a field the endpoint does not return - every branch
 * fell through to `0`, so every appraisal in the queue showed ₱0.00 while the
 * review dialog beside it showed the real valuation. The endpoint returns
 * `appraisedValue` (the valuation) and `recommendedLoanAmount` (the ask), and
 * `amountPaid` for a redemption. The recommendation is what gets approved, so
 * it wins; the valuation is the fallback.
 */
const itemAmount = (item: ApprovalQueueItem): number => {
  const candidates = [
    item.recommendedLoanAmount,
    item.amountPaid,
    item.appraisedValue,
    item.amount,
    item.payload?.recommendedLoanAmount,
    item.payload?.amount,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'number' && Number.isFinite(candidate) && candidate > 0) {
      return candidate;
    }
  }
  return 0;
};

const customerName = (item: ApprovalQueueItem): string =>
  item.customer?.fullName ?? item.requestedBy?.fullName ?? '—';

const itemSummary = (item: ApprovalQueueItem): string => {
  const parts: string[] = [];
  if (item.itemName) parts.push(item.itemName);
  if (item.category) parts.push(item.category);
  if (item.weight !== undefined && item.weight !== null && item.weight !== '') {
    parts.push(String(item.weight));
  }
  return parts.join(' • ') || '—';
};

export function ApprovalQueue({ branchId, activeBranchId, userRole }: ApprovalQueueProps) {
  const { showToast } = useToast();
  const effectiveBranchId =
    branchId ??
    (activeBranchId != null ? String(activeBranchId) : null) ??
    localStorage.getItem('active_pawnshop_id');
  const [activeTab, setActiveTab] = useState('APPRAISAL');
  const [records, setRecords] = useState<ApprovalQueueItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [processingId, setProcessingId] = useState<number | null>(null);
  const [reviewItem, setReviewItem] = useState<ApprovalQueueItem | null>(null);
  const [reviewDeclineReason, setReviewDeclineReason] = useState<DeclineReason>(null);
  const [reviewDeclineOpen, setReviewDeclineOpen] = useState(false);
  const [reviewPhotoIndex, setReviewPhotoIndex] = useState(0);
  const [reviewPhotoSrc, setReviewPhotoSrc] = useState<string | null>(null);
  const [reviewPhotoFailed, setReviewPhotoFailed] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [contractHandoff, setContractHandoff] = useState<{ applicationId?: string; contractId?: string; loanId?: number } | null>(null);
  const [disbursing, setDisbursing] = useState(false);

  const rawRole = (userRole ?? 'OWNER').trim().toUpperCase().replace(/[\s-]+/g, '_');
  const canonicalRole = rawRole === 'BRANCH_ADMIN' ? 'ADMIN' : rawRole;
  const isApprover = ['MANAGER', 'OWNER', 'ADMIN', 'SUPER_ADMIN'].includes(canonicalRole);
  const canSelfApprove = ['OWNER', 'SUPER_ADMIN'].includes(canonicalRole);

  const loadQueue = useCallback(
    async (tab: string) => {
      if (!effectiveBranchId) {
        setRecords([]);
        setIsLoading(false);
        return;
      }
      setIsLoading(true);
      setError(null);
      try {
        const params: Record<string, string> =
          tab === 'DECIDED'
            ? { pawnshopId: effectiveBranchId, status: 'DECIDED' }
            : { pawnshopId: effectiveBranchId, type: tab };
        const result = await api.get<ApprovalQueueItem[]>('/approval-queue', params);
        setRecords(result ?? []);
      } catch (err) {
        setRecords([]);
        const message = err instanceof Error ? err.message : 'Failed to load approval queue';
        setError(message);
        showToast(message, 'error');
      } finally {
        setIsLoading(false);
      }
    },
    [effectiveBranchId],
  );

  useEffect(() => {
    void loadQueue(activeTab);
  }, [activeTab, loadQueue]);

  useEffect(() => {
    let cancelled = false;
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!cancelled) setCurrentUserId(data.session?.user?.id ?? null);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const urls = reviewItem?.photoUrls ?? [];
    const url = urls[reviewPhotoIndex];
    setReviewPhotoFailed(false);
    setReviewPhotoSrc(null);
    if (!url) return;
    getDisplayableStorageUrl(url)
      .then((resolved) => setReviewPhotoSrc(resolved))
      .catch(() => setReviewPhotoFailed(true));
  }, [reviewItem, reviewPhotoIndex]);

  const handleApprove = async (id: number) => {
    if (processingId !== null) return;
    setProcessingId(id);
    try {
      const result = await api.post<Record<string, unknown>>(`/approval-queue/${id}/approve`, {
        decisionComment: '',
      });
      const applicationId = result?.applicationId as string | undefined;
      const contractId = result?.contractId as string | undefined;
      const loanId = result?.loanId as number | undefined;
      const isRedemption = records.some(
        (record) => record.id === id && record.targetType === 'REDEMPTION',
      );
      const isListingEdit = records.some(
        (record) => record.id === id && record.targetType === 'LISTING_EDIT',
      );
      if (applicationId || contractId) {
        // The review dialog must close before the contract opens. Both are
        // overlays; leaving this one mounted stacked two dialogs on top of each
        // other, and because they shared a z-index the contract rendered behind
        // the still-open review - so approving appeared to do nothing.
        setReviewItem(null);
        setReviewDeclineReason(null);
        setReviewDeclineOpen(false);
        setContractHandoff({ applicationId, contractId, loanId });
      } else {
        // No contract to sign - a redemption releases the item, an auction edit
        // just applies. Nothing replaces this dialog, so leaving it mounted
        // strands the reviewer on an already-decided request with live buttons.
        setReviewItem(null);
        setReviewDeclineReason(null);
        setReviewDeclineOpen(false);
      }
      showToast(
        isRedemption
          ? 'Redemption approved — item released'
          : isListingEdit
            ? 'Auction listing edit approved and applied'
            : Boolean(result?.resumed)
              ? 'Resuming contract signing'
              : 'Contract generated — sign to continue',
        'success',
      );
      await loadQueue(activeTab);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to approve request', 'error');
    } finally {
      setProcessingId(null);
    }
  };

  const handleDecline = async (id: number, reason: DeclineReason) => {
    if (processingId !== null) return;
    if (!isDeclineReasonComplete(reason)) return;
    setProcessingId(id);
    try {
      await api.post(`/approval-queue/${id}/reject`, {
        decisionComment: formatDeclineReason(reason),
      });
      showToast('Request declined', 'success');
      setReviewItem(null);
      await loadQueue(activeTab);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to decline request', 'error');
    } finally {
      setProcessingId(null);
    }
  };

  const handleDisburse = async () => {
    if (!contractHandoff?.loanId) return;
    setDisbursing(true);
    try {
      await api.post(`/loan/${contractHandoff.loanId}/disburse`, {});
      showToast('Loan disbursed — approval complete', 'success');
      setContractHandoff(null);
      await loadQueue(activeTab);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to disburse loan', 'error');
    } finally {
      setDisbursing(false);
    }
  };

  const visibleRecords = useMemo(() => {
    const scoped =
      activeTab === 'DECIDED'
        ? records.filter((record) => record.status !== 'PENDING')
        : records.filter((record) => record.targetType === activeTab);
    const query = searchQuery.trim().toLowerCase();
    if (!query) return scoped;
    return scoped.filter(
      (record) =>
        customerName(record).toLowerCase().includes(query) ||
        ticketNumber(record).toLowerCase().includes(query) ||
        String(record.id).includes(query),
    );
  }, [records, activeTab, searchQuery]);

  if (!isApprover) {
    return (
      <div className="p-8 text-center" style={{ color: 'var(--text-muted)' }}>
        <AlertTriangle className="w-8 h-8 mx-auto mb-3" style={{ color: 'var(--amber)' }} />
        <p className="text-sm font-bold">Access Restricted</p>
        <p className="text-xs mt-1">Only Owners, Admins, and Managers can act on pending approvals.</p>
      </div>
    );
  }

  const appraisalCount = records.filter(
    (record) => record.targetType === 'APPRAISAL' && record.status === 'PENDING',
  ).length;
  const redemptionCount = records.filter(
    (record) => record.targetType === 'REDEMPTION' && record.status === 'PENDING',
  ).length;
  const listingEditCount = records.filter(
    (record) => record.targetType === 'LISTING_EDIT' && record.status === 'PENDING',
  ).length;
  const pendingTotal = appraisalCount + redemptionCount + listingEditCount;

  const declineOptionsFor = (item: ApprovalQueueItem) =>
    item.targetType === 'REDEMPTION'
      ? DECLINE_REASON_SETS.REDEMPTION
      : item.targetType === 'LISTING_EDIT'
        ? DECLINE_REASON_SETS.LISTING_EDIT
        : DECLINE_REASON_SETS.APPRAISAL;

  const approveLabelFor = (item: ApprovalQueueItem) =>
    item.targetType === 'REDEMPTION'
      ? 'Approve & Release'
      : item.targetType === 'LISTING_EDIT'
        ? 'Approve Edit'
        : 'Approve & Generate Contract';

  const isOwnReviewRequest = Boolean(
    currentUserId && reviewItem?.requestedBy?.id === currentUserId && !canSelfApprove,
  );

  return (
    <div className="p-8 space-y-6 min-h-screen" style={{ background: 'rgba(28,28,38,0.5)' }}>
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-black text-[#C9A05C] uppercase tracking-tight">Approval Queue</h1>
          <p className="text-[10px] font-black mt-1 uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
            Review appraisals, redemptions, and auction edits pending owner sign-off
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="px-5 py-3 rounded-2xl bg-[#14141B] border border-[rgba(201,160,92,0.15)]">
            <span className="text-2xl font-black text-[#C9A05C]">{pendingTotal}</span>
            <span className="ml-2 text-[10px] font-black uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
              pending
            </span>
          </div>
          <button
            onClick={() => void loadQueue(activeTab)}
            aria-label="Refresh queue"
            className="px-4 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-2"
            style={{ background: 'rgba(201,160,92,0.1)', border: '1px solid rgba(201,160,92,0.15)', color: 'var(--gold)' }}
          >
            <RefreshCw className={`w-3 h-3 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="bg-[#14141B] border border-[rgba(201,160,92,0.1)] rounded-2xl p-1 gap-1">
          <TabsTrigger
            value="APPRAISAL"
            className="text-[10px] font-black uppercase tracking-widest px-4 py-2 data-[state=active]:bg-[#C9A05C] data-[state=active]:text-[#0A0A0F] data-[state=inactive]:text-[#8A8279] data-[state=active]:shadow-none"
          >
            Appraisal
            <Badge className="ml-2 bg-[#C9A05C]/10 text-[#C9A05C] border border-[rgba(201,160,92,0.2)]">
              {appraisalCount}
            </Badge>
          </TabsTrigger>
          <TabsTrigger
            value="REDEMPTION"
            className="text-[10px] font-black uppercase tracking-widest px-4 py-2 data-[state=active]:bg-[#C9A05C] data-[state=active]:text-[#0A0A0F] data-[state=inactive]:text-[#8A8279] data-[state=active]:shadow-none"
          >
            Redemption
            <Badge className="ml-2 bg-[#C9A05C]/10 text-[#C9A05C] border border-[rgba(201,160,92,0.2)]">
              {redemptionCount}
            </Badge>
          </TabsTrigger>
          <TabsTrigger
            value="LISTING_EDIT"
            className="text-[10px] font-black uppercase tracking-widest px-4 py-2 data-[state=active]:bg-[#C9A05C] data-[state=active]:text-[#0A0A0F] data-[state=inactive]:text-[#8A8279] data-[state=active]:shadow-none"
          >
            Auction Edits
            <Badge className="ml-2 bg-[#C9A05C]/10 text-[#C9A05C] border border-[rgba(201,160,92,0.2)]">
              {listingEditCount}
            </Badge>
          </TabsTrigger>
          <TabsTrigger
            value="DECIDED"
            className="text-[10px] font-black uppercase tracking-widest px-4 py-2 data-[state=active]:bg-[#C9A05C] data-[state=active]:text-[#0A0A0F] data-[state=inactive]:text-[#8A8279] data-[state=active]:shadow-none"
          >
            Decision History
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="flex flex-col gap-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8A8279]" />
          <Input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search by customer name or ticket number…"
            className="pl-10 bg-[#14141B] border-[rgba(201,160,92,0.12)] text-[#F5F0E8] focus:ring-2 focus:ring-[#C9A05C]/40"
          />
        </div>
        {activeTab === 'REDEMPTION' && (
          <p className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
            All redemptions require owner approval before the item is released.
          </p>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {[0, 1, 2].map((index) => (
            <Skeleton key={index} className="h-28 w-full rounded-2xl bg-[#1C1C26]" />
          ))}
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-[#D44545]/30 bg-[#1C1C26] p-6 text-center">
          <AlertTriangle className="w-6 h-6 mx-auto text-[#D44545] mb-2" />
          <p className="text-sm font-bold text-[#F5F0E8]">Could not load the approval queue</p>
          <p className="text-xs mt-1 mb-4" style={{ color: 'var(--text-muted)' }}>
            {error}
          </p>
          <Button variant="outline" onClick={() => void loadQueue(activeTab)}>
            Retry
          </Button>
        </div>
      ) : visibleRecords.length === 0 ? (
        <div className="rounded-2xl border border-[rgba(201,160,92,0.08)] bg-[#14141B] p-12 text-center">
          {activeTab === 'DECIDED' ? (
            <>
              <p className="text-lg font-black text-[#F5F0E8]">No decisions yet</p>
              <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                Approved and declined requests will appear here.
              </p>
            </>
          ) : (
            <>
              <p className="text-lg font-black text-[#F5F0E8]">All caught up!</p>
              <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                {activeTab === 'APPRAISAL'
                  ? 'No pending appraisals'
                  : activeTab === 'REDEMPTION'
                    ? 'No pending redemptions'
                    : 'No pending auction edits'}
              </p>
            </>
          )}
        </div>
      ) : activeTab === 'DECIDED' ? (
        <div className="overflow-x-auto rounded-2xl border border-[rgba(201,160,92,0.08)] bg-[#14141B]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ticket</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Submitted</TableHead>
                <TableHead>Decided by</TableHead>
                <TableHead>Decided</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleRecords.map((record) => (
                <TableRow key={record.id}>
                  <TableCell className="font-black text-[#C9A05C]">{ticketNumber(record)}</TableCell>
                  <TableCell>{record.targetType}</TableCell>
                  <TableCell>{customerName(record)}</TableCell>
                  <TableCell>{formatCurrency(itemAmount(record))}</TableCell>
                  <TableCell>
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-black uppercase ${statusColor(
                        record.status ?? '',
                      )}`}
                    >
                      {humanizeStatus(record.status ?? '')}
                    </span>
                  </TableCell>
                  <TableCell>{formatDateTime(record.createdAt)}</TableCell>
                  <TableCell>{record.decidedBy?.fullName || '—'}</TableCell>
                  <TableCell>{record.decidedAt ? formatDateTime(record.decidedAt) : '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <div className="space-y-4">
          {visibleRecords.map((record) => (
            <ApprovalRow
              key={record.id}
              record={record}
              isOwnRequest={Boolean(currentUserId && record.requestedBy?.id === currentUserId) && !canSelfApprove}
              onReview={() => {
                setReviewPhotoIndex(0);
                setReviewDeclineReason(null);
                setReviewDeclineOpen(false);
                setReviewItem(record);
              }}
            />
          ))}
        </div>
      )}

      <Dialog
        open={Boolean(reviewItem)}
        onOpenChange={(open) => {
          if (!open) {
            setReviewItem(null);
            setReviewDeclineReason(null);
            setReviewDeclineOpen(false);
          }
        }}
      >
        <DialogContent className="max-w-2xl bg-[#14141B] border border-[rgba(201,160,92,0.15)] text-[#F5F0E8] p-0 gap-0 flex flex-col max-h-[90vh] overflow-hidden">
          <DialogHeader className="px-6 pt-6 pb-4 pr-14 border-b shrink-0" style={{ borderColor: 'rgba(201,160,92,0.12)' }}>
            {reviewItem && (
              <div className="flex items-center gap-2 mb-2">
                <Badge
                  className={
                    reviewItem.targetType === 'APPRAISAL'
                      ? 'bg-[#C9A05C]/10 text-[#C9A05C] border border-[rgba(201,160,92,0.2)]'
                      : reviewItem.targetType === 'LISTING_EDIT'
                        ? 'bg-violet-500/10 text-violet-400 border border-violet-500/20'
                        : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                  }
                >
                  {reviewItem.targetType === 'LISTING_EDIT' ? 'AUCTION EDIT' : reviewItem.targetType}
                </Badge>
                <span className="text-[10px] font-black uppercase tracking-widest text-[#C9A05C]">
                  {ticketNumber(reviewItem)}
                </span>
              </div>
            )}
            <DialogTitle className="text-lg font-black uppercase tracking-tight text-[#F5F0E8] flex items-center gap-2">
              <FileText className="w-4 h-4 text-[#C9A05C]" />
              Review Request
            </DialogTitle>
            {reviewItem && (
              <p className="text-[11px] font-semibold mt-1" style={{ color: 'var(--text-muted)' }}>
                {reviewItem.requestedBy?.fullName
                  ? `Requested by ${reviewItem.requestedBy.fullName}`
                  : 'Requested by staff'}
                {reviewItem.createdAt ? ` · ${formatDateTime(reviewItem.createdAt)}` : ''}
              </p>
            )}
          </DialogHeader>

          {reviewItem && (
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5 text-sm">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="rounded-2xl p-4" style={{ background: 'rgba(255,255,255,0.035)' }}>
                  <p className="text-[10px] font-black uppercase tracking-widest mb-1" style={{ color: 'var(--text-muted)' }}>
                    Customer
                  </p>
                  <p className="font-bold text-[#F5F0E8]">{customerName(reviewItem)}</p>
                  {reviewItem.customer?.contactNumber && (
                    <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                      {reviewItem.customer.contactNumber}
                    </p>
                  )}
                </div>
                <div className="rounded-2xl p-4" style={{ background: 'rgba(255,255,255,0.035)' }}>
                  <p className="text-[10px] font-black uppercase tracking-widest mb-1" style={{ color: 'var(--text-muted)' }}>
                    Item
                  </p>
                  <p className="font-bold text-[#F5F0E8]">{itemSummary(reviewItem)}</p>
                </div>
              </div>
              {(reviewItem.photoUrls?.length ?? 0) > 0 && (
                <div className="rounded-2xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.035)' }}>
                  <div className="relative h-56 bg-[#1C1C26] flex items-center justify-center">
                    {reviewPhotoSrc && !reviewPhotoFailed ? (
                      <img
                        src={reviewPhotoSrc}
                        alt={`${ticketNumber(reviewItem)} item`}
                        className="h-full w-full object-contain"
                        onError={() => setReviewPhotoFailed(true)}
                      />
                    ) : reviewPhotoFailed ? (
                      <div className="flex flex-col items-center gap-2 p-4 text-center">
                        <AlertTriangle className="w-6 h-6 text-[#D44545]" />
                        <span className="text-[10px] font-black uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
                          Photo unavailable
                        </span>
                      </div>
                    ) : (
                      <Loader2 className="w-8 h-8 text-[#C9A05C] animate-spin" />
                    )}
                    {(reviewItem.photoUrls?.length ?? 0) > 1 && (
                      <>
                        <button
                          type="button"
                          onClick={() =>
                            setReviewPhotoIndex((index) =>
                              index <= 0 ? (reviewItem.photoUrls?.length ?? 1) - 1 : index - 1,
                            )
                          }
                          aria-label="Previous photo"
                          className="absolute left-3 top-1/2 -translate-y-1/2 h-9 w-9 rounded-full border border-white/40 bg-black/50 text-white flex items-center justify-center cursor-pointer transition-colors duration-200 hover:bg-black/70 focus-visible:ring-2 focus-visible:ring-[var(--gold)] focus-visible:outline-none"
                        >
                          <ChevronLeft className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setReviewPhotoIndex((index) =>
                              index >= (reviewItem.photoUrls?.length ?? 1) - 1 ? 0 : index + 1,
                            )
                          }
                          aria-label="Next photo"
                          className="absolute right-3 top-1/2 -translate-y-1/2 h-9 w-9 rounded-full border border-white/40 bg-black/50 text-white flex items-center justify-center cursor-pointer transition-colors duration-200 hover:bg-black/70 focus-visible:ring-2 focus-visible:ring-[var(--gold)] focus-visible:outline-none"
                        >
                          <ChevronRight className="w-4 h-4" />
                        </button>
                      </>
                    )}
                  </div>
                  {(reviewItem.photoUrls?.length ?? 0) > 1 && (
                    <p className="py-2 text-center text-[10px] font-black uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
                      Photo {reviewPhotoIndex + 1} of {reviewItem.photoUrls!.length}
                    </p>
                  )}
                </div>
              )}
              {reviewItem.targetType === 'APPRAISAL' ? (
                <ReviewValuation item={reviewItem} />
              ) : reviewItem.targetType === 'LISTING_EDIT' ? (
                <div className="rounded-2xl p-4" style={{ background: 'rgba(255,255,255,0.035)' }}>
                  <p className="text-[10px] font-black uppercase tracking-widest mb-3" style={{ color: 'var(--text-muted)' }}>
                    Requested change to auction listing
                  </p>
                  <div className="space-y-2">
                    <ListingChangeRow
                      label="Condition"
                      previous={reviewItem.listingEdit?.previous?.itemCondition}
                      next={reviewItem.listingEdit?.itemCondition}
                    />
                    <ListingChangeRow
                      label="Specifications"
                      previous={reviewItem.listingEdit?.previous?.itemSpecifications}
                      next={reviewItem.listingEdit?.itemSpecifications}
                    />
                    <ListingChangeRow
                      label="Provenance"
                      previous={reviewItem.listingEdit?.previous?.provenanceDetails}
                      next={reviewItem.listingEdit?.provenanceDetails}
                    />
                    <ListingChangeRow
                      label="Disclosures"
                      previous={reviewItem.listingEdit?.previous?.disclosureNotes}
                      next={reviewItem.listingEdit?.disclosureNotes}
                    />
                  </div>
                  <p className="text-[10px] font-semibold mt-3" style={{ color: 'var(--text-muted)' }}>
                    Changes apply to the listing after approval.
                  </p>
                </div>
              ) : (
                <div
                  className="rounded-2xl p-5"
                  style={{ background: 'rgba(201,160,92,0.08)', border: '1px solid rgba(201,160,92,0.18)' }}
                >
                  <p className="text-[10px] font-black uppercase tracking-widest mb-3" style={{ color: 'var(--gold)' }}>
                    Redemption Amount
                  </p>
                  <p
                    className="text-4xl font-black leading-none tracking-tight"
                    style={{ fontFamily: 'var(--font-display)', color: 'var(--gold)' }}
                  >
                    {formatCurrency(itemAmount(reviewItem))}
                  </p>
                  <p className="text-[11px] font-semibold mt-2" style={{ color: 'var(--text-muted)' }}>
                    Releasing this item returns the collateral to the pawner.
                  </p>
                  {typeof reviewItem.threshold === 'number' && (
                    <p className="text-[11px] font-semibold mt-1" style={{ color: 'var(--text-muted)' }}>
                      {itemAmount(reviewItem) >= reviewItem.threshold
                        ? 'At or above the owner-approval threshold — this decision is recorded against your name.'
                        : 'Below the owner-approval threshold, but a release still needs owner sign-off.'}
                    </p>
                  )}
                </div>
              )}
              {reviewItem.appraisalNotes && (
                <div className="rounded-2xl p-4" style={{ background: 'rgba(255,255,255,0.035)' }}>
                  <p className="text-[10px] font-black uppercase tracking-widest mb-1" style={{ color: 'var(--text-muted)' }}>
                    Appraisal notes
                  </p>
                  <p className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
                    {reviewItem.appraisalNotes}
                  </p>
                </div>
              )}
              {reviewItem.decisionComment && (
                <div className="rounded-2xl p-4 border border-amber-500/30" style={{ background: 'rgba(212,168,75,0.08)' }}>
                  <p className="text-[10px] font-black uppercase tracking-widest mb-1" style={{ color: 'var(--amber)' }}>
                    Decision comment
                  </p>
                  <p className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
                    {reviewItem.decisionComment}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* The decision lives in a pinned footer rather than at the end of the
              scroll area. On a long record the approve button was below the fold,
              so the dialog opened with no visible way to act on it. */}
          {reviewItem && (
            <div
              className="shrink-0 border-t px-6 py-4 space-y-4"
              style={{ borderColor: 'rgba(201,160,92,0.12)', background: 'rgba(10,10,15,0.5)' }}
            >
              {isOwnReviewRequest ? (
                <p className="text-xs font-bold text-center" style={{ color: 'var(--amber)' }}>
                  You cannot decide your own request.
                </p>
              ) : (
                <>
                  {reviewDeclineOpen && (
                    <div className="space-y-3 rounded-2xl p-4" style={{ background: 'rgba(212,69,69,0.06)' }}>
                      <DeclineReasonPicker
                        id={`decline-${reviewItem.id}`}
                        value={reviewDeclineReason}
                        onChange={setReviewDeclineReason}
                        options={declineOptionsFor(reviewItem)}
                        disabled={processingId === reviewItem.id}
                      />
                      <div className="flex items-center gap-2 flex-wrap">
                        <Button
                          variant="destructive"
                          onClick={() => void handleDecline(reviewItem.id, reviewDeclineReason)}
                          disabled={!isDeclineReasonComplete(reviewDeclineReason) || processingId === reviewItem.id}
                          className="font-black uppercase tracking-wider"
                        >
                          {processingId === reviewItem.id ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : null}
                          Confirm Decline
                        </Button>
                        <Button
                          variant="ghost"
                          onClick={() => setReviewDeclineOpen(false)}
                          disabled={processingId === reviewItem.id}
                        >
                          Cancel
                        </Button>
                      </div>
                      {!isDeclineReasonComplete(reviewDeclineReason) && (
                        <p className="text-[10px] font-semibold" style={{ color: 'var(--text-muted)' }}>
                          Select a reason to decline.
                        </p>
                      )}
                    </div>
                  )}
                  <div className="flex flex-col-reverse sm:flex-row gap-3">
                    <Button
                      variant="outline"
                      onClick={() => setReviewDeclineOpen((open) => !open)}
                      disabled={processingId === reviewItem.id}
                      className="sm:w-44 border-[#D44545]/40 text-[#D44545] hover:bg-[#D44545]/10 font-black uppercase tracking-wider"
                    >
                      {reviewDeclineOpen ? 'Cancel Decline' : 'Decline'}
                    </Button>
                    <Button
                      onClick={() => void handleApprove(reviewItem.id)}
                      disabled={processingId === reviewItem.id}
                      className="flex-1 font-black uppercase tracking-wider"
                    >
                      {processingId === reviewItem.id ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <CheckCircle2 className="w-4 h-4" />
                      )}
                      {approveLabelFor(reviewItem)}
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <ContractViewer
        applicationId={contractHandoff?.applicationId}
        contractId={contractHandoff?.contractId}
        open={Boolean(contractHandoff)}
        onClose={() => setContractHandoff(null)}
        userRole={userRole}
        onDisburse={contractHandoff?.loanId ? handleDisburse : undefined}
        disbursing={disbursing}
        onSignComplete={() => {
          showToast('Contract signed by both parties — ready to disburse', 'success');
        }}
      />
    </div>
  );
}

function ApprovalRow({
  record,
  isOwnRequest,
  onReview,
}: {
  record: ApprovalQueueItem;
  isOwnRequest: boolean;
  onReview: () => void;
}) {
  return (
    <div className="rounded-2xl border border-[rgba(201,160,92,0.08)] bg-[#14141B] p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <Badge
              className={
                record.targetType === 'APPRAISAL'
                  ? 'bg-[#C9A05C]/10 text-[#C9A05C] border border-[rgba(201,160,92,0.2)]'
                  : record.targetType === 'LISTING_EDIT'
                    ? 'bg-violet-500/10 text-violet-400 border border-violet-500/20'
                    : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
              }
            >
              {record.targetType === 'LISTING_EDIT' ? 'AUCTION EDIT' : record.targetType}
            </Badge>
            <span className="text-[10px] font-black uppercase tracking-widest text-[#C9A05C]">
              {ticketNumber(record)}
            </span>
          </div>
          <p className="text-sm font-black text-[#F5F0E8] truncate">{customerName(record)}</p>
          <p className="text-xs font-medium mt-1 truncate" style={{ color: 'var(--text-muted)' }}>
            {itemSummary(record)}
          </p>
          <p className="text-[10px] font-semibold mt-1" style={{ color: 'var(--text-muted)' }}>
            {record.requestedBy?.fullName ? `Requested by ${record.requestedBy.fullName}` : ''}
            {record.requestedBy?.fullName && record.createdAt ? ' · ' : ''}
            {record.createdAt ? formatDateTime(record.createdAt) : ''}
          </p>
        </div>
        <div className="text-right shrink-0">
          {record.targetType === 'LISTING_EDIT' ? (
            <p className="text-[10px] font-black uppercase tracking-widest text-[#C9A05C]">
              Auction Edit
            </p>
          ) : (
            <>
              <p className="text-lg font-black text-[#C9A05C]">{formatCurrency(itemAmount(record))}</p>
              {/* The number is only meaningful if the reviewer knows which of the
                  two figures it is. A ₱440 loan on an ₱800 valuation reads very
                  differently once it is named. */}
              <p className="text-[9px] font-black uppercase tracking-widest mt-0.5" style={{ color: 'var(--text-muted)' }}>
                {record.targetType === 'REDEMPTION'
                  ? 'Amount paid'
                  : typeof record.recommendedLoanAmount === 'number' && record.recommendedLoanAmount > 0
                    ? 'Recommended loan'
                    : 'Appraised value'}
              </p>
            </>
          )}
          {record.targetType === 'REDEMPTION' && (
            <p className="text-[10px] font-semibold mt-1" style={{ color: 'var(--text-muted)' }}>
              Needs owner approval
            </p>
          )}
        </div>
      </div>

      {record.targetType === 'LISTING_EDIT' && (
        <div className="mt-3 rounded-xl border border-[rgba(201,160,92,0.15)] bg-[#1C1C26] p-4 space-y-2">
          <p className="text-[10px] font-black uppercase tracking-widest text-[#C9A05C]">
            Requested changes
          </p>
          <ListingChangeRow
            label="Condition"
            previous={record.listingEdit?.previous?.itemCondition}
            next={record.listingEdit?.itemCondition}
          />
          <ListingChangeRow
            label="Specifications"
            previous={record.listingEdit?.previous?.itemSpecifications}
            next={record.listingEdit?.itemSpecifications}
          />
          <ListingChangeRow
            label="Provenance"
            previous={record.listingEdit?.previous?.provenanceDetails}
            next={record.listingEdit?.provenanceDetails}
          />
          <ListingChangeRow
            label="Disclosures"
            previous={record.listingEdit?.previous?.disclosureNotes}
            next={record.listingEdit?.disclosureNotes}
          />
        </div>
      )}

      <div className="mt-4 flex items-center gap-2 flex-wrap">
        <Button
          onClick={onReview}
          className="font-black uppercase tracking-wider cursor-pointer"
        >
          <FileText className="w-4 h-4" />
          Review &amp; Decide
        </Button>
      </div>

      {isOwnRequest && (
        <p className="text-[10px] font-semibold mt-2" style={{ color: 'var(--text-muted)' }}>
          You cannot decide your own request.
        </p>
      )}
    </div>
  );
}

/**
 * The valuation block.
 *
 * The loan figure leads because that is what the reviewer is approving; the
 * valuation and the LTV sit beneath it as the basis for that number. Previously
 * these were three equal-weight rows, and an appraisal where the valuation and
 * the recommendation happened to match rendered as the same figure twice with
 * no indication of which was which.
 */
function ReviewValuation({ item }: { item: ApprovalQueueItem }) {
  const appraised = item.appraisedValue ?? 0;
  const recommended = item.recommendedLoanAmount ?? itemAmount(item);
  const ltv = appraised > 0 ? Math.round((recommended / appraised) * 100) : null;
  const risk = typeof item.riskScore === 'number' ? item.riskScore : null;
  const riskTone =
    risk === null
      ? { color: 'var(--text-muted)', label: 'Not scored' }
      : risk > 40
        ? { color: '#D44545', label: 'High' }
        : risk > 20
          ? { color: 'var(--amber)', label: 'Moderate' }
          : { color: 'var(--green)', label: 'Low' };

  return (
    <div
      className="rounded-2xl p-5"
      style={{ background: 'rgba(201,160,92,0.08)', border: '1px solid rgba(201,160,92,0.18)' }}
    >
      <p className="text-[10px] font-black uppercase tracking-widest mb-3" style={{ color: 'var(--gold)' }}>
        Recommended Loan
      </p>
      <p
        className="text-4xl font-black leading-none tracking-tight"
        style={{ fontFamily: 'var(--font-display)', color: 'var(--gold)' }}
      >
        {formatCurrency(recommended)}
      </p>
      {ltv !== null && (
        <p className="text-[11px] font-semibold mt-2" style={{ color: 'var(--text-muted)' }}>
          {ltv}% of the {formatCurrency(appraised)} appraised value
        </p>
      )}

      <div
        className="grid grid-cols-2 gap-3 mt-5 pt-4"
        style={{ borderTop: '1px solid rgba(201,160,92,0.14)' }}
      >
        <div>
          <p className="text-[9px] font-black uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
            Appraised value
          </p>
          <p className="text-sm font-black text-[#F5F0E8] mt-1">{formatCurrency(appraised)}</p>
        </div>
        <div>
          <p className="text-[9px] font-black uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
            Risk score
          </p>
          <div className="flex items-baseline gap-2 mt-1">
            <p className="text-sm font-black text-[#F5F0E8]">{risk ?? '—'}</p>
            {risk !== null && (
              <span className="text-[9px] font-black uppercase tracking-widest" style={{ color: riskTone.color }}>
                {riskTone.label}
              </span>
            )}
          </div>
        </div>
      </div>

      {item.isHighRisk && (
        <p
          className="mt-4 text-[10px] font-black uppercase tracking-widest"
          style={{ color: 'var(--amber)' }}
        >
          Flagged high risk — confirm the collateral justifies this figure
        </p>
      )}
    </div>
  );
}

function ListingChangeRow({ label, previous, next }: { label: string; previous?: string | null; next?: string | null }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-1 text-xs">
      <span className="w-28 shrink-0 font-black uppercase tracking-widest text-[10px] pt-1" style={{ color: 'var(--text-muted)' }}>
        {label}
      </span>
      <div className="flex-1 min-w-0">
        <p className="font-medium text-[#F5F0E8] whitespace-pre-wrap break-words">{next?.trim() || '—'}</p>
        {(previous ?? '') !== (next ?? '') && previous?.trim() ? (
          <p className="mt-0.5 line-through font-semibold text-[#D44545]/70 whitespace-pre-wrap break-words">
            {previous.trim()}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export default ApprovalQueue;