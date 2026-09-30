import { useEffect, useState, useCallback } from 'react';
import { CheckCircle, XCircle, Clock, Eye, Shield, RefreshCw } from 'lucide-react';
import { api } from '../lib/apiClient';
import DocLink from './DocLink';
import {
  DeclineReasonPicker,
  DECLINE_REASON_SETS,
  formatDeclineReason,
  isDeclineReasonComplete,
  type DeclineReason,
} from './DeclineReasonPicker';

interface KycRecord {
  id: string;
  profileId: string;
  status: string;
  fullName: string;
  dateOfBirth: string;
  address: string;
  phoneNumber: string;
  idType: string;
  idNumber: string;
  idFrontUrl: string;
  idBackUrl: string | null;
  selfieUrl: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  rejectionReason: string | null;
  createdAt: string;
  profile?: { email: string; fullName: string | null; role: string };
}

const STATUS_STYLES: Record<string, { color: string; bg: string; icon: React.ReactNode }> = {
  PENDING: { color: 'text-amber-400', bg: 'bg-amber-500/10', icon: <Clock className="w-4 h-4" /> },
  VERIFIED: { color: 'text-emerald-400', bg: 'bg-emerald-500/10', icon: <CheckCircle className="w-4 h-4" /> },
  REJECTED: { color: 'text-red-400', bg: 'bg-red-500/10', icon: <XCircle className="w-4 h-4" /> },
};

