import { useEffect, useState } from 'react';
import { Clock, History, Loader2, Search } from 'lucide-react';
import api from '../../lib/apiClient';
import { LoanHistoryTimeline } from '../../components/LoanHistoryTimeline';
import { LoanStatusProgress } from '../../components/LoanStatusProgress';
import { CustomerHistory } from '../../components/CustomerHistory';

type RecentLoan = {
  id: number;
  customerId: string;
  customer?: { fullName?: string } | null;
  status?: string;
  submittedAt?: string;
  requestedAmount?: number;
};

export function LoanHistoryPage() {
  const [searchMode, setSearchMode] = useState<'loan' | 'customer'>('loan');
  const [searchValue, setSearchValue] = useState('');
  const [activeLoanId, setActiveLoanId] = useState<number | null>(null);
  const [activeCustomerId, setActiveCustomerId] = useState<string | null>(null);
  const [recentLoans, setRecentLoans] = useState<RecentLoan[]>([]);
  const [loadingRecent, setLoadingRecent] = useState(true);

  useEffect(() => {
    const fetchRecent = async () => {
      setLoadingRecent(true);
      try {
        const pawnshopId = localStorage.getItem('active_pawnshop_id') || undefined;
        const data = await api.get<RecentLoan[]>('/loan/applications', {
          pawnshopId,
          limit: 15,
        });
        setRecentLoans(Array.isArray(data) ? data : []);
      } catch {
        setRecentLoans([]);
      } finally {
        setLoadingRecent(false);
      }
    };
    fetchRecent();
  }, []);

  const handleSearch = () => {
    if (!searchValue.trim()) return;
    if (searchMode === 'loan') {
      const id = parseInt(searchValue);
      if (!isNaN(id)) setActiveLoanId(id);
    } else {
      setActiveCustomerId(searchValue.trim());
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700 text-left max-w-5xl">
      <div>
        <h2 className="text-3xl font-black text-[#EAE2D6] tracking-tight uppercase italic leading-none">
          Loan <span className="text-[#C9A05C]">History</span>
        </h2>
        <p className="mt-2 text-[11px] font-black uppercase tracking-widest text-[#6B655C] flex items-center gap-2">
          <History className="w-4 h-4 text-[#C9A05C]" />
          View loan timelines, status progress, and customer dashboards
        </p>
      </div>

      <div className="bg-[#14141B] rounded-[2rem] border border-[rgba(201,160,92,0.08)] p-4 flex flex-col sm:flex-row gap-3">
        <div className="flex gap-2">
          <button
            onClick={() => { setSearchMode('loan'); setActiveLoanId(null); setActiveCustomerId(null); }}
            className={`px-5 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition-colors ${
              searchMode === 'loan' ? 'bg-[#C9A05C] text-white' : 'bg-[#1C1C26] text-[#999186] hover:bg-[#222228]'
            }`}
          >
            By Loan ID
          </button>
          <button
            onClick={() => { setSearchMode('customer'); setActiveLoanId(null); setActiveCustomerId(null); }}
            className={`px-5 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition-colors ${
              searchMode === 'customer' ? 'bg-[#C9A05C] text-white' : 'bg-[#1C1C26] text-[#999186] hover:bg-[#222228]'
            }`}
          >
            By Customer ID
          </button>
        </div>
        <div className="relative flex-1 flex gap-2">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-[#6B655C] absolute left-4 top-1/2 -translate-y-1/2" />
            <input
              type={searchMode === 'loan' ? 'number' : 'text'}
              value={searchValue}
              onChange={(e) => setSearchValue(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder={searchMode === 'loan' ? 'Enter Loan ID...' : 'Enter Customer ID...'}
              className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-[rgba(201,160,92,0.12)] text-sm font-bold focus:outline-none focus:ring-2 focus:ring-[rgba(201,160,92,0.2)]"
            />
          </div>
          <button
            onClick={handleSearch}
            className="px-6 py-2.5 rounded-xl bg-[#C9A05C] text-white text-xs font-black uppercase tracking-wider hover:bg-[#E5C88C] transition-colors"
          >
            View
          </button>
        </div>
      </div>

      {!activeLoanId && !activeCustomerId && (
        <div className="bg-[#14141B] rounded-[2rem] border border-[rgba(201,160,92,0.08)] p-4">
          <div className="flex items-center gap-2 mb-3">
            <Clock className="w-4 h-4 text-[#C9A05C]" />
            <h3 className="text-[11px] font-black uppercase tracking-widest text-[#6B655C]">Recent Loans</h3>
          </div>
          {loadingRecent ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 text-[#C9A05C] animate-spin" />
            </div>
          ) : recentLoans.length === 0 ? (
            <p className="text-xs text-[#6B655C] py-4 text-center">No recent loans found.</p>
          ) : (
            <div className="space-y-1">
              {recentLoans.map((loan) => (
                <button
                  key={loan.id}
                  onClick={() => { setSearchMode('loan'); setActiveLoanId(loan.id); setActiveCustomerId(null); }}
                  className="w-full flex items-center justify-between px-4 py-3 rounded-xl hover:bg-[#C9A05C]/10 transition-colors text-left"
                >
                  <div className="flex flex-col">
                    <span className="text-sm font-bold text-[#EAE2D6]">
                      Loan #{loan.id}
                      {loan.customer?.fullName && (
                        <span className="text-[#999186] font-normal ml-2">— {loan.customer.fullName}</span>
                      )}
                    </span>
                    {loan.submittedAt && (
                      <span className="text-[10px] text-[#6B655C] mt-0.5">
                        {new Date(loan.submittedAt).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    {loan.status && (
                      <span className="text-[10px] font-black uppercase tracking-wider px-2.5 py-1 rounded-lg bg-[#1C1C26] text-[#C9A05C]">
                        {loan.status}
                      </span>
                    )}
                    {loan.requestedAmount != null && (
                      <span className="text-xs font-bold text-[#999186]">
                        ₱{Number(loan.requestedAmount).toLocaleString()}
                      </span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {searchMode === 'loan' && activeLoanId && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1">
            <LoanStatusProgress loanId={activeLoanId} />
          </div>
          <div className="lg:col-span-2">
            <LoanHistoryTimeline loanId={activeLoanId} />
          </div>
        </div>
      )}

      {searchMode === 'customer' && activeCustomerId && (
        <CustomerHistory customerId={activeCustomerId} />
      )}
    </div>
  );
}
