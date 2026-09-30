import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, it, vi, beforeEach } from 'vitest';

import ApprovalQueue from '../ApprovalQueue';

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
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: { session: { access_token: 'test-token', user: { id: 'user-1' } } },
      }),
      refreshSession: vi.fn(),
    },
  },
}));

vi.mock('../../App', () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

const pendingRecords = [
  {
    id: 1,
    targetType: 'APPRAISAL',
    targetId: 100,
    status: 'PENDING',
    amount: 15000,
    createdAt: '2026-08-01T00:00:00.000Z',
    payload: {
      ticketNumber: 'TKT-100',
      appraisedValue: 20000,
      riskScore: 25,
      recommendedLoanAmount: 15000,
    },
  },
  {
    id: 2,
    targetType: 'REDEMPTION',
    targetId: 200,
    status: 'PENDING',
    amount: 60000,
    createdAt: '2026-08-01T00:00:00.000Z',
    payload: { ticketNumber: 'TKT-200', amountPaid: 60000 },
  },
];

describe('ApprovalQueue (RBAC-05)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('active_pawnshop_id', 'ps_1');
    apiMock.get.mockResolvedValue(pendingRecords);
    apiMock.post.mockResolvedValue({ id: 1, status: 'APPROVED' });
  });

  it('renders the Approval Queue title with Appraisal, Redemption, and Decision History tabs', () => {
    render(<ApprovalQueue />);

    expect(screen.getByText('Approval Queue')).toBeInTheDocument();
    expect(screen.getByText('Appraisal')).toBeInTheDocument();
    expect(screen.getByText('Redemption')).toBeInTheDocument();
    expect(screen.getByText('Decision History')).toBeInTheDocument();
  });

  it('fetches GET /approval-queue with pawnshopId and the active tab type', async () => {
    render(<ApprovalQueue />);

    await waitFor(() =>
      expect(apiMock.get).toHaveBeenCalledWith('/approval-queue', {
        pawnshopId: 'ps_1',
        type: 'APPRAISAL',
      }),
    );

    fireEvent.mouseDown(screen.getByText('Redemption'));

    await waitFor(() =>
      expect(apiMock.get).toHaveBeenLastCalledWith('/approval-queue', {
        pawnshopId: 'ps_1',
        type: 'REDEMPTION',
      }),
    );
  });

  it('approves a record via POST /approval-queue/:id/approve and refreshes the queue', async () => {
    render(<ApprovalQueue />);

    fireEvent.click((await screen.findAllByRole('button', { name: /review & decide/i }))[0]);
    fireEvent.click(await screen.findByRole('button', { name: /approve & generate contract/i }));

    await waitFor(() =>
      expect(apiMock.post).toHaveBeenCalledWith('/approval-queue/1/approve', expect.anything()),
    );
    await waitFor(() => expect(apiMock.get).toHaveBeenCalledTimes(2));
  });

  // Approving opened the contract without closing the review dialog, so two
  // overlays stacked and - sharing a z-index - the contract rendered behind the
  // dialog the reviewer was still looking at. Approving appeared to do nothing.
  it('closes the review dialog before the contract opens', async () => {
    apiMock.get.mockResolvedValue([pendingRecords[0]]);
    apiMock.post.mockResolvedValue({ applicationId: 'app-1', contractId: 'ctr-1', loanId: 55 });

    render(<ApprovalQueue />);

    fireEvent.click(await screen.findByRole('button', { name: /review & decide/i }));
    expect(await screen.findByRole('button', { name: /approve & generate contract/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /approve & generate contract/i }));

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /approve & generate contract/i })).not.toBeInTheDocument(),
    );
  });

  it('closes the review dialog on approve even when no contract is generated', async () => {
    // A redemption releases the item and produces no contract, so nothing else
    // would ever replace the dialog - the reviewer would sit on a decided
    // request with its buttons still live.
    apiMock.get.mockResolvedValue([
      {
        id: 2,
        targetType: 'REDEMPTION',
        targetId: 200,
        status: 'PENDING',
        ticketNumber: 'TKT-200',
        createdAt: '2026-08-01T00:00:00.000Z',
        amountPaid: 1450,
      },
    ]);
    apiMock.post.mockResolvedValue({ id: 2, status: 'APPROVED' });

    render(<ApprovalQueue />);

    fireEvent.mouseDown(screen.getByText('Redemption'));
    fireEvent.click(await screen.findByRole('button', { name: /review & decide/i }));
    fireEvent.click(await screen.findByRole('button', { name: /approve & release/i }));

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /approve & release/i })).not.toBeInTheDocument(),
    );
  });

  it('offers no decision controls on the row - they live inside the review dialog', async () => {
    render(<ApprovalQueue />);

    await screen.findAllByRole('button', { name: /review & decide/i });

    // A decision taken without opening the record is what let a reviewer act on
    // a valuation they had not seen, so nothing may be actionable from the row.
    expect(screen.queryByRole('button', { name: /approve/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /decline/i })).not.toBeInTheDocument();
  });

  it('keeps Confirm Decline disabled until a reason is chosen from the dropdown', async () => {
    apiMock.get.mockResolvedValue([pendingRecords[0]]);

    render(<ApprovalQueue />);

    fireEvent.click(await screen.findByRole('button', { name: /review & decide/i }));
    fireEvent.click(await screen.findByRole('button', { name: /^decline$/i }));

    const confirm = await screen.findByRole('button', { name: /confirm decline/i });
    expect(confirm).toBeDisabled();
    expect(screen.getByText(/select a reason to decline/i)).toBeInTheDocument();

    // No reason means no request: the decline cannot reach the API at all.
    expect(apiMock.post).not.toHaveBeenCalled();
  });

  it('declines with the chosen reason and refreshes the queue', async () => {
    apiMock.get.mockResolvedValue([pendingRecords[0]]);

    render(<ApprovalQueue />);

    fireEvent.click(await screen.findByRole('button', { name: /review & decide/i }));
    fireEvent.click(await screen.findByRole('button', { name: /^decline$/i }));

    fireEvent.keyDown(await screen.findByTestId('decline-1-trigger'), { key: 'ArrowDown' });
    fireEvent.click(await screen.findByRole('option', { name: /documents insufficient/i }));

    const confirm = await screen.findByRole('button', { name: /confirm decline/i });
    await waitFor(() => expect(confirm).not.toBeDisabled());
    fireEvent.click(confirm);

    await waitFor(() =>
      expect(apiMock.post).toHaveBeenCalledWith('/approval-queue/1/reject', {
        decisionComment: 'Documents insufficient',
      }),
    );
  });

  it('requires typed text when the reason is "other"', async () => {
    apiMock.get.mockResolvedValue([pendingRecords[0]]);

    render(<ApprovalQueue />);

    fireEvent.click(await screen.findByRole('button', { name: /review & decide/i }));
    fireEvent.click(await screen.findByRole('button', { name: /^decline$/i }));

    fireEvent.keyDown(await screen.findByTestId('decline-1-trigger'), { key: 'ArrowDown' });
    fireEvent.click(await screen.findByRole('option', { name: /other \(specify below\)/i }));

    const confirm = await screen.findByRole('button', { name: /confirm decline/i });
    expect(confirm).toBeDisabled();

    const custom = await screen.findByTestId('decline-1-custom');
    fireEvent.change(custom, { target: { value: 'Item is a replica' } });

    await waitFor(() => expect(confirm).not.toBeDisabled());
    fireEvent.click(confirm);

    await waitFor(() =>
      expect(apiMock.post).toHaveBeenCalledWith('/approval-queue/1/reject', {
        decisionComment: 'Item is a replica',
      }),
    );
  });

  it('renders the empty state when the queue has no pending approvals', async () => {
    apiMock.get.mockResolvedValue([]);

    render(<ApprovalQueue />);

    expect(await screen.findByText(/All caught up!/i)).toBeInTheDocument();
  });

  // The endpoint returns `appraisedValue` and `recommendedLoanAmount`. It does
  // NOT return `amount`, and the row's helper used to read only that - so every
  // appraisal rendered ₱0.00 in the queue while the review dialog showed the
  // real figure. These fixtures use the actual response shape, no `amount`.
  describe('the figure on a collapsed row', () => {
    it('shows the recommended loan, not ₱0.00', async () => {
      apiMock.get.mockResolvedValue([
        {
          id: 1,
          targetType: 'APPRAISAL',
          targetId: 100,
          status: 'PENDING',
          ticketNumber: 'TKT-100',
          createdAt: '2026-08-01T00:00:00.000Z',
          appraisedValue: 800,
          recommendedLoanAmount: 440,
        },
      ]);

      render(<ApprovalQueue />);

      expect(await screen.findByText(/₱440/)).toBeInTheDocument();
      expect(screen.queryByText(/₱0\.00/)).not.toBeInTheDocument();
    });

    it('names the figure so ₱440 is not mistaken for the valuation', async () => {
      apiMock.get.mockResolvedValue([
        {
          id: 1,
          targetType: 'APPRAISAL',
          targetId: 100,
          status: 'PENDING',
          ticketNumber: 'TKT-100',
          createdAt: '2026-08-01T00:00:00.000Z',
          appraisedValue: 800,
          recommendedLoanAmount: 440,
        },
      ]);

      render(<ApprovalQueue />);

      expect(await screen.findByText(/Recommended loan/i)).toBeInTheDocument();
    });

    it('falls back to the appraised value when no recommendation was made', async () => {
      apiMock.get.mockResolvedValue([
        {
          id: 1,
          targetType: 'APPRAISAL',
          targetId: 100,
          status: 'PENDING',
          ticketNumber: 'TKT-100',
          createdAt: '2026-08-01T00:00:00.000Z',
          appraisedValue: 800,
          recommendedLoanAmount: null,
        },
      ]);

      render(<ApprovalQueue />);

      expect(await screen.findByText(/₱800/)).toBeInTheDocument();
      expect(await screen.findByText(/Appraised value/i)).toBeInTheDocument();
    });

    it('treats a zero recommendation as absent rather than as the figure', async () => {
      // A zero here would render ₱0.00 - the exact symptom being fixed - and
      // `??` would not help because 0 is not nullish.
      apiMock.get.mockResolvedValue([
        {
          id: 1,
          targetType: 'APPRAISAL',
          targetId: 100,
          status: 'PENDING',
          ticketNumber: 'TKT-100',
          createdAt: '2026-08-01T00:00:00.000Z',
          appraisedValue: 800,
          recommendedLoanAmount: 0,
        },
      ]);

      render(<ApprovalQueue />);

      expect(await screen.findByText(/₱800/)).toBeInTheDocument();
    });

    it('shows the amount paid on a redemption', async () => {
      apiMock.get.mockResolvedValue([
        {
          id: 2,
          targetType: 'REDEMPTION',
          targetId: 200,
          status: 'PENDING',
          ticketNumber: 'TKT-200',
          createdAt: '2026-08-01T00:00:00.000Z',
          amountPaid: 1450,
        },
      ]);

      render(<ApprovalQueue />);

      // Radix Tabs activates on pointer/mouse down, not on a bare click.
      fireEvent.mouseDown(screen.getByText('Redemption'));

      expect(await screen.findByText(/₱1,450/)).toBeInTheDocument();
      expect(await screen.findByText(/Amount paid/i)).toBeInTheDocument();
    });
  });
});
