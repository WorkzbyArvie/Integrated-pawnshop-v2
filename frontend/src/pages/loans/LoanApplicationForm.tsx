import React, { useState } from 'react';
import { X, FileText, DollarSign, Calendar, Loader2 } from 'lucide-react';
import { getBackendUrl } from '../../lib/backendUrl';

interface LoanApplicationFormProps {
  pawnshopId?: string;
  customerId?: string;
  onClose: () => void;
  onSuccess: () => void;
}

const LOAN_TYPES = ['Personal', 'Business', 'Emergency'];
const TERM_OPTIONS = [6, 12, 18, 24, 36, 48, 60];

export function LoanApplicationForm({
  pawnshopId,
  customerId,
  onClose,
  onSuccess,
}: LoanApplicationFormProps) {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    customerId: customerId || '',
    pawnshopId: pawnshopId || '',
    loanAmount: '',
    loanType: 'Personal',
    termMonths: 12,
    purpose: '',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const backendUrl = getBackendUrl();
      const response = await fetch(`${backendUrl}/loan/applications`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...formData,
          loanAmount: parseFloat(formData.loanAmount),
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || 'Failed to submit application');
      }

      const application = await response.json();
      console.log('âœ… Application submitted:', application);
      onSuccess();
      onClose();
    } catch (err: unknown) {
      console.error('âŒ Error submitting application:', err);
      setError((err instanceof Error ? err.message : String(err)) || 'Failed to submit application');
    } finally {
      setLoading(false);
    }
  };

  const calculateMonthlyPayment = () => {
    if (!formData.loanAmount) return 0;
    const principal = parseFloat(formData.loanAmount);
    const monthlyRate = 0.035 / 12; // 3.5% annual rate
    const months = formData.termMonths;
    const monthlyPayment =
      (principal * (monthlyRate * Math.pow(1 + monthlyRate, months))) /
      (Math.pow(1 + monthlyRate, months) - 1);
    return monthlyPayment.toFixed(2);
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-[#14141B] rounded-3xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-[#C9A05C] to-[#A07D40] p-6 text-white relative">
          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-2 hover:bg-white/20 rounded-full transition"
          >
            <X className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-3">
            <div className="p-3 bg-white/20 rounded-2xl">
              <FileText className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-2xl font-black">New Loan Application</h2>
              <p className="text-[#E5C88C] text-sm">Complete the form to apply for a loan</p>
            </div>
          </div>

          {/* Progress Steps */}
          <div className="mt-6 flex items-center justify-between">
            {[1, 2, 3].map((s) => (
              <div key={s} className="flex items-center flex-1">
                <div
                  className={`w-10 h-10 rounded-full flex items-center justify-center font-bold ${
                    step >= s ? 'bg-[#14141B] text-[#C9A05C]' : 'bg-white/20 text-white'
                  }`}
                >
                  {s}
                </div>
                {s < 3 && (
                  <div
                    className={`flex-1 h-1 mx-2 ${step > s ? 'bg-[#14141B]' : 'bg-white/20'}`}
                  />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Form Content */}
        <form onSubmit={handleSubmit} className="p-8 overflow-y-auto max-h-[calc(90vh-200px)]">
          {error && (
            <div className="mb-6 p-4 bg-rose-50 border border-rose-200 rounded-xl text-rose-600 text-sm">
              {error}
            </div>
          )}

          {/* Step 1: Loan Details */}
          {step === 1 && (
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-bold text-[#999186] mb-2">
                  <DollarSign className="w-4 h-4 inline mr-1" />
                  Loan Amount (₱)
                </label>
                <input
                  type="number"
                  value={formData.loanAmount}
                  onChange={(e) => setFormData({ ...formData, loanAmount: e.target.value })}
                  placeholder="50000"
                  min="1000"
                  step="1000"
                  required
                  className="w-full px-4 py-3 border-2 border-[rgba(201,160,92,0.1)] rounded-xl focus:border-[#C9A05C] focus:ring-2 focus:ring-[rgba(201,160,92,0.2)] outline-none transition font-medium text-lg"
                />
              </div>

              <div>
                <label className="block text-sm font-bold text-[#999186] mb-2">
                  <FileText className="w-4 h-4 inline mr-1" />
                  Loan Type
                </label>
                <select
                  value={formData.loanType}
                  onChange={(e) => setFormData({ ...formData, loanType: e.target.value })}
                  className="w-full px-4 py-3 border-2 border-[rgba(201,160,92,0.1)] rounded-xl focus:border-[#C9A05C] focus:ring-2 focus:ring-[rgba(201,160,92,0.2)] outline-none transition font-medium"
                >
                  {LOAN_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {type} Loan
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-bold text-[#999186] mb-2">
                  <Calendar className="w-4 h-4 inline mr-1" />
                  Loan Term (Months)
                </label>
                <div className="grid grid-cols-4 gap-3">
                  {TERM_OPTIONS.map((term) => (
                    <button
                      key={term}
                      type="button"
                      onClick={() => setFormData({ ...formData, termMonths: term })}
                      className={`py-3 rounded-xl font-bold text-sm transition ${
                        formData.termMonths === term
                          ? 'bg-[#C9A05C] text-white'
                          : 'bg-gray-100 text-[#999186] hover:bg-gray-200'
                      }`}
                    >
                      {term}
                    </button>
                  ))}
                </div>
              </div>

              {/* Monthly Payment Estimate */}
              {formData.loanAmount && (
                <div className="p-4 bg-[#C9A05C]/10 border border-[rgba(201,160,92,0.2)] rounded-xl">
                  <p className="text-sm text-[#C9A05C] font-medium mb-1">
                    Estimated Monthly Payment
                  </p>
                  <p className="text-3xl font-black text-[#C9A05C]">
                    ₱{calculateMonthlyPayment()}
                  </p>
                  <p className="text-xs text-[#C9A05C] mt-1">
                    Based on {formData.termMonths} months at 3.5% interest
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Step 2: Purpose */}
          {step === 2 && (
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-bold text-[#999186] mb-2">
                  Purpose of Loan
                </label>
                <textarea
                  value={formData.purpose}
                  onChange={(e) => setFormData({ ...formData, purpose: e.target.value })}
                  placeholder="Please describe the purpose of this loan (minimum 10 characters)..."
                  rows={6}
                  minLength={10}
                  required
                  className="w-full px-4 py-3 border-2 border-[rgba(201,160,92,0.1)] rounded-xl focus:border-[#C9A05C] focus:ring-2 focus:ring-[rgba(201,160,92,0.2)] outline-none transition resize-none"
                />
                <p className="text-xs text-[#6B655C] mt-2">
                  {formData.purpose.length}/10 characters minimum
                </p>
              </div>

              <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl">
                <p className="text-sm text-amber-800 font-medium">
                  ðŸ’¡ Be specific about how you'll use the funds. This helps us process your
                  application faster.
                </p>
              </div>
            </div>
          )}

          {/* Step 3: Review */}
          {step === 3 && (
            <div className="space-y-6">
              <div className="p-6 bg-gray-50 rounded-2xl space-y-4">
                <h3 className="font-black text-lg text-[#EAE2D6]">Application Summary</h3>

                <div className="space-y-3">
                  <div className="flex justify-between">
                    <span className="text-[#999186]">Loan Amount:</span>
                    <span className="font-bold text-[#EAE2D6]">₱{parseFloat(formData.loanAmount).toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#999186]">Loan Type:</span>
                    <span className="font-bold text-[#EAE2D6]">{formData.loanType}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#999186]">Term:</span>
                    <span className="font-bold text-[#EAE2D6]">{formData.termMonths} months</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#999186]">Monthly Payment:</span>
                    <span className="font-bold text-[#C9A05C]">₱{calculateMonthlyPayment()}</span>
                  </div>
                </div>

                <div className="pt-4 border-t border-[rgba(201,160,92,0.1)]">
                  <p className="text-sm text-[#999186] mb-2">Purpose:</p>
                  <p className="text-[#EAE2D6]">{formData.purpose}</p>
                </div>
              </div>

              <div className="p-4 bg-[#C9A05C]/10 border border-[rgba(201,160,92,0.2)] rounded-xl">
                <p className="text-sm text-[#C9A05C] font-medium">
                  ðŸ“‹ Your application will be reviewed by our team. You will be notified of the
                  decision within 24-48 hours.
                </p>
              </div>
            </div>
          )}

          {/* Navigation Buttons */}
          <div className="mt-8 flex gap-3">
            {step > 1 && (
              <button
                type="button"
                onClick={() => setStep(step - 1)}
                className="px-6 py-3 bg-gray-100 text-[#999186] font-bold rounded-xl hover:bg-gray-200 transition"
              >
                Back
              </button>
            )}
            {step < 3 ? (
              <button
                type="button"
                onClick={() => setStep(step + 1)}
                disabled={
                  (step === 1 && (!formData.loanAmount || parseFloat(formData.loanAmount) < 1000)) ||
                  (step === 2 && formData.purpose.length < 10)
                }
                className="flex-1 px-6 py-3 bg-[#C9A05C] text-white font-bold rounded-xl hover:bg-[#E5C88C] transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Continue
              </button>
            ) : (
              <button
                type="submit"
                disabled={loading}
                className="flex-1 px-6 py-3 bg-[#C9A05C] text-white font-bold rounded-xl hover:bg-[#E5C88C] transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Submitting...
                  </>
                ) : (
                  'Submit Application'
                )}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
