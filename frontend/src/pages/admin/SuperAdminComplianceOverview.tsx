import { useEffect, useState, useCallback } from 'react';
import {
  Shield,
  CheckCircle,
  XCircle,
  Clock,
  FileText,
  RefreshCw,
  Eye,
  X,
  User,
  Calendar,
  MapPin,
  Phone,
  CreditCard,
  Loader2,
  ExternalLink,
  Printer,
} from 'lucide-react';
import { api } from '../../lib/apiClient';
import { getSignedKycDocUrl } from '../../lib/kycDocs';

interface PendingReview {
  id: string;
  documentType: string;
  fileName: string;
  fileUrl: string;
  fileSize?: number | null;
  hasViewed?: boolean;
  status: string;
  rejectionReason: string | null;
  createdAt: string;
  pawnshop: { id: string; name: string; ownerEmail: string };
}

interface KycPendingReview {
  id: string;
  fullName: string;
  idType: string;
  idNumber: string;
  dateOfBirth?: string;
  address?: string;
  phoneNumber?: string;
  idFrontUrl?: string;
  idBackUrl?: string;
  selfieUrl?: string;
  status: string;
  createdAt: string;
  profile: { email: string; fullName: string; role: string };
  verificationData?: {
    face?: { matched?: boolean; score?: number };
    ocr?: { nameMatch?: boolean; idNumberMatch?: boolean; confidence?: number; extractedName?: string; extractedIdNumber?: string };
    tamper?: { clean?: boolean; flags?: string[] };
    submittedAt?: string;
  };
}

interface PawnshopCompliance {
  pawnshopId: string;
  pawnshopName: string;
  registrationNumber?: string | null;
  address?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
  ownerEmail?: string | null;
  createdAt?: string | null;
  score: number;
  documents: Array<{
    id: string;
    type: string;
    status: string;
    expiryDate: string | null;
    daysUntilExpiry: number | null;
    fileName: string;
  }>;
  summary: {
    totalRequired: number;
    uploaded: number;
    verified: number;
    notExpired: number;
    subscriptionActive: boolean;
  };
}

const DOCUMENT_LABELS: Record<string, string> = {
  DTI_REGISTRATION: 'DTI/SEC Registration',
  MAYORS_PERMIT: "Mayor's Permit",
  BIR_COR: 'BIR COR',
  BSP_LICENSE: 'BSP License',
  AMLC_REGISTRATION: 'AMLC Registration',
  GOVERNMENT_ID: 'Government ID',
  PROOF_OF_ADDRESS: 'Proof of Address',
  FIRE_SAFETY_CERT: 'Fire Safety Cert',
  OCCUPANCY_PERMIT: 'Occupancy Permit',
  SEC_REGISTRATION: 'SEC Registration',
};

