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
});
