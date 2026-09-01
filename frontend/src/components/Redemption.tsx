import { useState, useEffect } from 'react';
import { 
  Search, 
  RotateCcw,  
  Loader2, 
  Receipt, 
  Wallet, 
  PackageCheck
} from 'lucide-react';
import { useToast } from '../App';
import { supabase } from '../lib/supabaseClient';
import api from '../lib/apiClient';
import { formatCurrency } from '../lib/formatters';
import { ReceiptViewer } from './ReceiptViewer';
import Swal from 'sweetalert2';

const tierColors: Record<string, string> = {
  Standard: 'bg-gray-600',
  Bronze: 'bg-amber-700',
  Silver: 'bg-gray-400',
  Gold: 'bg-yellow-500',
  VIP: 'bg-purple-600',
};

// UPDATED: Added props interface to fix TS2322 error
interface RedemptionProps {
  branchId: string | null;
  activeBranchId?: number | null;
}

interface RedemptionItem {
  id: string; 
  ticketId: string;
  customerName: string;
  itemDetails: string;
  loanAmount: number;
  expiryDate: string;
  status: string;
  loyaltyTier: string;
}

export function Redemption({ branchId, activeBranchId }: RedemptionProps) {
  const [items, setItems] = useState<RedemptionItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedItem, setSelectedItem] = useState<RedemptionItem | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isFetching, setIsFetching] = useState(true);
  const [redeemedTicketId, setRedeemedTicketId] = useState<string | null>(null);
  const [showReceipt, setShowReceipt] = useState(false);

  const { showToast } = useToast();

  const sanitizeAssetDetails = (text?: string | null): string => {
    if (!text) return 'Pawned Item';
    const cleaned = String(text)
      .replace(/\n?\s*\[PHOTO_URL\]\s+https?:\/\/\S+/gi, '')
      .replace(/\n?\s*\[PHOTO_URLS\]\s+\[[\s\S]*?\]/gi, '')
      .replace(/https?:\/\/\S+/gi, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
    return cleaned || 'Pawned Item';
  };

  const fetchVault = async () => {
    const activePawnshopId = branchId ?? null;
    const activeOperationalBranchId = Number.isInteger(activeBranchId as number) ? Number(activeBranchId) : null;
    const hasActiveOperationalBranch = activeOperationalBranchId != null && activeOperationalBranchId > 0;
    
    if (!activePawnshopId) {
      setIsFetching(false);
      return;
    }

    setIsFetching(true);
    try {
      let query = supabase
        .from('ticket')
        .select(`
          id, 
          ticket_number, 
          description, 
          loan_amount, 
          expiry_date, 
          status, 
          customer:customer_id (
            full_name,
            loyaltytier
          )
        `);

      if (activePawnshopId) {
        query = query.eq('pawnshop_id', activePawnshopId as any);
      }
      if (hasActiveOperationalBranch) {
        query = query.eq('branch_id', activeOperationalBranchId as any);
      }

      const { data, error } = await query.eq('lifecycle_status', 'ACTIVE'); 

      if (error) throw error;

      const activeItems: RedemptionItem[] = (data || []).map((ticket: any) => ({
        id: ticket.id,
        ticketId: ticket.ticket_number,
        customerName: ticket.customer?.full_name || 'Unknown Customer',
        itemDetails: sanitizeAssetDetails(ticket.description),
        loanAmount: Number(ticket.loan_amount) || 0,
        expiryDate: ticket.expiry_date,
        status: ticket.status,
        loyaltyTier: ticket.customer?.loyaltytier || 'Standard',
      }));

      setItems(activeItems);
    } catch (err: unknown) {
      showToast(`Error: ${err instanceof Error ? err.message : String(err)}`, "error");
    } finally {
      setIsFetching(false);
    }
  };

  // RE-FETCH when branchId changes (Super Admin switching branches)
  useEffect(() => {
    fetchVault();
    setSelectedItem(null); // Clear selection if branch changes
  }, [branchId, activeBranchId]);

  const handleRedeem = async (id: string) => {
    if (!selectedItem) return;
    const confirm = await Swal.fire({
      title: 'Confirm Action',
      text: `Authorize release for ticket ${selectedItem.ticketId}? Total due: ${formatCurrency(calculateTotal(selectedItem.loanAmount).total)}`,
      icon: 'question',
      showCancelButton: true,
      confirmButtonColor: '#C9A05C',
      cancelButtonColor: '#8A8279',
      confirmButtonText: 'Yes, proceed',
      cancelButtonText: 'Cancel',
    });
    if (!confirm.isConfirmed) return;
    
    setIsLoading(true);
    try {
      const totalDue = calculateTotal(selectedItem.loanAmount).total;
      const res = await api.post<{
        requiresApproval?: boolean;
        approvalId?: string;
        message?: string;
      }>(
        `/pawn-tickets/${id}/redeem`,
        { amountPaid: totalDue, paymentMethod: 'CASH', notes: `In-person redemption` }
      );

      if (res?.requiresApproval) {
        showToast(
          `Ticket #${selectedItem.ticketId} submitted for approval — release pending owner sign-off.`,
          "success",
        );
        setSelectedItem(null);
        void fetchVault();
        return;
      }

      showToast(`Ticket #${selectedItem.ticketId} redeemed! ${formatCurrency(totalDue)} collected.`, "success");
      setItems(prev => prev.filter(item => item.id !== id));
      setRedeemedTicketId(id);
      setShowReceipt(true);
      setSelectedItem(null);
      
    } catch (error: any) {
      console.error("Redemption failed:", error);
      showToast(error.message || 'Redemption failed', "error");
    } finally {
      setIsLoading(false);
    }
  };

  const calculateTotal = (principal: number) => {
    const interest = principal * 0.03; // 3% matches DB interestRate default
    const serviceFee = 50;
    return {
      interest,
      serviceFee,
      total: principal + interest + serviceFee
    };
  };

  const filteredItems = items.filter(item => 
    item.customerName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    item.ticketId?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="p-6 space-y-6 text-left animate-in fade-in duration-500">
      <div className="flex justify-between items-end border-b border-[rgba(201,160,92,0.08)] pb-6">
        <div>
          <h2 className="text-3xl font-black text-[#F5F0E8] uppercase italic tracking-tighter">
            Redemption <span className="text-[#C9A05C]">Center</span>
          </h2>
          <p className="text-[#8A8279] text-[10px] font-black uppercase tracking-[0.2em] mt-1">
            Vault Authorization & Asset Release
          </p>
        </div>
        <button 
          onClick={fetchVault} 
          className="group flex items-center gap-2 bg-[#1C1C26] px-4 py-2 rounded-xl border border-[rgba(201,160,92,0.12)] hover:bg-[#C9A05C]/10 transition-all"
        >
          <RotateCcw className={`w-4 h-4 text-[#8A8279] group-hover:text-[#C9A05C] ${isFetching ? 'animate-spin' : ''}`} />
          <span className="text-[10px] font-black uppercase text-[#8A8279] group-hover:text-[#C9A05C]">Sync Vault</span>
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          <div className="relative">
            <Search className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-300 w-5 h-5" />
            <input 
              type="text"
              placeholder="Search Ticket or Customer..."
              className="w-full pl-14 pr-4 py-5 rounded-3xl border border-[rgba(201,160,92,0.08)] bg-[#14141B] shadow-sm font-bold text-sm outline-none focus:ring-2 focus:ring-blue-500/10"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <div className="bg-[#14141B] rounded-[2.5rem] border border-[rgba(201,160,92,0.08)] overflow-hidden shadow-xl">
            <table className="w-full">
              <thead className="bg-[#1C1C26]/50">
                <tr>
                  <th className="px-8 py-5 text-[10px] font-black text-[#8A8279] uppercase text-left tracking-widest">Asset Details</th>
                  <th className="px-8 py-5 text-[10px] font-black text-[#8A8279] uppercase text-left tracking-widest">Owner</th>
                  <th className="px-8 py-5 text-[10px] font-black text-[#8A8279] uppercase text-left tracking-widest">Principal</th>
                  <th className="px-8 py-5 text-[10px] font-black text-[#8A8279] uppercase text-right tracking-widest">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {isFetching ? (
                   <tr><td colSpan={4} className="py-20 text-center"><Loader2 className="animate-spin mx-auto text-blue-500 w-8 h-8" /></td></tr>
                ) : filteredItems.length > 0 ? (
                  filteredItems.map(item => (
                    <tr key={item.id} className="hover:bg-[#C9A05C]/10/30 transition-colors">
                      <td className="px-8 py-6">
                        <p className="font-black text-[#F5F0E8]">{item.itemDetails}</p>
                        <p className="text-[10px] text-[#C9A05C] font-bold uppercase">Ref: {item.ticketId}</p>
                      </td>
                      <td className="px-8 py-6 text-sm font-bold text-[#B8B0A4]">
                        <span className="flex items-center gap-2">
                          {item.customerName}
                          <span className={`px-2 py-0.5 rounded-full text-[9px] font-black text-white ${tierColors[item.loyaltyTier] || 'bg-gray-600'}`}>
                            {item.loyaltyTier}
                          </span>
                        </span>
                      </td>
                      <td className="px-8 py-6 font-black text-[#F5F0E8]">{formatCurrency(item.loanAmount)}</td>
                      <td className="px-8 py-6 text-right">
                        <button 
                          onClick={() => setSelectedItem(item)} 
                          className="bg-slate-900 text-white px-5 py-2.5 rounded-xl text-[10px] font-black uppercase hover:bg-blue-600 transition-all"
                        >
                          Calculate
                        </button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={4} className="py-20 text-center text-[#8A8279] text-[10px] font-black uppercase tracking-widest">No Active Items Found</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="lg:col-span-1">
          {selectedItem ? (
            <div className="bg-slate-900 rounded-[3rem] p-8 text-white shadow-2xl animate-in slide-in-from-right-8 duration-500 sticky top-8">
              <div className="flex items-center gap-3 mb-8">
                <Receipt className="w-6 h-6 text-blue-400" />
                <h3 className="font-black text-xl uppercase italic tracking-tighter">Settlement</h3>
              </div>

              <div className="mb-6 pb-4 border-b border-white/5">
                <p className="text-[10px] font-black text-[#8A8279] uppercase mb-1">Customer</p>
                <p className="font-bold text-white flex items-center gap-2">
                  {selectedItem.customerName}
                  <span className={`px-2 py-0.5 rounded-full text-[9px] font-black text-white ${tierColors[selectedItem.loyaltyTier] || 'bg-gray-600'}`}>
                    {selectedItem.loyaltyTier}
                  </span>
                </p>
              </div>
              
              <div className="space-y-4 mb-10">
                <div className="flex justify-between items-center pb-4 border-b border-white/5">
                  <span className="text-[10px] font-black text-[#8A8279] uppercase">Principal</span>
                  <span className="font-bold text-lg">{formatCurrency(selectedItem.loanAmount)}</span>
                </div>
                <div className="flex justify-between items-center pb-4 border-b border-white/5">
                  <span className="text-[10px] font-black text-[#8A8279] uppercase">Interest (3%)</span>
                  <span className="font-bold text-blue-400">+ {formatCurrency(calculateTotal(selectedItem.loanAmount).interest)}</span>
                </div>
                <div className="flex justify-between items-center pb-4 border-b border-white/5">
                  <span className="text-[10px] font-black text-[#8A8279] uppercase">Service Fee</span>
                  <span className="font-bold text-blue-400">+ {formatCurrency(50)}</span>
                </div>
                <div className="pt-6 flex justify-between items-end">
                  <span className="text-[10px] font-black text-blue-400 uppercase mb-2">Total Due</span>
                  <span className="text-4xl font-black italic tracking-tighter">
                    {formatCurrency(calculateTotal(selectedItem.loanAmount).total)}
                  </span>
                </div>
              </div>

              <button 
                onClick={() => handleRedeem(selectedItem.id)}
                disabled={isLoading}
                className="w-full py-5 bg-blue-600 text-white rounded-[2rem] font-black uppercase text-xs hover:bg-[#C9A05C]/100 transition-all flex items-center justify-center gap-3 disabled:opacity-50"
              >
                {isLoading ? <Loader2 className="animate-spin w-5 h-5" /> : <PackageCheck className="w-5 h-5" />}
                Authorize Release
              </button>
              
              <button 
                onClick={() => setSelectedItem(null)}
                className="w-full mt-4 py-2 text-[#8A8279] font-black uppercase text-[10px] hover:text-white transition-colors"
              >
                Cancel
              </button>
            </div>
          ) : (
            <div className="h-[400px] border-2 border-dashed border-[rgba(201,160,92,0.08)] rounded-[3rem] flex flex-col items-center justify-center p-12 text-center bg-[#1C1C26]/30">
              <Wallet className="w-8 h-8 text-slate-200 mb-4" />
              <p className="text-[#8A8279] font-black uppercase text-[10px] tracking-[0.3em]">Select an item to redeem</p>
            </div>
          )}
        </div>
      </div>
      {showReceipt && redeemedTicketId && (
        <ReceiptViewer
          referenceType="TICKET"
          referenceId={redeemedTicketId}
          open={showReceipt}
          onClose={() => setShowReceipt(false)}
        />
      )}
    </div>
  );
}