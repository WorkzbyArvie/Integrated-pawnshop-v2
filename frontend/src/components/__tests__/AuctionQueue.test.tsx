import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, it, vi } from 'vitest';
import { AuctionQueue } from '../AuctionQueue';

vi.mock('../../lib/supabaseClient', () => ({
  supabase: {
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'test-token' } } }) },
  },
}));

vi.mock('../../App', () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

describe('AuctionQueue', () => {
  it('renders the auction queue header and empty state', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [],
      }),
    );
    render(<AuctionQueue branchId="pawnshop-1" />);

    expect(screen.getByText('Auction Queue')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('No items currently marked for auction.')).toBeInTheDocument();
    });
  });

  it('returns an item to the vault', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [
            {
              id: 1,
              ticketNumber: 'TKT-100',
              description: 'Gold Necklace',
              category: 'Gold Jewelry',
              loanAmount: 5000,
              expiryDate: null,
              listingId: null,
              listingStatus: null,
            },
          ],
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ id: 1, status: 'ACTIVE' }),
        }),
    );

    render(<AuctionQueue branchId="pawnshop-1" />);

    await waitFor(() => {
      expect(screen.getByText('Gold Necklace')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Return to Vault'));

    await waitFor(() => {
      expect(screen.queryByText('Gold Necklace')).not.toBeInTheDocument();
    });
  });
});
