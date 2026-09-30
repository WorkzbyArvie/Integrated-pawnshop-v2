import { useState } from 'react';
import { CheckCircle2, FileText, Loader2, ChevronLeft, ChevronRight, AlertTriangle } from 'lucide-react';

import { Button } from '../src/components/ui/button';
import { Badge } from '../src/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../src/components/ui/dialog';
import { DeclineReasonPicker, DECLINE_REASON_SETS, isDeclineReasonComplete, type DeclineReason } from '../src/components/DeclineReasonPicker';
import { formatCurrency, formatDateTime } from '../src/lib/formatters';

interface Item {
  id: number;
  targetType: 'APPRAISAL' | 'REDEMPTION' | 'LISTING_EDIT';
  ticketNumber: string;
  itemName?: string | null;
  category?: string | null;
  weight?: string | number | null;
  customer?: { fullName?: string; contactNumber?: string } | null;
  requestedBy?: { fullName?: string } | null;
  appraisedValue?: number | null;
  recommendedLoanAmount?: number | null;
  riskScore?: number | null;
  isHighRisk?: boolean;
  appraisalNotes?: string | null;
  amountPaid?: number | null;
  threshold?: number;
  createdAt?: string;
  photoUrls?: string[];
}

const FIXTURES: Record<string, Item> = {
  appraisal: {
    id: 1,
    targetType: 'APPRAISAL',
    ticketNumber: 'TKT-1790738306',
    itemName: 'test',
    category: 'Silver Jewelry',
    weight: 10,
    customer: { fullName: 'test', contactNumber: '091243567899' },
    requestedBy: { fullName: 'Test' },
    appraisedValue: 800,
    recommendedLoanAmount: 440,
    riskScore: 60,
    isHighRisk: true,
    appraisalNotes: 'Submitted for approval via appraisal workflow for ticket TKT-1790738306',
    createdAt: '2026-09-30T11:18:00.000Z',
  },
  redemption: {
    id: 2,
    targetType: 'REDEMPTION',
    ticketNumber: 'TKT-1790688542',
    itemName: 'asdas',
    category: 'Silver Jewelry',
    weight: 10,
    customer: { fullName: 'test', contactNumber: '091243567899' },
    requestedBy: { fullName: 'Test' },
    amountPaid: 460,
    threshold: 50000,
    createdAt: '2026-09-30T12:15:00.000Z',
  },
};

function ValBlock({ item }: { item: Item }) {
  const appraised = item.appraisedValue ?? 0;
  const recommended = item.recommendedLoanAmount ?? 0;
  const ltv = appraised > 0 ? Math.round((recommended / appraised) * 100) : null;
  const risk = typeof item.riskScore === 'number' ? item.riskScore : null;
  const riskTone =
    risk === null
      ? { color: 'var(--text-muted)', label: 'Not scored' }
      : risk > 40
        ? { color: '#D44545', label: 'High' }
        : risk > 20
          ? { color: 'var(--amber)', label: 'Moderate' }
          : { color: 'var(--green)', label: 'Low' };

  return (
    <div className="rounded-2xl p-5" style={{ background: 'rgba(201,160,92,0.08)', border: '1px solid rgba(201,160,92,0.18)' }}>
      <p className="text-[10px] font-black uppercase tracking-widest mb-3" style={{ color: 'var(--gold)' }}>
        Recommended Loan
      </p>
      <p className="text-4xl font-black leading-none tracking-tight" style={{ fontFamily: 'var(--font-display)', color: 'var(--gold)' }}>
        {formatCurrency(recommended)}
      </p>
      {ltv !== null && (
        <p className="text-[11px] font-semibold mt-2" style={{ color: 'var(--text-muted)' }}>
          {ltv}% of the {formatCurrency(appraised)} appraised value
        </p>
      )}
      <div className="grid grid-cols-2 gap-3 mt-5 pt-4" style={{ borderTop: '1px solid rgba(201,160,92,0.14)' }}>
        <div>
          <p className="text-[9px] font-black uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>Appraised value</p>
          <p className="text-sm font-black text-[#F5F0E8] mt-1">{formatCurrency(appraised)}</p>
        </div>
        <div>
          <p className="text-[9px] font-black uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>Risk score</p>
          <div className="flex items-baseline gap-2 mt-1">
            <p className="text-sm font-black text-[#F5F0E8]">{risk ?? '—'}</p>
            {risk !== null && (
              <span className="text-[9px] font-black uppercase tracking-widest" style={{ color: riskTone.color }}>{riskTone.label}</span>
            )}
          </div>
        </div>
      </div>
      {item.isHighRisk && (
        <p className="mt-4 text-[10px] font-black uppercase tracking-widest" style={{ color: 'var(--amber)' }}>
          Flagged high risk — confirm the collateral justifies this figure
        </p>
      )}
    </div>
  );
}

