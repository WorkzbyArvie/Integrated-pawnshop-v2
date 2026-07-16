import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import Home from '../Home';

const listingResponse = {
  items: [
    {
      id: 101,
      title: 'Rolex Daytona 18K',
      description: 'Gold chronograph',
      startingPrice: 45000,
      reservePrice: null,
      currentBid: 52000,
      bidCount: 3,
      status: 'LIVE',
      startAt: new Date().toISOString(),
      endAt: new Date(Date.now() + 1000 * 60 * 60).toISOString(),
      pawnshop: { id: 'pawn-1', name: 'Golden Vault Pawn', logoUrl: null },
      category: { id: 1, name: 'Watches' },
      ticket: { id: 10, ticketNumber: 'TK-101', category: 'Watches', description: 'Gold watch' },
      images: [{ id: 1, url: 'https://example.com/watch.jpg', sortOrder: 0 }],
    },
  ],
  nextCursor: null,
};

describe('Home', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders live auctions from API', async () => {
    window.history.pushState({}, '', '/?pawnshopId=pawn-1');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => listingResponse,
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <MemoryRouter>
        <Home />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: 'Live Auctions' })).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getAllByText('Rolex Daytona 18K').length).toBeGreaterThan(0);
    });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('pawnshopId=pawn-1'),
      expect.any(Object),
    );
  });
});
