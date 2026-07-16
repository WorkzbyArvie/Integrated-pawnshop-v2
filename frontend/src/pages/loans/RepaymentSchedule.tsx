import React, { useState, useEffect } from 'react';
import Swal from 'sweetalert2';
import {
  Calendar,
  DollarSign,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  ArrowLeft,
} from 'lucide-react';
import { getBackendUrl } from '../../lib/backendUrl';

interface RepaymentScheduleProps {
  loanId: string;
  onBack: () => void;
}

interface ScheduleItem {
  id: string;
  installmentNumber: number;
  dueDate: string;
  principalAmount: number;
  interestAmount: number;
  totalDue: number;
  status: string;
  paidAmount: number;
  paidDate: string | null;
  penaltyAmount: number;
}

interface ScheduleSummary {
  totalAmount: number;
  paidAmount: number;
  remainingAmount: number;
  progressPercentage: number;
}

export function RepaymentSchedule({ loanId, onBack }: RepaymentScheduleProps) {
  const [schedule, setSchedule] = useState<ScheduleItem[]>([]);
  const [summary, setSummary] = useState<ScheduleSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [selectedSchedule, setSelectedSchedule] = useState<ScheduleItem | null>(null);

  useEffect(() => {
    fetchSchedule();
  }, [loanId]);

  const fetchSchedule = async () => {
    setLoading(true);
    try {
      const backendUrl = getBackendUrl();
      const response = await fetch(`${backendUrl}/loan/${loanId}/schedule`);
      if (!response.ok) throw new Error('Failed to fetch schedule');

      const raw = await response.json();
      const data = raw?.data ?? raw;
      setSchedule(data.schedules);
      setSummary(data.summary);
    } catch (err) {
      console.error('âŒ Error fetching schedule:', err);
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (amount: number) => {
    return `â‚±${amount.toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-PH', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      PENDING: 'bg-yellow-100 text-yellow-800',
      PARTIAL: 'bg-[#C9A05C]/15 text-[#C9A05C]',
      PAID: 'bg-green-100 text-green-800',
      OVERDUE: 'bg-red-100 text-red-800',
    };
    return colors[status] || 'bg-gray-100 text-[#EAE2D6]';
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'PAID':
        return <CheckCircle2 className="w-5 h-5 text-green-600" />;
      case 'OVERDUE':
        return <AlertTriangle className="w-5 h-5 text-red-600" />;
      default:
        return <Clock className="w-5 h-5 text-yellow-600" />;
    }
  };

  const handleRecordPayment = (scheduleItem: ScheduleItem) => {
    setSelectedSchedule(scheduleItem);
    setShowPaymentModal(true);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="w-8 h-8 text-[#C9A05C] animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-[#999186] hover:text-[#EAE2D6] mb-4 font-medium"
        >
          <ArrowLeft className="w-5 h-5" />
          Back to Loan Details
        </button>

        <h1 className="text-3xl font-black text-[#EAE2D6] mb-2">Repayment Schedule</h1>
        <p className="text-[#999186]">Track your loan installments and payments</p>
      </div>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <div className="bg-[#14141B] rounded-2xl shadow-sm border border-[rgba(201,160,92,0.1)] p-6">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 bg-[#C9A05C]/15 rounded-xl flex items-center justify-center">
                <DollarSign className="w-5 h-5 text-[#C9A05C]" />
              </div>
              <p className="text-sm text-[#999186]">Total Amount</p>
            </div>
            <p className="text-2xl font-black text-[#EAE2D6]">
              {formatCurrency(summary.totalAmount)}
            </p>
          </div>

          <div className="bg-[#14141B] rounded-2xl shadow-sm border border-[rgba(201,160,92,0.1)] p-6">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 bg-green-100 rounded-xl flex items-center justify-center">
                <CheckCircle2 className="w-5 h-5 text-green-600" />
              </div>
              <p className="text-sm text-[#999186]">Paid Amount</p>
            </div>
            <p className="text-2xl font-black text-green-600">
              {formatCurrency(summary.paidAmount)}
            </p>
          </div>

          <div className="bg-[#14141B] rounded-2xl shadow-sm border border-[rgba(201,160,92,0.1)] p-6">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 bg-orange-100 rounded-xl flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-orange-600" />
              </div>
              <p className="text-sm text-[#999186]">Remaining</p>
            </div>
            <p className="text-2xl font-black text-orange-600">
              {formatCurrency(summary.remainingAmount)}
            </p>
          </div>

          <div className="bg-[#14141B] rounded-2xl shadow-sm border border-[rgba(201,160,92,0.1)] p-6">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 bg-[#C9A05C]/15 rounded-xl flex items-center justify-center">
                <Calendar className="w-5 h-5 text-[#C9A05C]" />
              </div>
              <p className="text-sm text-[#999186]">Progress</p>
            </div>
            <p className="text-2xl font-black text-[#C9A05C]">
              {summary.progressPercentage.toFixed(1)}%
            </p>
            <div className="w-full bg-gray-200 rounded-full h-2 mt-3">
              <div
                className="bg-[#C9A05C] h-2 rounded-full transition-all"
                style={{ width: `${summary.progressPercentage}%` }}
              ></div>
            </div>
          </div>
        </div>
      )}

      {/* Schedule Table */}
      <div className="bg-[#14141B] rounded-2xl shadow-sm border border-[rgba(201,160,92,0.1)] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-[rgba(201,160,92,0.1)]">
              <tr>
                <th className="px-6 py-4 text-left text-xs font-bold text-[#999186] uppercase tracking-wider">
                  #
                </th>
                <th className="px-6 py-4 text-left text-xs font-bold text-[#999186] uppercase tracking-wider">
                  Due Date
                </th>
                <th className="px-6 py-4 text-right text-xs font-bold text-[#999186] uppercase tracking-wider">
                  Principal
                </th>
                <th className="px-6 py-4 text-right text-xs font-bold text-[#999186] uppercase tracking-wider">
                  Interest
                </th>
                <th className="px-6 py-4 text-right text-xs font-bold text-[#999186] uppercase tracking-wider">
                  Penalty
                </th>
                <th className="px-6 py-4 text-right text-xs font-bold text-[#999186] uppercase tracking-wider">
                  Total Due
                </th>
                <th className="px-6 py-4 text-right text-xs font-bold text-[#999186] uppercase tracking-wider">
                  Paid
                </th>
                <th className="px-6 py-4 text-center text-xs font-bold text-[#999186] uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-4 text-center text-xs font-bold text-[#999186] uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {schedule.map((item) => (
                <tr key={item.id} className="hover:bg-gray-50 transition">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      {getStatusIcon(item.status)}
                      <span className="font-bold text-[#EAE2D6]">
                        {item.installmentNumber}
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center gap-2 text-[#EAE2D6]">
                      <Calendar className="w-4 h-4 text-[#6B655C]" />
                      {formatDate(item.dueDate)}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-right font-medium text-[#EAE2D6]">
                    {formatCurrency(item.principalAmount)}
                  </td>
                  <td className="px-6 py-4 text-right font-medium text-[#999186]">
                    {formatCurrency(item.interestAmount)}
                  </td>
                  <td className="px-6 py-4 text-right font-medium text-red-600">
                    {item.penaltyAmount > 0 ? formatCurrency(item.penaltyAmount) : '-'}
                  </td>
                  <td className="px-6 py-4 text-right font-bold text-[#EAE2D6]">
                    {formatCurrency(item.totalDue)}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div>
                      <p className="font-bold text-green-600">
                        {formatCurrency(item.paidAmount)}
                      </p>
                      {item.paidDate && (
                        <p className="text-xs text-[#6B655C]">
                          {formatDate(item.paidDate)}
                        </p>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-center">
                    <span
                      className={`px-3 py-1 rounded-full text-xs font-bold ${getStatusColor(
                        item.status,
                      )}`}
                    >
                      {item.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-center">
                    {item.status !== 'PAID' && (
                      <button
                        onClick={() => handleRecordPayment(item)}
                        className="px-4 py-2 bg-[#C9A05C] text-white text-sm font-bold rounded-lg hover:bg-[#E5C88C] transition"
                      >
                        Pay
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Payment Modal */}
      {showPaymentModal && selectedSchedule && (
        <PaymentModal
          schedule={selectedSchedule}
          onClose={() => {
            setShowPaymentModal(false);
            setSelectedSchedule(null);
          }}
          onSuccess={() => {
            fetchSchedule();
            setShowPaymentModal(false);
            setSelectedSchedule(null);
          }}
        />
      )}
    </div>
  );
}

interface PaymentModalProps {
  schedule: ScheduleItem;
  onClose: () => void;
  onSuccess: () => void;
}

function PaymentModal({ schedule, onClose, onSuccess }: PaymentModalProps) {
  const [amount, setAmount] = useState(schedule.totalDue.toString());
  const [paymentMethod, setPaymentMethod] = useState('CASH');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const backendUrl = getBackendUrl();
      const response = await fetch(`${backendUrl}/loan/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scheduleId: schedule.id,
          amount: parseFloat(amount),
          paymentMethod,
          reference: reference || undefined,
          notes: notes || undefined,
        }),
      });

      if (!response.ok) throw new Error('Payment failed');

      onSuccess();
    } catch (err) {
      console.error('âŒ Payment error:', err);
      void Swal.fire({
        icon: 'error',
        title: 'Payment failed',
        text: 'Please try again.',
      });
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (amount: number) => {
    return `â‚±${amount.toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-[#14141B] rounded-2xl shadow-2xl max-w-lg w-full">
        <div className="p-6 border-b border-[rgba(201,160,92,0.1)]">
          <h2 className="text-2xl font-black text-[#EAE2D6]">Record Payment</h2>
          <p className="text-[#999186] mt-1">
            Installment #{schedule.installmentNumber}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="p-4 bg-gray-50 rounded-xl">
            <p className="text-sm text-[#999186] mb-1">Total Due</p>
            <p className="text-2xl font-black text-[#EAE2D6]">
              {formatCurrency(schedule.totalDue)}
            </p>
          </div>

          <div>
            <label className="block text-sm font-bold text-[#999186] mb-2">
              Payment Amount
            </label>
            <input
              type="number"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full px-4 py-3 border border-[rgba(201,160,92,0.15)] rounded-xl focus:border-[#C9A05C] focus:ring-2 focus:ring-[rgba(201,160,92,0.2)] outline-none"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-bold text-[#999186] mb-2">
              Payment Method
            </label>
            <select
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value)}
              className="w-full px-4 py-3 border border-[rgba(201,160,92,0.15)] rounded-xl focus:border-[#C9A05C] focus:ring-2 focus:ring-[rgba(201,160,92,0.2)] outline-none"
            >
              <option value="CASH">Cash</option>
              <option value="CHECK">Check</option>
              <option value="BANK_TRANSFER">Bank Transfer</option>
              <option value="GCASH">GCash</option>
              <option value="CREDIT_CARD">Credit Card</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-bold text-[#999186] mb-2">
              Reference Number (Optional)
            </label>
            <input
              type="text"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              className="w-full px-4 py-3 border border-[rgba(201,160,92,0.15)] rounded-xl focus:border-[#C9A05C] focus:ring-2 focus:ring-[rgba(201,160,92,0.2)] outline-none"
              placeholder="Transaction reference..."
            />
          </div>

          <div>
            <label className="block text-sm font-bold text-[#999186] mb-2">
              Notes (Optional)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="w-full px-4 py-3 border border-[rgba(201,160,92,0.15)] rounded-xl focus:border-[#C9A05C] focus:ring-2 focus:ring-[rgba(201,160,92,0.2)] outline-none resize-none"
              placeholder="Additional notes..."
            />
          </div>

          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-6 py-3 bg-gray-100 text-[#999186] font-bold rounded-xl hover:bg-gray-200 transition"
              disabled={loading}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 px-6 py-3 bg-[#C9A05C] text-white font-bold rounded-xl hover:bg-[#E5C88C] transition disabled:opacity-50 flex items-center justify-center gap-2"
              disabled={loading}
            >
              {loading ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-5 h-5" />
                  Record Payment
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
