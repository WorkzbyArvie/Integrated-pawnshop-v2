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
  score: number;
  documents: Array<{
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
      <img src={signedUrl} alt={alt} className="h-48 w-full object-cover" />
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
        <p className="text-sm text-gilded-muted">Document unavailable</p>
        <p className="text-xs text-gilded-muted/70">{fileName}</p>
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
          <img src={signedUrl} alt={fileName} className="mx-auto max-h-[70vh] w-full object-contain" />
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

        {activeTab === 'pending' && (
          <div className="space-y-4">
            {pendingReviews.length === 0 ? (
              <div className="text-center py-12 text-gilded-muted">
                No documents pending review
              </div>
            ) : (
              pendingReviews.map((review) => (
                <div
                  key={review.id}
                  className="bg-gilded-dark border border-gilded-border rounded-xl p-5"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-4">
                      <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
                        <FileText className="w-5 h-5 text-blue-400" />
                      </div>
                      <div>
                        <h4 className="font-semibold text-gilded-light">
                          {DOCUMENT_LABELS[review.documentType] || review.documentType}
                        </h4>
                        <p className="text-sm text-gilded-muted mt-0.5">
                          {review.pawnshop.name} &middot; {review.pawnshop.ownerEmail}
                        </p>
                        <p className="text-xs text-gilded-muted mt-1">
                          File: {review.fileName} &middot; Submitted: {new Date(review.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setViewingDoc(review)}
                        className="flex items-center gap-1 px-3 py-1.5 bg-blue-500/10 text-blue-400 rounded-lg hover:bg-blue-500/20 transition-colors"
                      >
                        <Eye className="w-4 h-4" />
                        View
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

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
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {allCompliance.map((ps) => (
              <div
                key={ps.pawnshopId}
                className="bg-gilded-dark border border-gilded-border rounded-xl p-5"
              >
                <div className="flex items-center justify-between mb-3">
                  <h4 className="font-semibold text-gilded-light">{ps.pawnshopName}</h4>
                  <span
                    className={`text-lg font-bold ${
                      ps.score >= 80
                        ? 'text-emerald-400'
                        : ps.score >= 60
                        ? 'text-yellow-400'
                        : ps.score >= 40
                        ? 'text-orange-400'
                        : 'text-red-400'
                    }`}
                  >
                    {ps.score}%
                  </span>
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between text-xs">
                    <span className="text-gilded-muted">Uploaded</span>
                    <span className="text-gilded-light">
                      {ps.summary.uploaded}/{ps.summary.totalRequired}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-gilded-muted">Verified</span>
                    <span className="text-emerald-400">{ps.summary.verified}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-gilded-muted">Not Expired</span>
                    <span className="text-yellow-400">{ps.summary.notExpired}</span>
                  </div>
                </div>
                <div className="mt-3 pt-3 border-t border-gilded-border space-y-1.5">
                  {ps.documents.map((doc) => {
                    const expired = doc.status === 'EXPIRED';
                    const expiring =
                      !expired &&
                      doc.daysUntilExpiry !== null &&
                      doc.daysUntilExpiry <= 30;
                    const label =
                      (DOCUMENT_LABELS[doc.type] || doc.type).split(' ')[0];
                    return (
                      <div
                        key={doc.type}
                        className="flex items-center justify-between text-[11px]"
                      >
                        <span
                          className={`flex items-center gap-1.5 text-gilded-light truncate ${
                            expired ? 'text-red-400' : ''
                          }`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                              expired
                                ? 'bg-red-400'
                                : expiring
                                ? 'bg-amber-400'
                                : doc.status === 'VERIFIED'
                                ? 'bg-emerald-400'
                                : 'bg-gray-400'
                            }`}
                          />
                          {label}
                        </span>
                        <span
                          className={`ml-2 text-right ${
                            expired
                              ? 'text-red-400 font-medium'
                              : expiring
                              ? 'text-amber-400 font-medium'
                              : 'text-gilded-muted'
                          }`}
                        >
                          {doc.expiryDate
                            ? `${expired ? 'Expired' : 'Expires'} ${formatDate(doc.expiryDate)}${
                                expiring && doc.daysUntilExpiry !== null
                                  ? ` (${doc.daysUntilExpiry}d)`
                                  : ''
                              }`
                            : doc.status === 'NOT_UPLOADED'
                            ? 'Not uploaded'
                            : 'No expiry'}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
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
