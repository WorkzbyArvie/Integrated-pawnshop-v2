import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SalesPos } from '../SalesPos';

const apiMock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
}));

vi.mock('../../lib/apiClient', () => ({
  api: apiMock,
  default: apiMock,
}));

vi.mock('../../lib/supabaseClient', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      update: vi.fn().mockResolvedValue({ data: null, error: null }),
      insert: vi.fn().mockResolvedValue({ data: null, error: null }),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
    })),
  },
}));

const showToast = vi.hoisted(() => vi.fn());

vi.mock('../../App', () => ({
  useToast: () => ({ showToast }),
}));

/** A quote as the server prices it, for a 10g silver bracelet. */
function silverQuote(overrides: Record<string, unknown> = {}) {
  return {
    itemCategory: 'Silver Jewelry',
    collateralClass: 'SILVER_JEWELRY',
    weight: 10,
    gramRate: 80,
    ltvRatio: 0.55,
    appraisedValue: 800,
    recommendedLoanAmount: 440,
    termDays: 30,
    maturityDate: '2026-10-30T00:00:00.000Z',
    gracePeriodDays: 90,
    gracePeriodEnds: '2027-01-28T00:00:00.000Z',
    risk: {
      score: 75,
      band: 'CRITICAL',
      factors: ['authenticity unverified', 'ID not verified', 'KYC not verified'],
      blocking: false,
    },
    compliance: { statutoryMinLtv: 0.3, belowStatutoryMinimum: false },
    ratesUsed: { silverJewelry: 80 },
    ...overrides,
  };
}

beforeEach(() => {
  apiMock.get.mockReset();
  apiMock.post.mockReset();
  showToast.mockReset();
  apiMock.post.mockResolvedValue(silverQuote());
});

/**
 * Fill a silver bracelet and ask for a quote.
 *
 * Submits the form directly rather than clicking the button: the calculate
 * button is a submit inside a form whose customer and photo fields are
 * `required`, and a click in jsdom is swallowed by native validation before
 * the handler runs. Submitting is also the more honest test — the quote is
 * reached by submitting the appraisal form, not by calling anything directly.
 */
async function fillItem(weight: string) {
  fireEvent.change(screen.getByLabelText(/weight/i), { target: { value: weight } });
  fireEvent.change(screen.getByLabelText(/item category/i), {
    target: { value: 'Silver Jewelry' },
  });
  fireEvent.submit(screen.getByRole('button', { name: /calculate/i }).closest('form')!);
}

