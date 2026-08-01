import { useEffect, useState } from 'react';
import { Gavel, Loader2, Search, ShieldCheck, UserCheck } from 'lucide-react';
import Swal from 'sweetalert2';
import { useToast } from '../App';
import api from '@/lib/apiClient';
import { formatCurrency } from '@/lib/formatters';

interface AuctionSettlementsProps {
  branchId: string | null;
  activeBranchId?: number | null;
}

interface SettlementItem {
  id: string;
  listingId: number;
  listing: { id: number; title: string; status: string; endAt: string | null };
  winnerId: string;
  winnerFullName: string;
  winnerPhone: string;
  winningBid: number;
  status: string;
  complianceDeadline: string;
  compliedAt: string | null;
  paymentReference: string | null;
  contractSignedAt: string | null;
  releasedAt: string | null;
  releasedBy: string | null;
  releaseNotes: string | null;
  createdAt: string;
}

function getStatusBadge(status: string): { label: string; color: string; bg: string } {
  switch (status) {
    case 'PENDING_COMPLIANCE':
      return { label: 'Awaiting Payment', color: '#fbbf24', bg: 'rgba(251,191,36,0.1)' };
    case 'COMPLIED':
      return { label: 'Paid', color: '#4ade80', bg: 'rgba(74,222,128,0.1)' };
    case 'READY_FOR_RELEASE':
      return { label: 'For Release', color: '#60a5fa', bg: 'rgba(96,165,250,0.1)' };
    case 'RELEASED':
      return { label: 'Released', color: '#a78bfa', bg: 'rgba(167,139,250,0.1)' };
    case 'EXPIRED':
      return { label: 'Expired', color: '#ef4444', bg: 'rgba(239,68,68,0.1)' };
    default:
      return { label: status, color: '#999', bg: 'rgba(153,153,153,0.1)' };
  }
}

