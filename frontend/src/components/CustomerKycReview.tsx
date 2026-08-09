import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle, Eye, Loader2, Shield, XCircle } from 'lucide-react';
import { api } from '../lib/apiClient';
import { formatDate } from '../lib/formatters';
import { CustomerKycRecord } from '../lib/types';
import { KYC_STATUS_PALETTE } from './KycStatusBadge';
import DocLink from './DocLink';
import { useToast } from '../App';

interface CustomerKycReviewProps {
  branchId?: string | null;
  activeBranchId?: number | null;
  userRole?: string | null;
}

export default function CustomerKycReview({ userRole }: CustomerKycReviewProps) {
  const { showToast } = useToast();
  const [records, setRecords] = useState<CustomerKycRecord[]>([]);
  const [tab, setTab] = useState<'pending' | 'all'>('pending');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [selected, setSelected] = useState<CustomerKycRecord | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const rawRole = (userRole ?? 'OWNER').trim().toUpperCase().replace(/[\s-]+/g, '_');
  const canonicalRole = rawRole === 'BRANCH_ADMIN' ? 'ADMIN' : rawRole;
  const isReviewer = ['MANAGER', 'OWNER', 'ADMIN', 'SUPER_ADMIN'].includes(canonicalRole);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<CustomerKycRecord[]>(
        '/kyc/customers',
        tab === 'pending' ? { status: 'PENDING' } : undefined,
      );
      setRecords(data ?? []);
    } catch (err) {
      setRecords([]);
      const message = err instanceof Error ? err.message : 'Failed to load KYC records';
      setError(message);
      showToast(message, 'error');
    } finally {
      setLoading(false);
    }
  }, [tab, showToast]);

  useEffect(() => {
    if (!isReviewer) return;
    void load();
  }, [load, isReviewer]);

  const pendingCount = records.filter((record) => record.status === 'PENDING').length;

  const handleReview = async (id: string, decision: 'VERIFIED' | 'REJECTED') => {
    if (decision === 'REJECTED' && !rejectReason.trim()) return;
    setActionLoading(true);
    try {
      await api.patch(`/kyc/customers/${id}/review`, {
        decision,
        ...(decision === 'REJECTED' ? { rejectionReason: rejectReason.trim() } : {}),
      });
      showToast(decision === 'VERIFIED' ? 'KYC marked as verified.' : 'KYC submission rejected.', 'success');
      setSelected(null);
      setRejectReason('');
      await load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Review failed', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  if (!isReviewer) {
    return (
      <div className="p-8 text-center" style={{ color: 'var(--text-muted)' }}>
        <AlertTriangle className="w-8 h-8 mx-auto mb-3" style={{ color: 'var(--amber)' }} />
        <p className="text-sm font-bold">Access Restricted</p>
        <p className="text-xs mt-1">Only Owners, Admins, and Managers can review customer KYC submissions.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black uppercase tracking-tight text-[#EAE2D6]">
            Customer <span className="text-[#C9A05C]">KYC</span> Review
          </h1>
          <p className="text-[10px] font-black mt-1 uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
            Verify customer identity records before transactions
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setTab('pending')}
            className={`px-3 py-1.5 text-[10px] font-black uppercase tracking-widest rounded-lg transition-colors ${tab === 'pending' ? 'bg-[#C9A05C] text-[#0A0A0F]' : 'bg-[#1C1C26] text-[#9B9488] hover:text-[#EAE2D6]'}`}
          >
            Pending ({pendingCount})
          </button>
          <button
            onClick={() => setTab('all')}
            className={`px-3 py-1.5 text-[10px] font-black uppercase tracking-widest rounded-lg transition-colors ${tab === 'all' ? 'bg-[#C9A05C] text-[#0A0A0F]' : 'bg-[#1C1C26] text-[#9B9488] hover:text-[#EAE2D6]'}`}
          >
            All
          </button>
          <button
            onClick={() => void load()}
            aria-label="Refresh KYC records"
            className="px-3 py-1.5 text-[10px] font-black uppercase tracking-widest rounded-lg border border-[rgba(201,160,92,0.15)] text-[#C9A05C] hover:bg-[rgba(201,160,92,0.1)] transition-colors flex items-center gap-1.5"
          >
            <Loader2 className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12 text-[#9B9488]">Loading KYC records...</div>
      ) : error ? (
        <div className="rounded-2xl border border-[#D44545]/30 bg-[#1C1C26] p-6 text-center">
          <AlertTriangle className="w-6 h-6 mx-auto text-[#D44545] mb-2" />
          <p className="text-sm font-bold text-[#EAE2D6]">Failed to load KYC records</p>
          <p className="text-xs mt-1 mb-4" style={{ color: 'var(--text-muted)' }}>
            Check your connection and try again.
          </p>
          <button
            onClick={() => void load()}
            className="px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-widest border border-[rgba(201,160,92,0.15)] text-[#C9A05C] hover:bg-[rgba(201,160,92,0.1)] transition-colors"
          >
            Retry
          </button>
        </div>
      ) : records.length === 0 ? (
        <div className="text-center py-12 text-[#9B9488]">
          <Shield className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="text-sm font-bold text-[#EAE2D6]">
            {tab === 'pending' ? 'No pending KYC submissions' : 'No KYC records found'}
          </p>
          <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
            {tab === 'pending'
              ? 'New customer KYC captures will appear here for verification.'
              : "Records appear once staff capture a customer's identity details at the counter."}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {records.map((record) => {
            const palette = KYC_STATUS_PALETTE[record.status] ?? KYC_STATUS_PALETTE.PENDING;
            return (
              <div
                key={record.id}
                className="flex items-center justify-between p-4 rounded-xl bg-[#1C1C26] border border-[rgba(201,160,92,0.08)] hover:border-[rgba(201,160,92,0.2)] transition-colors cursor-pointer"
                onClick={() => setSelected(record)}
              >
                <div className="flex items-center gap-4 min-w-0">
                  <div className={`p-2 rounded-lg shrink-0 ${palette.className}`}>{palette.icon}</div>
                  <div className="min-w-0">
                    <p className="text-sm font-normal text-[#EAE2D6] truncate">{record.fullName}</p>
                    <p className="text-[10px] text-[#9B9488]">
                      {record.contactNumber} · {record.idType} · Submitted {formatDate(record.createdAt)}
                    </p>
                  </div>
                </div>
                <Eye className="w-4 h-4 text-[#9B9488] shrink-0" />
              </div>
            );
          })}
        </div>
      )}

      {selected && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setSelected(null)}
        >
          <div
            className="bg-[#14141C] border border-[rgba(201,160,92,0.15)] rounded-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto p-6"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="text-lg font-black text-[#EAE2D6]">{selected.fullName}</h3>
                <p className="text-xs text-[#9B9488]">
                  {selected.idType} #{selected.idNumber}
                </p>
              </div>
              <button onClick={() => setSelected(null)} aria-label="Close" className="text-[#9B9488] hover:text-[#EAE2D6] text-xl">
                &times;
              </button>
            </div>

            <div className="grid grid-cols-2 gap-6 mb-6">
              <div className="space-y-3">
                <h4 className="text-[10px] font-extrabold uppercase tracking-wider text-[#C9A05C]">ID Document</h4>
                <DocLink url={selected.idFrontUrl} label="View ID Front" />
                {selected.idBackUrl && <DocLink url={selected.idBackUrl} label="View ID Back" />}
                {selected.selfieUrl && <DocLink url={selected.selfieUrl} label="View Selfie" />}
              </div>
              <div className="space-y-3">
                <h4 className="text-[10px] font-extrabold uppercase tracking-wider text-[#C9A05C]">Personal Info</h4>
                <p className="text-sm text-[#EAE2D6]">Contact: {selected.contactNumber}</p>
                <p className="text-sm text-[#EAE2D6]">Address: {selected.address}</p>
                <p className="text-sm text-[#9B9488]">Submitted {formatDate(selected.createdAt)}</p>
              </div>
            </div>

            {selected.status === 'PENDING' ? (
              <div className="flex items-end gap-3">
                <button
                  disabled={actionLoading}
                  onClick={() => void handleReview(selected.id, 'VERIFIED')}
                  className="flex items-center gap-2 px-4 py-2 bg-[#C9A05C] text-[#0A0A0F] hover:bg-[#d4b36e] text-sm font-black rounded-lg transition-colors disabled:opacity-50"
                >
                  {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                  Verify
                </button>
                <div className="flex-1">
                  <input
                    type="text"
                    placeholder="Rejection reason (required to reject)"
                    value={rejectReason}
                    onChange={(event) => setRejectReason(event.target.value)}
                    className="w-full px-3 py-2 bg-[#1C1C26] border border-[rgba(201,160,92,0.15)] rounded-lg text-sm text-[#EAE2D6] placeholder:text-[#6B655C] focus:outline-none focus:border-[#C9A05C]"
                  />
                </div>
                <button
                  disabled={actionLoading || !rejectReason.trim()}
                  onClick={() => void handleReview(selected.id, 'REJECTED')}
                  className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-500 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
                >
                  {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />}
                  Reject
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-sm">
                {selected.status === 'VERIFIED' ? (
                  <span className="text-emerald-400">Verified on {formatDate(selected.reviewedAt)}</span>
                ) : (
                  <span className="text-red-400">
                    Rejected — {selected.rejectionReason ?? 'No reason provided'} on {formatDate(selected.reviewedAt)}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