describe('SalesPos', () => {
  it('renders appraisal deadline and auction flag inputs', () => {
    const { container, getByText } = render(
      <SalesPos branchId="pawnshop-1" setActiveTab={vi.fn()} />
    );

    expect(getByText('Appraisal Deadline')).toBeInTheDocument();
    expect(container.querySelector('input[type="date"]')).toBeTruthy();
    expect(container.querySelector('input[type="checkbox"]')).toBeTruthy();
  });

  /**
   * The valuation used to be computed in this component from a table of
   * hardcoded per-gram rates, with no record of what produced the figure. The
   * browser computing money at all is the defect: a per-gram constant that
   * changes would silently change what a past ticket was worth, and the client
   * and the contract would disagree.
   */
  it('prices the item on the server rather than in the browser', async () => {
    render(<SalesPos branchId="pawnshop-1" setActiveTab={vi.fn()} />);

    // No figure appears before the appraiser asks for one.
    expect(screen.getByText(/Awaiting calculations/i)).toBeInTheDocument();

    await fillItem('10');

    await waitFor(() =>
      expect(apiMock.post).toHaveBeenCalledWith('/appraisal/quote', {
        itemCategory: 'Silver Jewelry',
        weight: 10,
        authenticityVerified: false,
      }),
    );
  });

  it('shows the server figure, not one derived in the component', async () => {
    render(<SalesPos branchId="pawnshop-1" setActiveTab={vi.fn()} />);

    await fillItem('10');

    // The server says PHP 440 for a 10g silver bracelet. At the old PHP 42/gram
    // the browser produced PHP 294, so a stale local table would show 294 here.
    await waitFor(() => expect(screen.getByText('₱440.00')).toBeInTheDocument());
    expect(screen.queryByText('₱294.00')).not.toBeInTheDocument();
  });

  it('shows the basis of the valuation so it is auditable', async () => {
    render(<SalesPos branchId="pawnshop-1" setActiveTab={vi.fn()} />);

    await fillItem('10');

    // The rate, the ratio and the term, so the appraisal can be checked rather
    // than taken on trust.
    await waitFor(() => expect(screen.getByText('Rate / gram')).toBeInTheDocument());
    expect(screen.getByText('₱80.00')).toBeInTheDocument();
    expect(screen.getByText('55%')).toBeInTheDocument();
    expect(screen.getByText('30 days')).toBeInTheDocument();
  });

  it('lists the factors behind the risk score', async () => {
    render(<SalesPos branchId="pawnshop-1" setActiveTab={vi.fn()} />);

    await fillItem('10');

    // A risk number the appraiser cannot interrogate is a number they have to
    // trust. The old client curve gave no basis to question at all.
    await waitFor(() => expect(screen.getByText(/authenticity unverified/i)).toBeInTheDocument());
    expect(screen.getByText(/ID not verified/i)).toBeInTheDocument();
  });

  it('displays the server band, not a second set of local thresholds', async () => {
    // The panel used to cut at 30/50 while the server cuts at 20/40/70, so a
    // score of 55 rendered amber here and CRITICAL on the receipt.
    apiMock.post.mockResolvedValue(silverQuote({ risk: { score: 55, band: 'CRITICAL', factors: ['heavy handling (2000g)'], blocking: false } }));

    render(<SalesPos branchId="pawnshop-1" setActiveTab={vi.fn()} />);

    await fillItem('10');

    // The risk score and the LTV happen to be the same number here, so scope the
    // assertion to the risk section rather than matching the string twice. The
    // label's own parent is the section: heading plus the score card.
    await waitFor(() =>
      expect(screen.getByText('Risk Score')).toBeInTheDocument(),
    );
    const riskSection = screen.getByText('Risk Score').closest('div')!;
    expect(within(riskSection).getByText('55%')).toBeInTheDocument();
    expect(within(riskSection).getByText('CRITICAL')).toBeInTheDocument();
  });

  it('refuses to quote an item the appraiser flagged as counterfeit', async () => {
    // Proceeding means the branch holds worthless collateral and may face the
    // rightful owner. It is not a risk to be scored and averaged down.
    apiMock.post.mockResolvedValue(
      silverQuote({ risk: { score: 55, band: 'CRITICAL', factors: ['authenticity suspected'], blocking: true } }),
    );

    render(<SalesPos branchId="pawnshop-1" setActiveTab={vi.fn()} />);

    await fillItem('10');

    await waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.stringMatching(/counterfeit/i), 'error'));
    // And no loan figure is offered.
    expect(screen.queryByText('₱440.00')).not.toBeInTheDocument();
  });

  it('surfaces the P.D. 114 s.9 floor rather than quietly lending under it', async () => {
    apiMock.post.mockResolvedValue(
      silverQuote({
        compliance: {
          statutoryMinLtv: 0.3,
          belowStatutoryMinimum: true,
          note: 'P.D. 114 Section 9 permits a loan below 30% of appraised value only where the pawner manifests in writing the desire to borrow less.',
        },
      }),
    );

    render(<SalesPos branchId="pawnshop-1" setActiveTab={vi.fn()} />);

    await fillItem('10');

    await waitFor(() => expect(screen.getByText(/Below statutory minimum/i)).toBeInTheDocument());
    expect(screen.getByText(/manifests in writing/i)).toBeInTheDocument();
  });

  it('records a risk score of 0 rather than treating it as absent', async () => {
    // Zero is the score of a fully-cleared item under the server's model, so it
    // is a real value. `|| undefined` on the way to the API would have dropped it.
    apiMock.post.mockResolvedValue(
      silverQuote({ risk: { score: 0, band: 'LOW', factors: ['authenticity verified', 'ID verified', 'KYC verified'], blocking: false } }),
    );

    render(<SalesPos branchId="pawnshop-1" setActiveTab={vi.fn()} />);

    await fillItem('10');

    await waitFor(() => expect(screen.getByText('0%')).toBeInTheDocument());
    expect(screen.getByText('LOW')).toBeInTheDocument();
  });
});
