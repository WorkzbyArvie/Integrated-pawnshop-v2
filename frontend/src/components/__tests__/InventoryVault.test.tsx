import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { InventoryVault } from '../InventoryVault';

const updateSelectMock = vi.fn().mockResolvedValue({ data: [{ id: 1 }], error: null });
const updateChain = {
  eq: vi.fn().mockReturnThis(),
  select: updateSelectMock,
};
const updateMock = vi.fn(() => updateChain);

const query = {
  select: vi.fn().mockReturnThis(),
  order: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  then: (resolve: any) =>
    resolve({
      data: [
        {
          id: 1,
          ticket_number: 'TKT-100',
          description: 'Gold Necklace',
          category: 'Gold Jewelry',
          weight: 10,
          loan_amount: 5000,
          status: 'ACTIVE',
          pawn_date: new Date().toISOString(),
          storage_location: 'Vault A',
          pawnshop_id: 'pawnshop-1',
          customer: { full_name: 'Jane Doe' },
        },
      ],
      error: null,
    }),
};

vi.mock('../../lib/supabaseClient', () => ({
  supabase: {
    from: vi.fn(() => ({
      ...query,
      update: updateMock,
    })),
  },
}));

const showToastMock = vi.fn();
vi.mock('../../App', () => ({
  useToast: () => ({ showToast: showToastMock }),
}));

describe('InventoryVault', () => {
  it('marks active items for auction', async () => {
    render(<InventoryVault branchId="pawnshop-1" />);

    await waitFor(() => {
      expect(screen.getByText('Gold Necklace')).toBeInTheDocument();
    });

    const action = screen.getByText('Mark for Auction');
    fireEvent.click(action);

    await waitFor(() => {
      expect(updateMock).toHaveBeenCalledWith({ status: 'AUCTION' });
    });

    expect(showToastMock).toHaveBeenCalled();
  });
});
