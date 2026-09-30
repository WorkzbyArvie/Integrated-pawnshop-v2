import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  Check,
  CheckCircle2,
  Info,
  Loader2,
  MapPin,
  Phone,
  ShieldCheck,
  Upload,
  X,
} from 'lucide-react';

import { api } from '../lib/apiClient';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Textarea } from '../components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';

/* ────────────────────────────────────────────────────────────────────────
   Public online application.

   A quote and a booking — never a loan. A pawn loan requires physical
   possession of the collateral, so nothing on this page creates one: the
   applicant gets a held rate, a reference, and a 24-hour window to visit.
   The branch confirms or revises the figure after inspecting the item, and
   that is where a contract and a loan begin.
   ──────────────────────────────────────────────────────────────────────── */

interface BranchOption {
  pawnshopId: string;
  pawnshopName: string;
  address: string | null;
  contactPhone: string | null;
  latitude: number | null;
  longitude: number | null;
  branches: Array<{ id: number; name: string; location: string }>;
}

interface Quote {
  pawnshopId: string;
  pawnshopName: string;
  appraisedValue: number;
  recommendedLoanAmount: number;
  gramRate: number;
  ltvRatio: number;
  termDays: number;
  maturityDate: string;
  gracePeriodDays: number;
  belowStatutoryMinimum: boolean;
  statutoryMinLtv: number;
  rates: { monthlyInterestRate: number; serviceFeeRate: number };
  risk: { score: number; band: string; factors: string[]; blocking: boolean };
}

interface Reservation {
  reference: string;
  status: string;
  expiresAt: string;
  appraisedValue: number;
  recommendedLoanAmount: number;
  termDays: number;
  kycStatus: string;
}

/**
 * A closed list, not free text.
 *
 * `collateralClassFor` falls back to DIAMOND_JEWELRY for an unrecognised name,
 * and diamonds carry the *highest* per-gram rate of the four — so a typo in a
 * free-text category would quote a pawner a diamond price for a gold ring. The
 * picker is closed so that fallback is unreachable from this page.
 */
const CATEGORIES = [
  { value: 'GOLD_JEWELRY', label: 'Gold jewellery', hint: 'Rings, necklace, bracelet' },
  { value: 'GOLD_COINS', label: 'Gold coins', hint: 'Bullion and commemorative' },
  { value: 'SILVER_JEWELRY', label: 'Silver jewellery', hint: 'Rings, necklace, bracelet' },
  { value: 'DIAMOND_JEWELRY', label: 'Diamonds', hint: 'Rings, earrings, loose stones' },
] as const;

/** Gold and silver are the only categories where a purity figure means anything. */
const PURITY_OPTIONS = [
  { value: '75', label: '18K — 75%' },
  { value: '91.6', label: '22K — 91.6%' },
  { value: '96.5', label: '23K — 96.5%' },
  { value: '99.9', label: '24K / pure — 99.9%' },
];

const SILVER_PURITY_OPTIONS = [
  { value: '92.5', label: 'Sterling — 92.5%' },
  { value: '80', label: '800 — 80%' },
  { value: '70', label: '700 — 70%' },
];

const ID_TYPES = [
  { value: 'NATIONAL_ID', label: 'Philippine ID' },
  { value: 'PASSPORT', label: 'Passport' },
  { value: 'DRIVERS_LICENSE', label: "Driver's licence" },
  { value: 'SSS_ID', label: 'SSS ID' },
  { value: 'PHILHEALTH_ID', label: 'PhilHealth ID' },
  { value: 'VOTERS_ID', label: "Voter's ID" },
  { value: 'POSTAL_ID', label: 'Postal ID' },
  { value: 'TIN_ID', label: 'TIN' },
];

/**
 * Radix reserves the empty string for "clear this Select and show the
 * placeholder again", and throws on a `<SelectItem value="">`. Two of these
 * fields genuinely mean "the applicant did not say" — preferred outlet and
 * purity — so they need a real value, and the display has to translate back to
 * "no answer" rather than posting the literal sentinel.
 */
