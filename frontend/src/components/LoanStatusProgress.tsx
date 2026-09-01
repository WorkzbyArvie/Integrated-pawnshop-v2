import { useEffect, useState } from 'react';
import { Loader2, XCircle } from 'lucide-react';
import api from '../lib/apiClient';
import { humanizeStatus } from '../lib/formatters';

type LoanStatus = {
  loanId: number;
  loanStatus: string;
  lifecycleStatus: string;
  applicationStatus: string | null;
  validTransitions: string[];
  progress: {
    percentage: number;
    currentStep: string;
    totalSteps: number;
    currentStepIndex: number;
  };
  timing: {
    daysElapsed: number;
    createdAt: string;
    expiryDate: string | null;
    forfeitureDate: string | null;
    gracePeriodEnd: string | null;
  };
};

interface LoanStatusProgressProps {
  loanId: string | number;
}

const statusLabels: Record<string, { label: string; color: string }> = {
  RECEIVED: { label: 'Received', color: 'bg-slate-400' },
  APPRAISED: { label: 'Appraised', color: 'bg-blue-400' },
  OFFER_MADE: { label: 'Offer Made', color: 'bg-cyan-400' },
  CONTRACT_SIGNED: { label: 'Contract Signed', color: 'bg-indigo-400' },
  DISBURSED: { label: 'Disbursed', color: 'bg-amber-400' },
  ACTIVE: { label: 'Active', color: 'bg-emerald-400' },
  GRACE_PERIOD: { label: 'Grace Period', color: 'bg-yellow-400' },
  OVERDUE: { label: 'Overdue', color: 'bg-orange-400' },
  REDEEMED: { label: 'Redeemed', color: 'bg-green-500' },
  FORFEITED: { label: 'Forfeited', color: 'bg-rose-400' },
  AUCTION_QUEUED: { label: 'Auction Queued', color: 'bg-violet-400' },
  AUCTION_SOLD: { label: 'Auction Sold', color: 'bg-purple-500' },
  AUCTION_UNSOLD: { label: 'Auction Unsold', color: 'bg-[#1C1C26]0' },
  CANCELLED: { label: 'Cancelled', color: 'bg-red-500' },
};

export function LoanStatusProgress({ loanId }: LoanStatusProgressProps) {
  const [data, setData] = useState<LoanStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchStatus = async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await api.get<LoanStatus>(`/loan/${loanId}/status`);
        setData(result);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    };
    fetchStatus();
  }, [loanId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-6 h-6 text-[#C9A05C] animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 text-rose-600 text-sm font-bold">
        <XCircle className="w-4 h-4" />
        {error}
      </div>
    );
  }

  if (!data) return null;

  const currentStep = statusLabels[data.lifecycleStatus] || { label: data.lifecycleStatus, color: 'bg-slate-400' };
  const progress = Math.min(data.progress.percentage, 100);

  return (
    <div className="bg-[#14141B] rounded-2xl border border-[rgba(201,160,92,0.08)] p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-black text-[#F5F0E8] uppercase tracking-wider">Loan Status</p>
          <p className="text-[11px] font-bold text-[#8A8279]">#{data.loanId}</p>
        </div>
        <div className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider text-white ${currentStep.color}`}>
          {currentStep.label}
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex justify-between text-[11px] font-bold text-[#8A8279]">
          <span>Progress</span>
          <span>{progress}%</span>
        </div>
        <div className="w-full h-2.5 bg-[#1C1C26] rounded-full overflow-hidden">
          <div
            className="h-full rounded-full bg-[#C9A05C] transition-all duration-700"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {data.validTransitions.length > 0 && (
        <div>
          <p className="text-[10px] font-black uppercase tracking-wider text-[#8A8279] mb-2">Allowed Next Steps</p>
          <div className="flex flex-wrap gap-2">
            {data.validTransitions.map((t) => {
              const next = statusLabels[t];
              return (
                <span
                  key={t}
                  className={`px-3 py-1.5 rounded-lg text-[11px] font-bold text-white ${next?.color || 'bg-slate-400'}`}
                >
                  {next?.label || humanizeStatus(t)}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {data.timing && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-3 border-t border-[rgba(201,160,92,0.08)]">
          <div>
            <p className="text-[10px] font-black uppercase tracking-wider text-[#8A8279]">Days Elapsed</p>
            <p className="text-lg font-black text-[#F5F0E8]">{data.timing.daysElapsed}d</p>
          </div>
          {data.timing.expiryDate && (
            <div>
              <p className="text-[10px] font-black uppercase tracking-wider text-[#8A8279]">Expiry</p>
              <p className="text-sm font-bold text-[#F5F0E8]">{new Date(data.timing.expiryDate).toLocaleDateString()}</p>
            </div>
          )}
          {data.timing.gracePeriodEnd && (
            <div>
              <p className="text-[10px] font-black uppercase tracking-wider text-[#8A8279]">Grace End</p>
              <p className="text-sm font-bold text-[#F5F0E8]">{new Date(data.timing.gracePeriodEnd).toLocaleDateString()}</p>
            </div>
          )}
          {data.timing.forfeitureDate && (
            <div>
              <p className="text-[10px] font-black uppercase tracking-wider text-[#8A8279]">Forfeiture</p>
              <p className="text-sm font-bold text-[#F5F0E8]">{new Date(data.timing.forfeitureDate).toLocaleDateString()}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
