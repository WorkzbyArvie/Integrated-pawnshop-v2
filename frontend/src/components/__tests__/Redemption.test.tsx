import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Redemption } from '../Redemption';
import Swal from 'sweetalert2';

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

const showToast = vi.hoisted(() => vi.fn());

vi.mock('../../App', () => ({
  useToast: () => ({ showToast }),
}));

vi.mock('../ReceiptViewer', () => ({
  ReceiptViewer: () => null,
}));

vi.mock('sweetalert2', () => ({
  default: { fire: vi.fn() },
}));

const fire = vi.mocked(Swal.fire);

const BRANCH = 'shop-1';

function ticket() {
  return {
    id: 900,
    ticketNumber: 'TKT-9001',
    description: '18K gold necklace',
    loanAmount: 10_000,
    expiryDate: '2026-10-01T00:00:00.000Z',
    status: 'ACTIVE',
    lifecycleStatus: 'ACTIVE',
    customer: { id: 'c1', fullName: 'Juan Dela Cruz', loyaltyTier: 'Gold' },
  };
}

/** A settlement priced by the server, at the rate recorded on the loan. */
function settlementQuote() {
  return {
    ticketId: 900,
    ticketNumber: 'TKT-9001',
    loanId: 77,
    principal: 10_000,
    interest: 350,
    serviceFee: 5,
    total: 10_355,
    interestRate: 0.035,
    daysUntilForfeiture: 44,
  };
}

function renewalQuote() {
  return {
    loanId: 77,
    ticketId: 900,
    ticketNumber: 'TKT-9001',
    customerName: 'Juan Dela Cruz',
    principal: 10_000,
    interestDue: 350,
    interestRate: 0.035,
    extensionDays: 30,
    currentExpiry: '2026-10-01T00:00:00.000Z',
    newExpiry: '2026-10-30T00:00:00.000Z',
    newGracePeriodEnd: '2027-01-28T00:00:00.000Z',
    newForfeitureDate: '2027-02-12T00:00:00.000Z',
    daysUntilForfeiture: 44,
  };
}

beforeEach(() => {
  apiMock.get.mockReset();
  apiMock.post.mockReset();
  fire.mockReset();
  showToast.mockReset();

  apiMock.get.mockImplementation((path: string) => {
    if (path === '/tickets') return Promise.resolve([ticket()]);
    if (path.includes('renewal-quote')) return Promise.resolve(renewalQuote());
    return Promise.resolve([]);
  });
  apiMock.post.mockImplementation((path: string) => {
    if (path === '/appraisal/redemption-quote') return Promise.resolve(settlementQuote());
    return Promise.resolve({});
  });
  fire.mockResolvedValue({ isConfirmed: true } as never);
});

/** Render, wait for the vault, and open the settlement panel. */
async function openPanel() {
  render(<Redemption branchId={BRANCH} activeBranchId={null} />);
  const calculate = await screen.findByRole('button', { name: /calculate/i });
  fireEvent.click(calculate);
  await waitFor(() => expect(screen.getByText('₱10,355.00')).toBeInTheDocument());
}