const NOT_STATED = '__not_stated__';
const toSelectValue = (value: string) => (value === '' ? NOT_STATED : value);
const fromSelectValue = (value: string) => (value === NOT_STATED ? '' : value);

const STEPS = [
  { key: 'branch', label: 'Branch' },
  { key: 'item', label: 'Your item' },
  { key: 'photos', label: 'Photos' },
  { key: 'id', label: 'Your ID' },
  { key: 'result', label: 'Quote' },
] as const;

type StepIndex = 0 | 1 | 2 | 3 | 4;

const peso = (value: number) =>
  `₱${value.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const microLabel =
  'block text-[10px] font-black uppercase tracking-widest text-[var(--text-muted)] [font-family:var(--font-mono)]';
const surface = 'rounded-2xl border border-[rgba(201,160,92,0.14)] bg-[var(--bg-surface)]';

/* ── Small presentational pieces ─────────────────────────────────────── */

function Field({
  id,
  label,
  children,
  hint,
  error,
}: {
  id: string;
  label: string;
  children: React.ReactNode;
  hint?: string;
  error?: string;
}) {
  return (
    <div className="space-y-2">
      <label htmlFor={id} className={microLabel}>
        {label}
      </label>
      {children}
      {error ? (
        <p role="alert" className="text-xs text-[var(--red)]">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-[var(--text-muted)]">{hint}</p>
      ) : null}
    </div>
  );
}

function Stepper({ current }: { current: StepIndex }) {
  return (
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-2" aria-label="Application progress">
      {STEPS.map((step, index) => {
        const done = index < current;
        const active = index === current;
        return (
          <li key={step.key} className="flex items-center gap-2">
            <span
              aria-current={active ? 'step' : undefined}
              className={[
                'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-semibold transition-colors duration-200',
                active
                  ? 'border-[var(--gold)] bg-[var(--gold-glow)] text-[var(--gold)]'
                  : done
                    ? 'border-[rgba(61,168,108,0.35)] text-[var(--green)]'
                    : 'border-[rgba(201,160,92,0.12)] text-[var(--text-dim)]',
              ].join(' ')}
            >
              {done ? (
                <Check className="h-3 w-3" aria-hidden="true" />
              ) : (
                <span
                  className="[font-family:var(--font-mono)] text-[10px] font-black"
                  aria-hidden="true"
                >
                  {index + 1}
                </span>
              )}
              {step.label}
            </span>
            {index < STEPS.length - 1 ? (
              <span className="h-px w-4 bg-[rgba(201,160,92,0.18)]" aria-hidden="true" />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * The money block.
 *
 * One primary figure, and the basis beneath it. Two equal-weight numbers render
 * the same way when they happen to coincide and leave a reader unable to tell
 * the valuation from the loan — so the loan is the figure, and the valuation is
 * stated as what it is.
 */
function MoneyBlock({ quote }: { quote: Quote }) {
  return (
    <div className="space-y-4 rounded-2xl border border-[rgba(201,160,92,0.20)] bg-[var(--bg-elevated)] p-5">
      <div>
        <p className={microLabel}>Estimated loan amount</p>
        <p className="mt-1 text-4xl font-black leading-none text-[var(--gold)] [font-family:var(--font-display)]">
          {peso(quote.recommendedLoanAmount)}
        </p>
        <p className="mt-2 text-sm text-[var(--text-secondary)]">
          {Math.round(quote.ltvRatio * 100)}% of the {peso(quote.appraisedValue)} appraised value
        </p>
      </div>

      <dl className="grid gap-x-6 gap-y-3 border-t border-[rgba(201,160,92,0.12)] pt-4 sm:grid-cols-2">
        <div>
          <dt className={microLabel}>Appraised value</dt>
          <dd className="mt-1 text-lg font-semibold text-[var(--text-primary)] [font-family:var(--font-display)]">
            {peso(quote.appraisedValue)}
          </dd>
        </div>
        <div>
          <dt className={microLabel}>Rate applied</dt>
          <dd className="mt-1 text-lg font-semibold text-[var(--text-primary)] [font-family:var(--font-display)]">
            {peso(quote.gramRate)}
            <span className="ml-1 text-xs font-normal text-[var(--text-muted)]">per gram</span>
          </dd>
        </div>
        <div>
          <dt className={microLabel}>Loan term</dt>
          <dd className="mt-1 text-sm text-[var(--text-primary)]">
            {quote.termDays} days, then a {quote.gracePeriodDays}-day grace period
          </dd>
        </div>
        <div>
          <dt className={microLabel}>Interest</dt>
          <dd className="mt-1 text-sm text-[var(--text-primary)]">
            {(quote.rates.monthlyInterestRate * 100).toFixed(2)}% per month on the principal
          </dd>
        </div>
      </dl>

      <p className="flex items-start gap-2 border-t border-[rgba(201,160,92,0.12)] pt-4 text-xs leading-relaxed text-[var(--text-muted)]">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>
          An estimate from what you have told us. The appraiser inspects the item in person before
          any figure is final, and may revise it.
        </span>
      </p>
    </div>
  );
}

/** Photograph picker. One component for item photos and ID images. */
function PhotoField({
  id,
  label,
  hint,
  kind,
  value,
  onChange,
  error,
}: {
  id: string;
  label: string;
  hint: string;
  kind: 'item' | 'id-front' | 'id-back' | 'selfie';
  value: string;
  onChange: (url: string) => void;
  error?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const handle = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setFailure(null);
    try {
      const result = await api.upload<{ url: string }>(
        '/public/pawn/uploads',
        file,
        { query: { kind } },
      );
      onChange(result.url);
    } catch (err: any) {
      setFailure(err?.message || 'That photograph could not be uploaded. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <span className={microLabel}>{label}</span>

      {value ? (
        <div className="relative overflow-hidden rounded-[14px] border border-[rgba(201,160,92,0.20)]">
          <img src={value} alt={`${label} preview`} className="h-40 w-full object-cover" />
          <button
            type="button"
            onClick={() => onChange('')}
            aria-label={`Remove ${label}`}
            className="absolute right-2 top-2 cursor-pointer rounded-[10px] border border-[rgba(245,240,232,0.20)] bg-[rgba(10,10,15,0.80)] p-1.5 text-[var(--text-primary)] transition-colors duration-200 hover:bg-[rgba(10,10,15,0.95)] focus-visible:ring-2 focus-visible:ring-[var(--gold)]"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          // Two photo fields on one screen, so the trigger has to name which
          // one it belongs to. Two buttons reading "Add photograph" is
          // ambiguous to a screen reader and to everyone else.
          aria-label={`Add ${label.toLowerCase()}`}
          aria-describedby={`${id}-hint`}
          className="flex h-28 w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-[14px] border border-dashed border-[rgba(201,160,92,0.28)] bg-[var(--bg-elevated)] text-sm text-[var(--text-secondary)] transition-colors duration-200 hover:border-[var(--gold)] hover:text-[var(--text-primary)] focus-visible:ring-2 focus-visible:ring-[var(--gold)] disabled:cursor-wait disabled:opacity-60"
        >
          {busy ? (
            <Loader2 className="h-5 w-5 animate-spin text-[var(--gold)]" aria-hidden="true" />
          ) : (
            <Camera className="h-5 w-5 text-[var(--gold)]" aria-hidden="true" />
          )}
          {busy ? 'Uploading…' : 'Add photograph'}
        </button>
      )}

      <input
        ref={inputRef}
        id={id}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic"
        className="sr-only"
        onChange={(event) => void handle(event.target.files?.[0])}
      />

      <p id={`${id}-hint`} className="text-xs text-[var(--text-muted)]">
        {failure ?? hint}
      </p>
      {error ? (
        <p role="alert" className="text-xs text-[var(--red)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/* ── Page ────────────────────────────────────────────────────────────── */

export default function ApplyPage() {
  const [step, setStep] = useState<StepIndex>(0);

  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [branchesError, setBranchesError] = useState<string | null>(null);
  const [shopId, setShopId] = useState('');
  const [branchId, setBranchId] = useState('');

  const [category, setCategory] = useState('');
  const [weight, setWeight] = useState('');
  const [purity, setPurity] = useState('');
  const [description, setDescription] = useState('');

  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);

  const [itemPhotos, setItemPhotos] = useState<string[]>([]);

  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [address, setAddress] = useState('');
  const [idType, setIdType] = useState('');
  const [idNumber, setIdNumber] = useState('');
  const [idFront, setIdFront] = useState('');
  const [idBack, setIdBack] = useState('');
  const [selfie, setSelfie] = useState('');

  const [reservation, setReservation] = useState<Reservation | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    api
      .get<BranchOption[]>('/public/pawn/branches')
      .then((data) => {
        if (!cancelled) setBranches(data);
      })
      .catch((err: any) => {
        if (!cancelled) {
          setBranchesError(
            err?.message || 'The branch list could not be loaded. Please refresh and try again.',
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedShop = branches.find((b) => b.pawnshopId === shopId) ?? null;
  const weightValue = Number.parseFloat(weight);
  const purityOptions =
    category === 'SILVER_JEWELRY' ? SILVER_PURITY_OPTIONS : PURITY_OPTIONS;

  const itemReady = Boolean(category) && Number.isFinite(weightValue) && weightValue > 0;

  /**
   * Whether the quote on screen belongs to the numbers currently in the form.
   *
   * The quote is debounced, so for 450 ms after the last keystroke it is stale.
   * A `quote != null` check is not enough: Continue would stay enabled through
   * that window, the applicant would reach the last step with no price, and
   * `submit` would return without doing anything — the same silent no-op that
   * made "Approve" look broken on the approval queue.
   */
  const quoteIsCurrent = Boolean(
    quote &&
      quote.itemCategory === category &&
      quote.weightGrams === weightValue &&
      (quote.purityPercent ?? null) === (purity ? Number.parseFloat(purity) : null),
  );

  /** Price the item. The server owns every rate and every cap. */
  const runQuote = useCallback(async () => {
    if (!shopId || !itemReady) return;
    setQuoting(true);
    setQuoteError(null);
    try {
      const result = await api.post<Quote>('/public/pawn/quote', {
        pawnshopId: shopId,
        itemCategory: category,
        weight: weightValue,
        purityPercent: purity ? Number.parseFloat(purity) : undefined,
      });
      setQuote(result);
    } catch (err: any) {
      setQuoteError(err?.message || 'That item could not be priced. Please check the details.');
    } finally {
      setQuoting(false);
    }
  }, [shopId, category, weightValue, purity, itemReady]);

  // Price as soon as there is enough to price, so the applicant sees the figure
  // without a button. Debounced because it is a network call per keystroke.
  useEffect(() => {
    if (step !== 1 || !itemReady) return;
    const timer = setTimeout(() => void runQuote(), 450);
    return () => clearTimeout(timer);
  }, [step, itemReady, runQuote]);

  const validateId = (): boolean => {
    const errors: Record<string, string> = {};
    if (name.trim().length < 2) errors.name = 'Enter your full name as it appears on your ID.';
    if (contact.trim().length < 7) errors.contact = 'Enter a mobile number we can reach you on.';
    if (address.trim().length < 4) errors.address = 'Enter the address you will collect from.';
    if (!idType) errors.idType = 'Choose the type of ID you will present.';
    if (!idNumber.trim()) errors.idNumber = 'Enter your ID number.';
    if (!idFront) errors.idFront = 'A photograph of the front of your ID is required.';
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const submit = async () => {
    // Never return without saying why. A bare `return` here is a button that
    // does nothing when clicked, which reads as a broken app rather than as a
    // missing price.
    if (!quoteIsCurrent) {
      setSubmitError(
        'We do not have a current estimate for this item. Go back to the item step and let it price before submitting.',
      );
      return;
    }
    if (!validateId()) return;

    setSubmitting(true);
    setSubmitError(null);
    try {
      const result = await api.post<Reservation>('/public/pawn/reservations', {
        pawnshopId: shopId,
        branchId: branchId ? Number.parseInt(branchId, 10) : undefined,
        customerName: name.trim(),
        contactNumber: contact.trim(),
        address: address.trim(),
        itemCategory: category,
        itemDescription: description.trim() || undefined,
        weight: weightValue,
        purityPercent: purity ? Number.parseFloat(purity) : undefined,
        photoUrls: itemPhotos,
        idType,
        idNumber: idNumber.trim(),
        idFrontUrl: idFront || undefined,
        idBackUrl: idBack || undefined,
        selfieUrl: selfie || undefined,
      });
      setReservation(result);
      setStep(4);
    } catch (err: any) {
      setSubmitError(err?.message || 'Your application could not be submitted. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const canAdvance =
    step === 0
      ? Boolean(shopId)
      : step === 1
        ? itemReady && quoteIsCurrent
        : step === 2
          ? itemPhotos.length > 0
          : false;

  return (
    <div className="min-h-screen bg-[var(--bg-deep)] text-[var(--text-primary)] [font-family:var(--font-body)]">
      <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
        <header className="mb-8">
          <p className={microLabel}>PawnGold</p>
          <h1 className="mt-1 text-3xl font-black leading-tight [font-family:var(--font-display)] sm:text-4xl">
            Get an estimate before you visit
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[var(--text-secondary)]">
            Tell us about the item and we will price it against your chosen branch&rsquo;s own rate
            table. You are not committing to anything, and no loan is created here.
          </p>
        </header>

        <Stepper current={step} />

        <main className="mt-6 space-y-5">
          {step === 0 ? (
            <section className={`${surface} space-y-5 p-5 sm:p-6`}>
              <div>
                <h2 className="text-xl font-bold [font-family:var(--font-display)]">
                  Choose a branch
                </h2>
                <p className="mt-1 text-sm text-[var(--text-secondary)]">
                  Only branches that can lawfully accept pawns today are listed.
                </p>
              </div>

              {branchesError ? (
                <p role="alert" className="text-sm text-[var(--red)]">
                  {branchesError}
                </p>
              ) : branches.length === 0 ? (
                <p className="text-sm text-[var(--text-secondary)]">Loading branches…</p>
              ) : (
                <fieldset className="space-y-3">
                  <legend className="sr-only">Branch</legend>
                  {branches.map((option) => {
                    const active = option.pawnshopId === shopId;
                    return (
                      <label
                        key={option.pawnshopId}
                        className={[
                          'flex cursor-pointer items-start gap-3 rounded-[14px] border p-4 transition-colors duration-200',
                          'focus-within:ring-2 focus-within:ring-[var(--gold)]',
                          active
                            ? 'border-[var(--gold)] bg-[var(--gold-glow)]'
                            : 'border-[rgba(201,160,92,0.14)] hover:border-[rgba(201,160,92,0.30)]',
                        ].join(' ')}
                      >
                        <input
                          type="radio"
                          name="branch"
                          value={option.pawnshopId}
                          checked={active}
                          // The wrapping label's text is the name plus two lines
                          // of metadata, so the accessible name is set
                          // explicitly rather than inherited from all of it.
                          aria-label={option.pawnshopName}
                          onChange={() => {
                            setShopId(option.pawnshopId);
                            setBranchId('');
                            // A price is branch-specific — it comes from that
                            // shop's own rate table — so carrying the previous
                            // branch's figure over would show one shop's number
                            // under another shop's name.
                            setQuote(null);
                          }}
                          className="mt-1 h-4 w-4 shrink-0 accent-[var(--gold)]"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-semibold">
                            {option.pawnshopName}
                          </span>
                          {option.address ? (
                            <span className="mt-1 flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
                              <MapPin className="h-3 w-3 shrink-0" aria-hidden="true" />
                              {option.address}
                            </span>
                          ) : null}
                          {option.contactPhone ? (
                            <span className="mt-1 flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
                              <Phone className="h-3 w-3 shrink-0" aria-hidden="true" />
                              {option.contactPhone}
                            </span>
                          ) : null}
                        </span>
                      </label>
                    );
                  })}
                </fieldset>
              )}

              {selectedShop && selectedShop.branches.length > 0 ? (
                <Field
                  id="branch-select"
                  label={selectedShop.branches.length > 1 ? 'Preferred outlet' : 'Outlet'}
                  hint="Optional. The main branch is used if you leave this blank."
                >
                  <Select value={toSelectValue(branchId)} onValueChange={(value) => setBranchId(fromSelectValue(value))}>
                    <SelectTrigger id="branch-select">
                      <SelectValue placeholder="No preference" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NOT_STATED}>No preference</SelectItem>
                      {selectedShop.branches.map((b) => (
                        <SelectItem key={b.id} value={String(b.id)}>
                          {b.name} — {b.location}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              ) : null}
            </section>
          ) : null}

          {step === 1 ? (
            <section className="space-y-5">
              <div className={`${surface} space-y-5 p-5 sm:p-6`}>
                <div>
                  <h2 className="text-xl font-bold [font-family:var(--font-display)]">
                    Describe your item
                  </h2>
                  <p className="mt-1 text-sm text-[var(--text-secondary)]">
                    The estimate updates as you type.
                  </p>
                </div>

                <Field id="category" label="What are you pawning?">
                  <Select
                    value={category}
                    onValueChange={(value) => {
                      setCategory(value);
                      setPurity('');
                    }}
                  >
                    <SelectTrigger id="category">
                      <SelectValue placeholder="Choose a category" />
                    </SelectTrigger>
                    <SelectContent>
                      {CATEGORIES.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label} — {option.hint}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>

                <div className="grid gap-5 sm:grid-cols-2">
                  <Field
                    id="weight"
                    label="Approximate weight (grams)"
                    hint="A kitchen scale is close enough. The appraiser will weigh it properly."
                  >
                    <Input
                      id="weight"
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="0.01"
                      value={weight}
                      onChange={(event) => setWeight(event.target.value)}
                      placeholder="0.00"
                    />
                  </Field>

                  {category ? (
                    <Field
                      id="purity"
                      label="Purity"
                      hint="Leave blank if you are unsure — we will assume the common grade."
                    >
                      <Select
                        value={toSelectValue(purity)}
                        onValueChange={(value) => setPurity(fromSelectValue(value))}
                      >
                        <SelectTrigger id="purity">
                          <SelectValue placeholder="Not sure" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NOT_STATED}>Not sure</SelectItem>
                          {purityOptions.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                  ) : null}
                </div>

                <Field
                  id="description"
                  label="Anything the appraiser should know"
                  hint="Optional. Hallmarks, stone count, damage, or a missing item."
                >
                  <Textarea
                    id="description"
                    rows={3}
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    placeholder="e.g. 22K necklace, one small stone near the clasp"
                  />
                </Field>
              </div>

              {quoteError ? (
                <p role="alert" className="text-sm text-[var(--red)]">
                  {quoteError}
                </p>
              ) : null}

              {quote ? <MoneyBlock quote={quote} /> : null}
            </section>
          ) : null}

          {step === 2 ? (
            <section className={`${surface} space-y-5 p-5 sm:p-6`}>
              <div>
                <h2 className="text-xl font-bold [font-family:var(--font-display)]">
                  Add a photograph
                </h2>
                <p className="mt-1 text-sm text-[var(--text-secondary)]">
                  One clear photo in good light lets the appraiser check for hallmarks and damage
                  before you arrive. It is not a substitute for the inspection.
                </p>
              </div>

              <div className="grid gap-5 sm:grid-cols-2">
                <PhotoField
                  id="item-photo-1"
                  label="Item photograph"
                  kind="item"
                  hint="JPEG, PNG or WebP, up to 5 MB."
                  value={itemPhotos[0] ?? ''}
                  onChange={(url) =>
                    setItemPhotos((current) => {
                      const next = [...current];
                      if (url) next[0] = url;
                      else next.shift();
                      return next.filter(Boolean);
                    })
                  }
                />
                <PhotoField
                  id="item-photo-2"
                  label="Second view"
                  kind="item"
                  hint="Optional. A hallmark or clasp close-up is ideal."
                  value={itemPhotos[1] ?? ''}
                  onChange={(url) =>
                    setItemPhotos((current) => {
                      const next = [...current];
                      if (url) next[1] = url;
                      else next.splice(1, 1);
                      return next.filter(Boolean);
                    })
                  }
                />
              </div>
            </section>
          ) : null}

          {step === 3 ? (
            <section className="space-y-5">
              <div className={`${surface} space-y-5 p-5 sm:p-6`}>
                <div>
                  <h2 className="text-xl font-bold [font-family:var(--font-display)]">
                    About you
                  </h2>
                  <p className="mt-1 text-sm text-[var(--text-secondary)]">
                    The branch needs to know who to expect and confirm your identity when you arrive.
                  </p>
                </div>

                <Field id="name" label="Full name" error={fieldErrors.name}>
                  <Input
                    id="name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    autoComplete="name"
                    aria-invalid={Boolean(fieldErrors.name)}
                    placeholder="As printed on your ID"
                  />
                </Field>

                <div className="grid gap-5 sm:grid-cols-2">
                  <Field id="contact" label="Mobile number" error={fieldErrors.contact}>
                    <Input
                      id="contact"
                      value={contact}
                      onChange={(event) => setContact(event.target.value)}
                      inputMode="tel"
                      autoComplete="tel"
                      aria-invalid={Boolean(fieldErrors.contact)}
                      placeholder="09XX XXX XXXX"
                    />
                  </Field>
                  <Field
                    id="address"
                    label="Collection address"
                    error={fieldErrors.address}
                    hint="Where you will pick the item up if the loan proceeds."
                  >
                    <Input
                      id="address"
                      value={address}
                      onChange={(event) => setAddress(event.target.value)}
                      autoComplete="street-address"
                      aria-invalid={Boolean(fieldErrors.address)}
                      placeholder="House number, street, city"
                    />
                  </Field>
                </div>
              </div>

              <div className={`${surface} space-y-5 p-5 sm:p-6`}>
                <div>
                  <h3 className="flex items-center gap-2 text-lg font-bold [font-family:var(--font-display)]">
                    <ShieldCheck className="h-4 w-4 text-[var(--gold)]" aria-hidden="true" />
                    Identity
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-[var(--text-secondary)]">
                    We record that you submitted these documents. A member of staff reviews them
                    before your visit — nothing here is marked verified automatically, and your
                    photographs are never shown to anyone who has your reference number.
                  </p>
                </div>

                <div className="grid gap-5 sm:grid-cols-2">
                  <Field id="id-type" label="ID type" error={fieldErrors.idType}>
                    <Select value={idType} onValueChange={setIdType}>
                      <SelectTrigger id="id-type">
                        <SelectValue placeholder="Choose an ID" />
                      </SelectTrigger>
                      <SelectContent>
                        {ID_TYPES.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>

                  <Field id="id-number" label="ID number" error={fieldErrors.idNumber}>
                    <Input
                      id="id-number"
                      value={idNumber}
                      onChange={(event) => setIdNumber(event.target.value)}
                      aria-invalid={Boolean(fieldErrors.idNumber)}
                      placeholder="As printed on the document"
                    />
                  </Field>
                </div>

                <div className="grid gap-5 sm:grid-cols-2">
                  <PhotoField
                    id="id-front"
                    label="Front of ID"
                    kind="id-front"
                    hint="All four corners visible."
                    value={idFront}
                    onChange={setIdFront}
                    error={fieldErrors.idFront}
                  />
                  <PhotoField
                    id="id-back"
                    label="Back of ID"
                    kind="id-back"
                    hint="Optional, but most IDs are checked on both sides."
                    value={idBack}
                    onChange={setIdBack}
                  />
                </div>

                <PhotoField
                  id="selfie"
                  label="Photo of yourself"
                  kind="selfie"
                  hint="Optional for now. You will confirm your identity in person."
                  value={selfie}
                  onChange={setSelfie}
                />
              </div>

              {submitError ? (
                <p role="alert" className="text-sm text-[var(--red)]">
                  {submitError}
                </p>
              ) : null}
            </section>
          ) : null}

          {step === 4 && reservation ? (
            <section className="space-y-5">
              <div className={`${surface} space-y-5 p-5 text-center sm:p-8`}>
                <CheckCircle2 className="mx-auto h-10 w-10 text-[var(--green)]" aria-hidden="true" />
                <div>
                  <p className={microLabel}>Your application</p>
                  <h2 className="mt-1 text-2xl font-black [font-family:var(--font-display)]">
                    {reservation.reference}
                  </h2>
                </div>

                {quote ? <MoneyBlock quote={quote} /> : null}

                <p className="text-sm text-[var(--text-secondary)]">
                  This rate is held until{' '}
                  <span className="font-semibold text-[var(--text-primary)]">
                    {new Date(reservation.expiresAt).toLocaleString('en-PH', {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
                  </span>
                  . Bring the item and a valid ID to the branch, and the appraiser will confirm or
                  revise the figure.
                </p>
              </div>

              <div className={`${surface} space-y-4 p-5`}>
                <h3 className="text-base font-bold [font-family:var(--font-display)]">
                  What happens next
                </h3>
                <ol className="space-y-3 text-sm text-[var(--text-secondary)]">
                  <li className="flex gap-3">
                    <span className="[font-family:var(--font-mono)] text-[10px] font-black text-[var(--gold)]">
                      01
                    </span>
                    <span>Bring the item and your original ID to the branch.</span>
                  </li>
                  <li className="flex gap-3">
                    <span className="[font-family:var(--font-mono)] text-[10px] font-black text-[var(--gold)]">
                      02
                    </span>
                    <span>
                      The appraiser weighs, tests and inspects it, then confirms or revises the
                      estimate.
                    </span>
                  </li>
                  <li className="flex gap-3">
                    <span className="[font-family:var(--font-mono)] text-[10px] font-black text-[var(--gold)]">
                      03
                    </span>
                    <span>
                      If you proceed, you sign a loan contract and receive a receipt. Only then does
                      the item go into the vault.
                    </span>
                  </li>
                </ol>
                <p className="border-t border-[rgba(201,160,92,0.12)] pt-4 text-xs leading-relaxed text-[var(--text-muted)]">
                  <Upload className="mr-1 inline h-3 w-3" aria-hidden="true" />
                  Keep your reference number. It is how the branch finds your application, so treat
                  it as private.
                </p>
              </div>
            </section>
          ) : null}
        </main>

        {step < 4 ? (
          <footer className="sticky bottom-0 mt-6 flex items-center justify-between gap-3 border-t border-[rgba(201,160,92,0.14)] bg-[var(--bg-glass)] py-4 backdrop-blur">
            <Button
              type="button"
              variant="outline"
              onClick={() => setStep((current) => Math.max(0, current - 1) as StepIndex)}
              disabled={step === 0}
              className="border-[rgba(201,160,92,0.22)] text-[var(--text-primary)]"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              Back
            </Button>

            {step < 3 ? (
              <Button
                type="button"
                disabled={!canAdvance || quoting}
                onClick={() => setStep((current) => Math.min(4, current + 1) as StepIndex)}
              >
                {step === 1 && quoting ? 'Pricing…' : 'Continue'}
                {step === 1 && !quoting ? (
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                ) : null}
              </Button>
            ) : (
              <Button type="button" onClick={() => void submit()} disabled={submitting}>
                {submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    Submitting…
                  </>
                ) : (
                  'Submit application'
                )}
              </Button>
            )}
          </footer>
        ) : null}
      </div>
    </div>
  );
}
