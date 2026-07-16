import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { vi } from 'vitest';
import ListingDetail from '../ListingDetail';

const listing = {
  id: 202,
  title: 'Cartier Panthere Necklace',
  description: 'Certified diamonds',
  startingPrice: 40000,
  reservePrice: null,
  currentBid: 45000,
  bidCount: 2,
  status: 'LIVE',
  startAt: new Date().toISOString(),
  endAt: new Date(Date.now() + 1000 * 60 * 60).toISOString(),
  pawnshop: { id: 'pawn-2', name: 'Luxe Credit Co.', logoUrl: null },
  category: { id: 2, name: 'Jewelry' },
  ticket: { id: 11, ticketNumber: 'TK-202', category: 'Jewelry', description: 'Necklace' },
  images: [{ id: 2, url: 'https://example.com/necklace.jpg', sortOrder: 0 }],
};

describe('ListingDetail', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders listing detail from API', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => listing,
      }),
    );

    render(
      <MemoryRouter initialEntries={['/listing/202']}>
        <Routes>
          <Route path="/listing/:id" element={<ListingDetail />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('Cartier Panthere Necklace')).toBeInTheDocument();
    });

    expect(screen.getByText('Current Bid')).toBeInTheDocument();
  });
});
