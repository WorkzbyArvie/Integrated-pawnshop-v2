import { useState, useEffect, useCallback } from 'react';
import {
  CheckCircle2, XCircle, Eye, Loader2, User,
  AlertTriangle, Scale, FileText,
} from 'lucide-react';
import { useToast } from '../App';
import api from '../lib/apiClient';
import { formatCurrency } from '../lib/formatters';
import { ContractViewer } from './ContractViewer';
import Swal from 'sweetalert2';

interface PendingTicket {
  id: number;
  ticketNumber: string;
  category: string;
  description: string;
  weight: number | null;
  loanAmount: number;
  lifecycleStatus: string;
  pawnDate: string;
  customer: {
    id: string;
    fullName: string;
    contactNumber: string;
    address: string;
    loyaltyTier: string;
  } | null;
}

const tierColors: Record<string, string> = {
  Standard: 'bg-gray-600',
  Bronze: 'bg-amber-700',
  Silver: 'bg-gray-400',
  Gold: 'bg-yellow-500',
  VIP: 'bg-purple-600',
};

interface PendingApprovalPanelProps {
  branchId: string | null;
  activeBranchId?: number | null;
  userRole?: string;
}

export function PendingApprovalPanel({ branchId, activeBranchId, userRole = 'STAFF' }: PendingApprovalPanelProps) {
  const { showToast } = useToast();

  const canonicalRole = userRole === 'BRANCH_ADMIN' ? 'ADMIN' : userRole;
  const canApprove = ['MANAGER', 'OWNER', 'SUPER_ADMIN'].includes(canonicalRole.toUpperCase());

  const [tickets, setTickets] = useState<PendingTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<number | null>(null);
  const [selectedTicket, setSelectedTicket] = useState<PendingTicket | null>(null);
  const [declineReason, setDeclineReason] = useState('');
  const [showDeclineDialog, setShowDeclineDialog] = useState(false);
  const [declineTargetId, setDeclineTargetId] = useState<number | null>(null);
  const [approveResult, setApproveResult] = useState<{
    applicationId: string;
    loanId: number;
    contractId: string;
    ticketId: number;
  } | null>(null);
  const [, setContractComplete] = useState(false);
  const [showContractModal, setShowContractModal] = useState(false);
  const [disbursingId, setDisbursingId] = useState<number | null>(null);

  const fetchPendingTickets = useCallback(async () => {
    if (!branchId) return;
    setLoading(true);
    try {
      const query: Record<string, string | number | boolean | undefined> = {
        pawnshopId: branchId,
      };
      const validBranchId = Number.isInteger(activeBranchId as number) && Number(activeBranchId) > 0
        ? Number(activeBranchId)
        : undefined;
      if (validBranchId !== undefined) query.branchId = validBranchId;
      const res = await api.get<PendingTicket[]>('/pawn-tickets/pending-approval', query);
      setTickets(res);
    } catch (error: any) {
      console.error('Failed to fetch pending approvals:', error);
    } finally {
      setLoading(false);
    }
  }, [branchId, activeBranchId]);

  useEffect(() => {
    if (canApprove) fetchPendingTickets();
  }, [canApprove, fetchPendingTickets]);

  const handleApprove = async (ticket: PendingTicket) => {
    if (!canApprove) return;
    const confirm = await Swal.fire({
      title: 'Confirm Action',
      text: `Approve ticket ${ticket.ticketNumber} and generate loan contract?`,
      icon: 'question',
      showCancelButton: true,
      confirmButtonColor: '#C9A05C',
      cancelButtonColor: '#8A8279',
      confirmButtonText: 'Yes, proceed',
      cancelButtonText: 'Cancel',
    });
    if (!confirm.isConfirmed) return;
    setProcessingId(ticket.id);
    try {
      const result = await api.post<{
        ticketId: number;
        ticketNumber: string;
        applicationId: string;
        loanId: number;
        contractId: string;
        lifecycleStatus: string;
      }>(`/pawn-tickets/${ticket.id}/manager-approve`);

      setApproveResult({
        applicationId: result.applicationId,
        loanId: result.loanId,
        contractId: result.contractId,
        ticketId: result.ticketId,
      });
      setContractComplete(false);
      setShowContractModal(true);
      setSelectedTicket(null);
    } catch (error: any) {
      console.error('Approve error:', error);
      showToast(error.message || 'Failed to approve ticket', 'error');
    } finally {
      setProcessingId(null);
    }
  };

  const handleSignComplete = () => {
    setContractComplete(true);
  };

  const handleDisburse = async () => {
    if (!approveResult) return;
    setDisbursingId(approveResult.loanId);
    try {
      await api.post(`/loan/${approveResult.loanId}/disburse`);
      showToast(`Loan #${approveResult.loanId} disbursed and activated!`, 'success');
      setApproveResult(null);
      setContractComplete(false);
      setShowContractModal(false);
      fetchPendingTickets();
    } catch (error: any) {
      console.error('Disburse error:', error);
      showToast(error.message || 'Failed to disburse loan', 'error');
    } finally {
      setDisbursingId(null);
    }
  };


  const handleDeclineClick = (ticketId: number) => {
    setDeclineTargetId(ticketId);
    setDeclineReason('');
    setShowDeclineDialog(true);
  };

  const handleDeclineConfirm = async () => {
    if (!declineTargetId || !declineReason.trim()) {
      showToast('Please provide a reason for declining.', 'error');
      return;
    }
    setProcessingId(declineTargetId);
    try {
      await api.post(`/pawn-tickets/${declineTargetId}/decline`, { reason: declineReason.trim() });
      showToast('Ticket declined.', 'success');
      setShowDeclineDialog(false);
      setDeclineTargetId(null);
      setSelectedTicket(null);
      fetchPendingTickets();
    } catch (error: any) {
      console.error('Decline error:', error);
      showToast(error.message || 'Failed to decline ticket', 'error');
    } finally {
      setProcessingId(null);
    }
  };

  if (!canApprove) {
    return (
      <div className="p-8 text-center" style={{ color: 'var(--text-muted)' }}>
        <AlertTriangle className="w-8 h-8 mx-auto mb-3" style={{ color: 'var(--amber)' }} />
        <p className="text-sm font-bold">Access Restricted</p>
        <p className="text-xs mt-1">Only Managers and Owners can approve pending appraisals.</p>
      </div>
    );
  }

  return (
    <div className="p-8 space-y-6 min-h-screen" style={{ background: 'rgba(28,28,38,0.5)' }}>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-[#F5F0E8] uppercase tracking-tight">
            Pending <span style={{ color: 'var(--gold)' }}>Approvals</span>
          </h1>
          <p className="text-[10px] font-black mt-1 uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
            Review and approve appraisals submitted by staff
          </p>
        </div>
        <button
          onClick={fetchPendingTickets}
          disabled={loading}
          className="px-5 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-2"
          style={{ background: 'rgba(201,160,92,0.1)', border: '1px solid rgba(201,160,92,0.15)', color: 'var(--gold)' }}
        >
          <Loader2 className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin" style={{ color: 'var(--gold)' }} />
        </div>
      ) : tickets.length === 0 ? (
        <div className="text-center py-20">
          <CheckCircle2 className="w-12 h-12 mx-auto mb-4" style={{ color: 'var(--green)' }} />
          <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>All caught up!</p>
          <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>No pending approval requests.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {tickets.map((ticket) => (
            <div
              key={ticket.id}
              className="rounded-[1.5rem] p-6 transition-all hover:scale-[1.02] cursor-pointer"
              style={{
                background: 'linear-gradient(160deg, #1C1C26 0%, #14141B 100%)',
                border: '1px solid rgba(201,160,92,0.1)',
              }}
              onClick={() => setSelectedTicket(ticket)}
            >
              <div className="flex items-start justify-between mb-4">
                <div>
                  <p className="text-[9px] font-black uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>Ticket</p>
                  <p className="text-sm font-bold text-[#F5F0E8]">{ticket.ticketNumber}</p>
                </div>
                <div className="px-3 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-widest"
                  style={{ background: 'rgba(201,160,92,0.1)', color: 'var(--gold)' }}>
                  Pending
                </div>
              </div>

              <div className="space-y-2 mb-5">
                <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
                  <User className="w-3.5 h-3.5" />
                  <span className="font-semibold text-[#F5F0E8]">{ticket.customer?.fullName || 'Unknown'}</span>
                  <span className={`px-2 py-0.5 rounded-full text-[9px] font-black text-white ${tierColors[ticket.customer?.loyaltyTier || 'Standard'] || 'bg-gray-600'}`}>
                    {ticket.customer?.loyaltyTier || 'Standard'}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
                  <Scale className="w-3.5 h-3.5" />
                  <span>{ticket.category} — {ticket.weight ? `${ticket.weight}g` : 'N/A'}</span>
                </div>
                <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
                  <FileText className="w-3.5 h-3.5" />
                  <span style={{ color: 'var(--gold)' }} className="font-bold">{formatCurrency(ticket.loanAmount)}</span>
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={(e) => { e.stopPropagation(); setSelectedTicket(ticket); }}
                  className="flex-1 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all flex items-center justify-center gap-1.5"
                  style={{ background: 'rgba(255,255,255,0.05)', color: 'var(--text-muted)' }}
                >
                  <Eye className="w-3.5 h-3.5" /> Review
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); handleApprove(ticket); }}
                  disabled={processingId === ticket.id}
                  className="flex-1 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all active:scale-95 disabled:opacity-50 flex items-center justify-center gap-1.5"
                  style={{ background: 'var(--gold)', color: '#030213' }}
                >
                  {processingId === ticket.id ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <><CheckCircle2 className="w-3.5 h-3.5" /> Approve</>
                  )}
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); handleDeclineClick(ticket.id); }}
                  disabled={processingId === ticket.id}
                  className="py-3 px-4 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all active:scale-95 disabled:opacity-50"
                  style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}
                >
                  <XCircle className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Detail Modal */}
      {selectedTicket && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={() => setSelectedTicket(null)}>
          <div
            className="w-full max-w-lg mx-4 rounded-[2rem] p-8 shadow-2xl"
            style={{ background: '#14141B', border: '1px solid rgba(201,160,92,0.15)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="font-black text-[#F5F0E8] text-lg">{selectedTicket.ticketNumber}</h3>
                <p className="text-[10px] text-[#8A8279] font-black uppercase tracking-widest">Pending Approval</p>
              </div>
              <button onClick={() => setSelectedTicket(null)} className="p-2 rounded-xl hover:bg-white/5" style={{ color: 'var(--text-muted)' }}>
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 mb-8">
              <div className="flex justify-between px-4 py-3 rounded-2xl" style={{ background: 'rgba(255,255,255,0.035)' }}>
                <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Customer</span>
                <span className="text-[11px] font-semibold text-[#F5F0E8] flex items-center gap-2">
                  {selectedTicket.customer?.fullName || 'Unknown'}
                  <span className={`px-2 py-0.5 rounded-full text-[9px] font-black text-white ${tierColors[selectedTicket.customer?.loyaltyTier || 'Standard'] || 'bg-gray-600'}`}>
                    {selectedTicket.customer?.loyaltyTier || 'Standard'}
                  </span>
                </span>
              </div>
              <div className="flex justify-between px-4 py-3 rounded-2xl" style={{ background: 'rgba(255,255,255,0.035)' }}>
                <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Contact</span>
                <span className="text-[11px] font-semibold text-[#F5F0E8]">{selectedTicket.customer?.contactNumber || '—'}</span>
              </div>
              <div className="flex justify-between px-4 py-3 rounded-2xl" style={{ background: 'rgba(255,255,255,0.035)' }}>
                <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Address</span>
                <span className="text-[11px] font-semibold text-[#F5F0E8] truncate max-w-[200px]">{selectedTicket.customer?.address || '—'}</span>
              </div>
              <div className="flex justify-between px-4 py-3 rounded-2xl" style={{ background: 'rgba(255,255,255,0.035)' }}>
                <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Category</span>
                <span className="text-[11px] font-semibold text-[#F5F0E8]">{selectedTicket.category}</span>
              </div>
              <div className="flex justify-between px-4 py-3 rounded-2xl" style={{ background: 'rgba(255,255,255,0.035)' }}>
                <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Weight</span>
                <span className="text-[11px] font-semibold text-[#F5F0E8]">{selectedTicket.weight ? `${selectedTicket.weight}g` : 'N/A'}</span>
              </div>
              <div className="flex justify-between px-4 py-3 rounded-2xl" style={{ background: 'rgba(255,255,255,0.035)' }}>
                <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Loan Amount</span>
                <span className="text-[11px] font-semibold" style={{ color: 'var(--gold)' }}>{formatCurrency(selectedTicket.loanAmount)}</span>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => handleDeclineClick(selectedTicket.id)}
                disabled={processingId === selectedTicket.id}
                className="flex-1 py-4 rounded-2xl font-black text-xs uppercase tracking-widest transition-all"
                style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}
              >
                Decline
              </button>
              <button
                onClick={() => handleApprove(selectedTicket)}
                disabled={processingId === selectedTicket.id}
                className="flex-1 py-4 rounded-2xl font-black text-xs uppercase tracking-widest transition-all active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2"
                style={{ background: 'var(--gold)', color: '#030213' }}
              >
                {processingId === selectedTicket.id ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <><CheckCircle2 className="w-4 h-4" /> Approve</>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Contract Signing Modal */}
      <ContractViewer
        applicationId={approveResult?.applicationId}
        open={showContractModal}
        onClose={() => { setShowContractModal(false); setApproveResult(null); setContractComplete(false); }}
        userRole={userRole}
        userId={undefined}
        onSignComplete={handleSignComplete}
        onDisburse={handleDisburse}
        disbursing={disbursingId === approveResult?.loanId}
      />

      {/* Decline Reason Dialog */}
      {showDeclineDialog && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div
            className="w-full max-w-sm mx-4 rounded-[2rem] p-8 shadow-2xl"
            style={{ background: '#14141B', border: '1px solid rgba(239,68,68,0.2)' }}
          >
            <div className="flex items-center gap-3 mb-5">
              <div className="w-10 h-10 rounded-2xl flex items-center justify-center" style={{ background: 'rgba(239,68,68,0.1)' }}>
                <AlertTriangle className="w-5 h-5 text-red-500" />
              </div>
              <h3 className="font-black text-[#F5F0E8]">Decline Reason</h3>
            </div>
            <textarea
              value={declineReason}
              onChange={(e) => setDeclineReason(e.target.value)}
              placeholder="Explain why this appraisal is being declined..."
              className="w-full rounded-2xl p-4 text-sm border-none outline-none resize-none h-24"
              style={{ background: 'rgba(255,255,255,0.05)', color: 'var(--text-primary)' }}
            />
            <div className="flex gap-3 mt-5">
              <button
                onClick={() => setShowDeclineDialog(false)}
                className="flex-1 py-3 rounded-2xl font-black text-xs uppercase tracking-widest"
                style={{ color: 'var(--text-muted)' }}
              >
                Cancel
              </button>
              <button
                onClick={handleDeclineConfirm}
                disabled={!declineReason.trim() || processingId !== null}
                className="flex-1 py-3 rounded-2xl font-black text-xs uppercase tracking-widest disabled:opacity-50"
                style={{ background: '#ef4444', color: 'white' }}
              >
                {processingId === declineTargetId ? (
                  <Loader2 className="w-4 h-4 animate-spin mx-auto" />
                ) : (
                  'Confirm Decline'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
