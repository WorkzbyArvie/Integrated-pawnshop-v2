import { useEffect, useState, useCallback } from 'react';
import { CheckCircle, XCircle, Clock, Eye, Shield, RefreshCw, AlertTriangle } from 'lucide-react';
import { api } from '../lib/apiClient';
import DocLink from './DocLink';

interface VerificationData {
  ocr: { nameMatch: boolean; idNumberMatch: boolean; confidence: number; extractedName: string; extractedIdNumber: string };
  face: { matched: boolean; score: number };
  tamper: { clean: boolean; flags: string[] };
  submittedAt: string;
}

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
  verificationData: VerificationData | null;
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

function ScoreBadge({ label, value, pass, format }: { label: string; value: number; pass: boolean; format?: 'pct' | 'decimal' }) {
  const display = format === 'pct' ? `${Math.round(value)}%` : format === 'decimal' ? `${Math.round(value * 100)}%` : String(value);
  return (
    <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${pass ? 'bg-emerald-500/5 border-emerald-500/20' : 'bg-red-500/5 border-red-500/20'}`}>
      <div className={`w-2 h-2 rounded-full ${pass ? 'bg-emerald-400' : 'bg-red-400'}`} />
      <span className="text-xs text-[#9B9488]">{label}</span>
      <span className={`text-sm font-semibold ${pass ? 'text-emerald-400' : 'text-red-400'}`}>{display}</span>
    </div>
  );
}

export default function BidderKycReview() {
  const [records, setRecords] = useState<KycRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<KycRecord | null>(null);
  const [rejectReason, setRejectReason] = useState('');
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
    if (decision === 'REJECTED' && !rejectReason.trim()) return;
    setActionLoading(true);
    try {
      await api.patch(`/auth/kyc/${id}/review`, {
        decision,
        rejectionReason: decision === 'REJECTED' ? rejectReason.trim() : undefined,
      });
      setSelected(null);
      setRejectReason('');
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
          <h2 className="text-xl font-bold text-[#EAE2D6]" style={{ fontFamily: "'Syne', sans-serif" }}>
            Bidder KYC Verification
          </h2>
          <p className="text-sm text-[#9B9488] mt-1">Review identity documents submitted by auction bidders</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setTab('pending')}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${tab === 'pending' ? 'bg-[#C9A05C] text-[#0A0A0F]' : 'bg-[#1C1C26] text-[#9B9488] hover:text-[#EAE2D6]'}`}
          >
            Pending ({tab === 'pending' ? records.length : '...'})
          </button>
          <button
            onClick={() => setTab('all')}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${tab === 'all' ? 'bg-[#C9A05C] text-[#0A0A0F]' : 'bg-[#1C1C26] text-[#9B9488] hover:text-[#EAE2D6]'}`}
          >
            All
          </button>
          <button onClick={load} className="p-1.5 rounded-lg bg-[#1C1C26] text-[#9B9488] hover:text-[#EAE2D6] transition-colors">
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
            const vd = r.verificationData;
            return (
              <div
                key={r.id}
                className="flex items-center justify-between p-4 rounded-xl bg-[#1C1C26] border border-[rgba(201,160,92,0.08)] hover:border-[rgba(201,160,92,0.2)] transition-colors cursor-pointer"
                onClick={() => setSelected(r)}
              >
                <div className="flex items-center gap-4">
                  <div className={`p-2 rounded-lg ${st.bg} ${st.color}`}>{st.icon}</div>
                  <div>
                    <p className="text-sm font-medium text-[#EAE2D6]">{r.fullName}</p>
                    <p className="text-xs text-[#9B9488]">{r.profile?.email || '—'} · {r.idType} · Submitted {new Date(r.createdAt).toLocaleDateString()}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {vd && (
                    <div className="flex items-center gap-2 text-xs">
                      <span className={vd.ocr?.nameMatch ? 'text-emerald-400' : 'text-red-400'}>
                        OCR {vd.ocr?.nameMatch ? '✓' : '✗'}
                      </span>
                      <span className={vd.face?.matched ? 'text-emerald-400' : 'text-red-400'}>
                        Face {vd.face?.matched ? '✓' : '✗'}
                      </span>
                      <span className={vd.tamper?.clean ? 'text-emerald-400' : 'text-red-400'}>
                        Tamper {vd.tamper?.clean ? '✓' : '✗'}
                      </span>
                    </div>
                  )}
                  <Eye className="w-4 h-4 text-[#9B9488]" />
                </div>
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
                <h3 className="text-lg font-bold text-[#EAE2D6]">{selected.fullName}</h3>
                <p className="text-xs text-[#9B9488]">{selected.profile?.email} · {selected.idType} #{selected.idNumber}</p>
              </div>
              <button onClick={() => setSelected(null)} className="text-[#9B9488] hover:text-[#EAE2D6] text-xl">&times;</button>
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
                <p className="text-sm text-[#EAE2D6]">DOB: {new Date(selected.dateOfBirth).toLocaleDateString()}</p>
                <p className="text-sm text-[#EAE2D6]">Phone: {selected.phoneNumber}</p>
                <p className="text-sm text-[#EAE2D6]">Address: {selected.address}</p>
              </div>
            </div>

            {selected.verificationData && (
              <div className="mb-6 p-4 rounded-xl bg-[#1C1C26] border border-[rgba(201,160,92,0.1)]">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-[#C9A05C] mb-3">
                  Client-Side Verification Results (Advisory)
                </h4>
                <div className="flex flex-wrap gap-3">
                  <ScoreBadge label="OCR Name Match" value={selected.verificationData.ocr?.confidence || 0} pass={selected.verificationData.ocr?.nameMatch === true} format="pct" />
                  <ScoreBadge label="OCR ID Number" value={100} pass={selected.verificationData.ocr?.idNumberMatch === true} format="pct" />
                  <ScoreBadge label="Face Similarity" value={selected.verificationData.face?.score || 0} pass={selected.verificationData.face?.matched === true} format="decimal" />
                  <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${selected.verificationData.tamper?.clean ? 'bg-emerald-500/5 border-emerald-500/20' : 'bg-red-500/5 border-red-500/20'}`}>
                    <div className={`w-2 h-2 rounded-full ${selected.verificationData.tamper?.clean ? 'bg-emerald-400' : 'bg-red-400'}`} />
                    <span className="text-xs text-[#9B9488]">Tamper Check</span>
                    <span className={`text-sm font-semibold ${selected.verificationData.tamper?.clean ? 'text-emerald-400' : 'text-red-400'}`}>
                      {selected.verificationData.tamper?.clean ? 'Clean' : 'Flags'}
                    </span>
                  </div>
                </div>
                {selected.verificationData.tamper?.flags && selected.verificationData.tamper.flags.length > 0 && (
                  <div className="mt-3 flex items-start gap-2 text-xs text-amber-400">
                    <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                    <span>{selected.verificationData.tamper.flags.join('; ')}</span>
                  </div>
                )}
                <p className="text-[10px] text-[#6B655C] mt-2">
                  Extracted name: "{selected.verificationData.ocr?.extractedName || 'N/A'}" · Extracted ID: "{selected.verificationData.ocr?.extractedIdNumber || 'N/A'}" · These results are advisory — make your own judgment.
                </p>
              </div>
            )}

            {selected.status === 'PENDING' && (
              <div className="flex items-end gap-3">
                <button
                  disabled={actionLoading}
                  onClick={() => handleReview(selected.id, 'VERIFIED')}
                  className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
                >
                  <CheckCircle className="w-4 h-4" /> Approve
                </button>
                <div className="flex-1">
                  <input
                    type="text"
                    placeholder="Rejection reason (required to reject)"
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    className="w-full px-3 py-2 bg-[#1C1C26] border border-[rgba(201,160,92,0.15)] rounded-lg text-sm text-[#EAE2D6] placeholder:text-[#6B655C] focus:outline-none focus:border-[#C9A05C]"
                  />
                </div>
                <button
                  disabled={actionLoading || !rejectReason.trim()}
                  onClick={() => handleReview(selected.id, 'REJECTED')}
                  className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-500 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
                >
                  <XCircle className="w-4 h-4" /> Reject
                </button>
              </div>
            )}

            {selected.status !== 'PENDING' && (
              <div className="flex items-center gap-2 text-sm">
                <span className={selected.status === 'VERIFIED' ? 'text-emerald-400' : 'text-red-400'}>
                  {selected.status === 'VERIFIED' ? 'Approved' : 'Rejected'}
                </span>
                {selected.rejectionReason && <span className="text-[#9B9488]">— {selected.rejectionReason}</span>}
                {selected.reviewedAt && <span className="text-[#6B655C]">on {new Date(selected.reviewedAt).toLocaleDateString()}</span>}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