function formatDate(value: string | null) {
  if (!value) return 'No expiry';
  const date = new Date(value);
  if (isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function shortLabel(type: string) {
  return (DOCUMENT_LABELS[type] || type).split(' ')[0];
}

function isDocMissing(status: string) {
  return status === 'NOT_UPLOADED' || status === 'REJECTED';
}

function missingDocs(ps: PawnshopCompliance) {
  return ps.documents.filter((d) => isDocMissing(d.status));
}

function complianceBand(ps: PawnshopCompliance) {
  if (ps.summary.verified === ps.summary.totalRequired) {
    return { label: 'Fully Compliant', className: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10' };
  }
  if (ps.score >= 60) {
    return { label: 'Partially Compliant', className: 'text-amber-400 border-amber-500/30 bg-amber-500/10' };
  }
  return { label: 'Non-Compliant', className: 'text-red-400 border-red-500/30 bg-red-500/10' };
}

function docStatusBadge(status: string) {
  switch (status) {
    case 'VERIFIED':
      return { text: '✓', className: 'text-emerald-400', title: 'Verified' };
    case 'UPLOADED':
      return { text: 'U', className: 'text-blue-400', title: 'Submitted / pending review' };
    case 'UNDER_REVIEW':
      return { text: '~', className: 'text-amber-400', title: 'Under review' };
    case 'REJECTED':
      return { text: '✗', className: 'text-red-400', title: 'Rejected' };
    case 'EXPIRED':
      return { text: 'E', className: 'text-red-400', title: 'Expired' };
    default:
      return { text: '—', className: 'text-gilded-muted', title: 'Missing' };
  }
}

function buildRegisterHtml(all: PawnshopCompliance[]) {
  const shortTypes = all[0]?.documents.map((d) => d.type) || [];
  const now = new Date().toLocaleString();
  const rows = all
    .map((ps) => {
      const missing = missingDocs(ps).map((d) => shortLabel(d.type)).join(', ') || 'None';
      const badges = shortTypes
        .map((type) => {
          const doc = ps.documents.find((d) => d.type === type);
          const st = doc?.status || 'NOT_UPLOADED';
          const map: Record<string, string> = {
            VERIFIED: '✓ Verified',
            UPLOADED: 'Submitted',
            UNDER_REVIEW: 'Under review',
            REJECTED: 'Rejected',
            EXPIRED: 'Expired',
          };
          const cls = st === 'VERIFIED' ? 'ok' : st === 'NOT_UPLOADED' ? 'miss' : st === 'REJECTED' || st === 'EXPIRED' ? 'bad' : 'pend';
          return `<td class="${cls}">${map[st] || '—'}</td>`;
        })
        .join('');
      return `<tr>
        <td class="name"><strong>${ps.pawnshopName}</strong>${ps.registrationNumber ? `<br><small>Reg. ${ps.registrationNumber}</small>` : ''}</td>
        ${badges}
        <td class="${missing === 'None' ? 'ok' : 'bad'}">${missing}</td>
        <td class="score">${ps.score}%</td>
      </tr>`;
    })
    .join('');

  const headers = shortTypes.map((t) => `<th>${shortLabel(t)}</th>`).join('');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Regulatory Compliance Register</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: 'Segoe UI', Arial, sans-serif; color: #111; margin: 32px; }
  .head { border-bottom: 3px solid #C9A05C; padding-bottom: 12px; margin-bottom: 20px; }
  .head h1 { margin: 0; font-size: 22px; letter-spacing: 0.4px; }
  .head p { margin: 4px 0 0; color: #555; font-size: 12px; }
  .chips { margin-bottom: 18px; }
  .chip { display: inline-block; margin-right: 8px; padding: 5px 12px; border-radius: 999px; font-size: 12px; border: 1px solid #ddd; background: #f7f7f8; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th { text-align: left; background: #f2f2f3; padding: 7px 8px; border: 1px solid #ddd; white-space: nowrap; }
  td { padding: 7px 8px; border: 1px solid #e2e2e4; }
  tr:nth-child(even) td { background: #fafafa; }
  td.name strong { font-size: 13px; }
  td.name small { color: #888; }
  .ok { color: #1a7f37; }
  .miss { color: #b45309; }
  .bad { color: #c0392b; }
  .pend { color: #2563eb; }
  td.score { font-weight: 700; }
  .foot { margin-top: 20px; font-size: 11px; color: #888; }
</style>
</head>
<body>
  <div class="head">
    <h1>PawnGold &mdash; Regulatory Compliance Register</h1>
    <p>Compiled ${now} &middot; Summarizes all regulatory documents required for each active pawnshop</p>
  </div>
  <div class="chips">
    <span class="chip">Active pawnshops: <b>${all.length}</b></span>
    <span class="chip">Fully compliant: <b>${all.filter((p) => p.summary.verified === p.summary.totalRequired).length}</b></span>
    <span class="chip">With missing docs: <b>${all.filter((p) => missingDocs(p).length > 0).length}</b></span>
  </div>
  <table>
    <thead><tr><th>Pawnshop</th>${headers}<th>Missing</th><th>Score</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="foot">Generated by PawnGold &middot; Integrated Pawnshop Management System</div>
</body>
</html>`;
}

function printRegister(all: PawnshopCompliance[]) {
  const w = window.open('', '_blank', 'width=1000,height=900');
  if (!w) return;
  w.document.write(buildRegisterHtml(all));
  w.document.close();
  w.focus();
  w.print();
}

function SignedDocImage({ url, alt }: { url: string; alt: string }) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setSignedUrl(null);
    setFailed(false);
    getSignedKycDocUrl(url)
      .then((minted) => {
        if (!cancelled) setSignedUrl(minted);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  if (failed) {
    return (
      <div className="flex h-48 w-full items-center justify-center rounded-lg border border-gilded-border bg-gilded-darker/60">
        <span className="text-xs text-gilded-muted">Document unavailable</span>
      </div>
    );
  }

  if (!signedUrl) {
    return (
      <div className="flex h-48 w-full animate-pulse items-center justify-center rounded-lg border border-gilded-border bg-gilded-darker/60">
        <Loader2 className="h-5 w-5 animate-spin text-gilded-muted" />
      </div>
    );
  }

  return (
    <a
      href={signedUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="block overflow-hidden rounded-lg border border-gilded-border transition-colors hover:border-gilded-gold/50"
    >
      <img src={signedUrl} alt={alt} onError={() => setFailed(true)} className="h-48 w-full object-cover" />
    </a>
  );
}

function SignedDocViewer({ url, fileName }: { url: string; fileName: string }) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setSignedUrl(null);
    setFailed(false);
    getSignedKycDocUrl(url)
      .then((minted) => {
        if (!cancelled) setSignedUrl(minted);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  if (failed) {
    return (
      <div className="flex h-72 w-full flex-col items-center justify-center gap-3 rounded-lg border border-gilded-border bg-gilded-darker/60">
        <p className="text-sm text-gilded-muted">Document missing from storage</p>
        <p className="text-xs text-gilded-muted/70">{fileName} &middot; Ask the pawnshop to re-upload</p>
      </div>
    );
  }

  if (!signedUrl) {
    return (
      <div className="flex h-72 w-full animate-pulse items-center justify-center rounded-lg border border-gilded-border bg-gilded-darker/60">
        <Loader2 className="h-6 w-6 animate-spin text-gilded-muted" />
      </div>
    );
  }

  const isImage = /\.(jpe?g|png|gif|webp|bmp)$/i.test(fileName) || /^image\//i.test(url);

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-lg border border-gilded-border bg-gilded-darker/60">
        {isImage ? (
          <img
            src={signedUrl}
            alt={fileName}
            onError={() => setFailed(true)}
            className="mx-auto max-h-[70vh] w-full object-contain"
          />
        ) : (
          <iframe
            src={signedUrl}
            title={fileName}
            className="h-[70vh] w-full"
          />
        )}
      </div>
      <a
        href={signedUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 text-sm text-gilded-gold hover:underline"
      >
        <ExternalLink className="w-4 h-4" />
        Open in new tab
      </a>
    </div>
  );
}

export default function SuperAdminComplianceOverview() {
  const [pendingReviews, setPendingReviews] = useState<PendingReview[]>([]);
  const [kycPendingReviews, setKycPendingReviews] = useState<KycPendingReview[]>([]);
  const [allCompliance, setAllCompliance] = useState<PawnshopCompliance[]>([]);
  const [loading, setLoading] = useState(true);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [verifyingKycId, setVerifyingKycId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [showKycRejectModal, setShowKycRejectModal] = useState<string | null>(null);
  const [docRejectOpen, setDocRejectOpen] = useState(false);
  const [kycRejectReason, setKycRejectReason] = useState('');
  const [activeTab, setActiveTab] = useState<'pending' | 'kyc' | 'overview'>('pending');
  const [viewingKyc, setViewingKyc] = useState<KycPendingReview | null>(null);
  const [viewingDoc, setViewingDoc] = useState<PendingReview | null>(null);
  const [requestingReplacementFor, setRequestingReplacementFor] = useState<string | null>(null);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const overview = await api.get<{ pendingReviews: PendingReview[]; allPawnshops: PawnshopCompliance[]; kycPending: KycPendingReview[] }>('/compliance/super-admin-overview');
      setPendingReviews(overview.pendingReviews);
      setAllCompliance(overview.allPawnshops);
      setKycPendingReviews(overview.kycPending);
    } catch (err) {
      console.error('Failed to fetch compliance data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  async function handleVerify(documentId: string, status: 'VERIFIED' | 'REJECTED') {
    setVerifyingId(documentId);
    try {
      await api.put(`/compliance/documents/${documentId}/verify`, {
        status,
        rejectionReason: status === 'REJECTED' ? rejectReason : undefined,
      });
      setRejectReason('');
      setDocRejectOpen(false);
      fetchData();
    } catch (err) {
      console.error('Verification failed:', err);
    } finally {
      setVerifyingId(null);
    }
  }

  async function handleKycReview(kycId: string, decision: 'VERIFIED' | 'REJECTED') {
    setVerifyingKycId(kycId);
    try {
      await api.patch(`/auth/kyc/${kycId}/review`, {
        decision,
        rejectionReason: decision === 'REJECTED' ? kycRejectReason : undefined,
      });
      setShowKycRejectModal(null);
      setKycRejectReason('');
      fetchData();
    } catch (err) {
      console.error('KYC review failed:', err);
    } finally {
      setVerifyingKycId(null);
    }
  }

  async function handleRequestReplacement(documentId: string) {
    const confirmed = window.confirm(
      'Flag this document for replacement? The owner will be notified and must upload a new, updated copy.',
    );
    if (!confirmed) return;
    setRequestingReplacementFor(documentId);
    try {
      await api.post(`/compliance/documents/${documentId}/request-replacement`, {});
      fetchData();
    } catch (err: any) {
      window.alert(err?.message || 'Failed to request replacement');
      console.error('Request replacement failed:', err);
    } finally {
      setRequestingReplacementFor(null);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gilded-darker flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-2 border-gilded-gold border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gilded-darker p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-display font-bold text-gilded-gold">
              Compliance Overview
            </h1>
            <p className="text-gilded-muted text-sm mt-1">
              Review pawnshop documents and monitor compliance status
            </p>
          </div>
          <button
            onClick={fetchData}
            className="flex items-center gap-2 px-4 py-2 bg-gilded-dark border border-gilded-border rounded-lg text-gilded-light hover:border-gilded-gold/50 transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
        </div>

        <div className="flex gap-4 border-b border-gilded-border pb-2">
          <button
            onClick={() => setActiveTab('pending')}
            className={`flex items-center gap-2 px-4 py-2 font-medium transition-colors ${
              activeTab === 'pending'
                ? 'text-gilded-gold border-b-2 border-gilded-gold'
                : 'text-gilded-muted hover:text-gilded-light'
            }`}
          >
            <Clock className="w-4 h-4" />
            Document Reviews ({pendingReviews.length})
          </button>
          <button
            onClick={() => setActiveTab('kyc')}
            className={`flex items-center gap-2 px-4 py-2 font-medium transition-colors ${
              activeTab === 'kyc'
                ? 'text-gilded-gold border-b-2 border-gilded-gold'
                : 'text-gilded-muted hover:text-gilded-light'
            }`}
          >
            <FileText className="w-4 h-4" />
            KYC Reviews ({kycPendingReviews.length})
          </button>
          <button
            onClick={() => setActiveTab('overview')}
            className={`flex items-center gap-2 px-4 py-2 font-medium transition-colors ${
              activeTab === 'overview'
                ? 'text-gilded-gold border-b-2 border-gilded-gold'
                : 'text-gilded-muted hover:text-gilded-light'
            }`}
          >
            <Shield className="w-4 h-4" />
            All Pawnshops ({allCompliance.length})
          </button>
        </div>

        {activeTab === 'pending' && (() => {
          const grouped = pendingReviews.reduce<Record<string, PendingReview[]>>((acc, review) => {
            const psId = review.pawnshop.id;
            (acc[psId] = acc[psId] || []).push(review);
            return acc;
          }, {});
          const pawnshops = Object.values(grouped);

          return (
            <div className="space-y-4">
              {pawnshops.length === 0 ? (
                <div className="text-center py-12 text-gilded-muted">
                  No documents pending review
                </div>
              ) : (
                pawnshops.map((reviews) => {
                  const pawnshop = reviews[0].pawnshop;
                  return (
                    <div
                      key={pawnshop.id}
                      className="bg-gilded-dark border border-gilded-border rounded-xl p-5"
                    >
                      <div className="flex items-start justify-between mb-4 pb-4 border-b border-gilded-border">
                        <div className="flex items-start gap-4">
                          <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
                            <FileText className="w-5 h-5 text-blue-400" />
                          </div>
                          <div>
                            <h4 className="font-semibold text-gilded-light">{pawnshop.name}</h4>
                            <p className="text-sm text-gilded-muted mt-0.5">{pawnshop.ownerEmail}</p>
                            <p className="text-xs text-gilded-muted mt-1">
                              {reviews.length} document{reviews.length > 1 ? 's' : ''} pending review
                            </p>
                          </div>
                        </div>
                      </div>

                      <div className="space-y-3">
                        {reviews.map((review) => (
                          <div
                            key={review.id}
                            className="flex items-start justify-between gap-3 rounded-lg bg-gilded-darker/60 border border-gilded-border px-4 py-3"
                          >
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <Clock className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                                <h5 className="font-medium text-gilded-light">
                                  {DOCUMENT_LABELS[review.documentType] || review.documentType}
                                </h5>
                              </div>
                              <p className="text-xs text-gilded-muted mt-1">
                                File: {review.fileName} &middot; Submitted: {new Date(review.createdAt).toLocaleDateString()}
                              </p>
                            </div>
                            <button
                              onClick={() => setViewingDoc(review)}
                              className="flex items-center gap-1 px-3 py-1.5 bg-blue-500/10 text-blue-400 rounded-lg hover:bg-blue-500/20 transition-colors shrink-0"
                            >
                              <Eye className="w-4 h-4" />
                              View
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          );
        })()}

        {activeTab === 'kyc' && (
          <div className="space-y-4">
            {kycPendingReviews.length === 0 ? (
              <div className="text-center py-12 text-gilded-muted">
                No KYC submissions pending review
              </div>
            ) : (
              kycPendingReviews.map((kyc) => (
                <div
                  key={kyc.id}
                  className="bg-gilded-dark border border-gilded-border rounded-xl p-5"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-4">
                      <div className="w-10 h-10 rounded-lg bg-purple-500/10 flex items-center justify-center">
                        <FileText className="w-5 h-5 text-purple-400" />
                      </div>
                      <div>
                        <h4 className="font-semibold text-gilded-light">
                          {kyc.fullName}
                        </h4>
                        <p className="text-sm text-gilded-muted mt-0.5">
                          {kyc.profile.email} &middot; {kyc.idType.replace(/_/g, ' ')}
                        </p>
                        <p className="text-xs text-gilded-muted mt-1">
                          ID: {kyc.idNumber} &middot; Submitted: {new Date(kyc.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setViewingKyc(kyc)}
                        className="flex items-center gap-1 px-3 py-1.5 bg-blue-500/10 text-blue-400 rounded-lg hover:bg-blue-500/20 transition-colors"
                      >
                        <Eye className="w-4 h-4" />
                        View Docs
                      </button>
                      <button
                        onClick={() => handleKycReview(kyc.id, 'VERIFIED')}
                        disabled={verifyingKycId === kyc.id}
                        className="flex items-center gap-1 px-3 py-1.5 bg-emerald-500/10 text-emerald-400 rounded-lg hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
                      >
                        <CheckCircle className="w-4 h-4" />
                        Approve
                      </button>
                      <button
                        onClick={() => setShowKycRejectModal(kyc.id)}
                        disabled={verifyingKycId === kyc.id}
                        className="flex items-center gap-1 px-3 py-1.5 bg-red-500/10 text-red-400 rounded-lg hover:bg-red-500/20 transition-colors disabled:opacity-50"
                      >
                        <XCircle className="w-4 h-4" />
                        Reject
                      </button>
                    </div>
                  </div>

                  {showKycRejectModal === kyc.id && (
                    <div className="mt-4 p-4 bg-gilded-darker border border-red-500/30 rounded-lg">
                      <label className="block text-sm text-gilded-muted mb-2">
                        Rejection Reason
                      </label>
                      <textarea
                        value={kycRejectReason}
                        onChange={(e) => setKycRejectReason(e.target.value)}
                        className="w-full px-3 py-2 bg-gilded-dark border border-gilded-border rounded-lg text-gilded-light text-sm"
                        rows={3}
                        placeholder="Enter reason for rejection..."
                      />
                      <div className="flex gap-2 mt-2">
                        <button
                          onClick={() => handleKycReview(kyc.id, 'REJECTED')}
                          disabled={!kycRejectReason.trim()}
                          className="px-4 py-1.5 bg-red-500 text-white rounded-lg text-sm font-medium disabled:opacity-50"
                        >
                          Confirm Reject
                        </button>
                        <button
                          onClick={() => {
                            setShowKycRejectModal(null);
                            setKycRejectReason('');
                          }}
                          className="px-4 py-1.5 bg-gilded-dark border border-gilded-border rounded-lg text-gilded-light text-sm"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {activeTab === 'overview' && (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-display font-bold text-gilded-gold">
                  Regulatory Compliance Register
                </h2>
                <p className="text-xs text-gilded-muted mt-0.5">
                  Compiled {new Date().toLocaleString()} &middot; {' '}
                  {allCompliance.length} active pawnshops
                </p>
              </div>
              <button
                onClick={() => printRegister(allCompliance)}
                className="flex items-center gap-2 px-4 py-2 bg-gilded-dark border border-gilded-gold/40 rounded-lg text-gilded-gold hover:border-gilded-gold/70 transition-colors"
              >
                <Printer className="w-4 h-4" />
                Print / Export
              </button>
            </div>

            <div className="flex flex-wrap gap-2">
              <span className="px-3 py-1.5 rounded-full text-xs bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
                Fully Compliant: {allCompliance.filter((p) => p.summary.verified === p.summary.totalRequired).length}
              </span>
              <span className="px-3 py-1.5 rounded-full text-xs bg-amber-500/10 border border-amber-500/30 text-amber-400">
                Partial: {allCompliance.filter((p) => p.summary.verified !== p.summary.totalRequired && missingDocs(p).length === 0).length}
              </span>
              <span className="px-3 py-1.5 rounded-full text-xs bg-red-500/10 border border-red-500/30 text-red-400">
                With Missing Docs: {allCompliance.filter((p) => missingDocs(p).length > 0).length}
              </span>
            </div>

            <div className="overflow-x-auto bg-gilded-dark border border-gilded-border rounded-xl">
              <table className="w-full text-xs min-w-[760px]">
                <thead>
                  <tr className="border-b border-gilded-border text-gilded-muted">
                    <th className="text-left px-4 py-3 font-medium">Pawnshop</th>
                    {allCompliance[0]?.documents.map((d) => (
                      <th key={d.type} className="text-center px-2 py-3 font-medium" title={DOCUMENT_LABELS[d.type]}>
                        {shortLabel(d.type)}
                      </th>
                    ))}
                    <th className="text-left px-4 py-3 font-medium">Missing</th>
                    <th className="text-center px-4 py-3 font-medium">Score</th>
                  </tr>
                </thead>
                <tbody>
                  {allCompliance.map((ps) => {
                    const missing = missingDocs(ps);
                    return (
                      <tr key={ps.pawnshopId} className="border-b border-gilded-border/50 last:border-0">
                        <td className="px-4 py-3">
                          <p className="font-semibold text-gilded-light">{ps.pawnshopName}</p>
                          <p className="text-[11px] text-gilded-muted truncate max-w-[180px]">
                            {[ps.address, ps.contactPhone].filter(Boolean).join(' · ') || 'No contact info'}
                          </p>
                        </td>
                        {ps.documents.map((doc) => {
                          const badge = docStatusBadge(doc.status);
                          return (
                            <td key={doc.type} className="text-center px-2 py-3" title={`${DOCUMENT_LABELS[doc.type]}: ${badge.title}`}>
                              <span className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-sm font-bold border border-current/30 ${badge.className}`}>
                                {badge.text}
                              </span>
                            </td>
                          );
                        })}
                        <td className="px-4 py-3">
                          {missing.length === 0 ? (
                            <span className="text-emerald-400">None</span>
                          ) : (
                            <span className="text-red-400 font-medium">
                              {missing.map((d) => shortLabel(d.type)).join(', ')}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className={`font-bold ${
                            ps.score >= 80 ? 'text-emerald-400' : ps.score >= 60 ? 'text-amber-400' : 'text-red-400'
                          }`}>
                            {ps.score}%
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {allCompliance.map((ps) => {
                const missing = missingDocs(ps);
                const band = complianceBand(ps);
                return (
                  <div
                    key={ps.pawnshopId}
                    className="bg-gilded-dark border border-gilded-border rounded-xl p-5"
                  >
                    <div className="flex items-center justify-between mb-3 gap-2">
                      <div className="min-w-0">
                        <h4 className="font-semibold text-gilded-light truncate">{ps.pawnshopName}</h4>
                        <p className="text-[11px] text-gilded-muted truncate">
                          {[ps.address, ps.contactPhone, ps.ownerEmail].filter(Boolean).join(' · ') || 'No contact info'}
                        </p>
                      </div>
                      <span className={`shrink-0 text-xs font-medium px-2.5 py-1 rounded-full border ${band.className}`}>
                        {band.label} {ps.score}%
                      </span>
                    </div>

                    {missing.length > 0 && (
                      <div className="mb-3 p-2.5 rounded-lg bg-red-500/10 border border-red-500/30">
                        <p className="text-[11px] text-red-400 font-semibold mb-1">Missing Documents</p>
                        <p className="text-xs text-red-300">{missing.map((d) => DOCUMENT_LABELS[d.type] || d.type).join(' · ')}</p>
                      </div>
                    )}

                    <div className="space-y-2">
                      <div className="flex justify-between text-xs">
                        <span className="text-gilded-muted">Verified</span>
                        <span className="text-emerald-400">{ps.summary.verified}/{ps.summary.totalRequired}</span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-gilded-muted">Submitted / Pending</span>
                        <span className="text-blue-400">
                          {ps.documents.filter((d) => d.status === 'UPLOADED' || d.status === 'UNDER_REVIEW').length}
                        </span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-gilded-muted">Expired</span>
                        <span className="text-red-400">{ps.documents.filter((d) => d.status === 'EXPIRED').length}</span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-gilded-muted">Subscription</span>
                        <span className={ps.summary.subscriptionActive ? 'text-emerald-400' : 'text-red-400'}>
                          {ps.summary.subscriptionActive ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                    </div>

                    <div className="mt-3 pt-3 border-t border-gilded-border space-y-1.5">
                      {ps.documents.map((doc) => {
                        const expired = doc.status === 'EXPIRED';
                        const expiring =
                          !expired &&
                          doc.daysUntilExpiry !== null &&
                          doc.daysUntilExpiry <= 30;
                        const replacementEligible =
                          !!doc.id &&
                          (expired ||
                            (doc.status === 'VERIFIED' &&
                              doc.daysUntilExpiry !== null &&
                              doc.daysUntilExpiry <= 60));
                        return (
                          <div
                            key={doc.type}
                            className="flex items-center justify-between text-[11px]"
                          >
                            <span className={`flex items-center gap-1.5 text-gilded-light truncate ${expired ? 'text-red-400' : ''}`}>
                              <span
                                className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                                  expired
                                    ? 'bg-red-400'
                                    : expiring
                                    ? 'bg-amber-400'
                                    : doc.status === 'VERIFIED'
                                    ? 'bg-emerald-400'
                                    : doc.status === 'NOT_UPLOADED' || doc.status === 'REJECTED'
                                    ? 'bg-red-400/70'
                                    : 'bg-blue-400'
                                }`}
                              />
                              {DOCUMENT_LABELS[doc.type] || doc.type}
                            </span>
                            <span className="flex items-center gap-2">
                              <span
                                className={`ml-2 text-right ${
                                  expired
                                    ? 'text-red-400 font-medium'
                                    : expiring
                                    ? 'text-amber-400 font-medium'
                                    : 'text-gilded-muted'
                                }`}
                              >
                                {doc.status === 'NOT_UPLOADED'
                                  ? 'Missing'
                                  : doc.status === 'REJECTED'
                                  ? 'Rejected'
                                  : doc.expiryDate
                                  ? `${expired ? 'Expired' : 'Expires'} ${formatDate(doc.expiryDate)}${
                                      expiring && doc.daysUntilExpiry !== null ? ` (${doc.daysUntilExpiry}d)` : ''
                                    }`
                                  : 'No expiry'}
                              </span>
                              {replacementEligible && (
                                <button
                                  onClick={() => handleRequestReplacement(doc.id)}
                                  disabled={requestingReplacementFor === doc.id}
                                  className="shrink-0 px-2 py-0.5 rounded text-[10px] font-semibold bg-gilded-gold/10 text-gilded-gold border border-gilded-gold/30 hover:bg-gilded-gold/20 transition-colors disabled:opacity-50"
                                >
                                  {requestingReplacementFor === doc.id ? '...' : 'Request New Overwrite'}
                                </button>
                              )}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {viewingKyc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90" onClick={() => setViewingKyc(null)}>
          <div className="border border-gilded-border rounded-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto shadow-2xl relative" style={{ backgroundColor: '#0A0A0F' }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b border-gilded-border">
              <div>
                <h2 className="text-lg font-display font-bold text-gilded-gold">KYC Document Review</h2>
                <p className="text-sm text-gilded-muted mt-0.5">{viewingKyc.profile.email} &middot; {viewingKyc.idType.replace(/_/g, ' ')}</p>
              </div>
              <button onClick={() => setViewingKyc(null)} className="p-2 rounded-lg hover:bg-gilded-darker transition-colors">
                <X className="w-5 h-5 text-gilded-muted" />
              </button>
            </div>

            <div className="p-5 space-y-6">
              <div className="grid grid-cols-2 gap-4 p-4 rounded-xl" style={{ backgroundColor: '#12121C' }}>
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-gilded-muted text-xs"><User className="w-3.5 h-3.5" /> Full Name</div>
                  <p className="text-gilded-light font-medium">{viewingKyc.fullName}</p>
                </div>
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-gilded-muted text-xs"><Calendar className="w-3.5 h-3.5" /> Date of Birth</div>
                  <p className="text-gilded-light font-medium">{viewingKyc.dateOfBirth || '—'}</p>
                </div>
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-gilded-muted text-xs"><Phone className="w-3.5 h-3.5" /> Phone Number</div>
                  <p className="text-gilded-light font-medium">{viewingKyc.phoneNumber || '—'}</p>
                </div>
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-gilded-muted text-xs"><CreditCard className="w-3.5 h-3.5" /> ID Number</div>
                  <p className="text-gilded-light font-medium">{viewingKyc.idNumber}</p>
                </div>
                <div className="col-span-2 space-y-1">
                  <div className="flex items-center gap-2 text-gilded-muted text-xs"><MapPin className="w-3.5 h-3.5" /> Address</div>
                  <p className="text-gilded-light font-medium">{viewingKyc.address || '—'}</p>
                </div>
              </div>

              <div className="space-y-3 p-4 rounded-xl" style={{ backgroundColor: '#12121C' }}>
                <h4 className="text-sm font-semibold text-gilded-light">Submitted Documents</h4>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  {viewingKyc.idFrontUrl && (
                    <div className="space-y-1">
                      <p className="text-[11px] text-gilded-muted font-medium">ID Front</p>
                      <SignedDocImage url={viewingKyc.idFrontUrl} alt="ID Front" />
                    </div>
                  )}
                  {viewingKyc.idBackUrl && (
                    <div className="space-y-1">
                      <p className="text-[11px] text-gilded-muted font-medium">ID Back</p>
                      <SignedDocImage url={viewingKyc.idBackUrl} alt="ID Back" />
                    </div>
                  )}
                  {viewingKyc.selfieUrl && (
                    <div className="space-y-1">
                      <p className="text-[11px] text-gilded-muted font-medium">Selfie</p>
                      <SignedDocImage url={viewingKyc.selfieUrl} alt="Selfie" />
                    </div>
                  )}
                  {!viewingKyc.idFrontUrl && !viewingKyc.idBackUrl && !viewingKyc.selfieUrl && (
                    <p className="text-gilded-muted text-sm col-span-3">No documents attached</p>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-gilded-border">
                <button onClick={() => setViewingKyc(null)} className="px-4 py-2 bg-gilded-darker border border-gilded-border rounded-lg text-gilded-light text-sm hover:border-gilded-gold/30 transition-colors">
                  Close
                </button>
                <button
                  onClick={() => { handleKycReview(viewingKyc.id, 'VERIFIED'); setViewingKyc(null); }}
                  disabled={verifyingKycId === viewingKyc.id}
                  className="flex items-center gap-1.5 px-4 py-2 bg-emerald-500/10 text-emerald-400 rounded-lg hover:bg-emerald-500/20 transition-colors disabled:opacity-50 text-sm font-medium"
                >
                  <CheckCircle className="w-4 h-4" />
                  Approve
                </button>
                <button
                  onClick={() => { setViewingKyc(null); setShowKycRejectModal(viewingKyc.id); }}
                  disabled={verifyingKycId === viewingKyc.id}
                  className="flex items-center gap-1.5 px-4 py-2 bg-red-500/10 text-red-400 rounded-lg hover:bg-red-500/20 transition-colors disabled:opacity-50 text-sm font-medium"
                >
                  <XCircle className="w-4 h-4" />
                  Reject
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {viewingDoc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90" onClick={() => setViewingDoc(null)}>
          <div className="border border-gilded-border rounded-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto shadow-2xl relative" style={{ backgroundColor: '#0A0A0F' }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b border-gilded-border">
              <div>
                <h2 className="text-lg font-display font-bold text-gilded-gold">
                  {DOCUMENT_LABELS[viewingDoc.documentType] || viewingDoc.documentType}
                </h2>
                <p className="text-sm text-gilded-muted mt-0.5">
                  {viewingDoc.pawnshop.name} &middot; {viewingDoc.pawnshop.ownerEmail}
                </p>
              </div>
              <button onClick={() => setViewingDoc(null)} className="p-2 rounded-lg hover:bg-gilded-darker transition-colors">
                <X className="w-5 h-5 text-gilded-muted" />
              </button>
            </div>

            <div className="p-5 space-y-5">
              <div className="flex items-center justify-between text-xs text-gilded-muted">
                <span className="font-medium">{viewingDoc.fileName}</span>
                <span>
                  Submitted {new Date(viewingDoc.createdAt).toLocaleDateString()} &middot;{' '}
                  {viewingDoc.fileSize ? `${(viewingDoc.fileSize / 1024).toFixed(1)} KB` : 'Unknown size'}
                </span>
              </div>

              <SignedDocViewer url={viewingDoc.fileUrl} fileName={viewingDoc.fileName} />

              {docRejectOpen && (
                <div className="p-4 bg-gilded-darker border border-red-500/30 rounded-lg">
                  <label className="block text-sm text-gilded-muted mb-2">
                    Rejection Reason
                  </label>
                  <textarea
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    className="w-full px-3 py-2 bg-gilded-dark border border-gilded-border rounded-lg text-gilded-light text-sm"
                    rows={3}
                    placeholder="Enter reason for rejection..."
                  />
                  <div className="flex gap-2 mt-2">
                    <button
                      onClick={() => { handleVerify(viewingDoc.id, 'REJECTED'); setViewingDoc(null); }}
                      disabled={!rejectReason.trim()}
                      className="px-4 py-1.5 bg-red-500 text-white rounded-lg text-sm font-medium disabled:opacity-50"
                    >
                      Confirm Reject
                    </button>
                    <button
                      onClick={() => {
                        setDocRejectOpen(false);
                        setRejectReason('');
                      }}
                      className="px-4 py-1.5 bg-gilded-dark border border-gilded-border rounded-lg text-gilded-light text-sm"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-gilded-border">
                <button onClick={() => setViewingDoc(null)} className="px-4 py-2 bg-gilded-darker border border-gilded-border rounded-lg text-gilded-light text-sm hover:border-gilded-gold/30 transition-colors">
                  Close
                </button>
                <button
                  onClick={() => { handleVerify(viewingDoc.id, 'VERIFIED'); setViewingDoc(null); }}
                  disabled={verifyingId === viewingDoc.id}
                  className="flex items-center gap-1.5 px-4 py-2 bg-emerald-500/10 text-emerald-400 rounded-lg hover:bg-emerald-500/20 transition-colors disabled:opacity-50 text-sm font-medium"
                >
                  <CheckCircle className="w-4 h-4" />
                  Approve
                </button>
                <button
                  onClick={() => setDocRejectOpen(true)}
                  disabled={verifyingId === viewingDoc.id}
                  className="flex items-center gap-1.5 px-4 py-2 bg-red-500/10 text-red-400 rounded-lg hover:bg-red-500/20 transition-colors disabled:opacity-50 text-sm font-medium"
                >
                  <XCircle className="w-4 h-4" />
                  Reject
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
