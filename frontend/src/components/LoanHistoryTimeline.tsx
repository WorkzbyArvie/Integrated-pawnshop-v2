import { useEffect, useState } from 'react';
import {
  History, Loader2, DollarSign, FileCheck2, Receipt, AlertTriangle,
  Clock, ArrowRight, CheckCircle2, XCircle,
} from 'lucide-react';
import api from '../lib/apiClient';
import { formatCurrency, formatDateTime, humanizeStatus } from '../lib/formatters';

type TimelineEvent = {
  sequenceNumber: number;
  eventType: string;
  timestamp: string;
  [key: string]: unknown;
};

type ProofRecord = {
  id: string;
  proofNumber: string;
  recordType: string;
  title: string;
};

type LoanHistory = {
  loanId: number;
  loan: {
    id: number;
    principalAmount: number;
    status: string;
    lifecycleStatus?: string;
    createdAt: string;
  };
  contract: Record<string, unknown> | null;
  payments: {
    records: Array<Record<string, unknown>>;
    summary: { totalPaid: number; paymentCount: number };
  };
  proofs: { contractProofs: ProofRecord[]; loanProofs: ProofRecord[]; count: number };
  timeline: TimelineEvent[];
};

interface LoanHistoryTimelineProps {
  loanId?: number;
  customerId?: string;
}

const eventIcons: Record<string, typeof History> = {
  PAYMENT: DollarSign,
  CONTRACT_SIGNED: FileCheck2,
  PROOF_RECORD: Receipt,
  DISBURSEMENT: ArrowRight,
  PENALTY: AlertTriangle,
  RECEIPT: Receipt,
  LIFECYCLE_STATUS: CheckCircle2,
  LOAN_CREATED: Clock,
};

const eventColors: Record<string, string> = {
  PAYMENT: 'text-emerald-600 bg-emerald-100',
  CONTRACT_SIGNED: 'text-[#C9A05C] bg-[#C9A05C]/15',
  PROOF_RECORD: 'text-[#C9A05C] bg-[#C9A05C]/15',
  DISBURSEMENT: 'text-amber-600 bg-amber-100',
  PENALTY: 'text-rose-600 bg-rose-100',
  RECEIPT: 'text-[#999186] bg-[#1C1C26]',
  LIFECYCLE_STATUS: 'text-violet-600 bg-violet-100',
  LOAN_CREATED: 'text-sky-600 bg-sky-100',
};

function getEventSummary(event: TimelineEvent): string {
  switch (event.eventType) {
    case 'PAYMENT':
      return `Payment of ${formatCurrency(event.amount as number)} via ${humanizeStatus(event.method as string) || 'Unknown'}`;
    case 'CONTRACT_SIGNED':
      return `Contract ${event.number || ''} signed`;
    case 'PROOF_RECORD':
      return `${humanizeStatus(event.recordType as string)} â€” ${event.proofNumber || ''}`;
    case 'DISBURSEMENT':
      return `Disbursed ${formatCurrency(event.amount as number)} via ${humanizeStatus(event.method as string) || 'Unknown'}`;
    case 'PENALTY':
      return `${formatCurrency(event.amount as number)} penalty applied (${humanizeStatus(event.type as string || '')})${event.waived ? ' â€” Waived' : ''}`;
    case 'RECEIPT':
      return `Receipt ${event.receiptNumber || ''} (${humanizeStatus(event.type as string)})`;
    case 'LIFECYCLE_STATUS':
      return `Status: ${humanizeStatus(event.status as string)}`;
    case 'LOAN_CREATED':
      return `Loan created â€” ${formatCurrency(event.amount as number)}`;
    default:
      return JSON.stringify(event.data || {});
  }
}

export function LoanHistoryTimeline({ loanId, customerId }: LoanHistoryTimelineProps) {
  const [data, setData] = useState<LoanHistory | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchHistory = async () => {
      setLoading(true);
      setError(null);
      try {
        let result: LoanHistory;
        if (customerId) {
          result = await api.get<LoanHistory>(`/loan/customers/${customerId}/history`);
        } else if (loanId) {
          result = await api.get<LoanHistory>(`/loan/${loanId}/history`);
        } else {
          return;
        }
        setData(result);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    };
    fetchHistory();
  }, [loanId, customerId]);

  if (!loanId && !customerId) {
    return (
      <div className="bg-[#14141B] rounded-[2.5rem] border border-[rgba(201,160,92,0.08)] p-8 text-sm font-bold text-[#6B655C]">
        Select a loan or customer to view history
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 bg-[#14141B] rounded-[2.5rem] border border-dashed border-[rgba(201,160,92,0.12)]">
        <Loader2 className="w-10 h-10 text-[#C9A05C] animate-spin mb-3" />
        <p className="text-[10px] font-black uppercase tracking-widest text-[#6B655C]">Loading History...</p>
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

  if (!data || !data.timeline?.length) {
    return (
      <div className="bg-[#14141B] rounded-[2.5rem] border border-[rgba(201,160,92,0.08)] p-8 text-sm font-bold text-[#6B655C]">
        No history events found.
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700 text-left">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-black text-[#EAE2D6] tracking-tight uppercase italic leading-none">
            Loan <span className="text-[#C9A05C]">History</span>
          </h2>
          <p className="mt-2 text-[11px] font-black uppercase tracking-widest text-[#6B655C] flex items-center gap-2">
            <History className="w-4 h-4 text-[#C9A05C]" />
            {customerId ? 'Customer Timeline' : `Loan #${loanId} Timeline`}
          </p>
        </div>
        {data.loan && (
          <div className="text-right">
            <p className="text-2xl font-black text-[#EAE2D6]">{formatCurrency(data.loan.principalAmount)}</p>
            <p className="text-[10px] font-black uppercase tracking-wider text-[#6B655C]">
              {humanizeStatus(data.loan.lifecycleStatus || data.loan.status)}
            </p>
          </div>
        )}
      </div>

      <div className="relative">
        <div className="absolute left-7 top-0 bottom-0 w-0.5 bg-[#222228]" />

        <div className="space-y-0">
          {data.timeline.map((event) => {
            const Icon = eventIcons[event.eventType] || History;
            const colorClass = eventColors[event.eventType] || 'text-[#999186] bg-[#1C1C26]';
            return (
              <div key={`${event.eventType}-${event.timestamp}-${event.sequenceNumber}`} className="relative flex items-start gap-5 pb-8 last:pb-0">
                <div className={`relative z-10 w-14 h-14 rounded-2xl flex items-center justify-center shrink-0 ${colorClass}`}>
                  <Icon className="w-6 h-6" />
                </div>
                <div className="flex-1 min-w-0 pt-2">
                  <p className="text-sm font-black text-[#EAE2D6] uppercase tracking-wider">
                    {humanizeStatus(event.eventType)}
                  </p>
                  <p className="text-sm font-semibold text-[#999186] mt-1">
                    {getEventSummary(event)}
                  </p>
                  <p className="text-[11px] font-bold text-[#6B655C] mt-1">
                    {formatDateTime(event.timestamp)}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {data.payments?.summary && (
        <div className="bg-[#C9A05C]/10 rounded-2xl border border-[rgba(201,160,92,0.15)] p-5 flex items-center justify-between">
          <p className="text-sm font-bold text-indigo-900">
            Total Paid: {formatCurrency(data.payments.summary.totalPaid)}
          </p>
          <p className="text-[11px] font-black text-[#C9A05C] uppercase tracking-wider">
            {data.payments.summary.paymentCount} payment{data.payments.summary.paymentCount !== 1 ? 's' : ''}
          </p>
        </div>
      )}
    </div>
  );
}