export function ApprovalQueueHarness() {
  const [which, setWhich] = useState<'appraisal' | 'redemption'>('appraisal');
  const [open, setOpen] = useState(true);
  const [declineOpen, setDeclineOpen] = useState(false);
  const [reason, setReason] = useState<DeclineReason>(null);
  const [busy, setBusy] = useState(false);
  const item = FIXTURES[which];

  return (
    <div className="min-h-screen p-10" style={{ background: '#0A0A0F' }}>
      <div className="flex gap-3 mb-8">
        {(['appraisal', 'redemption'] as const).map((key) => (
          <Button key={key} variant={which === key ? 'default' : 'outline'} onClick={() => setWhich(key)}>
            {key}
          </Button>
        ))}
        <Button onClick={() => { setOpen(true); setDeclineOpen(false); setReason(null); }}>Open dialog</Button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl bg-[#14141B] border border-[rgba(201,160,92,0.15)] text-[#F5F0E8] p-0 gap-0 flex flex-col max-h-[90vh] overflow-hidden">
          <DialogHeader className="px-6 pt-6 pb-4 pr-14 border-b shrink-0" style={{ borderColor: 'rgba(201,160,92,0.12)' }}>
            <div className="flex items-center gap-2 mb-2">
              <Badge className={item.targetType === 'APPRAISAL' ? 'bg-[#C9A05C]/10 text-[#C9A05C] border border-[rgba(201,160,92,0.2)]' : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'}>
                {item.targetType}
              </Badge>
              <span className="text-[10px] font-black uppercase tracking-widest text-[#C9A05C]">{item.ticketNumber}</span>
            </div>
            <DialogTitle className="text-lg font-black uppercase tracking-tight text-[#F5F0E8] flex items-center gap-2">
              <FileText className="w-4 h-4 text-[#C9A05C]" />
              Review Request
            </DialogTitle>
            <p className="text-[11px] font-semibold mt-1" style={{ color: 'var(--text-muted)' }}>
              Requested by {item.requestedBy?.fullName} · {formatDateTime(item.createdAt)}
            </p>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5 text-sm">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="rounded-2xl p-4" style={{ background: 'rgba(255,255,255,0.035)' }}>
                <p className="text-[10px] font-black uppercase tracking-widest mb-1" style={{ color: 'var(--text-muted)' }}>Customer</p>
                <p className="font-bold text-[#F5F0E8]">{item.customer?.fullName}</p>
                <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{item.customer?.contactNumber}</p>
              </div>
              <div className="rounded-2xl p-4" style={{ background: 'rgba(255,255,255,0.035)' }}>
                <p className="text-[10px] font-black uppercase tracking-widest mb-1" style={{ color: 'var(--text-muted)' }}>Item</p>
                <p className="font-bold text-[#F5F0E8]">{[item.itemName, item.category, item.weight].filter(Boolean).join(' • ')}</p>
              </div>
            </div>

            <div className="rounded-2xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.035)' }}>
              <div className="relative h-56 bg-[#1C1C26] flex items-center justify-center">
                <svg viewBox="0 0 200 140" className="h-full w-full" aria-label="item photo placeholder">
                  <rect width="200" height="140" fill="#23232e" />
                  <path d="M60 70 q40 -34 80 0 q-6 30 -40 30 q-34 0 -40 -30z" fill="#8f8b98" />
                  <path d="M66 70 q34 -24 68 0" stroke="#b9b4c2" strokeWidth="3" fill="none" />
                </svg>
                <button type="button" aria-label="Previous photo" className="absolute left-3 top-1/2 -translate-y-1/2 h-9 w-9 rounded-full border border-white/40 bg-black/50 text-white flex items-center justify-center cursor-pointer">
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button type="button" aria-label="Next photo" className="absolute right-3 top-1/2 -translate-y-1/2 h-9 w-9 rounded-full border border-white/40 bg-black/50 text-white flex items-center justify-center cursor-pointer">
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
              <p className="py-2 text-center text-[10px] font-black uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
                Photo 1 of 2
              </p>
            </div>

            {item.targetType === 'APPRAISAL' ? (
              <ValBlock item={item} />
            ) : (
              <div className="rounded-2xl p-5" style={{ background: 'rgba(201,160,92,0.08)', border: '1px solid rgba(201,160,92,0.18)' }}>
                <p className="text-[10px] font-black uppercase tracking-widest mb-3" style={{ color: 'var(--gold)' }}>Redemption Amount</p>
                <p className="text-4xl font-black leading-none tracking-tight" style={{ fontFamily: 'var(--font-display)', color: 'var(--gold)' }}>
                  {formatCurrency(item.amountPaid ?? 0)}
                </p>
                <p className="text-[11px] font-semibold mt-2" style={{ color: 'var(--text-muted)' }}>
                  Releasing this item returns the collateral to the pawner.
                </p>
                <p className="text-[11px] font-semibold mt-1" style={{ color: 'var(--text-muted)' }}>
                  Below the owner-approval threshold, but a release still needs owner sign-off.
                </p>
              </div>
            )}

            {item.appraisalNotes && (
              <div className="rounded-2xl p-4" style={{ background: 'rgba(255,255,255,0.035)' }}>
                <p className="text-[10px] font-black uppercase tracking-widest mb-1" style={{ color: 'var(--text-muted)' }}>Appraisal notes</p>
                <p className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>{item.appraisalNotes}</p>
              </div>
            )}
          </div>

          <div className="shrink-0 border-t px-6 py-4 space-y-4" style={{ borderColor: 'rgba(201,160,92,0.12)', background: 'rgba(10,10,15,0.5)' }}>
            {declineOpen && (
              <div className="space-y-3 rounded-2xl p-4" style={{ background: 'rgba(212,69,69,0.06)' }}>
                <DeclineReasonPicker id="harness-decline" value={reason} onChange={setReason} options={DECLINE_REASON_SETS.APPRAISAL} />
                <div className="flex items-center gap-2 flex-wrap">
                  <Button variant="destructive" disabled={!isDeclineReasonComplete(reason)} className="font-black uppercase tracking-wider">
                    Confirm Decline
                  </Button>
                  <Button variant="ghost" onClick={() => setDeclineOpen(false)}>Cancel</Button>
                </div>
                {!isDeclineReasonComplete(reason) && (
                  <p className="text-[10px] font-semibold" style={{ color: 'var(--text-muted)' }}>Select a reason to decline.</p>
                )}
              </div>
            )}
            <div className="flex flex-col-reverse sm:flex-row gap-3">
              <Button
                variant="outline"
                onClick={() => setDeclineOpen((o) => !o)}
                className="sm:w-44 border-[#D44545]/40 text-[#D44545] hover:bg-[#D44545]/10 font-black uppercase tracking-wider"
              >
                {declineOpen ? 'Cancel Decline' : 'Decline'}
              </Button>
              <Button onClick={() => setBusy(true)} className="flex-1 font-black uppercase tracking-wider">
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                {busy ? 'Working…' : item.targetType === 'APPRAISAL' ? 'Approve & Generate Contract' : 'Approve & Release'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {!open && (
        <button type="button" onClick={() => setOpen(true)} className="text-[#C9A05C] underline">Reopen</button>
      )}
      <AlertTriangle className="hidden" />
    </div>
  );
}

export default ApprovalQueueHarness;
