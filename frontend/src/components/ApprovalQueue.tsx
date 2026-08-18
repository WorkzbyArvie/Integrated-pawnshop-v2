import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
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
import { Textarea } from './ui/textarea';
import { ContractViewer } from './ContractViewer';

interface ApprovalQueueItem {
  id: number;
  targetType: 'APPRAISAL' | 'REDEMPTION';
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
}

interface ApprovalQueueProps {
  branchId?: string | null;
  activeBranchId?: string | null;
  userRole?: string;
}

const ticketNumber = (item: ApprovalQueueItem): string =>
  item.ticketNumber ?? String(item.payload?.ticketNumber ?? `#${item.id}`);

const itemAmount = (item: ApprovalQueueItem): number =>
  item.amount ?? item.amountPaid ?? Number(item.payload?.amount ?? 0);

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
  const effectiveBranchId = branchId ?? activeBranchId ?? localStorage.getItem('active_pawnshop_id');
  const [activeTab, setActiveTab] = useState('APPRAISAL');
  const [records, setRecords] = useState<ApprovalQueueItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [processingId, setProcessingId] = useState<number | null>(null);
  const [reviewItem, setReviewItem] = useState<ApprovalQueueItem | null>(null);
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
      if (applicationId || contractId) {
        setContractHandoff({ applicationId, contractId, loanId });
      }
      showToast(
        isRedemption
          ? 'Redemption approved — item released'
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

  const handleReject = async (id: number, comment: string) => {
    if (processingId !== null) return;
    setProcessingId(id);
    try {
      await api.post(`/approval-queue/${id}/reject`, { decisionComment: comment });
      showToast('Request rejected', 'success');
      await loadQueue(activeTab);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to reject request', 'error');
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
  const pendingTotal = appraisalCount + redemptionCount;

  return (
    <div className="p-8 space-y-6 min-h-screen" style={{ background: 'rgba(28,28,38,0.5)' }}>
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-black text-[#C9A05C] uppercase tracking-tight">Approval Queue</h1>
          <p className="text-[10px] font-black mt-1 uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
            Review appraisals and redemptions pending owner sign-off
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
            className="text-[10px] font-black uppercase tracking-widest px-4 py-2 data-[state=active]:bg-[#C9A05C] data-[state=active]:text-[#0A0A0F] data-[state=inactive]:text-[#6B655C] data-[state=active]:shadow-none"
          >
            Appraisal
            <Badge className="ml-2 bg-[#C9A05C]/10 text-[#C9A05C] border border-[rgba(201,160,92,0.2)]">
              {appraisalCount}
            </Badge>
          </TabsTrigger>
          <TabsTrigger
            value="REDEMPTION"
            className="text-[10px] font-black uppercase tracking-widest px-4 py-2 data-[state=active]:bg-[#C9A05C] data-[state=active]:text-[#0A0A0F] data-[state=inactive]:text-[#6B655C] data-[state=active]:shadow-none"
          >
            Redemption
            <Badge className="ml-2 bg-[#C9A05C]/10 text-[#C9A05C] border border-[rgba(201,160,92,0.2)]">
              {redemptionCount}
            </Badge>
          </TabsTrigger>
          <TabsTrigger
            value="DECIDED"
            className="text-[10px] font-black uppercase tracking-widest px-4 py-2 data-[state=active]:bg-[#C9A05C] data-[state=active]:text-[#0A0A0F] data-[state=inactive]:text-[#6B655C] data-[state=active]:shadow-none"
          >
            Decision History
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="flex flex-col gap-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#6B655C]" />
          <Input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search by customer name or ticket number…"
            className="pl-10 bg-[#14141B] border-[rgba(201,160,92,0.12)] text-[#EAE2D6] focus:ring-2 focus:ring-[#C9A05C]/40"
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
          <p className="text-sm font-bold text-[#EAE2D6]">Could not load the approval queue</p>
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
              <p className="text-lg font-black text-[#EAE2D6]">No decisions yet</p>
              <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                Approved and rejected requests will appear here.
              </p>
            </>
          ) : (
            <>
              <p className="text-lg font-black text-[#EAE2D6]">All caught up!</p>
              <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                {activeTab === 'APPRAISAL' ? 'No pending appraisals' : 'No pending redemptions'}
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
              processing={processingId === record.id}
              onReview={() => { setReviewPhotoIndex(0); setReviewItem(record); }}
              onApprove={() => void handleApprove(record.id)}
              onReject={(comment) => void handleReject(record.id, comment)}
            />
          ))}
        </div>
      )}

      <Dialog open={Boolean(reviewItem)} onOpenChange={(open) => { if (!open) setReviewItem(null); }}>
        <DialogContent className="max-w-lg bg-[#14141B] border border-[rgba(201,160,92,0.15)] text-[#EAE2D6]">
          <DialogHeader>
            <DialogTitle className="text-lg font-black uppercase tracking-tight text-[#EAE2D6] flex items-center gap-2">
              <FileText className="w-4 h-4 text-[#C9A05C]" />
              Review Request
            </DialogTitle>
          </DialogHeader>
          {reviewItem && (
            <div className="space-y-4 text-sm">
              <div className="flex items-center gap-2">
                <Badge
                  className={
                    reviewItem.targetType === 'APPRAISAL'
                      ? 'bg-[#C9A05C]/10 text-[#C9A05C] border border-[rgba(201,160,92,0.2)]'
                      : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                  }
                >
                  {reviewItem.targetType}
                </Badge>
                <span className="text-[10px] font-black uppercase tracking-widest text-[#C9A05C]">
                  {ticketNumber(reviewItem)}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-2xl p-4" style={{ background: 'rgba(255,255,255,0.035)' }}>
                  <p className="text-[10px] font-black uppercase tracking-widest mb-1" style={{ color: 'var(--text-muted)' }}>
                    Customer
                  </p>
                  <p className="font-bold text-[#EAE2D6]">{customerName(reviewItem)}</p>
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
                  <p className="font-bold text-[#EAE2D6]">{itemSummary(reviewItem)}</p>
                </div>
              </div>
              {(reviewItem.photoUrls?.length ?? 0) > 0 && (
                <div className="rounded-2xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.035)' }}>
                  <div className="relative h-48 bg-[#1C1C26] flex items-center justify-center">
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
                          onClick={() =>
                            setReviewPhotoIndex((index) =>
                              index <= 0 ? (reviewItem.photoUrls?.length ?? 1) - 1 : index - 1,
                            )
                          }
                          aria-label="Previous photo"
                          className="absolute left-3 top-1/2 -translate-y-1/2 h-8 w-8 rounded-full border border-white/40 bg-black/40 text-white flex items-center justify-center"
                        >
                          <ChevronLeft className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() =>
                            setReviewPhotoIndex((index) =>
                              index >= (reviewItem.photoUrls?.length ?? 1) - 1 ? 0 : index + 1,
                            )
                          }
                          aria-label="Next photo"
                          className="absolute right-3 top-1/2 -translate-y-1/2 h-8 w-8 rounded-full border border-white/40 bg-black/40 text-white flex items-center justify-center"
                        >
                          <ChevronRight className="w-4 h-4" />
                        </button>
                      </>
                    )}
                  </div>
                  {(reviewItem.photoUrls?.length ?? 0) > 1 && (
                    <p className="py-1.5 text-center text-[10px] font-black uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
                      {reviewPhotoIndex + 1} / {reviewItem.photoUrls!.length}
                    </p>
                  )}
                </div>
              )}
              {reviewItem.targetType === 'APPRAISAL' ? (
                <div
                  className="rounded-2xl p-4"
                  style={{ background: 'rgba(201,160,92,0.1)', border: '1px solid rgba(201,160,92,0.15)' }}
                >
                  <p className="text-[10px] font-black uppercase tracking-widest mb-2" style={{ color: 'var(--gold)' }}>
                    Valuation
                  </p>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                      Appraised value
                    </span>
                    <span className="text-lg font-black text-[#C9A05C]">
                      {formatCurrency(reviewItem.appraisedValue ?? itemAmount(reviewItem))}
                    </span>
                  </div>
                  <div className="flex items-center justify-between mt-2">
                    <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                      Recommended loan
                    </span>
                    <span className="text-sm font-black text-[#EAE2D6]">
                      {formatCurrency(reviewItem.recommendedLoanAmount ?? itemAmount(reviewItem))}
                    </span>
                  </div>
                  {typeof reviewItem.riskScore === 'number' && (
                    <div className="flex items-center justify-between mt-2">
                      <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                        Risk score
                      </span>
                      <span className="text-sm font-black text-[#EAE2D6]">{reviewItem.riskScore}</span>
                    </div>
                  )}
                  {reviewItem.isHighRisk && (
                    <p className="text-[10px] font-black uppercase tracking-widest mt-2" style={{ color: 'var(--amber)' }}>
                      High risk
                    </p>
                  )}
                </div>
              ) : (
                <div className="rounded-2xl p-4" style={{ background: 'rgba(255,255,255,0.035)' }}>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                      Amount paid
                    </span>
                    <span className="text-lg font-black text-[#C9A05C]">{formatCurrency(itemAmount(reviewItem))}</span>
                  </div>
                  <div className="flex items-center justify-between mt-2">
                    <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                      Requires owner approval
                    </span>
                    <span className="text-sm font-black text-[#EAE2D6]">Yes</span>
                  </div>
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
              <p className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                {reviewItem.requestedBy?.fullName ? `Requested by ${reviewItem.requestedBy.fullName}` : 'Requested by staff'}
                {reviewItem.createdAt ? ` · ${formatDateTime(reviewItem.createdAt)}` : ''}
              </p>
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
  processing,
  onReview,
  onApprove,
  onReject,
}: {
  record: ApprovalQueueItem;
  isOwnRequest: boolean;
  processing: boolean;
  onReview: () => void;
  onApprove: () => void;
  onReject: (comment: string) => void;
}) {
  const [comment, setComment] = useState('');

  return (
    <div className="rounded-2xl border border-[rgba(201,160,92,0.08)] bg-[#14141B] p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <Badge
              className={
                record.targetType === 'APPRAISAL'
                  ? 'bg-[#C9A05C]/10 text-[#C9A05C] border border-[rgba(201,160,92,0.2)]'
                  : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
              }
            >
              {record.targetType}
            </Badge>
            <span className="text-[10px] font-black uppercase tracking-widest text-[#C9A05C]">
              {ticketNumber(record)}
            </span>
          </div>
          <p className="text-sm font-black text-[#EAE2D6] truncate">{customerName(record)}</p>
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
          <p className="text-lg font-black text-[#C9A05C]">{formatCurrency(itemAmount(record))}</p>
          {record.targetType === 'REDEMPTION' && (
            <p className="text-[10px] font-semibold mt-1" style={{ color: 'var(--text-muted)' }}>
              Needs owner approval
            </p>
          )}
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="ghost" size="sm" onClick={onReview}>
            Review
          </Button>
          <Button
            size="sm"
            onClick={onApprove}
            disabled={processing || isOwnRequest}
            className="bg-[#C9A05C] text-[#0A0A0F] hover:bg-[#d4b36e]"
          >
            {processing ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
            {record.targetType === 'REDEMPTION' ? 'Approve & Release' : 'Approve & Generate Contract'}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onReject(comment)}
            disabled={processing || comment.trim() === ''}
            className="border-[#D44545]/40 text-[#D44545] hover:bg-[#D44545]/10"
          >
            Reject
          </Button>
        </div>
        <Textarea
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          placeholder="Rejection comment (required)"
          rows={2}
          className="bg-[#1C1C26] border-[rgba(217,69,69,0.2)] text-[#EAE2D6] placeholder:text-[#6B655C] focus:ring-2 focus:ring-[#D44545]/40 lg:max-w-xs"
        />
      </div>

      {isOwnRequest && (
        <p className="text-[10px] font-semibold mt-2" style={{ color: 'var(--text-muted)' }}>
          You cannot approve your own request.
        </p>
      )}
    </div>
  );
}

export default ApprovalQueue;
