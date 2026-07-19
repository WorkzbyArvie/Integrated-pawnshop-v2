import { useState, useEffect } from 'react';
import {
  ArrowLeft,
  FileText,
  CheckCircle2,
  Clock,
  AlertCircle,
  Upload,
  Download,
  Check,
  X,
  Loader2,
} from 'lucide-react';
import { getBackendUrl } from '../../lib/backendUrl';

interface ApplicationDetailProps {
  applicationId: string;
  onBack: () => void;
}

interface Document {
  id: string;
  documentType: string;
  fileName: string;
  fileUrl: string;
  uploadedAt: string;
  verifiedBy: string | null;
}

interface Approval {
  id: string;
  approvalLevel: string;
  status: string;
  approverName: string | null;
  approvedDate: string | null;
  comments: string | null;
}

interface EligibilityCheck {
  status: string;
  creditScore: number | null;
  debtToIncomeRatio: number;
  remarks: string | null;
  checkedAt: string;
}

interface ApplicationData {
  id: string;
  customerId: string;
  loanAmount: number;
  loanType: string;
  termMonths: number;
  interestRate: number;
  purpose: string;
  status: string;
  submittedAt: string;
  customer: {
    fullName: string;
    contactNumber: string;
    email: string | null;
  };
  documents: Document[];
  approvals: Approval[];
  eligibilityCheck: EligibilityCheck | null;
}