describe('Redemption settlement panel', () => {
  /**
   * The panel used to compute `principal * 0.03` plus a flat PHP 50 fee in the
   * browser, and then send that figure as `amountPaid` when the teller released
   * the item. Two errors compounded: loans were issued at 3.5%, so the branch
   * absorbed the difference on every redemption; and P.D. 114 s.10 caps the
   * service fee at the lesser of 1% of principal and PHP 5, so the flat 50 was
   * up to ten times the legal maximum. A ticket is money already owed, so the
   * figure comes from the loan.
   */
  it('prices the settlement on the server, not in the browser', async () => {
    render(<Redemption branchId={BRANCH} activeBranchId={null} />);
    fireEvent.click(await screen.findByRole('button', { name: /calculate/i }));

    await waitFor(() =>
      expect(apiMock.post).toHaveBeenCalledWith('/appraisal/redemption-quote', {
        ticketId: 900,
      }),
    );
  });

  it('shows the server total rather than a locally derived one', async () => {
    await openPanel();

    // Scoped to the panel: the principal also appears in the vault table.
    const panel = screen.getByRole('heading', { name: /settlement/i }).closest('div')!
      .parentElement!;
    expect(within(panel).getByText('₱10,000.00')).toBeInTheDocument();
    // The interest and fee render as "+ ₱350.00", one node with the sign.
    expect(within(panel).getByText('+ ₱350.00')).toBeInTheDocument();
    // The old figure was a flat ₱50, up to ten times the statutory cap.
    expect(within(panel).getByText('+ ₱5.00')).toBeInTheDocument();
    expect(within(panel).getByText('₱10,355.00')).toBeInTheDocument();
    expect(within(panel).queryByText('+ ₱50.00')).not.toBeInTheDocument();
  });

  it('states the rate the loan was issued at, not a hardcoded 3%', async () => {
    await openPanel();
    // The panel used to read "Interest (3%)" while the loan carried 3.5%.
    //
    // `interestRate` is a fraction, so this also pins the scaling: printing the
    // raw 0.035 as a percentage renders "0.04%" on a 3.5% loan, which is the
    // kind of figure a customer will not query and a panel member will.
    expect(screen.getByText(/Interest \(3\.50%\)/)).toBeInTheDocument();
    expect(screen.queryByText(/Interest \(0\.04%\)/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Interest \(3%\)/)).not.toBeInTheDocument();
  });

  it('cites the statutory cap on the service fee', async () => {
    await openPanel();
    // A flat PHP 50 with no citation is the thing a panel member asks about.
    expect(screen.getByText(/lesser of 1% and/i)).toBeInTheDocument();
    expect(screen.getByText(/P\.D\. 114 s\.10/)).toBeInTheDocument();
  });

  it('sends the quoted total as the amount paid', async () => {
    await openPanel();
    fireEvent.click(screen.getByRole('button', { name: /authorize release/i }));

    await waitFor(() => {
      const renewal = apiMock.post.mock.calls.find(([p]) => p === '/loan/renew');
      const settle = apiMock.post.mock.calls.find(([p]) => p === '/pawn-tickets/900/redeem');
      expect(settle).toBeDefined();
      expect(renewal).toBeUndefined();
      expect(settle![1]).toMatchObject({ amountPaid: 10_355, paymentMethod: 'CASH' });
    });
  });

  it('re-reads the quote at settlement and warns when the total moved', async () => {
    await openPanel();
    // A rate change between pricing and tendering must not be settled at the
    // stale figure, and must not be settled silently either.
    apiMock.post.mockImplementation((path: string) => {
      if (path === '/appraisal/redemption-quote') {
        return Promise.resolve({ ...settlementQuote(), total: 10_360, interest: 355 });
      }
      return Promise.resolve({});
    });
    fire.mockResolvedValueOnce({ isConfirmed: true } as never).mockResolvedValueOnce({
      isConfirmed: true,
    } as never);

    fireEvent.click(screen.getByRole('button', { name: /authorize release/i }));

    await waitFor(() => expect(fire).toHaveBeenCalledTimes(2));
    expect(Swal.fire).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: 'Amount changed' }),
    );
    await waitFor(() => {
      const settle = apiMock.post.mock.calls.find(([p]) => p === '/pawn-tickets/900/redeem');
      expect(settle![1]).toMatchObject({ amountPaid: 10_360 });
    });
  });

  it('does not release the item when the teller cancels the re-quote', async () => {
    await openPanel();
    apiMock.post.mockImplementation((path: string) => {
      if (path === '/appraisal/redemption-quote') {
        return Promise.resolve({ ...settlementQuote(), total: 10_360 });
      }
      return Promise.resolve({});
    });
    fire.mockResolvedValueOnce({ isConfirmed: true } as never).mockResolvedValueOnce({
      isConfirmed: false,
    } as never);

    fireEvent.click(screen.getByRole('button', { name: /authorize release/i }));

    await waitFor(() => expect(fire).toHaveBeenCalledTimes(2));
    const settle = apiMock.post.mock.calls.find(([p]) => p === '/pawn-tickets/900/redeem');
    expect(settle).toBeUndefined();
  });
});

