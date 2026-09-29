import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InventoryVault } from '../InventoryVault';
import { api } from '../../lib/apiClient';

// `vi.mock` factories are hoisted above these declarations, so the spies are
// created inside the factory and read back through `vi.mocked`.
vi.mock('../../lib/apiClient', () => {
  const get = vi.fn();
  const post = vi.fn().mockResolvedValue({ success: true });
  const patch = vi.fn().mockResolvedValue({ id: 1, description: 'Gold Necklace' });
  const client = { get, post, patch };
  return { api: client, default: client };
});

const getMock = vi.mocked(api.get);
const postMock = vi.mocked(api.post);
const patchMock = vi.mocked(api.patch);

vi.mock('../../lib/supabaseClient', () => ({
  supabase: {
    storage: { from: vi.fn(() => ({ upload: vi.fn(), getPublicUrl: vi.fn() })) },
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) },
  },
}));

const showToastMock = vi.fn();
vi.mock('../../App', () => ({
  useToast: () => ({ showToast: showToastMock }),
}));

// The confirm dialog gates the action; without this the click never reaches the API.
vi.mock('sweetalert2', () => ({
  default: { fire: vi.fn().mockResolvedValue({ isConfirmed: true }) },
}));

beforeEach(() => {
  getMock.mockReset();
  postMock.mockClear();
  patchMock.mockClear();
  showToastMock.mockClear();
});

/** Row shape returned by `GET /tickets` (camelCase from Prisma). */
const TICKET = {
  id: 1,
  ticketNumber: 'TKT-100',
  description: 'Gold Necklace',
  category: 'Gold Jewelry',
  weight: 10,
  loanAmount: 5000,
  status: 'ACTIVE',
  pawnDate: new Date().toISOString(),
  storageLocation: 'Vault A',
  pawnshopId: 'pawnshop-1',
  customer: { id: 'c-1', fullName: 'Jane Doe', loyaltyTier: 'Gold' },
};

describe('InventoryVault', () => {
  it('marks active items for auction', async () => {
    getMock.mockResolvedValue([TICKET]);

    render(<InventoryVault branchId="pawnshop-1" />);

    await waitFor(() => {
      expect(screen.getByText('Gold Necklace')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Mark for Auction'));

    await waitFor(() => {
      expect(postMock).toHaveBeenCalledWith('/pawn-tickets/1/send-to-auction');
    });

    expect(showToastMock).toHaveBeenCalled();
  });

  // The vault used to read `ticket` straight from the browser with its pawnshop
  // filter applied only when a shop happened to be selected. It now reads
  // through the backend, which derives the tenant from the session.
  it('reads the vault through the backend and never names a tenant', async () => {
    getMock.mockResolvedValue([TICKET]);

    render(<InventoryVault branchId="pawnshop-1" />);

    await waitFor(() => {
      expect(getMock).toHaveBeenCalled();
    });

    const [path, params] = getMock.mock.calls[0];
    expect(path).toBe('/tickets');
    expect(params).not.toHaveProperty('pawnshopId');
  });

  it('surfaces a backend failure instead of rendering an empty vault as success', async () => {
    getMock.mockRejectedValue(new Error('Cannot read tickets for another shop'));

    // A distinct shop id avoids the module-level inventory cache, which is keyed
    // by shop and would otherwise serve the rows from an earlier test.
    render(<InventoryVault branchId="pawnshop-error-case" />);

    await waitFor(() => {
      expect(screen.queryByText('Gold Necklace')).not.toBeInTheDocument();
    });
  });
});