export function ApplicationDetail({ applicationId, onBack }: ApplicationDetailProps) {
  const [application, setApplication] = useState<ApplicationData | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'details' | 'documents' | 'approvals' | 'eligibility'>(
    'details',
  );

  useEffect(() => {
    fetchApplicationDetails();
  }, [applicationId]);

  const fetchApplicationDetails = async () => {
    setLoading(true);
    try {
      const backendUrl = getBackendUrl();
      const response = await fetch(`${backendUrl}/loan/applications/${applicationId}`);
      if (!response.ok) throw new Error('Failed to fetch application details');

      const raw = await response.json();
      setApplication(raw?.data ?? raw);
    } catch (err) {
      console.error('âŒ Error fetching application details:', err);
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (amount: number) => {
    return `₱${amount.toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-PH', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      PENDING: 'text-yellow-600 bg-yellow-50',
      APPROVED: 'text-green-600 bg-green-50',
      REJECTED: 'text-red-600 bg-red-50',
      ELIGIBLE: 'text-green-600 bg-green-50',
      NOT_ELIGIBLE: 'text-red-600 bg-red-50',
    };
    return colors[status] || 'text-[#999186] bg-gray-50';
  };

  if (loading || !application) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="w-8 h-8 text-[#C9A05C] animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-[#999186] hover:text-[#EAE2D6] mb-4 font-medium"
        >
          <ArrowLeft className="w-5 h-5" />
          Back to Applications
        </button>

        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-black text-[#EAE2D6] mb-2">
              Application #{application.id.slice(0, 8)}
            </h1>
            <p className="text-[#999186]">{application.customer.fullName}</p>
          </div>
          <span
            className={`px-4 py-2 rounded-xl text-sm font-bold ${getStatusColor(
              application.status,
            )}`}
          >
            {application.status.replace(/_/g, ' ')}
          </span>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-[rgba(201,160,92,0.1)] mb-6">
        <div className="flex gap-6">
          {[
            { id: 'details', label: 'Details', icon: FileText },
            { id: 'documents', label: 'Documents', icon: Upload },
            { id: 'approvals', label: 'Approvals', icon: CheckCircle2 },
            { id: 'eligibility', label: 'Eligibility', icon: AlertCircle },
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as typeof activeTab)}
                className={`pb-4 px-1 border-b-2 font-bold flex items-center gap-2 transition ${
                  isActive
                    ? 'border-[#C9A05C] text-[#C9A05C]'
                    : 'border-transparent text-[#6B655C] hover:text-[#999186]'
                }`}
              >
                <Icon className="w-5 h-5" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab Content */}
      {activeTab === 'details' && (
        <div className="bg-[#14141B] rounded-2xl shadow-sm border border-[rgba(201,160,92,0.1)] p-8">
          <h2 className="text-xl font-bold text-[#EAE2D6] mb-6">Application Details</h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Customer Info */}
            <div className="space-y-4">
              <h3 className="text-sm font-bold text-[#6B655C] uppercase mb-3">Customer Information</h3>
              <div>
                <p className="text-sm text-[#6B655C]">Full Name</p>
                <p className="font-bold text-[#EAE2D6]">{application.customer.fullName}</p>
              </div>
              <div>
                <p className="text-sm text-[#6B655C]">Contact Number</p>
                <p className="font-bold text-[#EAE2D6]">{application.customer.contactNumber}</p>
              </div>
              {application.customer.email && (
                <div>
                  <p className="text-sm text-[#6B655C]">Email</p>
                  <p className="font-bold text-[#EAE2D6]">{application.customer.email}</p>
                </div>
              )}
            </div>

            {/* Loan Info */}
            <div className="space-y-4">
              <h3 className="text-sm font-bold text-[#6B655C] uppercase mb-3">Loan Information</h3>
              <div>
                <p className="text-sm text-[#6B655C]">Loan Amount</p>
                <p className="font-bold text-[#EAE2D6] text-lg">{formatCurrency(application.loanAmount)}</p>
              </div>
              <div>
                <p className="text-sm text-[#6B655C]">Loan Type</p>
                <p className="font-bold text-[#EAE2D6]">{application.loanType}</p>
              </div>
              <div>
                <p className="text-sm text-[#6B655C]">Term</p>
                <p className="font-bold text-[#EAE2D6]">{application.termMonths} months</p>
              </div>
              <div>
                <p className="text-sm text-[#6B655C]">Interest Rate</p>
                <p className="font-bold text-[#EAE2D6]">{application.interestRate}% per month</p>
              </div>
            </div>

            {/* Purpose */}
            <div className="md:col-span-2">
              <h3 className="text-sm font-bold text-[#6B655C] uppercase mb-3">Purpose</h3>
              <p className="text-[#EAE2D6]">{application.purpose}</p>
            </div>

            {/* Submission Date */}
            <div className="md:col-span-2">
              <p className="text-sm text-[#6B655C]">Submitted At</p>
              <p className="font-bold text-[#EAE2D6]">{formatDate(application.submittedAt)}</p>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'documents' && (
        <div className="bg-[#14141B] rounded-2xl shadow-sm border border-[rgba(201,160,92,0.1)] p-8">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold text-[#EAE2D6]">Documents</h2>
            <button className="px-4 py-2 bg-[#C9A05C] text-white font-bold rounded-xl hover:bg-[#E5C88C] transition flex items-center gap-2">
              <Upload className="w-4 h-4" />
              Upload Document
            </button>
          </div>

          {application.documents.length === 0 ? (
            <div className="text-center py-12">
              <FileText className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <p className="text-[#999186]">No documents uploaded yet</p>
            </div>
          ) : (
            <div className="space-y-3">
              {application.documents.map((doc) => (
                <div
                  key={doc.id}
                  className="flex items-center justify-between p-4 bg-gray-50 rounded-xl hover:bg-gray-100 transition"
                >
                  <div className="flex items-center gap-3">
                    <FileText className="w-5 h-5 text-[#999186]" />
                    <div>
                      <p className="font-bold text-[#EAE2D6]">{doc.fileName}</p>
                      <p className="text-sm text-[#6B655C]">
                        {doc.documentType} • Uploaded {formatDate(doc.uploadedAt)}
                      </p>
                    </div>
                    {doc.verifiedBy && (
                      <span className="px-2 py-1 bg-green-100 text-green-800 text-xs font-bold rounded-lg">
                        Verified
                      </span>
                    )}
                  </div>
                  <button className="p-2 text-[#C9A05C] hover:bg-[#C9A05C]/8 rounded-lg transition">
                    <Download className="w-5 h-5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'approvals' && (
        <div className="bg-[#14141B] rounded-2xl shadow-sm border border-[rgba(201,160,92,0.1)] p-8">
          <h2 className="text-xl font-bold text-[#EAE2D6] mb-6">Approval Workflow</h2>

          {application.approvals.length === 0 ? (
            <div className="text-center py-12">
              <Clock className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <p className="text-[#999186]">No approvals yet</p>
            </div>
          ) : (
            <div className="space-y-4">
              {application.approvals.map((approval) => (
                <div
                  key={approval.id}
                  className="flex items-start gap-4 p-4 bg-gray-50 rounded-xl"
                >
                  <div className="flex-shrink-0 mt-1">
                    {approval.status === 'APPROVED' && (
                      <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
                        <Check className="w-5 h-5 text-green-600" />
                      </div>
                    )}
                    {approval.status === 'REJECTED' && (
                      <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center">
                        <X className="w-5 h-5 text-red-600" />
                      </div>
                    )}
                    {approval.status === 'PENDING' && (
                      <div className="w-10 h-10 bg-yellow-100 rounded-full flex items-center justify-center">
                        <Clock className="w-5 h-5 text-yellow-600" />
                      </div>
                    )}
                  </div>

                  <div className="flex-1">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="font-bold text-[#EAE2D6]">{approval.approvalLevel.replace(/_/g, ' ')}</h3>
                      <span
                        className={`px-3 py-1 rounded-full text-xs font-bold ${getStatusColor(
                          approval.status,
                        )}`}
                      >
                        {approval.status}
                      </span>
                    </div>

                    {approval.approverName && (
                      <p className="text-sm text-[#999186] mb-1">
                        By {approval.approverName}
                      </p>
                    )}

                    {approval.approvedDate && (
                      <p className="text-sm text-[#6B655C] mb-2">
                        {formatDate(approval.approvedDate)}
                      </p>
                    )}

                    {approval.comments && (
                      <p className="text-sm text-[#999186] bg-[#14141B] p-3 rounded-lg">
                        {approval.comments}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'eligibility' && (
        <div className="bg-[#14141B] rounded-2xl shadow-sm border border-[rgba(201,160,92,0.1)] p-8">
          <h2 className="text-xl font-bold text-[#EAE2D6] mb-6">Eligibility Check</h2>

          {!application.eligibilityCheck ? (
            <div className="text-center py-12">
              <AlertCircle className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <p className="text-[#999186] mb-4">Eligibility check not performed yet</p>
              <button className="px-6 py-3 bg-[#C9A05C] text-white font-bold rounded-xl hover:bg-[#E5C88C] transition">
                Run Eligibility Check
              </button>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="flex items-center justify-between p-6 bg-gray-50 rounded-xl">
                <div>
                  <p className="text-sm text-[#6B655C] mb-1">Eligibility Status</p>
                  <p
                    className={`text-2xl font-black ${
                      application.eligibilityCheck.status === 'ELIGIBLE'
                        ? 'text-green-600'
                        : 'text-red-600'
                    }`}
                  >
                    {application.eligibilityCheck.status}
                  </p>
                </div>
                {application.eligibilityCheck.status === 'ELIGIBLE' ? (
                  <CheckCircle2 className="w-12 h-12 text-green-600" />
                ) : (
                  <X className="w-12 h-12 text-red-600" />
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {application.eligibilityCheck.creditScore !== null && (
                  <div className="p-6 bg-gray-50 rounded-xl">
                    <p className="text-sm text-[#6B655C] mb-2">Credit Score</p>
                    <p className="text-3xl font-black text-[#EAE2D6]">
                      {application.eligibilityCheck.creditScore}
                    </p>
                  </div>
                )}

                <div className="p-6 bg-gray-50 rounded-xl">
                  <p className="text-sm text-[#6B655C] mb-2">Debt-to-Income Ratio</p>
                  <p className="text-3xl font-black text-[#EAE2D6]">
                    {application.eligibilityCheck.debtToIncomeRatio.toFixed(1)}%
                  </p>
                </div>
              </div>

              {application.eligibilityCheck.remarks && (
                <div className="p-6 bg-[#C9A05C]/10 rounded-xl">
                  <p className="text-sm font-bold text-[#C9A05C] mb-2">Remarks</p>
                  <p className="text-[#C9A05C]">{application.eligibilityCheck.remarks}</p>
                </div>
              )}

              <div className="text-sm text-[#6B655C]">
                Checked at {formatDate(application.eligibilityCheck.checkedAt)}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