describe('Redemption renewal', () => {
  /**
   * `POST /loans/renew` existed with no caller. A pawner who wanted to keep the
   * item by paying the accrued interest had no way to do it from the counter.
   */
  it('offers a renewal, priced on the server', async () => {
    await openPanel();
    fireEvent.click(screen.getByRole('button', { name: /renewing instead/i }));

    await waitFor(() =>
      expect(apiMock.get).toHaveBeenCalledWith('/loan/77/renewal-quote'),
    );
    await waitFor(() => expect(screen.getByText(/Renewal Instead/i)).toBeInTheDocument());
    expect(screen.getByText('₱350.00')).toBeInTheDocument();
    // The renewal quote's rate is also a fraction, and is scaled for display.
    expect(screen.getByText('3.50%')).toBeInTheDocument();
  });

  it('states the dates the renewal produces, including the restored grace period', async () => {
    await openPanel();
    fireEvent.click(screen.getByRole('button', { name: /renewing instead/i }));
    await waitFor(() => expect(screen.getByText(/Grace period ends/i)).toBeInTheDocument());

    // Renewing the day before forfeiture returns the full 90 days under
    // P.D. 114 s.13, not the 15 that were left.
    expect(screen.getByText(/restores the full 90-day redemption period/i)).toBeInTheDocument();
    expect(screen.getByText(/Extends by/i)).toBeInTheDocument();
  });

  it('collects the interest the server quoted, and nothing the screen computed', async () => {
    await openPanel();
    fireEvent.click(screen.getByRole('button', { name: /renewing instead/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /collect interest/i })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /collect interest/i }));

    await waitFor(() => {
      const renew = apiMock.post.mock.calls.find(([p]) => p === '/loan/renew');
      expect(renew).toBeDefined();
      expect(renew![1]).toMatchObject({
        ticketId: 900,
        loanId: 77,
        interestAmount: 350,
        paymentMethod: 'CASH',
      });
    });

    // And a renewal is not a redemption: releasing the collateral would defeat
    // the point of paying to keep it.
    const settle = apiMock.post.mock.calls.find(([p]) => p === '/pawn-tickets/900/redeem');
    expect(settle).toBeUndefined();
  });

  it('does not send a client-chosen identity for the receipt', async () => {
    await openPanel();
    fireEvent.click(screen.getByRole('button', { name: /renewing instead/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /collect interest/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /collect interest/i }));

    await waitFor(() => {
      const renew = apiMock.post.mock.calls.find(([p]) => p === '/loan/renew');
      expect(renew).toBeDefined();
      // `processedBy` names whoever signs a receipt, so it is taken from the
      // session server-side. Sending it from the browser is how a proof ends up
      // attributed to the wrong person.
      expect(renew![1]).not.toHaveProperty('processedBy');
    });
  });

  it('does not settle when the teller declines the renewal confirmation', async () => {
    await openPanel();
    fireEvent.click(screen.getByRole('button', { name: /renewing instead/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /collect interest/i })).toBeInTheDocument());

    fire.mockResolvedValue({ isConfirmed: false } as never);
    fireEvent.click(screen.getByRole('button', { name: /collect interest/i }));

    await waitFor(() => expect(fire).toHaveBeenCalled());
    const renew = apiMock.post.mock.calls.find(([p]) => p === '/loan/renew');
    expect(renew).toBeUndefined();
  });

  it('surfaces a ticket that cannot be renewed rather than failing silently', async () => {
    await openPanel();
    apiMock.get.mockImplementation((path: string) => {
      if (path === '/tickets') return Promise.resolve([ticket()]);
      return Promise.reject(new Error('Ticket TKT-9001 (REDEEMED) cannot be renewed'));
    });

    fireEvent.click(screen.getByRole('button', { name: /renewing instead/i }));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.stringMatching(/cannot be renewed/i), 'error'));
  });
});
