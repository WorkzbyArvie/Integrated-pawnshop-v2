import { useEffect, useState } from 'react';
import {
  Upload,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Clock,
  Shield,
  RefreshCw,
  Eye,
} from 'lucide-react';
import { api } from '../../lib/apiClient';
import { supabase } from '../../lib/supabaseClient';
import ComplianceExpiryRegister from '../../components/ComplianceExpiryRegister';

interface ComplianceData {
  score: number;
  documents: Array<{
    type: string;
    status: string;
    expiryDate: string | null;
    daysUntilExpiry: number | null;
    fileName: string;
    rejectionReason?: string;
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
  BIR_COR: 'BIR Certificate of Registration',
  BSP_LICENSE: 'BSP Pawnshop License',
  AMLC_REGISTRATION: 'AMLC Registration',
  GOVERNMENT_ID: 'Valid Government ID',
  PROOF_OF_ADDRESS: 'Proof of Business Address',
  FIRE_SAFETY_CERT: 'Fire Safety Certificate',
  OCCUPANCY_PERMIT: 'Occupancy Permit',
  SEC_REGISTRATION: 'SEC Registration',
};

const STATUS_CONFIG: Record<string, { color: string; bg: string; icon: React.ReactNode }> = {
  NOT_UPLOADED: {
    color: 'text-gray-400',
    bg: 'bg-gray-500/10',
    icon: <Upload className="w-4 h-4" />,
  },
  UPLOADED: {
    color: 'text-blue-400',
    bg: 'bg-blue-500/10',
    icon: <Clock className="w-4 h-4" />,
  },
  UNDER_REVIEW: {
    color: 'text-yellow-400',
    bg: 'bg-yellow-500/10',
    icon: <Eye className="w-4 h-4" />,
  },
  VERIFIED: {
    color: 'text-emerald-400',
    bg: 'bg-emerald-500/10',
    icon: <CheckCircle className="w-4 h-4" />,
  },
  REJECTED: {
    color: 'text-red-400',
    bg: 'bg-red-500/10',
    icon: <XCircle className="w-4 h-4" />,
  },
  EXPIRED: {
    color: 'text-orange-400',
    bg: 'bg-orange-500/10',
    icon: <AlertTriangle className="w-4 h-4" />,
  },
};

function getScoreColor(score: number) {
  if (score >= 80) return 'text-emerald-400';
  if (score >= 60) return 'text-yellow-400';
  if (score >= 40) return 'text-orange-400';
  return 'text-red-400';
}

function getScoreLabel(score: number) {
  if (score >= 80) return 'Full Access';
  if (score >= 60) return 'Restricted Access';
  if (score >= 40) return 'Limited Access';
  return 'Critical - Features Locked';
}

function formatExpiryDate(value: string) {
  const date = new Date(value);
  if (isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/**
 * One upload control per document, not one shared form plus seven buttons.
 *
 * The previous shape rendered an "Upload" button on every row that only set the
 * type and scrolled to a single form at the bottom. From the row it read as
 * "upload this document" and did something else entirely, so the obvious click
 * looked broken and the correct flow was a scroll away and easy to miss.
 *
 * Each row now owns its own file, its own expiry and its own submit, so the
 * button on a row means the thing it says.
 */
interface DocumentDraft {
  file: File | null;
  expiryDate: string;
}

const EMPTY_DRAFT: DocumentDraft = { file: null, expiryDate: '' };

/** Days before expiry at which a document is called out as needing attention. */
const EXPIRY_WARNING_DAYS = 30;

function expiryTone(days: number | null): { label: string; className: string } {
  if (days === null) {
    return {
      label: 'No expiry set',
      className: 'bg-gray-500/10 text-gilded-muted',
    };
  }
  if (days < 0) {
    return { label: `Expired ${Math.abs(days)}d ago`, className: 'bg-red-500/20 text-red-400' };
  }
  if (days <= 7) {
    return { label: `${days}d left`, className: 'bg-red-500/20 text-red-400' };
  }
  if (days <= 14) {
    return { label: `${days}d left`, className: 'bg-orange-500/20 text-orange-400' };
  }
  if (days <= EXPIRY_WARNING_DAYS) {
    return { label: `${days}d left`, className: 'bg-yellow-500/20 text-yellow-400' };
  }
  return { label: `${days}d left`, className: 'bg-emerald-500/10 text-emerald-400' };
}

export default function OwnerComplianceDashboard() {
  const [compliance, setCompliance] = useState<ComplianceData | null>(null);
  const [loading, setLoading] = useState(true);
  /** Per-document upload state, keyed by document type. */
  const [drafts, setDrafts] = useState<Record<string, DocumentDraft>>({});
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [uploadingType, setUploadingType] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [view, setView] = useState<'docs' | 'register'>('docs');

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData() {
    setLoading(true);
    try {
      const data = await api.get<any>('/compliance/score');
      if (data) setCompliance(data);
    } catch (err) {
      console.error('Failed to fetch compliance data:', err);
    } finally {
      setLoading(false);
    }
  }

  function setDraft(type: string, patch: Partial<DocumentDraft>) {
    setDrafts((prev) => ({ ...prev, [type]: { ...EMPTY_DRAFT, ...prev[type], ...patch } }));
  }

  function toggleRow(type: string) {
    setRowErrors((prev) => {
      if (!(type in prev)) return prev;
      const next = { ...prev };
      delete next[type];
      return next;
    });
    setOpenRow((prev) => {
      if (prev === type) {
        setDrafts((d) => ({ ...d, [type]: EMPTY_DRAFT }));
        return null;
      }
      return type;
    });
  }

  async function handleUpload(type: string) {
    const draft = drafts[type] ?? EMPTY_DRAFT;
    if (!draft.file) {
      setRowErrors((prev) => ({ ...prev, [type]: 'Choose a file first.' }));
      return;
    }

    // Expiry is required rather than optional.
    //
    // The compliance guard scores a `notExpired` band, and it used to count a
    // document with no expiry as valid forever. That is the opposite of what a
    // legality argument needs: a document nobody is obliged to renew is a
    // document that silently stops being enforced. Requiring the date at upload
    // means the shop is making an explicit, dated assertion about validity, and
    // the shop is the one that has to come back when it lapses.
    if (!draft.expiryDate) {
      setRowErrors((prev) => ({ ...prev, [type]: 'Enter the expiry date for this document.' }));
      return;
    }

    setUploadingType(type);
    setRowErrors((prev) => {
      const next = { ...prev };
      delete next[type];
      return next;
    });

    try {
      const file = draft.file;
      const ext = file.name.includes('.') ? file.name.split('.').pop() : 'bin';
      const safeExt = (ext || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
      const storagePath = `compliance-docs/${type}_${Date.now()}.${safeExt}`;

      const { error: uploadError } = await supabase.storage
        .from('kyc-documents')
        .upload(storagePath, file, {
          contentType: file.type || 'application/octet-stream',
          upsert: true,
        });

      if (uploadError) {
        throw new Error(uploadError.message || 'File upload to storage failed.');
      }

      const { data: urlData } = supabase.storage
        .from('kyc-documents')
        .getPublicUrl(storagePath);
      const fileUrl = urlData?.publicUrl || storagePath;

      await api.post('/compliance/documents', {
        documentType: type,
        fileUrl,
        fileName: file.name,
        fileSize: file.size,
        expiryDate: draft.expiryDate,
      });

      setDrafts((prev) => ({ ...prev, [type]: EMPTY_DRAFT }));
      setOpenRow(null);
      await fetchData();
    } catch (err: unknown) {
      setRowErrors((prev) => ({
        ...prev,
        [type]: err instanceof Error ? err.message : 'Upload failed',
      }));
    } finally {
      setUploadingType(null);
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
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-display font-bold text-gilded-gold">
              Compliance Dashboard
            </h1>
            <p className="text-gilded-muted text-sm mt-1">
              Manage your regulatory documents and compliance status
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
            onClick={() => setView('docs')}
            className={`px-4 py-2 font-medium transition-colors ${
              view === 'docs' ? 'text-gilded-gold border-b-2 border-gilded-gold' : 'text-gilded-muted hover:text-gilded-light'
            }`}
          >
            Documents &amp; Compliance
          </button>
          <button
            onClick={() => setView('register')}
            className={`px-4 py-2 font-medium transition-colors ${
              view === 'register' ? 'text-gilded-gold border-b-2 border-gilded-gold' : 'text-gilded-muted hover:text-gilded-light'
            }`}
          >
            Expiry Register
          </button>
        </div>

        {view === 'register' ? (
          <ComplianceExpiryRegister isSuperAdmin={false} />
        ) : (
        <>
        {compliance && (
          <div className="bg-gilded-dark border border-gilded-border rounded-xl p-6">
            <div className="flex items-center gap-6">
              <div className="relative">
                <svg className="w-24 h-24 transform -rotate-90">
                  <circle
                    cx="48"
                    cy="48"
                    r="40"
                    stroke="currentColor"
                    strokeWidth="6"
                    fill="none"
                    className="text-gilded-dark"
                  />
                  <circle
                    cx="48"
                    cy="48"
                    r="40"
                    stroke="currentColor"
                    strokeWidth="6"
                    fill="none"
                    strokeDasharray={`${(compliance.score / 100) * 251.2} 251.2`}
                    className={`${getScoreColor(compliance.score)} transition-all duration-1000`}
                  />
                </svg>
                <span
                  className={`absolute inset-0 flex items-center justify-center text-xl font-bold ${getScoreColor(compliance.score)}`}
                >
                  {compliance.score}
                </span>
              </div>
              <div className="flex-1">
                <h3 className={`text-lg font-semibold ${getScoreColor(compliance.score)}`}>
                  {getScoreLabel(compliance.score)}
                </h3>
                <div className="grid grid-cols-4 gap-4 mt-3">
                  <div className="text-center">
                    <div className="text-2xl font-bold text-gilded-light">
                      {compliance.summary.uploaded}/{compliance.summary.totalRequired}
                    </div>
                    <div className="text-xs text-gilded-muted">On File</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-emerald-400">
                      {compliance.summary.verified}
                    </div>
                    <div className="text-xs text-gilded-muted">Verified</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-yellow-400">
                      {compliance.summary.notExpired}
                    </div>
                    <div className="text-xs text-gilded-muted">Not Expired</div>
                  </div>
                  <div className="text-center">
                    <div className={`text-2xl font-bold ${compliance.summary.subscriptionActive ? 'text-emerald-400' : 'text-red-400'}`}>
                      {compliance.summary.subscriptionActive ? 'Active' : 'None'}
                    </div>
                    <div className="text-xs text-gilded-muted">Subscription</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="bg-gilded-dark border border-gilded-border rounded-xl p-6">
          <h3 className="text-lg font-semibold text-gilded-light mb-4 flex items-center gap-2">
            <Shield className="w-5 h-5 text-gilded-gold" />
            Required Documents
          </h3>
          <div className="space-y-3">
            {compliance?.documents.map((doc) => {
              const config = STATUS_CONFIG[doc.status] || STATUS_CONFIG.NOT_UPLOADED;
              const label = DOCUMENT_LABELS[doc.type] || doc.type;
              const draft = drafts[doc.type] ?? EMPTY_DRAFT;
              const isOpen = openRow === doc.type;
              const isUploading = uploadingType === doc.type;
              const error = rowErrors[doc.type];
              const tone = expiryTone(doc.daysUntilExpiry);
              const needsAttention =
                doc.status === 'EXPIRED' ||
                doc.status === 'REJECTED' ||
                doc.status === 'NOT_UPLOADED' ||
                doc.status === 'UNDER_REVIEW' ||
                (doc.daysUntilExpiry !== null && doc.daysUntilExpiry <= EXPIRY_WARNING_DAYS);
              const uploadDisabled =
                !draft.file || !draft.expiryDate || isUploading;

              return (
                <div
                  key={doc.type}
                  className={`rounded-lg ${config.bg} border ${
                    isOpen ? 'border-gilded-gold/50' : 'border-gilded-border'
                  }`}
                >
                  <div className="flex items-center justify-between p-4 gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      {config.icon}
                      <div className="min-w-0">
                        <div className="font-medium text-gilded-light">{label}</div>
                        {doc.fileName && (
                          <div className="text-xs text-gilded-muted mt-0.5 truncate">
                            {doc.fileName}
                          </div>
                        )}
                        {doc.expiryDate && (
                          <div
                            className={`text-xs mt-0.5 ${
                              doc.daysUntilExpiry !== null && doc.daysUntilExpiry <= EXPIRY_WARNING_DAYS
                                ? 'text-amber-400 font-medium'
                                : 'text-gilded-muted'
                            }`}
                          >
                            Expires {formatExpiryDate(doc.expiryDate)}
                            {doc.daysUntilExpiry !== null &&
                              doc.daysUntilExpiry <= EXPIRY_WARNING_DAYS && (
                                <> — replace before it lapses</>
                              )}
                          </div>
                        )}
                        {doc.rejectionReason && doc.status === 'REJECTED' && (
                          <div className="text-xs text-red-400 mt-0.5">
                            Reason: {doc.rejectionReason}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className={`text-xs px-2 py-0.5 rounded ${tone.className}`}>
                        {tone.label}
                      </span>
                      <span className={`text-xs font-medium ${config.color}`}>
                        {doc.status.replace(/_/g, ' ')}
                      </span>
                      <button
                        onClick={() => toggleRow(doc.type)}
                        aria-expanded={isOpen}
                        aria-controls={`upload-${doc.type}`}
                        className="text-[11px] px-2.5 py-1 bg-gilded-gold/10 text-gilded-gold border border-gilded-gold/30 rounded hover:bg-gilded-gold/20 transition-colors"
                      >
                        {isOpen
                          ? 'Cancel'
                          : doc.status === 'NOT_UPLOADED'
                          ? 'Upload'
                          : 'Replace / Renew'}
                      </button>
                    </div>
                  </div>

                  {isOpen && (
                    <div
                      id={`upload-${doc.type}`}
                      className="border-t border-gilded-border p-4 space-y-3"
                    >
                      <p className="text-xs text-gilded-muted">
                        Uploading for{' '}
                        <span className="text-gilded-light font-medium">{label}</span>. The
                        expiry date is required — it is what the system uses to warn
                        you before this document lapses and to lock the shop out
                        once it does.
                      </p>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                          <label
                            htmlFor={`file-${doc.type}`}
                            className="block text-xs text-gilded-muted mb-1"
                          >
                            File
                          </label>
                          <input
                            id={`file-${doc.type}`}
                            type="file"
                            onChange={(e) =>
                              setDraft(doc.type, { file: e.target.files?.[0] || null })
                            }
                            className="w-full px-3 py-2 bg-gilded-darker border border-gilded-border rounded-lg text-gilded-light text-sm file:mr-3 file:py-1 file:px-2.5 file:rounded file:border-0 file:bg-gilded-gold file:text-gilded-darker file:font-medium file:text-xs"
                          />
                        </div>
                        <div>
                          <label
                            htmlFor={`expiry-${doc.type}`}
                            className="block text-xs text-gilded-muted mb-1"
                          >
                            Expiry date <span className="text-gilded-gold">required</span>
                          </label>
                          <input
                            id={`expiry-${doc.type}`}
                            type="date"
                            value={draft.expiryDate}
                            onChange={(e) => setDraft(doc.type, { expiryDate: e.target.value })}
                            className="w-full px-3 py-2 bg-gilded-darker border border-gilded-border rounded-lg text-gilded-light"
                          />
                        </div>
                      </div>
                      {error && (
                        <div className="px-3 py-2 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
                          {error}
                        </div>
                      )}
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => handleUpload(doc.type)}
                          disabled={uploadDisabled}
                          className="px-4 py-2 bg-gilded-gold text-gilded-darker font-semibold text-sm rounded-lg hover:bg-gilded-gold/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {isUploading
                            ? 'Uploading...'
                            : doc.status === 'NOT_UPLOADED'
                            ? 'Upload document'
                            : 'Replace document'}
                        </button>
                        {uploadDisabled && !isUploading && (
                          <span className="text-xs text-gilded-muted">
                            {!draft.file ? 'Choose a file.' : 'Enter the expiry date.'}
                          </span>
                        )}
                      </div>
                    </div>
                  )}

                  {!isOpen && needsAttention && (
                    <p className="px-4 pb-3 text-xs text-gilded-muted">
                      {doc.status === 'NOT_UPLOADED'
                        ? 'Not on file — this counts against your compliance score.'
                        : doc.status === 'REJECTED'
                        ? 'Rejected — upload a corrected document.'
                        : doc.status === 'UNDER_REVIEW'
                        ? 'Awaiting verification.'
                        : 'Expiring soon — renew to keep the shop operating.'}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        </>
        )}
      </div>
    </div>
  );
}
