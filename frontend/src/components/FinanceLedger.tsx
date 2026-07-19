/**
 * FinanceLedger -- Immutable cash ledger with reconciliation.
 *
 * Features:
 *   - Balance overview + financial summary
 *   - Ledger entries table with category/date filters
 *   - Create new ledger entry (CREDIT / DEBIT / ADJUSTMENT)
 *   - Daily reconciliation management
 */

import { useState, useCallback, useMemo } from 'react';
import {
  Wallet,
  TrendingUp,
  TrendingDown,
  Plus,
  RefreshCw,
  Filter,
  FileText,
  CheckCircle2,
  AlertTriangle,
  ArrowUpCircle,
  ArrowDownCircle,
  Loader2,
  Receipt,
  ShieldCheck,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import api from '@/lib/apiClient';
import useApi from '@/lib/useApi';
import { formatCurrency, formatDateTime, humanizeStatus } from '@/lib/formatters';
import type { LedgerEntry, LedgerEntryType, LedgerCategory, FinanceSummary } from '@/lib/types';
import { supabase } from '@/lib/supabaseClient';
import { useToast } from '../App';
import Swal from 'sweetalert2';

const CATEGORIES: LedgerCategory[] = [
  'LOAN_DISBURSEMENT', 'LOAN_REPAYMENT', 'AUCTION_PAYMENT', 'AUCTION_REFUND',
  'PENALTY_COLLECTION', 'FEE_COLLECTION', 'OPERATIONAL_EXPENSE', 'SALARY_PAYMENT',
  'SUBSCRIPTION_PAYMENT', 'CASH_IN', 'CASH_OUT', 'ADJUSTMENT',
];

const ENTRY_TYPES: LedgerEntryType[] = ['CREDIT', 'DEBIT'];

interface FinanceLedgerProps {
  branchId: string | null;
  activeBranchId?: number | null;
}

interface LedgerEntryRequest {
  id: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  requestedAt: string;
  requestedBy: string;
  approvedBy?: string | null;
  rejectedBy?: string | null;
  rejectionReason?: string | null;
  payload: {
    entryType: LedgerEntryType;
    category: LedgerCategory;
    amount: number;
    description: string;
  };
}

export function FinanceLedger({ branchId: _branchId, activeBranchId }: FinanceLedgerProps) {
  const { showToast } = useToast();
  const normalizedBranchId =
    Number.isInteger(activeBranchId as number) && Number(activeBranchId) > 0
      ? Number(activeBranchId)
      : undefined;
  const normalizedRole = (localStorage.getItem('user_role') || '')
    .toUpperCase()
    .replace(/[_\s]/g, '');
  const isManagerOrOwner = normalizedRole === 'MANAGER' || normalizedRole === 'OWNER';

  // â”€â”€ Filters â”€â”€
  const [categoryFilter, setCategoryFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showReconDialog, setShowReconDialog] = useState(false);
  const [creating, setCreating] = useState(false);
  // Reject modal state
  const [showRejectDialog, setShowRejectDialog] = useState(false);
  const [rejectingRequestId, setRejectingRequestId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectLoading, setRejectLoading] = useState(false);

  // â”€â”€ New entry form â”€â”€
  const [newEntry, setNewEntry] = useState({
    entryType: 'CREDIT' as LedgerEntryType,
    category: 'CASH_IN' as LedgerCategory,
    amount: '',
    description: '',
    performedBy: '',
    counterparty: '',
    paymentMethod: '',
    receiptNumber: '',
    // approvedBy removed
    approvalNotes: '',
  });

  const staffQuery: Record<string, string | number | boolean | undefined> = {};
  if (Number.isFinite(normalizedBranchId)) {
    staffQuery.branchId = normalizedBranchId;
  }

  const { data: staffListRaw } = useApi<Array<{
    id: string;
    fullName?: string;
    email?: string;
    role?: string;
  }>>('/attendance/staff-list', staffQuery, [normalizedBranchId]);
  const staffList = Array.isArray(staffListRaw) ? staffListRaw : [];
  const staffNameMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const s of staffList) {
      map[s.id] = s.fullName || s.email || s.id;
    }
    return map;
  }, [staffList]);

  // â”€â”€ Recon form â”€â”€
  const [reconForm, setReconForm] = useState({ physicalCash: '' });

  // â”€â”€ Data Fetching â”€â”€
  const ledgerQuery: Record<string, string | number | boolean | undefined> = {
    limit: 100,
    offset: 0,
  };
  if (Number.isFinite(normalizedBranchId)) ledgerQuery.branchId = normalizedBranchId;
  if (categoryFilter) ledgerQuery.category = categoryFilter;
  if (dateFrom) ledgerQuery.dateFrom = dateFrom;
  if (dateTo) ledgerQuery.dateTo = dateTo;

  const {
    data: entriesRaw,
    loading: entriesLoading,
    error: entriesError,
    refetch: refetchEntries,
  } = useApi<LedgerEntry[] | { data: LedgerEntry[] }>('/finance/ledger', ledgerQuery, [categoryFilter, dateFrom, dateTo, normalizedBranchId]);

  const balanceQuery: Record<string, string | number | boolean | undefined> = {};
  if (Number.isFinite(normalizedBranchId)) balanceQuery.branchId = normalizedBranchId;
  const { data: balanceData, refetch: refetchBalance } = useApi<{ balance: number }>('/finance/balance', balanceQuery, [normalizedBranchId]);
  const { data: requestsRaw, refetch: refetchRequests } = useApi<LedgerEntryRequest[]>('/finance/ledger/requests');
  const summaryQuery: Record<string, string | number | boolean | undefined> = {
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
  };
  if (Number.isFinite(normalizedBranchId)) summaryQuery.branchId = normalizedBranchId;
  const { data: summary, refetch: refetchSummary } = useApi<FinanceSummary>('/finance/summary', summaryQuery, [dateFrom, dateTo, normalizedBranchId]);

  const entries: LedgerEntry[] = Array.isArray(entriesRaw) ? entriesRaw : (entriesRaw as any)?.data ?? [];
  const requests: LedgerEntryRequest[] = Array.isArray(requestsRaw) ? requestsRaw : [];
  const pendingRequests = requests.filter((r) => r.status === 'PENDING');
  const balance = balanceData?.balance ?? 0;

  const summaryView = useMemo(() => {
    const raw = (summary || {}) as any;
    const totalCredits = Number(raw.totalCredits ?? raw.totalCredit ?? 0);
    const totalDebits = Number(raw.totalDebits ?? raw.totalDebit ?? 0);
    const netFlow = Number(raw.netFlow ?? totalCredits - totalDebits);
    return { totalCredits, totalDebits, netFlow };
  }, [summary]);

  const refetchAll = useCallback(() => {
    refetchEntries();
    refetchBalance();
    refetchSummary();
    refetchRequests();
  }, [refetchEntries, refetchBalance, refetchSummary, refetchRequests]);

  // â”€â”€ Handlers â”€â”€
  const handleCreateEntry = async () => {
    const amount = parseFloat(newEntry.amount);
    if (!amount || amount <= 0) {
      showToast('Amount must be greater than zero', 'error');
      return;
    }
    if (!newEntry.description.trim()) {
      showToast('Description is required', 'error');
      return;
    }
    // Require explicit selection (not just default)
    if (!newEntry.entryType || !['CREDIT', 'DEBIT', 'ADJUSTMENT'].includes(newEntry.entryType)) {
      showToast('Please select an entry type.', 'error');
      return;
    }
    if (!newEntry.category || !CATEGORIES.includes(newEntry.category as LedgerCategory)) {
      showToast('Please select a category.', 'error');
      return;
    }

    if (!newEntry.performedBy) {
      showToast('Please select who performed this entry', 'error');
      return;
    }

    setCreating(true);
    try {
      const payload = {
        entryType: newEntry.entryType,
        category: newEntry.category,
        amount: Number(newEntry.amount), // Ensure amount is a number
        description: newEntry.description,
        performedBy: newEntry.performedBy,
        counterparty: newEntry.counterparty || undefined,
        paymentMethod: newEntry.paymentMethod || undefined,
        // receiptNumber is auto-generated, do not send from UI
        // approvedBy removed
        approvalNotes: newEntry.approvalNotes || undefined,
      };

      if (isManagerOrOwner) {
        await api.post('/finance/ledger', payload);
        showToast('Ledger entry created', 'success');
      } else {
        await api.post('/finance/ledger/requests', payload);
        showToast('Ledger request submitted for manager/owner approval', 'success');
      }

      setShowCreateDialog(false);
      setNewEntry({
        entryType: 'CREDIT',
        category: 'CASH_IN',
        amount: '',
        description: '',
        performedBy: '',
        counterparty: '',
        paymentMethod: '',
        receiptNumber: '',
        approvalNotes: '',
      });
      refetchAll();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setCreating(false);
    }
  };

  const handleApproveRequest = async (requestId: string) => {
    const confirm = await Swal.fire({
      title: 'Confirm Action',
      text: 'Approve this ledger entry? This will record it in the cash ledger.',
      icon: 'question',
      showCancelButton: true,
      confirmButtonColor: '#C9A05C',
      cancelButtonColor: '#6B655C',
      confirmButtonText: 'Yes, proceed',
      cancelButtonText: 'Cancel',
    });
    if (!confirm.isConfirmed) return;
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const approvedBy = session?.user?.id || localStorage.getItem('user_id') || '';
      if (!approvedBy) {
        showToast('Unable to identify approver account', 'error');
        return;
      }

      await api.post(`/finance/ledger/requests/${requestId}/approve`, { approvedBy });
      showToast('Ledger request approved and recorded', 'success');
      refetchAll();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : String(err), 'error');
    }
  };

  // Open reject modal
  const openRejectDialog = (requestId: string) => {
    setRejectingRequestId(requestId);
    setRejectReason('');
    setShowRejectDialog(true);
  };

  // Handle actual rejection
  const handleRejectRequest = async () => {
    if (!rejectingRequestId) return;
    setRejectLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const rejectedBy = session?.user?.id || localStorage.getItem('user_id') || '';
      if (!rejectedBy) {
        showToast('Unable to identify approver account', 'error');
        setRejectLoading(false);
        return;
      }
      await api.post(`/finance/ledger/requests/${rejectingRequestId}/reject`, {
        rejectedBy,
        reason: rejectReason || undefined,
      });
      showToast('Ledger request rejected', 'success');
      setShowRejectDialog(false);
      setRejectingRequestId(null);
      setRejectReason('');
      refetchAll();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setRejectLoading(false);
    }
  };

  const handleCreateRecon = async () => {
    try {
      await api.post('/finance/reconciliation', {
        physicalCash: reconForm.physicalCash ? parseFloat(reconForm.physicalCash) : undefined,
      });
      showToast('Reconciliation created', 'success');
      setShowReconDialog(false);
      setReconForm({ physicalCash: '' });
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : String(err), 'error');
    }
  };

  const entryTypeIcon = (type: LedgerEntryType) => {
    switch (type) {
      case 'CREDIT': return <ArrowUpCircle className="w-4 h-4 text-emerald-600" />;
      case 'DEBIT': return <ArrowDownCircle className="w-4 h-4 text-rose-600" />;
    }
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black text-[#EAE2D6] tracking-tight">Finance & Ledger</h1>
          <p className="text-[#6B655C] mt-1">Immutable cash book with daily reconciliation</p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={refetchAll}>
            <RefreshCw className="w-4 h-4 mr-2" /> Refresh
          </Button>
          <Button variant="outline" onClick={() => setShowReconDialog(true)}>
            <FileText className="w-4 h-4 mr-2" /> Reconcile
          </Button>
          <Button onClick={() => setShowCreateDialog(true)}>
            <Plus className="w-4 h-4 mr-2" /> New Entry
          </Button>
        </div>
      </div>

      {/* Balance Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="bg-gradient-to-br from-[#C9A05C] to-[#A07D40] text-white">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-white/20 rounded-xl"><Wallet className="w-6 h-6" /></div>
              <div>
                <p className="text-3xl font-black">{formatCurrency(balance)}</p>
                <p className="text-[#E5C88C] text-sm">Current Balance</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-emerald-100 rounded-xl"><TrendingUp className="w-5 h-5 text-emerald-600" /></div>
              <div>
                <p className="text-2xl font-black text-[#EAE2D6]">{formatCurrency(summaryView.totalCredits)}</p>
                <p className="text-xs text-[#6B655C]">Total Credits</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-rose-100 rounded-xl"><TrendingDown className="w-5 h-5 text-rose-600" /></div>
              <div>
                <p className="text-2xl font-black text-[#EAE2D6]">{formatCurrency(summaryView.totalDebits)}</p>
                <p className="text-xs text-[#6B655C]">Total Debits</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-sky-100 rounded-xl"><Receipt className="w-5 h-5 text-sky-600" /></div>
              <div>
                <p className="text-2xl font-black text-[#EAE2D6]">{formatCurrency(summaryView.netFlow)}</p>
                <p className="text-xs text-[#6B655C]">Net Flow</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <Filter className="w-4 h-4 text-[#6B655C]" />
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-52"><SelectValue placeholder="All Categories" /></SelectTrigger>
          <SelectContent>
            <SelectItem value=" ">All Categories</SelectItem>
            {CATEGORIES.map((c) => (
              <SelectItem key={c} value={c}>{humanizeStatus(c)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input type="date" className="w-44" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} placeholder="From" />
        <Input type="date" className="w-44" value={dateTo} onChange={(e) => setDateTo(e.target.value)} placeholder="To" />
        {(categoryFilter || dateFrom || dateTo) && (
          <Button variant="ghost" size="sm" onClick={() => { setCategoryFilter(''); setDateFrom(''); setDateTo(''); }}>
            Clear
          </Button>
        )}
      </div>

      {/* Ledger Table */}
      {entriesLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-[#C9A05C]" />
        </div>
      ) : entriesError ? (
        <div className="flex items-center justify-center py-12">
          <AlertTriangle className="w-5 h-5 text-rose-500 mr-2" />
          <span className="text-rose-600">{entriesError}</span>
        </div>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Ledger Entries</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Entry #</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Balance After</TableHead>
                  <TableHead>Performed By</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="font-mono text-xs">{entry.entryNumber}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        {entryTypeIcon(entry.entryType)}
                        <span className="text-xs font-medium">{entry.entryType}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">{humanizeStatus(entry.category)}</Badge>
                    </TableCell>
                    <TableCell className="text-sm whitespace-normal break-words">{entry.description}</TableCell>
                    <TableCell className={`text-right font-mono font-bold ${
                      entry.entryType === 'CREDIT' ? 'text-emerald-600' :
                      entry.entryType === 'DEBIT' ? 'text-rose-600' : 'text-amber-600'
                    }`}>
                      {entry.entryType === 'DEBIT' ? '-' : '+'}{formatCurrency(entry.amount)}
                    </TableCell>
                    <TableCell className="text-right font-mono">{formatCurrency(entry.balanceAfter)}</TableCell>
                    <TableCell className="text-xs text-[#6B655C]">{staffNameMap[entry.performedBy] || entry.performedBy}</TableCell>
                    <TableCell className="text-xs">
                      {formatDateTime(
                        (entry as any).transactionDate ||
                          (entry as any).recordedAt ||
                          entry.createdAt,
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {entries.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-[#6B655C] py-8">No ledger entries found</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Approval Queue */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <ShieldCheck className="w-5 h-5" /> Ledger Approval Queue
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Requested</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pendingRequests.map((req) => (
                <TableRow key={req.id}>
                  <TableCell className="text-xs">{formatDateTime(req.requestedAt)}</TableCell>
                  <TableCell>{req.payload.entryType}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-xs">{humanizeStatus(req.payload.category)}</Badge>
                  </TableCell>
                  <TableCell>{req.payload.description}</TableCell>
                  <TableCell className="text-right font-mono">{formatCurrency(req.payload.amount)}</TableCell>
                  <TableCell>
                    <Badge className="bg-amber-100 text-amber-700">Pending</Badge>
                  </TableCell>
                  <TableCell>
                    {isManagerOrOwner ? (
                      <div className="flex gap-2">
                        <Button size="sm" onClick={() => handleApproveRequest(req.id)}>Approve</Button>
                        <Button size="sm" variant="outline" className="text-rose-600" onClick={() => openRejectDialog(req.id)}>Reject</Button>
                      </div>
                    ) : (
                      <span className="text-xs text-[#6B655C]">Awaiting approval</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {pendingRequests.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-[#6B655C] py-6">
                    No pending ledger requests
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Reject Ledger Request Dialog */}
      <Dialog open={showRejectDialog} onOpenChange={(open) => { setShowRejectDialog(open); if (!open) { setRejectingRequestId(null); setRejectReason(''); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Reject Ledger Request</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-[#999186]">Please provide a reason for rejecting this ledger request. This will be recorded for audit purposes.</p>
            <textarea
              className="w-full min-h-[80px] rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-500 bg-[#1C1C26]"
              placeholder="Rejection reason (optional)"
              value={rejectReason}
              onChange={e => setRejectReason(e.target.value)}
              disabled={rejectLoading}
              autoFocus
            />
          </div>
          <DialogFooter className="flex gap-2 justify-end mt-4">
            <Button variant="ghost" onClick={() => { setShowRejectDialog(false); setRejectingRequestId(null); setRejectReason(''); }} disabled={rejectLoading}>Cancel</Button>
            <Button variant="destructive" onClick={handleRejectRequest} disabled={rejectLoading}>
              {rejectLoading ? (
                <span className="flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Rejecting...</span>
              ) : (
                'Reject'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Entry Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>New Ledger Entry</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-[#6B655C]">Entry Type *</label>
                <Select value={newEntry.entryType} onValueChange={(v) => setNewEntry({ ...newEntry, entryType: v as LedgerEntryType })}>
                  <SelectTrigger><SelectValue placeholder="Select entry type..." /></SelectTrigger>
                  <SelectContent>
                    {ENTRY_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>{t}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm font-medium text-[#6B655C]">Category *</label>
                <Select value={newEntry.category} onValueChange={(v) => setNewEntry({ ...newEntry, category: v as LedgerCategory })}>
                  <SelectTrigger><SelectValue placeholder="Select category..." /></SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c === 'CASH_IN' ? 'Deposit' : c === 'CASH_OUT' ? 'Withdrawal' : humanizeStatus(c)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <label className="text-sm font-medium text-[#6B655C]">Amount (₱) *</label>
              <Input
                type="number"
                min={0}
                step={0.01}
                placeholder="0.00"
                value={newEntry.amount}
                onChange={(e) => setNewEntry({ ...newEntry, amount: e.target.value })}
              />
            </div>
            <div>
              <label className="text-sm font-medium text-[#6B655C]">Description *</label>
              <Input
                placeholder="Describe the transaction..."
                value={newEntry.description}
                onChange={(e) => setNewEntry({ ...newEntry, description: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-[#6B655C]">Performed By</label>
                <label className="text-sm font-medium text-[#6B655C]">Performed By *</label>
                {(!staffList || staffList.length === 0) ? (
                  <Select disabled value="">
                    <SelectTrigger>
                      <SelectValue placeholder="No staff available" />
                    </SelectTrigger>
                  </Select>
                ) : (
                  <Select
                    value={newEntry.performedBy}
                    onValueChange={(v) => setNewEntry({ ...newEntry, performedBy: v })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select staff..." />
                    </SelectTrigger>
                    <SelectContent>
                      {staffList.map((staff) => (
                        staff && staff.id ? (
                          <SelectItem key={staff.id} value={staff.id}>{staff.fullName || staff.email || staff.id}</SelectItem>
                        ) : null
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
              <div>
                <label className="text-sm font-medium text-[#6B655C]">Payment Method</label>
                <Input
                  placeholder="Cash, GCash, Bank..."
                  value={newEntry.paymentMethod}
                  onChange={(e) => setNewEntry({ ...newEntry, paymentMethod: e.target.value })}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-[#6B655C]">Counterparty</label>
                <Input
                  placeholder="Customer/Vendor name"
                  value={newEntry.counterparty}
                  onChange={(e) => setNewEntry({ ...newEntry, counterparty: e.target.value })}
                />
              </div>
              <div>
                <label className="text-sm font-medium text-[#6B655C]">Receipt Number</label>
                <Input
                  placeholder="Auto-generated after approval"
                  value={newEntry.receiptNumber}
                  disabled
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              {/* Approved By field removed for security reasons */}
              <div>
                <label className="text-sm font-medium text-[#6B655C]">Approval Notes</label>
                <Input
                  placeholder="Optional approval remarks"
                  value={newEntry.approvalNotes}
                  onChange={(e) => setNewEntry({ ...newEntry, approvalNotes: e.target.value })}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)}>Cancel</Button>
            <Button onClick={handleCreateEntry} disabled={creating}>
              {creating ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
              Record Entry
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reconciliation Dialog */}
      <Dialog open={showReconDialog} onOpenChange={setShowReconDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Daily Reconciliation</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <p className="text-sm text-[#6B655C]">
              Record the physical cash count for today. The system will compare it against the computed balance.
            </p>
            <div>
              <label className="text-sm font-medium text-[#6B655C]">Physical Cash Count (₱)</label>
              <Input
                type="number"
                min={0}
                step={0.01}
                placeholder="0.00"
                value={reconForm.physicalCash}
                onChange={(e) => setReconForm({ physicalCash: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowReconDialog(false)}>Cancel</Button>
            <Button onClick={handleCreateRecon}>
              <CheckCircle2 className="w-4 h-4 mr-2" /> Submit Reconciliation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default FinanceLedger;
