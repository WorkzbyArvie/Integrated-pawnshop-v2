import { useState, useEffect, useCallback } from 'react';
import {
  CheckCircle2, XCircle, Search, Eye, Loader2, Scale, User, Calendar,
  AlertTriangle, CheckCheck, ChevronLeft, ChevronRight, Package, FileText, CreditCard,
  ImageOff,
} from 'lucide-react';
import { useToast } from '../App';
import api from '../lib/apiClient';
import { ContractViewer } from './ContractViewer';
import { formatCurrency } from '../lib/formatters';
import { getDisplayableStorageUrl } from '../lib/storageUrls';
import Swal from 'sweetalert2';

const tierColors: Record<string, string> = {
  Standard: 'bg-gray-600',
  Bronze: 'bg-amber-700',
  Silver: 'bg-gray-400',
  Gold: 'bg-yellow-500',
  VIP: 'bg-purple-600',
};

interface PendingApiTicket {
  id: number;
  ticketNumber: string;
  category: string;
  description: string;
  weight: number | null;
  loanAmount: number;
  lifecycleStatus: string;
  pawnDate: string;
  expiryDate: string;
  isHighRisk: boolean;
  customer: {
    id: string;
    fullName: string;
    contactNumber: string;
    address: string;
    loyaltyTier: string;
  } | null;
}

interface PendingAppraisal {
  id: number;
  ticketNumber: string;
  category: string;
  rawDescription: string;
  description: string;
  photoUrls: string[];
  weight: number;
  loanAmount: number;
  status: string;
  isHighRisk: boolean;
  pawnDate: string;
  expiryDate: string;
  customerName: string;
  customerContact: string;
  customerAddress: string;
  loyaltyTier: string;
}

interface AppraisalApprovalProps {
  branchId: string | null;
  activeBranchId?: number | null;
  userRole?: string;
}

