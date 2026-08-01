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

interface Document {
  id: string;
  documentType: string;
  fileName: string;
  status: string;
  expiryDate: string | null;
  rejectionReason: string | null;
  verifiedAt: string | null;
  createdAt: string;
}

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

export default function OwnerComplianceDashboard() {
  const [compliance, setCompliance] = useState<ComplianceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [selectedType, setSelectedType] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [expiryDate, setExpiryDate] = useState('');
  const [renewMessage, setRenewMessage] = useState('');

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

  async function handleUpload() {
    if (!selectedType || !selectedFile) return;
    setUploading(true);
    setRenewMessage('');
    try {
      const ext = selectedFile.name.includes('.')
        ? selectedFile.name.split('.').pop()
        : 'bin';
      const safeExt = (ext || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
      const storagePath = `compliance-docs/${selectedType}_${Date.now()}.${safeExt}`;

      const { error: uploadError } = await supabase.storage
        .from('kyc-documents')
        .upload(storagePath, selectedFile, {
          contentType: selectedFile.type || 'application/octet-stream',
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
        documentType: selectedType,
        fileUrl,
        fileName: selectedFile.name,
        fileSize: selectedFile.size,
        expiryDate: expiryDate || undefined,
      });
      setSelectedType('');
      setSelectedFile(null);
      setExpiryDate('');
      fetchData();
    } catch (err: any) {
      setRenewMessage(err.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  function handleRenew(type: string) {
    setSelectedType(type);
    setSelectedFile(null);
    setExpiryDate('');
    setRenewMessage('');
    document.getElementById('upload-form')?.scrollIntoView({ behavior: 'smooth' });
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
              return (
                <div
                  key={doc.type}
                  className={`flex items-center justify-between p-4 rounded-lg ${config.bg} border border-gilded-border`}
                >
                  <div className="flex items-center gap-3">
                    {config.icon}
                    <div>
                      <div className="font-medium text-gilded-light">
                        {DOCUMENT_LABELS[doc.type] || doc.type}
                      </div>
                      {doc.fileName && (
                        <div className="text-xs text-gilded-muted mt-0.5">{doc.fileName}</div>
                      )}
                      {doc.rejectionReason && doc.status === 'REJECTED' && (
                        <div className="text-xs text-red-400 mt-0.5">
                          Reason: {doc.rejectionReason}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {doc.daysUntilExpiry !== null && doc.daysUntilExpiry <= 30 && doc.status === 'VERIFIED' && (
                      <span
                        className={`text-xs px-2 py-0.5 rounded ${
                          doc.daysUntilExpiry <= 7
                            ? 'bg-red-500/20 text-red-400'
                            : doc.daysUntilExpiry <= 14
                            ? 'bg-orange-500/20 text-orange-400'
                            : 'bg-yellow-500/20 text-yellow-400'
                        }`}
                      >
                        {doc.daysUntilExpiry}d left
                      </span>
                    )}
                    <span className={`text-xs font-medium ${config.color}`}>
                      {doc.status.replace(/_/g, ' ')}
                    </span>
                    {(doc.status === 'EXPIRED' || doc.status === 'REJECTED' || doc.status === 'NOT_UPLOADED') && (
                      <button
                        onClick={() => handleRenew(doc.type)}
                        className="text-[10px] px-2 py-0.5 bg-gilded-gold/10 text-gilded-gold border border-gilded-gold/30 rounded hover:bg-gilded-gold/20 transition-colors"
                      >
                        {doc.status === 'NOT_UPLOADED' ? 'Upload' : 'Renew'}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div id="upload-form" className="bg-gilded-dark border border-gilded-border rounded-xl p-6">
          <h3 className="text-lg font-semibold text-gilded-light mb-4 flex items-center gap-2">
            <Upload className="w-5 h-5 text-gilded-gold" />
            {selectedType ? `Renew ${DOCUMENT_LABELS[selectedType] || selectedType}` : 'Upload Document'}
          </h3>
          {renewMessage && (
            <div className="mb-4 px-3 py-2 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
              {renewMessage}
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gilded-muted mb-1">Document Type</label>
              <select
                value={selectedType}
                onChange={(e) => setSelectedType(e.target.value)}
                className="w-full px-3 py-2 bg-gilded-darker border border-gilded-border rounded-lg text-gilded-light"
              >
                <option value="">Select type...</option>
                {Object.entries(DOCUMENT_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm text-gilded-muted mb-1">File</label>
              <input
                type="file"
                onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                className="w-full px-3 py-2 bg-gilded-darker border border-gilded-border rounded-lg text-gilded-light file:mr-4 file:py-1 file:px-3 file:rounded file:border-0 file:bg-gilded-gold file:text-gilded-darker file:font-medium file:text-sm"
              />
            </div>
            <div>
              <label className="block text-sm text-gilded-muted mb-1">Expiry Date (optional)</label>
              <input
                type="date"
                value={expiryDate}
                onChange={(e) => setExpiryDate(e.target.value)}
                className="w-full px-3 py-2 bg-gilded-darker border border-gilded-border rounded-lg text-gilded-light"
              />
            </div>
            <div className="flex items-end">
              <button
                onClick={handleUpload}
                disabled={!selectedType || !selectedFile || uploading}
                className="px-6 py-2 bg-gilded-gold text-gilded-darker font-semibold rounded-lg hover:bg-gilded-gold/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {uploading ? 'Uploading...' : 'Upload'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
