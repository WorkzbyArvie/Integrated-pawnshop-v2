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

    const approveButtons = await screen.findAllByRole('button', { name: /approve/i });
    fireEvent.click(approveButtons[0]);

    await waitFor(() =>
      expect(apiMock.post).toHaveBeenCalledWith('/approval-queue/1/approve', expect.anything()),
    );
    await waitFor(() => expect(apiMock.get).toHaveBeenCalledTimes(2));
  });

  it('keeps reject disabled until a rejection comment is provided', async () => {
    apiMock.get.mockResolvedValue([pendingRecords[0]]);

    render(<ApprovalQueue />);

    const rejectButton = await screen.findByRole('button', { name: /reject/i });
    expect(rejectButton).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText(/rejection comment/i), {
      target: { value: 'redo appraisal' },
    });

    expect(rejectButton).not.toBeDisabled();

    fireEvent.click(rejectButton);

    await waitFor(() =>
      expect(apiMock.post).toHaveBeenCalledWith('/approval-queue/1/reject', {
        decisionComment: 'redo appraisal',
      }),
    );
  });

  it('renders the empty state when the queue has no pending approvals', async () => {
    apiMock.get.mockResolvedValue([]);

    render(<ApprovalQueue />);

    expect(await screen.findByText(/All caught up!/i)).toBeInTheDocument();
  });
});