export function AppraisalApproval({ branchId, activeBranchId, userRole = 'STAFF' }: AppraisalApprovalProps) {
  const { showToast } = useToast();
  const [detailPhotoIndex, setDetailPhotoIndex] = useState(0);
  const [appraisals, setAppraisals] = useState<PendingAppraisal[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedAppraisal, setSelectedAppraisal] = useState<PendingAppraisal | null>(null);
  const [processingId, setProcessingId] = useState<number | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [disbursingId, setDisbursingId] = useState<number | null>(null);
  const [photoSrc, setPhotoSrc] = useState<string | null>(null);
  const [photoFailed, setPhotoFailed] = useState(false);

  const [approveResult, setApproveResult] = useState<{
    applicationId: string;
    loanId: number;
    contractId: string;
    ticketId: number;
  } | null>(null);
  const [showContractModal, setShowContractModal] = useState(false);
  const [contractComplete, setContractComplete] = useState(false);

  const normalizedRole = String(userRole || '')
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_');
  const canonicalRole = normalizedRole === 'BRANCH_ADMIN' ? 'ADMIN' : normalizedRole;
  const canApprove = ['MANAGER', 'OWNER', 'ADMIN', 'SUPER_ADMIN'].includes(canonicalRole);

  const extractPhotoUrlsFromDescription = (text?: string | null): string[] => {
    if (!text) return [];
    const taggedListMatch = text.match(/\[PHOTO_URLS\]\s+(\[[\s\S]*?\])/i);
    if (taggedListMatch?.[1]) {
      try {
        const parsed = JSON.parse(taggedListMatch[1]);
        if (Array.isArray(parsed)) {
          return parsed.filter((url) => typeof url === 'string' && /^https?:\/\//i.test(url));
        }
      } catch {
        // fall through to legacy parsing
      }
    }
    const legacy = text.match(/\[PHOTO_URL\]\s+(https?:\/\/\S+)/i);
    return legacy?.[1] ? [legacy[1]] : [];
  };

  const sanitizeDescription = (text?: string | null): string => {
    if (!text) return '';
    return text
      .replace(/\n?\s*\[PHOTO_URL\]\s+https?:\/\/\S+/gi, '')
      .replace(/\n?\s*\[PHOTO_URLS\]\s+\[[\s\S]*?\]/gi, '')
      .trim();
  };

  const fetchPendingAppraisals = useCallback(async () => {
    setLoading(true);
    try {
      const query: Record<string, string | number | boolean | undefined> = {};
      if (branchId) query.pawnshopId = branchId;
      const validBranchId = Number.isInteger(activeBranchId as number) && Number(activeBranchId) > 0
        ? Number(activeBranchId)
        : undefined;
      if (validBranchId !== undefined) query.branchId = validBranchId;

      const tickets = await api.get<PendingApiTicket[]>('/pawn-tickets/pending-approval', query);

      const transformedData: PendingAppraisal[] = tickets
        .filter((ticket: any) => ticket.lifecycleStatus !== 'CONTRACT_SIGNED')
        .map((ticket: any) => {
        const rawDescription = ticket.description || '';
        return {
          id: ticket.id,
          ticketNumber: ticket.ticketNumber,
          category: ticket.category,
          rawDescription,
          description: sanitizeDescription(rawDescription),
          photoUrls: extractPhotoUrlsFromDescription(rawDescription),
          weight: ticket.weight || 0,
          loanAmount: ticket.loanAmount || 0,
          status: ticket.lifecycleStatus || ticket.status,
          isHighRisk: ticket.isHighRisk || false,
          pawnDate: ticket.pawnDate,
          expiryDate: ticket.expiryDate,
          customerName: ticket.customer?.fullName || ticket.customerName || 'Unknown',
          customerContact: ticket.customer?.contactNumber || ticket.customerContact || 'N/A',
          customerAddress: ticket.customer?.address || ticket.customerAddress || 'N/A',
          loyaltyTier: ticket.customer?.loyaltyTier || 'Standard',
        };
      });

      setAppraisals(transformedData);
    } catch (error: any) {
      console.error('Error fetching pending appraisals:', error);
      showToast('Failed to load pending appraisals', 'error');
    } finally {
      setLoading(false);
    }
  }, [branchId, activeBranchId, showToast]);

  useEffect(() => {
    fetchPendingAppraisals();
  }, [fetchPendingAppraisals]);

  const resolveCurrentPhoto = useCallback(() => {
    const url = selectedAppraisal?.photoUrls?.[detailPhotoIndex];
    setPhotoFailed(false);
    setPhotoSrc(null);
    if (!url) return;
    getDisplayableStorageUrl(url)
      .then((resolved) => setPhotoSrc(resolved))
      .catch(() => setPhotoFailed(true));
  }, [selectedAppraisal, detailPhotoIndex]);

  useEffect(() => {
    resolveCurrentPhoto();
  }, [resolveCurrentPhoto]);

  const handleApprove = async (appraisalId: number) => {
    if (!canApprove) {
      showToast('You do not have permission to approve appraisals', 'error');
      return;
    }
    const confirm = await Swal.fire({
      title: 'Confirm Action',
      text: 'Approve this appraisal and generate a loan contract?',
      icon: 'question',
      showCancelButton: true,
      confirmButtonColor: '#C9A05C',
      cancelButtonColor: '#8A8279',
      confirmButtonText: 'Yes, proceed',
      cancelButtonText: 'Cancel',
    });
    if (!confirm.isConfirmed) return;

    setProcessingId(appraisalId);
    try {
      const result = await api.post<{
        ticketId: number;
        ticketNumber: string;
        applicationId: string;
        loanId: number;
        contractId: string;
        lifecycleStatus: string;
      }>(`/pawn-tickets/${appraisalId}/approve`);

      setApproveResult({
        applicationId: result.applicationId,
        loanId: result.loanId,
        contractId: result.contractId,
        ticketId: result.ticketId,
      });
      setContractComplete(false);
      setShowContractModal(true);
    } catch (error: any) {
      console.error('Error approving appraisal:', error);
      showToast(error.message || 'Failed to approve appraisal', 'error');
    } finally {
      setProcessingId(null);
    }
  };

  const handleSignComplete = () => {
    setContractComplete(true);
  };

  const handleDisburse = async (loanId: number, appraisalId: number) => {
    setDisbursingId(appraisalId);
    try {
      await api.post<{
        loanId: number;
        status: string;
        message: string;
      }>(`/loan/${loanId}/disburse`);

      showToast(`Loan #${loanId} disbursed and activated!`, 'success');
      setApproveResult(null);
      setContractComplete(false);
      setShowContractModal(false);
      setSelectedAppraisal(null);
      fetchPendingAppraisals();
    } catch (error: any) {
      console.error('Error disbursing loan:', error);
      showToast(error.message || 'Failed to disburse loan', 'error');
    } finally {
      setDisbursingId(null);
    }
  };

  const handleReject = async (appraisalId: number) => {
    if (!canApprove) {
      showToast('You do not have permission to reject appraisals', 'error');
      return;
    }

    if (!rejectionReason.trim()) {
      showToast('Please provide a reason for rejection', 'error');
      return;
    }

    setProcessingId(appraisalId);
    try {
      await api.post(`/pawn-tickets/${appraisalId}/decline`, { reason: rejectionReason.trim() });
      showToast('Appraisal rejected', 'success');
      fetchPendingAppraisals();
      setSelectedAppraisal(null);
      setRejectionReason('');
    } catch (error: any) {
      console.error('Error rejecting appraisal:', error);
      showToast(error.message || 'Failed to reject appraisal', 'error');
    } finally {
      setProcessingId(null);
    }
  };

  const handleCloseContractModal = () => {
    setShowContractModal(false);
    if (contractComplete && approveResult) {
      fetchPendingAppraisals();
    }
  };

  const filteredAppraisals = appraisals.filter((app) =>
    app.customerName.toLowerCase().includes(searchTerm.toLowerCase()) ||
    app.ticketNumber.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="p-8 space-y-8 bg-[#1C1C26]/50 min-h-screen">
      <ContractViewer
        applicationId={approveResult?.applicationId}
        open={showContractModal}
        onClose={handleCloseContractModal}
        userRole={userRole}
        userId={undefined}
        onSignComplete={handleSignComplete}
        onDisburse={approveResult && selectedAppraisal ? () => handleDisburse(approveResult.loanId, selectedAppraisal.id) : undefined}
        disbursing={disbursingId === selectedAppraisal?.id}
      />

      {/* Header */}
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-2xl font-black text-[#030213] uppercase italic tracking-tighter">
            Appraisal <span className="text-[#C9A05C]">Approval</span>
          </h1>
          <p className="text-[#8A8279] text-xs font-bold uppercase tracking-wide mt-1">
            Review and approve pending appraisals
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="bg-[#14141B] border border-[rgba(201,160,92,0.12)] rounded-2xl px-4 py-2">
            <p className="text-[9px] font-black text-[#8A8279] uppercase tracking-widest">Pending</p>
            <p className="text-2xl font-black text-[#C9A05C]">{appraisals.length}</p>
          </div>
        </div>
      </div>

      {!canApprove && (
        <div className="bg-amber-50 border border-amber-200 p-4 rounded-2xl flex items-center gap-3 text-amber-800">
          <AlertTriangle size={18} />
          <p className="text-xs font-bold">You do not have permission to approve appraisals. Manager or Owner role required.</p>
        </div>
      )}

      {/* Search */}
      <div className="bg-[#14141B] rounded-2xl shadow-sm border border-[rgba(201,160,92,0.08)] p-4">
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[#8A8279]" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search by customer name or ticket number..."
            className="w-full pl-12 pr-4 py-3 border border-[rgba(201,160,92,0.12)] rounded-xl focus:border-[#C9A05C] focus:ring-2 focus:ring-[rgba(201,160,92,0.2)] outline-none transition font-bold text-[#F5F0E8]"
          />
        </div>
      </div>

      {/* Content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Appraisals List */}
        <div className="lg:col-span-2">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-8 h-8 text-[#C9A05C] animate-spin" />
            </div>
          ) : filteredAppraisals.length === 0 ? (
            <div className="bg-[#14141B] rounded-3xl p-12 text-center border border-[rgba(201,160,92,0.08)]">
              <CheckCheck className="w-16 h-16 text-slate-300 mx-auto mb-4" />
              <p className="text-[#8A8279] font-bold text-sm uppercase tracking-widest">No pending appraisals</p>
            </div>
          ) : (
            <div className="space-y-4">
              {filteredAppraisals.map((appraisal) => (
                <div
                  key={appraisal.id}
                  onClick={() => {
                    setSelectedAppraisal(appraisal);
                    setDetailPhotoIndex(0);
                  }}
                  className={`bg-[#14141B] rounded-3xl p-6 border-2 transition-all cursor-pointer hover:shadow-lg ${
                    selectedAppraisal?.id === appraisal.id
                      ? 'border-indigo-500 shadow-lg'
                      : 'border-transparent'
                  }`}
                >
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <h3 className="font-black text-[#F5F0E8] text-lg flex items-center gap-2">
                        {appraisal.customerName}
                        <span className={`px-2 py-0.5 rounded-full text-[9px] font-black text-white ${tierColors[appraisal.loyaltyTier] || 'bg-gray-600'}`}>
                          {appraisal.loyaltyTier}
                        </span>
                      </h3>
                      <p className="text-xs text-[#C9A05C] font-bold uppercase tracking-wider">
                        {appraisal.ticketNumber}
                      </p>
                    </div>
                    {appraisal.isHighRisk && (
                      <span className="bg-red-100 text-red-600 px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest">
                        High Risk
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-3 gap-4 mb-4">
                    <div>
                      <p className="text-[9px] font-black text-[#8A8279] uppercase tracking-widest mb-1">Category</p>
                      <p className="text-sm font-bold text-[#8A8279]">{appraisal.category}</p>
                    </div>
                    <div>
                      <p className="text-[9px] font-black text-[#8A8279] uppercase tracking-widest mb-1">Weight</p>
                      <p className="text-sm font-bold text-[#8A8279]">{appraisal.weight}g</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[9px] font-black text-[#8A8279] uppercase tracking-widest mb-1">Loan Amount</p>
                      <p className="text-lg font-black text-[#C9A05C]">{formatCurrency(appraisal.loanAmount)}</p>
                    </div>
                  </div>

                  <p className="text-xs text-[#B8B0A4] line-clamp-2">{appraisal.description || 'No description provided.'}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Details Panel */}
        <div className="lg:col-span-1">
          {selectedAppraisal ? (
            <div className="bg-[#14141B] rounded-3xl p-8 shadow-sm border border-[rgba(201,160,92,0.08)] sticky top-8 space-y-6">
              <div>
                <h3 className="text-[10px] font-black text-[#8A8279] uppercase tracking-widest mb-4">Appraisal Details</h3>

                <div className="space-y-4">
                  <div className="flex items-center gap-3 pb-4 border-b border-[rgba(201,160,92,0.08)]">
                    <User className="w-5 h-5 text-[#C9A05C]" />
                    <div>
                      <p className="text-[9px] font-black text-[#8A8279] uppercase tracking-widest">Customer</p>
                      <p className="font-bold text-[#F5F0E8] flex items-center gap-2">
                        {selectedAppraisal.customerName}
                        <span className={`px-2 py-0.5 rounded-full text-[9px] font-black text-white ${tierColors[selectedAppraisal.loyaltyTier] || 'bg-gray-600'}`}>
                          {selectedAppraisal.loyaltyTier}
                        </span>
                      </p>
                      <p className="text-xs text-[#B8B0A4]">{selectedAppraisal.customerContact}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 pb-4 border-b border-[rgba(201,160,92,0.08)]">
                    <Scale className="w-5 h-5 text-[#C9A05C]" />
                    <div>
                      <p className="text-[9px] font-black text-[#8A8279] uppercase tracking-widest">Item Details</p>
                      <p className="font-bold text-[#F5F0E8]">{selectedAppraisal.category}</p>
                      <p className="text-xs text-[#B8B0A4]">{selectedAppraisal.weight}g</p>
                    </div>
                  </div>

                  <div className="bg-[#1C1C26] rounded-2xl p-4">
                    <p className="text-[9px] font-black text-[#8A8279] uppercase tracking-widest mb-2">Photos</p>
                    <div className="relative h-44 rounded-2xl border border-[rgba(201,160,92,0.12)] bg-[#14141B] overflow-hidden flex items-center justify-center">
                      {photoSrc ? (
                        <img
                          src={photoSrc}
                          alt={`${selectedAppraisal.ticketNumber} photo ${detailPhotoIndex + 1}`}
                          className="h-full w-full object-cover"
                          onError={() => setPhotoFailed(true)}
                        />
                      ) : photoFailed ? (
                        <div className="flex flex-col items-center gap-2 text-slate-300 p-4">
                          <ImageOff className="w-8 h-8" />
                          <p className="text-xs font-bold text-[#8A8279]">Photo unavailable</p>
                          <button
                            onClick={resolveCurrentPhoto}
                            className="text-[10px] font-black uppercase tracking-widest text-[#C9A05C] hover:underline"
                          >
                            Retry
                          </button>
                        </div>
                      ) : selectedAppraisal.photoUrls.length > 0 ? (
                        <Loader2 className="w-8 h-8 text-[#C9A05C] animate-spin" />
                      ) : (
                        <Package className="w-10 h-10 text-slate-300" />
                      )}

                      {selectedAppraisal.photoUrls.length > 1 ? (
                        <>
                          <button
                            onClick={() =>
                              setDetailPhotoIndex((prev) =>
                                prev === 0 ? selectedAppraisal.photoUrls.length - 1 : prev - 1,
                              )
                            }
                            className="absolute left-3 top-1/2 -translate-y-1/2 h-8 w-8 rounded-full border border-white/40 bg-black/40 text-white flex items-center justify-center"
                            aria-label="Previous photo"
                          >
                            <ChevronLeft className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() =>
                              setDetailPhotoIndex((prev) =>
                                prev >= selectedAppraisal.photoUrls.length - 1 ? 0 : prev + 1,
                              )
                            }
                            className="absolute right-3 top-1/2 -translate-y-1/2 h-8 w-8 rounded-full border border-white/40 bg-black/40 text-white flex items-center justify-center"
                            aria-label="Next photo"
                          >
                            <ChevronRight className="w-4 h-4" />
                          </button>
                        </>
                      ) : null}
                    </div>
                    {selectedAppraisal.photoUrls.length > 1 ? (
                      <p className="text-[10px] mt-2 font-black text-[#8A8279] uppercase tracking-widest">
                        Photo {detailPhotoIndex + 1} / {selectedAppraisal.photoUrls.length}
                      </p>
                    ) : null}
                  </div>

                  <div className="bg-[#1C1C26] rounded-2xl p-4">
                    <p className="text-[9px] font-black text-[#8A8279] uppercase tracking-widest mb-2">Description</p>
                    <p className="text-sm text-[#8A8279]">{selectedAppraisal.description || 'No description provided.'}</p>
                  </div>

                  <div className="flex items-center gap-3 pb-4 border-b border-[rgba(201,160,92,0.08)]">
                    <Calendar className="w-5 h-5 text-[#C9A05C]" />
                    <div>
                      <p className="text-[9px] font-black text-[#8A8279] uppercase tracking-widest">Expiry Date</p>
                      <p className="font-bold text-[#F5F0E8]">
                        {new Date(selectedAppraisal.expiryDate).toLocaleDateString('en-PH', {
                          year: 'numeric',
                          month: 'long',
                          day: 'numeric',
                        })}
                      </p>
                    </div>
                  </div>

                  <div className="bg-[#C9A05C]/10 rounded-2xl p-4">
                    <p className="text-[9px] font-black text-indigo-900 uppercase tracking-widest mb-2">Loan Amount</p>
                    <p className="text-3xl font-black text-[#C9A05C]">{formatCurrency(selectedAppraisal.loanAmount)}</p>
                    <p className="text-xs text-[#C9A05C] mt-1">Interest: {formatCurrency(Math.round(selectedAppraisal.loanAmount * 0.035))}</p>
                  </div>

                  {/* Contract & Disbursement Status */}
                  {approveResult && approveResult.ticketId === selectedAppraisal.id && (
                    <div className="rounded-2xl border border-[rgba(201,160,92,0.2)] bg-[#C9A05C]/10 p-4 space-y-3">
                      <div className="flex items-center gap-2">
                        <FileText className="w-4 h-4 text-[#C9A05C]" />
                        <p className="text-[10px] font-black text-indigo-900 uppercase tracking-widest">Contract Status</p>
                      </div>
                      {!contractComplete ? (
                        <button
                          onClick={() => setShowContractModal(true)}
                          className="w-full py-3 bg-[#C9A05C] text-white rounded-xl text-xs font-black uppercase tracking-widest hover:bg-[#E5C88C] transition-all"
                        >
                          Open Contract for Signing
                        </button>
                      ) : (
                        <div className="space-y-2">
                          <div className="flex items-center gap-2 text-emerald-700">
                            <CheckCircle2 className="w-4 h-4" />
                            <span className="text-xs font-bold">Contract fully signed</span>
                          </div>
                          <button
                            onClick={() => handleDisburse(approveResult.loanId, selectedAppraisal.id)}
                            disabled={disbursingId === selectedAppraisal.id}
                            className="w-full py-3 bg-emerald-600 text-white rounded-xl text-xs font-black uppercase tracking-widest hover:bg-emerald-700 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                          >
                            {disbursingId === selectedAppraisal.id ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <CreditCard className="w-4 h-4" />
                            )}
                            Disburse Loan
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {canApprove && !approveResult && (
                <div className="space-y-3 pt-4 border-t border-[rgba(201,160,92,0.08)]">
                  <button
                    onClick={() => handleApprove(selectedAppraisal.id)}
                    disabled={processingId === selectedAppraisal.id}
                    className="w-full bg-green-600 text-white py-4 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-green-700 transition-all shadow-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {processingId === selectedAppraisal.id ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <>
                        <CheckCircle2 className="w-4 h-4" />
                        Approve & Generate Contract
                      </>
                    )}
                  </button>

                  <div className="space-y-2">
                    <textarea
                      value={rejectionReason}
                      onChange={(e) => setRejectionReason(e.target.value)}
                      placeholder="Reason for rejection..."
                      className="w-full px-4 py-3 border border-[rgba(201,160,92,0.12)] rounded-xl text-sm focus:border-red-500 focus:ring-2 focus:ring-red-200 outline-none transition"
                      rows={3}
                    />
                    <button
                      onClick={() => handleReject(selectedAppraisal.id)}
                      disabled={processingId === selectedAppraisal.id || !rejectionReason.trim()}
                      className="w-full bg-red-600 text-white py-4 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-red-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                      <XCircle className="w-4 h-4" />
                      Reject Appraisal
                    </button>
                  </div>
                </div>
              )}

              {approveResult && approveResult.ticketId === selectedAppraisal.id && canApprove && (
                <div className="pt-4 border-t border-[rgba(201,160,92,0.08)]">
                  <p className="text-[10px] text-[#C9A05C] font-black uppercase tracking-widest text-center">
                    Contract generated -- proceed with signing
                  </p>
                </div>
              )}
            </div>
          ) : (
            <div className="bg-[#14141B] rounded-3xl p-12 text-center border border-[rgba(201,160,92,0.08)] sticky top-8">
              <Eye className="w-16 h-16 text-slate-300 mx-auto mb-4" />
              <p className="text-[#8A8279] font-bold text-sm uppercase tracking-widest">Select an appraisal to review</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