export function AuctionSettlements({ branchId, activeBranchId }: AuctionSettlementsProps) {
  const { showToast } = useToast();
  const [items, setItems] = useState<SettlementItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [releasingId, setReleasingId] = useState<string | null>(null);

  const fetchSettlements = async () => {
    setLoading(true);
    try {
      const res = await api.get<{ data: SettlementItem[]; total: number }>('/auction/settlements');
      setItems(res.data || []);
    } catch (err: unknown) {
      showToast(`Error loading settlements: ${err instanceof Error ? err.message : String(err)}`, 'error');
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSettlements();
  }, []);

  const canRelease = (status: string) =>
    ['COMPLIED', 'READY_FOR_RELEASE'].includes(status);

  const handleRelease = async (item: SettlementItem) => {
    const result = await Swal.fire({
      title: 'Release Item to Winner',
      html: `
        <p style="margin-bottom:1rem;text-align:left">
          Release <strong>${item.listing.title}</strong> to <strong>${item.winnerFullName}</strong>?
        </p>
        <textarea id="release-notes" placeholder="Release notes (optional)"
          style="width:100%;padding:0.75rem;border-radius:0.75rem;border:1px solid rgba(201,160,92,0.2);
          background:rgba(255,255,255,0.04);color:#EAE2D6;font-family:inherit;resize:vertical;"
          rows="3"></textarea>
      `,
      showCancelButton: true,
      confirmButtonColor: '#C9A05C',
      cancelButtonColor: '#6B655C',
      confirmButtonText: 'Yes, Release Item',
      cancelButtonText: 'Cancel',
      preConfirm: () => {
        const notes = (document.getElementById('release-notes') as HTMLTextAreaElement)?.value || '';
        return { notes };
      },
    });

    if (!result.isConfirmed) return;

    setReleasingId(item.id);
    try {
      await api.patch(`/auction/settlements/${item.id}/release`, result.value);
      showToast(`Item released to ${item.winnerFullName}`, 'success');
      fetchSettlements();
    } catch (err: unknown) {
      showToast(`Release failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
    } finally {
      setReleasingId(null);
    }
  };

  const filtered = items.filter(
    (item) =>
      item.listing.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.winnerFullName.toLowerCase().includes(searchTerm.toLowerCase()),
  );

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Gavel className="w-6 h-6 text-[#C9A05C]" />
          <h2 className="text-2xl font-black text-[#EAE2D6] uppercase tracking-tight">
            Auction Settlements
          </h2>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#6B655C]" />
          <input
            type="text"
            placeholder="Search by title or winner..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10 pr-4 py-2 rounded-xl bg-[#1C1C26] border border-[rgba(201,160,92,0.08)] text-[#EAE2D6] text-sm placeholder-[#6B655C] focus:outline-none focus:border-[#C9A05C] w-64"
          />
        </div>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-24">
          <Loader2 className="w-8 h-8 text-[#C9A05C] animate-spin mb-3" />
          <p className="text-[10px] font-black uppercase tracking-widest text-[#6B655C]">Loading settlements...</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="border-2 border-dashed border-[rgba(201,160,92,0.08)] rounded-[2rem] flex flex-col items-center justify-center py-24 px-8 text-center">
          <ShieldCheck className="w-8 h-8 text-[#6B655C] mb-4" />
          <p className="text-[#6B655C] font-black uppercase text-[10px] tracking-[0.3em]">
            {searchTerm ? 'No settlements match your search' : 'No auction settlements yet'}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[rgba(201,160,92,0.08)]">
                <th className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-wider text-[#6B655C]">Item</th>
                <th className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-wider text-[#6B655C]">Winner</th>
                <th className="px-4 py-3 text-right text-[10px] font-black uppercase tracking-wider text-[#6B655C]">Winning Bid</th>
                <th className="px-4 py-3 text-center text-[10px] font-black uppercase tracking-wider text-[#6B655C]">Status</th>
                <th className="px-4 py-3 text-center text-[10px] font-black uppercase tracking-wider text-[#6B655C]">Contract</th>
                <th className="px-4 py-3 text-center text-[10px] font-black uppercase tracking-wider text-[#6B655C]">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item) => {
                const badge = getStatusBadge(item.status);
                const expired = new Date(item.complianceDeadline) < new Date() && item.status === 'PENDING_COMPLIANCE';

                return (
                  <tr key={item.id} className="border-b border-[rgba(201,160,92,0.04)] hover:bg-[rgba(201,160,92,0.02)] transition-colors">
                    <td className="px-4 py-4">
                      <p className="font-bold text-[#EAE2D6]">{item.listing.title}</p>
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-2">
                        <UserCheck className="w-4 h-4 text-[#6B655C]" />
                        <span className="font-bold text-[#EAE2D6]">{item.winnerFullName}</span>
                      </div>
                      <p className="text-[10px] text-[#6B655C]">{item.winnerPhone}</p>
                    </td>
                    <td className="px-4 py-4 text-right font-bold text-[#EAE2D6]">
                      {formatCurrency(item.winningBid)}
                    </td>
                    <td className="px-4 py-4 text-center">
                      <span
                        className="inline-block px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider"
                        style={{
                          background: expired ? 'rgba(239,68,68,0.1)' : badge.bg,
                          color: expired ? '#ef4444' : badge.color,
                        }}
                      >
                        {expired ? 'Expired' : badge.label}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-center">
                      {item.contractSignedAt ? (
                        <span className="text-[10px] font-bold text-[#4ade80]">
                          Signed {new Date(item.contractSignedAt).toLocaleDateString('en-PH')}
                        </span>
                      ) : (
                        <span className="text-[10px] text-[#6B655C]">Not signed</span>
                      )}
                    </td>
                    <td className="px-4 py-4 text-center">
                      {item.status === 'RELEASED' ? (
                        <span className="text-[10px] text-[#a78bfa] font-bold uppercase">
                          Released {item.releasedAt ? new Date(item.releasedAt).toLocaleDateString('en-PH') : ''}
                        </span>
                      ) : canRelease(item.status) ? (
                        <button
                          onClick={() => handleRelease(item)}
                          disabled={releasingId === item.id}
                          className="px-4 py-2 rounded-xl bg-[#C9A05C] text-white text-[10px] font-black uppercase tracking-wider hover:bg-[#E5C88C] transition-colors disabled:opacity-50"
                        >
                          {releasingId === item.id ? (
                            <Loader2 className="w-3 h-3 animate-spin inline" />
                          ) : (
                            'Release Item'
                          )}
                        </button>
                      ) : (
                        <span className="text-[10px] text-[#6B655C]">Awaiting payment</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
