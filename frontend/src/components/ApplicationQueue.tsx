import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  Inbox,
  Loader2,
  Phone,
  RefreshCw,
} from 'lucide-react';

import { api } from '../lib/apiClient';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';

/* ────────────────────────────────────────────────────────────────────────
   Online applications received.

   The other half of the public application flow. A pawner applies from their
   phone; this is where the branch sees it, inspects the item, and turns the
   application into a real pawn ticket.

   The figure shown here is the applicant's *estimate*, not an offer. The
   appraiser's own numbers are entered at conversion and those are what go on
   the ticket — so the screen never presents the online figure as agreed.
   ──────────────────────────────────────────────────────────────────────── */

interface Reservation {
  reference: string;
  status: string;
  expiresAt: string;
  customerName: string;
  contactNumber: string;
  address: string;
  itemCategory: string;
  itemDescription: string | null;
  weightGrams: number;
  purityPercent: number | null;
  photoUrls: string[];
  appraisedValue: number;
  recommendedLoanAmount: number;
  termDays: number;
  kycStatus: string;
  rejectionReason: string | null;
}

const peso = (value: number) =>
  `₱${value.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const microLabel =
  'block text-[10px] font-black uppercase tracking-widest text-[var(--text-muted)] [font-family:var(--font-mono)]';
const surface = 'rounded-2xl border border-[rgba(201,160,92,0.14)] bg-[var(--bg-surface)]';

/** How long is left, phrased for a person rather than a timestamp. */
function windowLeft(expiresAt: string): { text: string; urgent: boolean } {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return { text: 'Window passed', urgent: true };

  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  if (hours >= 1) return { text: `${hours}h ${minutes}m left`, urgent: hours < 6 };
  return { text: `${minutes}m left`, urgent: true };
}

const STATUS_TONE: Record<string, string> = {
  PENDING: 'text-[var(--amber)] bg-[rgba(212,168,75,0.10)]',
  CONFIRMED: 'text-[var(--gold)] bg-[var(--gold-glow)]',
  CONVERTED: 'text-[var(--green)] bg-[rgba(61,168,108,0.10)]',
  EXPIRED: 'text-[var(--text-muted)] bg-[rgba(255,255,255,0.04)]',
  CANCELLED: 'text-[var(--text-muted)] bg-[rgba(255,255,255,0.04)]',
  DECLINED: 'text-[var(--red)] bg-[rgba(212,69,69,0.10)]',
};

export default function ApplicationQueue() {
  const [rows, setRows] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [active, setActive] = useState<Reservation | null>(null);
  const [weight, setWeight] = useState('');
  const [appraisedValue, setAppraisedValue] = useState('');
  const [loanAmount, setLoanAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [revisionReason, setRevisionReason] = useState('');
  const [converting, setConverting] = useState(false);
  const [convertError, setConvertError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Tenant comes from the session, not a query param — the route derives it
      // from `req.user`, and a param here could only narrow it for SUPER_ADMIN.
      const data = await api.get<Reservation[]>('/public/pawn/reservations');
      setRows(data);
    } catch (err: any) {
      // An empty list and a failure look identical, and an empty list reads as
      // "no applications yet" — which is a lie if the request failed.
      setError(err?.message || 'Applications could not be loaded.');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** Open the appraisal dialog, seeded from the applicant's estimate. */
  const openAppraisal = (reservation: Reservation) => {
    setActive(reservation);
    setWeight(String(reservation.weightGrams));
    setAppraisedValue(String(reservation.appraisedValue));
    setLoanAmount(String(reservation.recommendedLoanAmount));
    setNotes('');
    setRevisionReason('');
    setConvertError(null);
    setFieldError(null);
  };

  const closeAppraisal = () => {
    // Always clears. A redemption produces no dialog behind it, and leaving the
    // state set would leave a live form on a decided application.
    setActive(null);
    setConvertError(null);
    setFieldError(null);
  };

  /**
   * Whether the inspected figures differ from what the applicant was shown.
   *
   * Computed here only to prompt for a reason — the server refuses the
   * conversion without one, so this is a courtesy, not the control. Relying on it
   * alone would mean the browser decided whether a revision was material.
   */
  const revised = Boolean(
    active &&
      (Math.abs(active.recommendedLoanAmount - Number.parseFloat(loanAmount)) > 0.01 ||
        Math.abs(active.appraisedValue - Number.parseFloat(appraisedValue)) > 0.01),
  );

  const convert = async () => {
    if (!active) return;

    const weightValue = Number.parseFloat(weight);
    const appraised = Number.parseFloat(appraisedValue);
    const loan = Number.parseFloat(loanAmount);

    if (!Number.isFinite(weightValue) || weightValue <= 0) {
      setFieldError('Enter the weight you measured, in grams.');
      return;
    }
    if (!Number.isFinite(appraised) || appraised < 0) {
      setFieldError('Enter the appraised value you assessed.');
      return;
    }
    if (!Number.isFinite(loan) || loan < 0) {
      setFieldError('Enter the loan amount you are approving.');
      return;
    }
    if (revised && !revisionReason.trim()) {
      setFieldError(
        'These figures differ from the online estimate. Record why, so the pawner can be told.',
      );
      return;
    }

    setFieldError(null);
    setConverting(true);
    setConvertError(null);
    try {
      await api.post(`/public/pawn/reservations/${active.reference}/convert`, {
        weight: weightValue,
        appraisedValue: appraised,
        loanAmount: loan,
        itemDescription: notes.trim() || undefined,
        revisionReason: revised ? revisionReason.trim() : undefined,
      });
      closeAppraisal();
      await load();
    } catch (err: any) {
      setConvertError(err?.message || 'The application could not be converted.');
    } finally {
      setConverting(false);
    }
  };

  const pending = rows.filter((row) => row.status === 'PENDING');
  const settled = rows.filter((row) => row.status !== 'PENDING');

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className={microLabel}>Pawn applications</p>
          <h2 className="mt-1 text-2xl font-black [font-family:var(--font-display)]">
            Received online
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-[var(--text-secondary)]">
            These are estimates from what the applicant told us. Inspect the item before any figure
            is agreed — the appraised value you enter below is what goes on the ticket.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => void load()}
          disabled={loading}
          className="border-[rgba(201,160,92,0.28)] text-[var(--text-primary)]"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
          Refresh
        </Button>
      </header>

      {error ? (
        <p role="alert" className="rounded-[14px] border border-[rgba(212,69,69,0.30)] bg-[rgba(212,69,69,0.06)] p-4 text-sm text-[var(--red)]">
          {error}
        </p>
      ) : loading ? (
        <p className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Loading applications…
        </p>
      ) : pending.length === 0 && settled.length === 0 ? (
        <div className={`${surface} p-10 text-center`}>
          <Inbox className="mx-auto h-8 w-8 text-[var(--text-dim)]" aria-hidden="true" />
          <p className="mt-3 text-sm text-[var(--text-secondary)]">
            No applications yet. They appear here as soon as someone applies through the website.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {pending.length > 0 ? (
            <section className="space-y-3">
              <p className={microLabel}>Awaiting appraisal · {pending.length}</p>
              {pending.map((row) => {
                const left = windowLeft(row.expiresAt);
                return (
                  <article key={row.reference} className={`${surface} space-y-4 p-5`}>
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-[11px] font-bold text-[var(--gold)]">
                            {row.reference}
                          </span>
                          <span
                            className={[
                              'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-widest [font-family:var(--font-mono)]',
                              STATUS_TONE[row.status] ?? STATUS_TONE.EXPIRED,
                            ].join(' ')}
                          >
                            {row.status}
                          </span>
                          <span
                            className={[
                              'inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-widest [font-family:var(--font-mono)]',
                              left.urgent ? 'text-[var(--amber)]' : 'text-[var(--text-muted)]',
                            ].join(' ')}
                          >
                            <Clock className="h-3 w-3" aria-hidden="true" />
                            {left.text}
                          </span>
                        </div>
                        <p className="mt-2 text-sm font-semibold">{row.customerName}</p>
                        <p className="mt-0.5 flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
                          <Phone className="h-3 w-3 shrink-0" aria-hidden="true" />
                          {row.contactNumber}
                        </p>
                      </div>

                      <div className="text-right">
                        <p className={microLabel}>Online estimate</p>
                        <p className="mt-1 text-2xl font-black text-[var(--gold)] [font-family:var(--font-display)]">
                          {peso(row.recommendedLoanAmount)}
                        </p>
                        <p className="text-xs text-[var(--text-muted)]">
                          on {peso(row.appraisedValue)} appraised
                        </p>
                      </div>
                    </div>

                    <dl className="grid gap-x-6 gap-y-2 border-t border-[rgba(201,160,92,0.12)] pt-3 text-xs sm:grid-cols-3">
                      <div>
                        <dt className={microLabel}>Item</dt>
                        <dd className="mt-0.5 text-[var(--text-primary)]">
                          {row.itemCategory.replace(/_/g, ' ').toLowerCase()}
                          {row.purityPercent ? ` · ${row.purityPercent}%` : ''}
                        </dd>
                      </div>
                      <div>
                        <dt className={microLabel}>Stated weight</dt>
                        <dd className="mt-0.5 text-[var(--text-primary)]">
                          {row.weightGrams} g
                        </dd>
                      </div>
                      <div>
                        <dt className={microLabel}>ID status</dt>
                        <dd className="mt-0.5 text-[var(--text-primary)]">
                          {row.kycStatus === 'PENDING' ? 'Not yet reviewed' : row.kycStatus}
                        </dd>
                      </div>
                    </dl>

                    <div className="flex justify-end border-t border-[rgba(201,160,92,0.12)] pt-3">
                      <Button onClick={() => openAppraisal(row)}>
                        Inspect and convert
                        <ArrowRight className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    </div>
                  </article>
                );
              })}
            </section>
          ) : null}

          {settled.length > 0 ? (
            <section className="space-y-3">
              <p className={microLabel}>Settled · {settled.length}</p>
              {settled.map((row) => (
                <article
                  key={row.reference}
                  className={`${surface} flex flex-wrap items-center justify-between gap-3 p-4 opacity-75`}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[11px] font-bold text-[var(--text-muted)]">
                        {row.reference}
                      </span>
                      <span
                        className={[
                          'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-widest [font-family:var(--font-mono)]',
                          STATUS_TONE[row.status] ?? STATUS_TONE.EXPIRED,
                        ].join(' ')}
                      >
                        {row.status}
                      </span>
                    </div>
                    <p className="mt-1 text-sm">{row.customerName}</p>
                  </div>
                  <p className="text-sm text-[var(--text-secondary)]">
                    {peso(row.recommendedLoanAmount)}
                  </p>
                </article>
              ))}
            </section>
          ) : null}
        </div>
      )}

      {/*
        The appraisal dialog. `sm:max-w-2xl`, not a bare `max-w-2xl` — the
        shared `DialogContent` ships `sm:max-w-lg`, and a bare override has equal
        specificity but loses to the responsive variant emitted later in the
        stylesheet, so the dialog silently stays 512px on desktop and clips its
        own action.
      */}
      <Dialog open={Boolean(active)} onOpenChange={(open) => !open && closeAppraisal()}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span className="font-mono text-[11px] font-bold text-[var(--gold)]">
                {active?.reference}
              </span>
              Appraise the item
            </DialogTitle>
            <DialogDescription>
              {active?.customerName} · stated {active?.weightGrams} g{' '}
              {active?.itemCategory.replace(/_/g, ' ').toLowerCase()}. Enter what you measured and
              assessed — these figures go on the ticket and the contract.
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto space-y-4 px-1">
            {active ? (
              <div className={`${surface} space-y-1 p-4`}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className={microLabel}>Online estimate</span>
                  <span className="text-lg font-bold text-[var(--text-secondary)] [font-family:var(--font-display)]">
                    {peso(active.recommendedLoanAmount)}
                  </span>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <span className={microLabel}>Online valuation</span>
                  <span className="text-sm text-[var(--text-secondary)]">
                    {peso(active.appraisedValue)}
                  </span>
                </div>
                <p className="pt-1 text-xs text-[var(--text-muted)]">
                  An estimate from a self-reported weight. Not an offer.
                </p>
              </div>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <label htmlFor="aq-weight" className={microLabel}>
                  Weighed (g)
                </label>
                <Input
                  id="aq-weight"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  value={weight}
                  onChange={(event) => setWeight(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="aq-value" className={microLabel}>
                  Appraised value
                </label>
                <Input
                  id="aq-value"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  value={appraisedValue}
                  onChange={(event) => setAppraisedValue(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="aq-loan" className={microLabel}>
                  Loan approved
                </label>
                <Input
                  id="aq-loan"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  value={loanAmount}
                  onChange={(event) => setLoanAmount(event.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <label htmlFor="aq-notes" className={microLabel}>
                Inspection notes
              </label>
              <Textarea
                id="aq-notes"
                rows={2}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="e.g. 22K confirmed by acid test, small stone near the clasp"
              />
            </div>

            {revised ? (
              <div className="space-y-2 rounded-[14px] border border-[rgba(212,168,75,0.30)] bg-[rgba(212,168,75,0.06)] p-4">
                <p className="flex items-center gap-2 text-sm font-semibold text-[var(--amber)]">
                  <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                  These figures differ from the online estimate
                </p>
                <label htmlFor="aq-revision" className={microLabel}>
                  Why it changed
                </label>
                <Textarea
                  id="aq-revision"
                  rows={2}
                  value={revisionReason}
                  onChange={(event) => setRevisionReason(event.target.value)}
                  placeholder="e.g. Hallmark reads 18K, not the 22K stated online"
                />
                <p className="text-xs text-[var(--text-secondary)]">
                  The applicant was quoted {peso(active?.recommendedLoanAmount ?? 0)}. This reason
                  is recorded on the ticket so the difference is explainable later.
                </p>
              </div>
            ) : null}

            {fieldError ? (
              <p role="alert" className="text-sm text-[var(--red)]">
                {fieldError}
              </p>
            ) : null}
            {convertError ? (
              <p role="alert" className="text-sm text-[var(--red)]">
                {convertError}
              </p>
            ) : null}
          </div>

          {/*
            Pinned, not at the end of the scroll area. The appraiser is on their
            feet with the item on the counter; an action below the fold reads as
            a missing one.
          */}
          <DialogFooter className="shrink-0 border-t border-[rgba(201,160,92,0.12)] pt-4">
            <Button variant="outline" onClick={closeAppraisal} disabled={converting}>
              Cancel
            </Button>
            <Button onClick={() => void convert()} disabled={converting}>
              {converting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Converting…
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                  Create pawn ticket
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}