export default function BidderKycReview() {
  const [records, setRecords] = useState<KycRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<KycRecord | null>(null);
  const [declineReason, setDeclineReason] = useState<DeclineReason>(null);
  const [declineOpen, setDeclineOpen] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [tab, setTab] = useState<'pending' | 'all'>('pending');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (tab === 'pending') {
        const data = await api.get<KycRecord[]>('/auth/kyc/pending');
        setRecords(data);
      } else {
        const data = await api.get<KycRecord[]>('/auth/kyc/all');
        setRecords(data);
      }
    } catch (err: any) {
      console.error('Failed to load KYC records:', err);
      setRecords([]);
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => { load(); }, [load]);

  const handleReview = async (id: string, decision: 'VERIFIED' | 'REJECTED') => {
    if (decision === 'REJECTED' && !isDeclineReasonComplete(declineReason)) return;
    setActionLoading(true);
    try {
      await api.patch(`/auth/kyc/${id}/review`, {
        decision,
        rejectionReason: decision === 'REJECTED' ? formatDeclineReason(declineReason) : undefined,
      });
      setSelected(null);
      setDeclineReason(null);
      setDeclineOpen(false);
      await load();
    } catch (err: any) {
      alert(err.message || 'Review failed');
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-[#F5F0E8]" style={{ fontFamily: "'Syne', sans-serif" }}>
            Bidder KYC Verification
          </h2>
          <p className="text-sm text-[#9B9488] mt-1">Review identity documents submitted by auction bidders</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setTab('pending')}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${tab === 'pending' ? 'bg-[#C9A05C] text-[#0A0A0F]' : 'bg-[#1C1C26] text-[#9B9488] hover:text-[#F5F0E8]'}`}
          >
            Pending ({tab === 'pending' ? records.length : '...'})
          </button>
          <button
            onClick={() => setTab('all')}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${tab === 'all' ? 'bg-[#C9A05C] text-[#0A0A0F]' : 'bg-[#1C1C26] text-[#9B9488] hover:text-[#F5F0E8]'}`}
          >
            All
          </button>
          <button onClick={load} className="p-1.5 rounded-lg bg-[#1C1C26] text-[#9B9488] hover:text-[#F5F0E8] transition-colors">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12 text-[#9B9488]">Loading KYC records...</div>
      ) : records.length === 0 ? (
        <div className="text-center py-12 text-[#9B9488]">
          <Shield className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p>{tab === 'pending' ? 'No pending KYC submissions' : 'No KYC records found'}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {records.map((r) => {
            const st = STATUS_STYLES[r.status] || STATUS_STYLES.PENDING;
            return (
              <div
                key={r.id}
                className="flex items-center justify-between p-4 rounded-xl bg-[#1C1C26] border border-[rgba(201,160,92,0.08)] hover:border-[rgba(201,160,92,0.2)] transition-colors cursor-pointer"
                onClick={() => setSelected(r)}
              >
                <div className="flex items-center gap-4">
                  <div className={`p-2 rounded-lg ${st.bg} ${st.color}`}>{st.icon}</div>
                  <div>
                    <p className="text-sm font-medium text-[#F5F0E8]">{r.fullName}</p>
                    <p className="text-xs text-[#9B9488]">{r.profile?.email || '—'} · {r.idType} · Submitted {new Date(r.createdAt).toLocaleDateString()}</p>
                  </div>
                </div>
                <Eye className="w-4 h-4 text-[#9B9488]" />
              </div>
            );
          })}
        </div>
      )}

      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setSelected(null)}>
          <div className="bg-[#14141C] border border-[rgba(201,160,92,0.15)] rounded-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="text-lg font-bold text-[#F5F0E8]">{selected.fullName}</h3>
                <p className="text-xs text-[#9B9488]">{selected.profile?.email} · {selected.idType} #{selected.idNumber}</p>
              </div>
              <button onClick={() => setSelected(null)} className="text-[#9B9488] hover:text-[#F5F0E8] text-xl">&times;</button>
            </div>

            <div className="grid grid-cols-2 gap-6 mb-6">
              <div className="space-y-3">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-[#C9A05C]">ID Document</h4>
                <DocLink url={selected.idFrontUrl} label="View ID Front" />
                {selected.idBackUrl && <DocLink url={selected.idBackUrl} label="View ID Back" />}
                <DocLink url={selected.selfieUrl} label="View Selfie" />
              </div>
              <div className="space-y-3">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-[#C9A05C]">Personal Info</h4>
                <p className="text-sm text-[#F5F0E8]">DOB: {new Date(selected.dateOfBirth).toLocaleDateString()}</p>
                <p className="text-sm text-[#F5F0E8]">Phone: {selected.phoneNumber}</p>
                <p className="text-sm text-[#F5F0E8]">Address: {selected.address}</p>
              </div>
            </div>

            {selected.status === 'PENDING' && (
              <div className="space-y-3">
                <div className="flex items-center gap-3 flex-wrap">
                  <button
                    disabled={actionLoading}
                    onClick={() => handleReview(selected.id, 'VERIFIED')}
                    className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
                  >
                    <CheckCircle className="w-4 h-4" /> Approve
                  </button>
                  <button
                    disabled={actionLoading}
                    onClick={() => setDeclineOpen((open) => !open)}
                    className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-500 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
                  >
                    <XCircle className="w-4 h-4" /> Decline
                  </button>
                </div>
                {declineOpen && (
                  <div className="space-y-3">
                    <DeclineReasonPicker
                      id={`kyc-decline-${selected.id}`}
                      value={declineReason}
                      onChange={setDeclineReason}
                      options={DECLINE_REASON_SETS.KYC}
                      disabled={actionLoading}
                    />
                    <div className="flex items-center gap-2">
                      <button
                        disabled={actionLoading || !isDeclineReasonComplete(declineReason)}
                        onClick={() => handleReview(selected.id, 'REJECTED')}
                        className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-500 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
                      >
                        <XCircle className="w-4 h-4" /> Confirm Decline
                      </button>
                      <button
                        disabled={actionLoading}
                        onClick={() => { setDeclineOpen(false); setDeclineReason(null); }}
                        className="px-4 py-2 text-sm font-medium rounded-lg text-[#9B9488] hover:text-[#F5F0E8] transition-colors disabled:opacity-50"
                      >
                        Cancel
                      </button>
                    </div>
                    {!isDeclineReasonComplete(declineReason) && (
                      <p className="text-[10px] font-semibold text-[#8A8279]">
                        Select a reason to decline.
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}

            {selected.status !== 'PENDING' && (
              <div className="flex items-center gap-2 text-sm">
                <span className={selected.status === 'VERIFIED' ? 'text-emerald-400' : 'text-red-400'}>
                  {selected.status === 'VERIFIED' ? 'Approved' : 'Declined'}
                </span>
                {selected.rejectionReason && <span className="text-[#9B9488]">— {selected.rejectionReason}</span>}
                {selected.reviewedAt && <span className="text-[#8A8279]">on {new Date(selected.reviewedAt).toLocaleDateString()}</span>}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
