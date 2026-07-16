import { useState, useEffect } from 'react';
import Swal from 'sweetalert2';
import {
  CheckCircle2,
  XCircle,
  Clock,
  User,
  MessageSquare,
  AlertCircle,
  Loader2,
  ArrowRight,
} from 'lucide-react';
import { getBackendUrl } from '../../lib/backendUrl';

interface ApprovalWorkflowProps {
  applicationId: string;
  currentStatus: string;
  userRole: string; // STAFF, MANAGER, OWNER
  onApprovalComplete: () => void;
}

interface ApprovalStep {
  level: string;
  label: string;
  status: 'COMPLETED' | 'CURRENT' | 'PENDING';
  approver: string | null;
  date: string | null;
  comments: string | null;
}

const APPROVAL_FLOW: Record<string, string[]> = {
  STAFF: ['PENDING', 'DOCUMENTS_REVIEW'],
  MANAGER: ['MANAGER_REVIEW'],
  OWNER: ['OWNER_APPROVAL'],
};

export function ApprovalWorkflow({
  applicationId,
  currentStatus,
  userRole,
  onApprovalComplete,
}: ApprovalWorkflowProps) {
  const [loading, setLoading] = useState(false);
  const [decision, setDecision] = useState<'APPROVE' | 'REJECT' | null>(null);
  const [comments, setComments] = useState('');
  const [showDecisionForm, setShowDecisionForm] = useState(false);
  const [approvalSteps, setApprovalSteps] = useState<ApprovalStep[]>([]);

  useEffect(() => {
    fetchApprovalHistory();
  }, [applicationId]);

  const fetchApprovalHistory = async () => {
    try {
      const backendUrl = getBackendUrl();
      const response = await fetch(`${backendUrl}/loan/applications/${applicationId}`);
      if (!response.ok) throw new Error('Failed to fetch application');

      const raw = await response.json();
      const data = raw?.data ?? raw;
      
      // Map approval steps
      const steps: ApprovalStep[] = [
        {
          level: 'STAFF',
          label: 'Staff Review',
          status: getStepStatus('STAFF', data.status, data.approvals),
          approver: null,
          date: null,
          comments: null,
        },
        {
          level: 'MANAGER',
          label: 'Manager Review',
          status: getStepStatus('MANAGER', data.status, data.approvals),
          approver: null,
          date: null,
          comments: null,
        },
        {
          level: 'OWNER',
          label: 'Owner Approval',
          status: getStepStatus('OWNER', data.status, data.approvals),
          approver: null,
          date: null,
          comments: null,
        },
      ];

      // Populate approval data
      data.approvals?.forEach((approval: any) => {
        const step = steps.find((s) => s.level === approval.approvalLevel);
        if (step && approval.status === 'APPROVED') {
          step.approver = approval.approverName;
          step.date = approval.approvedDate;
          step.comments = approval.comments;
        }
      });

      setApprovalSteps(steps);
    } catch (err) {
      console.error('âŒ Error fetching approval history:', err);
    }
  };

  const getStepStatus = (
    level: string,
    currentStatus: string,
    approvals: any[] = [],
  ): 'COMPLETED' | 'CURRENT' | 'PENDING' => {
    const approval = approvals.find((a) => a.approvalLevel === level);
    if (approval && approval.status === 'APPROVED') return 'COMPLETED';

    const statusMap: Record<string, string> = {
      PENDING: 'STAFF',
      DOCUMENTS_REVIEW: 'STAFF',
      ELIGIBILITY_CHECK: 'STAFF',
      AWAITING_APPROVAL: 'MANAGER',
      MANAGER_REVIEW: 'MANAGER',
      OWNER_APPROVAL: 'OWNER',
    };

    if (statusMap[currentStatus] === level) return 'CURRENT';
    return 'PENDING';
  };

  const canApprove = () => {
    const allowedStatuses = APPROVAL_FLOW[userRole] || [];
    return allowedStatuses.includes(currentStatus);
  };

  const handleSubmitDecision = async () => {
    if (!decision || !comments.trim()) {
      void Swal.fire({
        icon: 'warning',
        title: 'Comments required',
        text: 'Please provide comments for your decision.',
      });
      return;
    }

    setLoading(true);
    try {
      const backendUrl = getBackendUrl();

      // Determine next status based on decision and role
      let nextStatus = '';
      if (decision === 'REJECT') {
        nextStatus = 'REJECTED';
      } else {
        // Approval flow
        if (userRole === 'STAFF') {
          nextStatus = 'MANAGER_REVIEW';
        } else if (userRole === 'MANAGER') {
          nextStatus = 'OWNER_APPROVAL';
        } else if (userRole === 'OWNER') {
          nextStatus = 'APPROVED';
        }
      }

      const response = await fetch(
        `${backendUrl}/loan/applications/${applicationId}/status`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            status: nextStatus,
            comments,
          }),
        },
      );

      if (!response.ok) throw new Error('Failed to update application');

      void Swal.fire({
        icon: 'success',
        title: 'Decision submitted',
        text: `Application ${decision === 'APPROVE' ? 'approved' : 'rejected'} successfully.`,
      });
      onApprovalComplete();
    } catch (err) {
      console.error('âŒ Error submitting decision:', err);
      void Swal.fire({
        icon: 'error',
        title: 'Submission failed',
        text: 'Failed to submit decision. Please try again.',
      });
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return '';
    return new Date(dateString).toLocaleDateString('en-PH', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="space-y-6">
      {/* Approval Timeline */}
      <div className="bg-[#14141B] rounded-2xl shadow-sm border border-[rgba(201,160,92,0.1)] p-8">
        <h2 className="text-xl font-black text-[#EAE2D6] mb-6">Approval Progress</h2>

        <div className="relative">
          {/* Timeline Line */}
          <div className="absolute left-5 top-0 bottom-0 w-0.5 bg-gray-200"></div>

          <div className="space-y-8">
            {approvalSteps.map((step) => (
              <div key={step.level} className="relative flex items-start gap-4">
                {/* Status Icon */}
                <div className="relative z-10">
                  {step.status === 'COMPLETED' && (
                    <div className="w-10 h-10 bg-green-500 rounded-full flex items-center justify-center">
                      <CheckCircle2 className="w-6 h-6 text-white" />
                    </div>
                  )}
                  {step.status === 'CURRENT' && (
                    <div className="w-10 h-10 bg-[#C9A05C] rounded-full flex items-center justify-center animate-pulse">
                      <Clock className="w-6 h-6 text-white" />
                    </div>
                  )}
                  {step.status === 'PENDING' && (
                    <div className="w-10 h-10 bg-gray-300 rounded-full flex items-center justify-center">
                      <Clock className="w-6 h-6 text-[#6B655C]" />
                    </div>
                  )}
                </div>

                {/* Step Content */}
                <div className="flex-1 pb-8">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-lg font-bold text-[#EAE2D6]">{step.label}</h3>
                    {step.status === 'COMPLETED' && (
                      <span className="px-3 py-1 bg-green-100 text-green-800 text-xs font-bold rounded-full">
                        Completed
                      </span>
                    )}
                    {step.status === 'CURRENT' && (
                      <span className="px-3 py-1 bg-[#C9A05C]/15 text-[#C9A05C] text-xs font-bold rounded-full">
                        In Progress
                      </span>
                    )}
                  </div>

                  {step.approver && (
                    <div className="flex items-center gap-2 text-sm text-[#999186] mb-1">
                      <User className="w-4 h-4" />
                      <span>Approved by {step.approver}</span>
                    </div>
                  )}

                  {step.date && (
                    <div className="flex items-center gap-2 text-sm text-[#6B655C] mb-2">
                      <Clock className="w-4 h-4" />
                      <span>{formatDate(step.date)}</span>
                    </div>
                  )}

                  {step.comments && (
                    <div className="mt-3 p-3 bg-gray-50 rounded-lg">
                      <div className="flex items-start gap-2">
                        <MessageSquare className="w-4 h-4 text-[#6B655C] mt-0.5 flex-shrink-0" />
                        <p className="text-sm text-[#999186]">{step.comments}</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Decision Form */}
      {canApprove() && (
        <div className="bg-[#14141B] rounded-2xl shadow-sm border border-[rgba(201,160,92,0.1)] p-8">
          <div className="flex items-center gap-3 mb-6">
            <AlertCircle className="w-6 h-6 text-[#C9A05C]" />
            <h2 className="text-xl font-black text-[#EAE2D6]">Your Decision Required</h2>
          </div>

          {!showDecisionForm ? (
            <div className="flex gap-4">
              <button
                onClick={() => {
                  setDecision('APPROVE');
                  setShowDecisionForm(true);
                }}
                className="flex-1 px-6 py-4 bg-green-600 text-white font-bold rounded-xl hover:bg-green-700 transition flex items-center justify-center gap-2"
              >
                <CheckCircle2 className="w-5 h-5" />
                Approve Application
              </button>
              <button
                onClick={() => {
                  setDecision('REJECT');
                  setShowDecisionForm(true);
                }}
                className="flex-1 px-6 py-4 bg-red-600 text-white font-bold rounded-xl hover:bg-red-700 transition flex items-center justify-center gap-2"
              >
                <XCircle className="w-5 h-5" />
                Reject Application
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Decision Badge */}
              <div
                className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl font-bold ${
                  decision === 'APPROVE'
                    ? 'bg-green-100 text-green-800'
                    : 'bg-red-100 text-red-800'
                }`}
              >
                {decision === 'APPROVE' ? (
                  <>
                    <CheckCircle2 className="w-5 h-5" />
                    Approving Application
                  </>
                ) : (
                  <>
                    <XCircle className="w-5 h-5" />
                    Rejecting Application
                  </>
                )}
              </div>

              {/* Comments */}
              <div>
                <label className="block text-sm font-bold text-[#999186] mb-2">
                  Comments / Reason <span className="text-red-600">*</span>
                </label>
                <textarea
                  value={comments}
                  onChange={(e) => setComments(e.target.value)}
                  rows={4}
                  className="w-full px-4 py-3 border border-[rgba(201,160,92,0.15)] rounded-xl focus:border-[#C9A05C] focus:ring-2 focus:ring-[rgba(201,160,92,0.2)] outline-none resize-none"
                  placeholder={
                    decision === 'APPROVE'
                      ? 'Add any notes or conditions for this approval...'
                      : 'Please explain the reason for rejection...'
                  }
                  required
                />
                <p className="text-sm text-[#6B655C] mt-2">
                  Your comments will be recorded in the approval history
                </p>
              </div>

              {/* Action Buttons */}
              <div className="flex gap-3 pt-4">
                <button
                  onClick={() => {
                    setShowDecisionForm(false);
                    setDecision(null);
                    setComments('');
                  }}
                  className="px-6 py-3 bg-gray-100 text-[#999186] font-bold rounded-xl hover:bg-gray-200 transition"
                  disabled={loading}
                >
                  Cancel
                </button>
                <button
                  onClick={handleSubmitDecision}
                  disabled={loading || !comments.trim()}
                  className={`flex-1 px-6 py-3 text-white font-bold rounded-xl transition disabled:opacity-50 flex items-center justify-center gap-2 ${
                    decision === 'APPROVE'
                      ? 'bg-green-600 hover:bg-green-700'
                      : 'bg-red-600 hover:bg-red-700'
                  }`}
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      Submitting...
                    </>
                  ) : (
                    <>
                      <ArrowRight className="w-5 h-5" />
                      Confirm {decision === 'APPROVE' ? 'Approval' : 'Rejection'}
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Information */}
      {!canApprove() && (
        <div className="bg-[#C9A05C]/10 border border-[rgba(201,160,92,0.2)] rounded-xl p-6">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-[#C9A05C] flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-bold text-[#C9A05C] mb-1">Awaiting Other Approvers</p>
              <p className="text-sm text-[#C9A05C]">
                This application is currently being reviewed by another team member. You will be
                notified when it reaches your approval level.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
