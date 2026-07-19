import { useEffect, useState } from 'react';
import {
  Users, Loader2, DollarSign, Clock, AlertTriangle, ShieldCheck,
  XCircle, TrendingUp, Calendar,
} from 'lucide-react';
import api from '../lib/apiClient';
import { formatCurrency, formatDateTime } from '../lib/formatters';
import { LoanHistoryTimeline } from './LoanHistoryTimeline';
import { LoanStatusProgress } from './LoanStatusProgress';

const tierColors: Record<string, string> = {
  Standard: 'bg-gray-600',
  Bronze: 'bg-amber-700',
  Silver: 'bg-gray-400',
  Gold: 'bg-yellow-500',
  VIP: 'bg-purple-600',
};

type CustomerDashboard = {
  customerId: string;
  tier: string;
  summary: {
    totalLoans: number;
    activeLoanCount: number;
    overdueCount: number;
    gracePeriodCount: number;
    totalOutstanding: number;
    totalOverdue: number;
    totalPaid: number;
    totalPayments: number;
  };
  nextDuePayment: {
    loanId: number;
    dueDate: string;
    amount: number;
    status: string;
  } | null;
  recentActivity: Array<{
    id: string;
    recordType: string;
    title: string;
    createdAt: string;
    loanId: number | null;
  }>;
};

interface CustomerHistoryProps {
  customerId: string;
}

export function CustomerHistory({ customerId }: CustomerHistoryProps) {
  const [data, setData] = useState<CustomerDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedLoanId, setSelectedLoanId] = useState<number | null>(null);

  useEffect(() => {
    const fetchDashboard = async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await api.get<CustomerDashboard>(`/loan/customers/${customerId}/dashboard`);
        setData(result);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    };
    fetchDashboard();
  }, [customerId]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24">
        <Loader2 className="w-10 h-10 text-[#C9A05C] animate-spin mb-3" />
        <p className="text-[10px] font-black uppercase tracking-widest text-[#6B655C]">Loading Customer Dashboard...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-[#14141B] rounded-[2.5rem] border border-rose-100 p-8">
        <div className="flex items-center gap-3 text-rose-600">
          <XCircle className="w-5 h-5" />
          <p className="text-sm font-bold">{error}</p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="bg-[#14141B] rounded-[2.5rem] border border-[rgba(201,160,92,0.08)] p-8 text-sm font-bold text-[#6B655C]">
        Customer not found.
      </div>
    );
  }

  const { summary } = data;

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700 text-left">
      <div>
        <h2 className="text-3xl font-black text-[#EAE2D6] tracking-tight uppercase italic leading-none">
          Customer <span className="text-[#C9A05C]">Dashboard</span>
        </h2>
        <p className="mt-2 text-[11px] font-black uppercase tracking-widest text-[#6B655C] flex items-center gap-2">
          <Users className="w-4 h-4 text-[#C9A05C]" />
          {customerId}
          <span className={`px-2 py-0.5 rounded-full text-[9px] font-black text-white ${tierColors[data.tier] || 'bg-gray-600'}`}>
            {data.tier || 'Standard'}
          </span>
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-[#14141B] rounded-2xl border border-[rgba(201,160,92,0.08)] p-5 space-y-2">
          <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center">
            <DollarSign className="w-5 h-5 text-emerald-600" />
          </div>
          <p className="text-2xl font-black text-[#EAE2D6]">{formatCurrency(summary.totalOutstanding)}</p>
          <p className="text-[10px] font-black uppercase tracking-wider text-[#6B655C]">Outstanding ({summary.activeLoanCount} active)</p>
        </div>
        <div className="bg-[#14141B] rounded-2xl border border-[rgba(201,160,92,0.08)] p-5 space-y-2">
          <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center">
            <TrendingUp className="w-5 h-5 text-emerald-600" />
          </div>
          <p className="text-2xl font-black text-[#EAE2D6]">{formatCurrency(summary.totalPaid)}</p>
          <p className="text-[10px] font-black uppercase tracking-wider text-[#6B655C]">Total Paid ({summary.totalPayments} payments)</p>
        </div>
        <div className="bg-[#14141B] rounded-2xl border border-[rgba(201,160,92,0.08)] p-5 space-y-2">
          <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center">
            <Clock className="w-5 h-5 text-amber-600" />
          </div>
          <p className="text-2xl font-black text-[#EAE2D6]">{summary.totalLoans}</p>
          <p className="text-[10px] font-black uppercase tracking-wider text-[#6B655C]">Total Loans</p>
        </div>
        <div className="bg-[#14141B] rounded-2xl border border-[rgba(201,160,92,0.08)] p-5 space-y-2">
          <div className="w-10 h-10 rounded-xl bg-rose-100 flex items-center justify-center">
            <AlertTriangle className="w-5 h-5 text-rose-600" />
          </div>
          <p className="text-2xl font-black text-[#EAE2D6]">{summary.overdueCount}</p>
          <p className="text-[10px] font-black uppercase tracking-wider text-[#6B655C]">Overdue ({formatCurrency(summary.totalOverdue)})</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {data.nextDuePayment && (
          <div className="bg-[#14141B] rounded-2xl border border-[rgba(201,160,92,0.08)] p-5 flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-[#C9A05C]/15 flex items-center justify-center">
              <Calendar className="w-6 h-6 text-[#C9A05C]" />
            </div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-wider text-[#6B655C]">Next Payment Due</p>
              <p className="text-lg font-black text-[#EAE2D6]">
                {formatCurrency(data.nextDuePayment.amount)}
              </p>
              <p className="text-xs font-bold text-[#6B655C]">
                {new Date(data.nextDuePayment.dueDate).toLocaleDateString()}
              </p>
            </div>
          </div>
        )}

        {data.recentActivity.length > 0 && (
          <div className="lg:col-span-2 bg-[#14141B] rounded-2xl border border-[rgba(201,160,92,0.08)] p-5">
            <p className="text-[10px] font-black uppercase tracking-wider text-[#6B655C] mb-3">Recent Activity</p>
            <div className="space-y-2">
              {data.recentActivity.slice(0, 5).map((a) => (
                <div key={a.id} className="flex items-center gap-3">
                  <ShieldCheck className="w-4 h-4 text-[#C9A05C] shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold text-[#EAE2D6] truncate">{a.title}</p>
                    <p className="text-[10px] font-semibold text-[#6B655C]">{formatDateTime(a.createdAt)}</p>
                  </div>
                  {a.loanId && (
                    <button
                      onClick={() => setSelectedLoanId(a.loanId === selectedLoanId ? null : a.loanId)}
                      className="text-[10px] font-black uppercase tracking-wider text-[#C9A05C] hover:text-[#C9A05C] shrink-0"
                    >
                      View
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {selectedLoanId && (
        <div className="space-y-6">
          <LoanStatusProgress loanId={selectedLoanId} />
          <LoanHistoryTimeline loanId={selectedLoanId} />
        </div>
      )}
    </div>
  );
}
