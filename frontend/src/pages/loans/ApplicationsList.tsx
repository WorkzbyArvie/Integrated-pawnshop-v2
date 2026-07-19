import React, { useState, useEffect } from 'react';
import { FileText, Search, Filter, Eye, Clock, CheckCircle2, XCircle, Loader2, Plus } from 'lucide-react';
import { LoanApplicationForm } from './LoanApplicationForm';
import { getBackendUrl } from '../../lib/backendUrl';

interface Application {
  id: string;
  customerId: string;
  loanAmount: number;
  loanType: string;
  termMonths: number;
  status: string;
  submittedAt: string;
  customer: {
    fullName: string;
    contactNumber: string;
  };
}

interface ApplicationsListProps {
  pawnshopId?: string;
  onViewApplication?: (applicationId: string) => void;
}

const STATUS_COLORS: Record<string, string> = {
  PENDING: 'bg-yellow-100 text-yellow-800',
  DOCUMENTS_REVIEW: 'bg-[#C9A05C]/15 text-[#C9A05C]',
  ELIGIBILITY_CHECK: 'bg-purple-100 text-purple-800',
  AWAITING_APPROVAL: 'bg-orange-100 text-orange-800',
  MANAGER_REVIEW: 'bg-[#C9A05C]/15 text-[#C9A05C]',
  OWNER_APPROVAL: 'bg-pink-100 text-pink-800',
  APPROVED: 'bg-green-100 text-green-800',
  REJECTED: 'bg-red-100 text-red-800',
  DISBURSED: 'bg-emerald-100 text-emerald-800',
};

const STATUS_ICONS: Record<string, React.ReactNode> = {
  PENDING: <Clock className="w-4 h-4" />,
  APPROVED: <CheckCircle2 className="w-4 h-4" />,
  REJECTED: <XCircle className="w-4 h-4" />,
  DISBURSED: <CheckCircle2 className="w-4 h-4" />,
};

export function ApplicationsList({ pawnshopId, onViewApplication }: ApplicationsListProps) {
  const [applications, setApplications] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [showNewForm, setShowNewForm] = useState(false);

  const fetchApplications = async () => {
    setLoading(true);
    try {
      const backendUrl = getBackendUrl();
      const params = new URLSearchParams();
      if (pawnshopId) {
        params.append('pawnshopId', pawnshopId);
      }
      if (statusFilter !== 'ALL') {
        params.append('status', statusFilter);
      }

      const response = await fetch(`${backendUrl}/loan/applications?${params}`);
      if (!response.ok) throw new Error('Failed to fetch applications');

      const raw = await response.json();
      const data = raw?.data ?? raw;
      setApplications(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('âŒ Error fetching applications:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchApplications();
  }, [pawnshopId, statusFilter]);

  const filteredApplications = applications.filter((app) =>
    app.customer.fullName.toLowerCase().includes(searchTerm.toLowerCase()),
  );

  const formatCurrency = (amount: number) => {
    return `₱${amount.toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-PH', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-black text-[#EAE2D6]">Loan Applications</h1>
          <p className="text-[#999186] mt-1">Manage and review loan applications</p>
        </div>
        <button
          onClick={() => setShowNewForm(true)}
          className="px-6 py-3 bg-[#C9A05C] text-white font-bold rounded-xl hover:bg-[#E5C88C] transition flex items-center gap-2"
        >
          <Plus className="w-5 h-5" />
          New Application
        </button>
      </div>

      {/* Filters */}
      <div className="bg-[#14141B] rounded-2xl shadow-sm border border-[rgba(201,160,92,0.1)] p-6 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[#6B655C]" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search by customer name..."
              className="w-full pl-10 pr-4 py-3 border border-[rgba(201,160,92,0.15)] rounded-xl focus:border-[#C9A05C] focus:ring-2 focus:ring-[rgba(201,160,92,0.2)] outline-none transition"
            />
          </div>

          {/* Status Filter */}
          <div className="relative">
            <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[#6B655C]" />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full pl-10 pr-4 py-3 border border-[rgba(201,160,92,0.15)] rounded-xl focus:border-[#C9A05C] focus:ring-2 focus:ring-[rgba(201,160,92,0.2)] outline-none transition appearance-none"
            >
              <option value="ALL">All Statuses</option>
              <option value="PENDING">Pending</option>
              <option value="DOCUMENTS_REVIEW">Documents Review</option>
              <option value="AWAITING_APPROVAL">Awaiting Approval</option>
              <option value="APPROVED">Approved</option>
              <option value="REJECTED">Rejected</option>
              <option value="DISBURSED">Disbursed</option>
            </select>
          </div>
        </div>
      </div>

      {/* Applications List */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 text-[#C9A05C] animate-spin" />
        </div>
      ) : filteredApplications.length === 0 ? (
        <div className="bg-[#14141B] rounded-2xl shadow-sm border border-[rgba(201,160,92,0.1)] p-12 text-center">
          <FileText className="w-16 h-16 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-bold text-[#EAE2D6] mb-2">No Applications Found</h3>
          <p className="text-[#999186]">
            {searchTerm
              ? 'Try adjusting your search filters'
              : 'Get started by creating a new loan application'}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredApplications.map((app) => (
            <div
              key={app.id}
              className="bg-[#14141B] rounded-2xl shadow-sm border border-[rgba(201,160,92,0.1)] p-6 hover:shadow-md transition"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-3">
                    <h3 className="text-lg font-bold text-[#EAE2D6]">
                      {app.customer.fullName}
                    </h3>
                    <span
                      className={`px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1 ${
                        STATUS_COLORS[app.status] || 'bg-gray-100 text-[#EAE2D6]'
                      }`}
                    >
                      {STATUS_ICONS[app.status] || <Clock className="w-4 h-4" />}
                      {app.status.replace(/_/g, ' ')}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <div>
                      <p className="text-[#6B655C] mb-1">Loan Amount</p>
                      <p className="font-bold text-[#EAE2D6]">{formatCurrency(app.loanAmount)}</p>
                    </div>
                    <div>
                      <p className="text-[#6B655C] mb-1">Loan Type</p>
                      <p className="font-bold text-[#EAE2D6]">{app.loanType}</p>
                    </div>
                    <div>
                      <p className="text-[#6B655C] mb-1">Term</p>
                      <p className="font-bold text-[#EAE2D6]">{app.termMonths} months</p>
                    </div>
                    <div>
                      <p className="text-[#6B655C] mb-1">Submitted</p>
                      <p className="font-bold text-[#EAE2D6]">{formatDate(app.submittedAt)}</p>
                    </div>
                  </div>
                </div>

                <button
                  onClick={() => onViewApplication?.(app.id)}
                  className="ml-4 p-3 bg-[#C9A05C]/10 text-[#C9A05C] rounded-xl hover:bg-[#C9A05C]/15 transition"
                  title="View Details"
                >
                  <Eye className="w-5 h-5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* New Application Modal */}
      {showNewForm && (
        <LoanApplicationForm
          pawnshopId={pawnshopId}
          onClose={() => setShowNewForm(false)}
          onSuccess={fetchApplications}
        />
      )}
    </div>
  );
}
