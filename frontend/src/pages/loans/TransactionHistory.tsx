import { useCallback, useEffect, useState } from 'react';
import { ArrowDownRight, ArrowRight, ArrowUpRight, FileDown, History, Loader2, Receipt as ReceiptIcon, Search } from 'lucide-react';
import api from '../../lib/apiClient';
import { getBackendUrl } from '../../lib/backendUrl';
import { supabase } from '../../lib/supabaseClient';

type ReceiptRecord = {
  id: string;
  receiptNumber: string;
  receiptType: string;
  referenceType: string;
  referenceId: string;
  amount: number;
  taxAmount?: number;
  totalAmount: number;
  currency?: string;
  customerName: string;
  customerAddress?: string | null;
  lineItems?: unknown;
  pdfUrl?: string | null;
  isVoid: boolean;
  voidReason?: string | null;
  generatedAt: string;
  generatedBy: string;
  customerId?: string | null;
};

type ReceiptListResponse = {
  data: ReceiptRecord[];
  total: number;
  limit: number;
  offset: number;
};

const TYPE_META: Record<string, { label: string; badge: string; icon: 'in' | 'out' }> = {
  PAYMENT: { label: 'Payment', badge: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20', icon: 'in' },
  REDEMPTION: { label: 'Redemption', badge: 'bg-teal-500/10 text-teal-300 border-teal-500/20', icon: 'in' },
  LOAN_DISBURSEMENT: { label: 'Loan Disbursement', badge: 'bg-gold/10 text-[#C9A05C] border-gold/25', icon: 'out' },
  AUCTION_SALE: { label: 'Auction Sale', badge: 'bg-violet-500/10 text-violet-300 border-violet-500/20', icon: 'in' },
  PENALTY: { label: 'Penalty', badge: 'bg-red-500/10 text-red-300 border-red-500/20', icon: 'in' },
  RENEWAL: { label: 'Renewal', badge: 'bg-sky-500/10 text-sky-300 border-sky-500/20', icon: 'in' },
  SERVICE_FEE: { label: 'Service Fee', badge: 'bg-amber-500/10 text-amber-300 border-amber-500/20', icon: 'in' },
  APPRAISAL_CERTIFICATE: { label: 'Appraisal Certificate', badge: 'bg-cyan-500/10 text-cyan-300 border-cyan-500/20', icon: 'in' },
  FORFEITURE: { label: 'Forfeiture', badge: 'bg-orange-500/10 text-orange-300 border-orange-500/20', icon: 'out' },
  AUCTION_UNSOLD: { label: 'Auction Unsold', badge: 'bg-zinc-500/10 text-zinc-300 border-zinc-500/20', icon: 'out' },
};

const TYPE_ORDER = ['PAYMENT', 'REDEMPTION', 'LOAN_DISBURSEMENT', 'AUCTION_SALE', 'PENALTY', 'RENEWAL', 'SERVICE_FEE', 'APPRAISAL_CERTIFICATE', 'FORFEITURE', 'AUCTION_UNSOLD'];

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) +
    ' · ' +
    d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function formatMoney(value: number): string {
  return '₱' + Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function downloadReceipt(receipt: ReceiptRecord) {
  try {
    const headers: Record<string, string> = {};
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`;
    } catch {}
    const res = await fetch(`${getBackendUrl()}/receipts/${receipt.id}/pdf/download`, { headers });
    if (!res.ok) throw new Error('Download failed');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${receipt.receiptNumber || 'receipt'}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch {}
}

export function TransactionHistory() {
  const [transactions, setTransactions] = useState<ReceiptRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [hasMore, setHasMore] = useState(false);

  const PAGE_SIZE = 25;

  const fetchPage = useCallback(async (offset: number) => {
    try {
      const pawnshopId = localStorage.getItem('active_pawnshop_id') || undefined;
      const res = await api.get<ReceiptListResponse>('/receipts', {
        pawnshopId,
        type: typeFilter || undefined,
        limit: PAGE_SIZE,
        offset,
      });
      return res;
    } catch {
      return null;
    }
  }, [typeFilter]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setTransactions([]);
      const res = await fetchPage(0);
      if (cancelled) return;
      if (res) {
        setTransactions(res.data || []);
        setTotal(res.total ?? 0);
        setHasMore((res.data?.length || 0) >= PAGE_SIZE);
      } else {
        setTransactions([]);
        setTotal(0);
        setHasMore(false);
      }
      setLoading(false);
    };
    load();
    return () => { cancelled = true; };
  }, [fetchPage]);

  const loadMore = async () => {
    if (loadingMore) return;
    setLoadingMore(true);
    const res = await fetchPage(transactions.length);
    if (res && res.data?.length) {
      setTransactions((prev) => {
        const seen = new Set(prev.map((t) => t.id));
        const fresh = res.data.filter((t) => !seen.has(t.id));
        return [...prev, ...fresh];
      });
      setHasMore((res.data?.length || 0) >= PAGE_SIZE);
    } else {
      setHasMore(false);
    }
    setLoadingMore(false);
  };

  const query = search.trim().toLowerCase();
  const filtered = query
    ? transactions.filter(
        (t) =>
          (t.receiptNumber || '').toLowerCase().includes(query) ||
          (t.customerName || '').toLowerCase().includes(query) ||
          (t.referenceId || '').toLowerCase().includes(query),
      )
    : transactions;

  const metaFor = (type: string) => TYPE_META[type] || { label: type || 'Transaction', badge: 'bg-[#1C1C26] text-[#B8B0A4] border-white/10', icon: 'in' as const };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700 text-left max-w-5xl">
      <div>
        <h2 className="text-3xl font-black text-[#F5F0E8] tracking-tight uppercase italic leading-none">
          Transaction <span className="text-[#C9A05C]">History</span>
        </h2>
        <p className="mt-2 text-[11px] font-black uppercase tracking-widest text-[#8A8279] flex items-center gap-2">
          <History className="w-4 h-4 text-[#C9A05C]" />
          Immutable record of every financial transaction
        </p>
      </div>

      <div className="bg-[#14141B] rounded-[2rem] border border-[rgba(201,160,92,0.08)] p-4 flex flex-col md:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-[#8A8279] absolute left-4 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search receipt no., customer, or reference..."
            className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-[rgba(201,160,92,0.12)] text-sm font-bold focus:outline-none focus:ring-2 focus:ring-[rgba(201,160,92,0.2)]"
          />
        </div>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="px-4 py-2.5 rounded-xl border border-[rgba(201,160,92,0.12)] text-xs font-black uppercase tracking-wider focus:outline-none focus:ring-2 focus:ring-[rgba(201,160,92,0.2)]"
        >
          <option value="">All Types</option>
          {TYPE_ORDER.map((type) => (
            <option key={type} value={type}>{TYPE_META[type].label}</option>
          ))}
        </select>
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#1C1C26] text-[11px] font-black uppercase tracking-wider text-[#B8B0A4] shrink-0">
          <ReceiptIcon className="w-4 h-4 text-[#C9A05C]" />
          {filtered.length.toLocaleString()} / {total.toLocaleString()} transactions
        </div>
      </div>

      <div className="bg-[#14141B] rounded-[2rem] border border-[rgba(201,160,92,0.08)] overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 text-[#C9A05C] animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <p className="text-xs text-[#8A8279] py-16 text-center">
            {query || typeFilter ? 'No transactions match your filters.' : 'No transactions found.'}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-[rgba(201,160,92,0.1)]">
                  <th className="px-5 py-3 text-[10px] font-black uppercase tracking-widest text-[#8A8279]">Receipt No.</th>
                  <th className="px-5 py-3 text-[10px] font-black uppercase tracking-widest text-[#8A8279]">Type</th>
                  <th className="px-5 py-3 text-[10px] font-black uppercase tracking-widest text-[#8A8279]">Customer</th>
                  <th className="px-5 py-3 text-[10px] font-black uppercase tracking-widest text-[#8A8279]">Reference</th>
                  <th className="px-5 py-3 text-[10px] font-black uppercase tracking-widest text-[#8A8279]">Date</th>
                  <th className="px-5 py-3 text-right text-[10px] font-black uppercase tracking-widest text-[#8A8279]">Amount</th>
                  <th className="px-5 py-3 text-right text-[10px] font-black uppercase tracking-widest text-[#8A8279]">Receipt</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((t) => {
                  const meta = metaFor(t.receiptType);
                  const AmountIcon = meta.icon === 'out' ? ArrowUpRight : ArrowDownRight;
                  return (
                    <tr
                      key={t.id}
                      className="border-b border-[rgba(201,160,92,0.05)] hover:bg-[#C9A05C]/5 transition-colors"
                    >
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-xl bg-[#C9A05C]/10 text-[#C9A05C] flex items-center justify-center shrink-0">
                            <ReceiptIcon className="w-4 h-4" />
                          </div>
                          <div className="flex flex-col">
                            <span className="text-xs font-black text-[#F5F0E8] tracking-tight">{t.receiptNumber}</span>
                            {t.isVoid && (
                              <span className="text-[9px] font-black uppercase tracking-widest text-red-400">
                                Void{t.voidReason ? ` — ${t.voidReason}` : ''}
                              </span>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-3.5">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[10px] font-black uppercase tracking-wider ${meta.badge}`}>
                          {meta.icon === 'out' ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                          {meta.label}
                        </span>
                      </td>
                      <td className="px-5 py-3.5">
                        <span className="text-xs font-bold text-[#F5F0E8]">{t.customerName || '—'}</span>
                        {t.referenceType && (
                          <div className="text-[9px] text-[#8A8279] uppercase tracking-wider mt-0.5">{t.referenceType}</div>
                        )}
                      </td>
                      <td className="px-5 py-3.5">
                        <span className="text-[10px] font-mono text-[#B8B0A4]">{t.referenceId ? t.referenceId.slice(0, 12) : '—'}</span>
                      </td>
                      <td className="px-5 py-3.5">
                        <span className="text-[11px] text-[#B8B0A4] whitespace-nowrap">{formatDateTime(t.generatedAt)}</span>
                      </td>
                      <td className="px-5 py-3.5 text-right whitespace-nowrap">
                        <span className={`inline-flex items-center gap-1.5 text-xs font-black ${t.isVoid ? 'text-[#8A8279] line-through' : meta.icon === 'out' ? 'text-[#F0A68C]' : 'text-[#7BD88F]'}`}>
                          <AmountIcon className="w-3.5 h-3.5" />
                          {formatMoney(t.totalAmount)}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        <button
                          onClick={() => downloadReceipt(t)}
                          title="Download receipt PDF"
                          className="inline-flex items-center justify-center w-8 h-8 rounded-xl bg-[#1C1C26] hover:bg-[#C9A05C] text-[#B8B0A4] hover:text-white transition-colors"
                        >
                          <FileDown className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {!loading && filtered.length > 0 && (
          <div className="px-5 py-4 border-t border-[rgba(201,160,92,0.08)] flex items-center justify-between">
            <span className="text-[10px] font-black uppercase tracking-widest text-[#8A8279]">
              Showing {filtered.length.toLocaleString()} of {total.toLocaleString()}
            </span>
            {hasMore && (
              <button
                onClick={loadMore}
                disabled={loadingMore}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#C9A05C] text-white text-[10px] font-black uppercase tracking-wider hover:bg-[#E5C88C] disabled:opacity-50 transition-colors"
              >
                {loadingMore ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
                Load More
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
