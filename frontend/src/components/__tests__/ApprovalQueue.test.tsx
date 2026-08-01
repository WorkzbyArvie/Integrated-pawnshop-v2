import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, it, vi, beforeEach } from 'vitest';

import ApprovalQueue from '../ApprovalQueue';

const apiMock = { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() };

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
    apiMock.get.mockResolvedValue({
      success: true,
      data: { records: pendingRecords, total: 2 },
    });
    apiMock.post.mockResolvedValue({ success: true, data: { id: 1, status: 'APPROVED' } });
  });

  it('renders pending appraisal and redemption approvals fetched from GET /approvals', async () => {
    render(<ApprovalQueue />);

    await waitFor(() => expect(apiMock.get).toHaveBeenCalledWith('/approvals'));
    expect(await screen.findByText(/TKT-100/)).toBeInTheDocument();
    expect(await screen.findByText(/TKT-200/)).toBeInTheDocument();
  });

  it('shows an empty state when there are no pending approvals', async () => {
    apiMock.get.mockResolvedValue({
      success: true,
      data: { records: [], total: 0 },
    });

    render(<ApprovalQueue />);

    expect(await screen.findByText(/no pending approvals/i)).toBeInTheDocument();
  });

  it('approves a record via POST /approvals/:id/approve and refreshes the queue', async () => {
    render(<ApprovalQueue />);

    const approveButtons = await screen.findAllByRole('button', { name: /approve/i });
    fireEvent.click(approveButtons[0]);

    await waitFor(() =>
      expect(apiMock.post).toHaveBeenCalledWith('/approvals/1/approve', expect.anything()),
    );
    await waitFor(() => expect(apiMock.get).toHaveBeenCalledTimes(2));
  });

  it('rejects a record via POST /approvals/:id/reject and refreshes the queue', async () => {
    apiMock.post.mockResolvedValue({ success: true, data: { id: 2, status: 'REJECTED' } });

    render(<ApprovalQueue />);

    const rejectButtons = await screen.findAllByRole('button', { name: /reject/i });
    fireEvent.click(rejectButtons[0]);

    await waitFor(() =>
      expect(apiMock.post).toHaveBeenCalledWith('/approvals/1/reject', expect.anything()),
    );
    await waitFor(() => expect(apiMock.get).toHaveBeenCalledTimes(2));
  });
});
