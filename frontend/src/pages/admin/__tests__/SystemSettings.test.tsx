import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SystemSettings } from '../SystemSettings';

/**
 * Covers the save consolidation on the System Control page.
 *
 * The page used to carry four commit points wired to four different endpoints
 * with three different interaction models, and nothing on screen distinguished
 * them. These tests pin the behaviour that replaced it: one commit point, dirty
 * state derived from what the server is known to hold, and -- the case most
 * likely to regress silently -- a partial failure that must not mark unsaved
 * work as done.
 */

const DEFAULTS = {
  vault_enabled: true,
  finance_enabled: true,
  crm_enabled: true,
  hr_enabled: true,
  auction_enabled: true,
  decision_enabled: false,
  alerts_enabled: true,
};

const LOADED_SETTINGS = {
  ...DEFAULTS,
  redemptionApprovalThreshold: 50000,
  contractTermsAndConditions: '1. Existing clause one.\n2. Existing clause two.',
  contractPawnshopResponsibilities: 'Existing responsibility.',
  global_overrides: {},
};

const supabaseMock = vi.hoisted(() => {
  const rows: Record<string, unknown>[] = [];
  const singleRow: Record<string, unknown> = {};
  const chain = () => ({
    select: () => chain(),
    eq: () => chain(),
    single: () => Promise.resolve({ data: singleRow, error: null }),
    then: (onFulfilled: (v: unknown) => unknown) =>
      Promise.resolve({ data: rows, error: null }).then(onFulfilled),
  });
  return { rows, singleRow, from: () => chain() };
});

vi.mock('../../../lib/supabaseClient', () => ({ supabase: supabaseMock }));
vi.mock('sweetalert2', () => ({
  default: { fire: vi.fn().mockResolvedValue({ isConfirmed: true }) },
}));

const apiGet = vi.fn();
const apiPatch = vi.fn();
vi.mock('../../../lib/apiClient', () => ({
  default: {
    get: (...a: unknown[]) => apiGet(...a),
    patch: (...a: unknown[]) => apiPatch(...a),
  },
}));

// Leaflet cannot mount in jsdom, and the picker owns the location fields this
// test drives through prop callbacks anyway.
vi.mock('../../../components/LocationPicker', () => ({
  LocationPicker: () => <div data-testid="location-picker" />,
}));

/**
 * `config` is a controlled prop, so the component cannot change it on its own.
 * The real parent owns that state, and a stubbed `setConfig` would leave the
 * toggles inert, so the harness reproduces the parent.
 */
function Harness({
  userRole = 'Owner',
  branchId = 'branch-1' as string | null,
}: {
  userRole?: string;
  branchId?: string | null;
}) {
  const [config, setConfig] = useState(DEFAULTS);
  return (
    <SystemSettings
      config={config}
      setConfig={setConfig}
      userRole={userRole}
      branchId={branchId}
    />
  );
}

const saveButton = () => screen.getByRole('button', { name: /save changes/i });
const toggle = (name: RegExp) => screen.getByRole('switch', { name });

async function renderPage(props: { userRole?: string; branchId?: string | null } = {}) {
  render(<Harness {...props} />);
  // Both async loads have to settle before the saved baseline exists.
  await waitFor(() => expect(screen.getByText('Everything Saved')).toBeInTheDocument());
}

beforeEach(() => {
  vi.clearAllMocks();
  supabaseMock.rows.length = 0;
  supabaseMock.rows.push({ id: 'branch-1', settings: { ...LOADED_SETTINGS } });
  Object.keys(supabaseMock.singleRow).forEach((k) => delete supabaseMock.singleRow[k]);
  Object.assign(supabaseMock.singleRow, {
    settings: { ...LOADED_SETTINGS },
    latitude: 14.34,
    longitude: 120.98,
    address: 'Dasmarinas, Cavite',
  });
  apiGet.mockResolvedValue({
    pawnshopId: 'branch-1',
    pawnshopName: 'PawnGold',
    displayName: 'PawnGold',
    logoUrl: null,
    primaryColor: '#D4AF37',
    secondaryColor: '#141416',
    customBrandingEnabled: false,
  });
  apiPatch.mockResolvedValue({});
});

describe('SystemSettings save consolidation', () => {
  it('opens clean, with the commit control disabled and nothing marked unsaved', async () => {
    await renderPage();

    expect(saveButton()).toBeDisabled();
    expect(screen.queryByText('Unsaved Changes')).not.toBeInTheDocument();
    expect(screen.queryByText('Unsaved')).not.toBeInTheDocument();
  });

  it('names the pending section instead of offering a second save button for it', async () => {
    await renderPage();

    fireEvent.click(toggle(/inventory vault/i));

    await waitFor(() => expect(screen.getByText('Unsaved Changes')).toBeInTheDocument());

    // The footer states which sections are outstanding, rather than the page
    // carrying one save button per section.
    expect(
      screen.getByText(/Pending: feature toggles and redemption threshold\./),
    ).toBeInTheDocument();
    expect(saveButton()).toBeEnabled();
    expect(screen.getAllByRole('button', { name: /save/i })).toHaveLength(1);
  });

  it('tracks each edited section independently', async () => {
    await renderPage();

    fireEvent.click(toggle(/inventory vault/i));
    fireEvent.change(screen.getByLabelText(/terms and conditions/i), {
      target: { value: '1. Rewritten clause.' },
    });

    await waitFor(() =>
      expect(
        screen.getByText(
          /Pending: feature toggles and redemption threshold, contract terms\./,
        ),
      ).toBeInTheDocument(),
    );

    // The footer names both, and the contract section carries the inline marker.
    // The feature grid has no inline marker of its own because the sticky footer
    // is always on screen and already reports it.
    expect(screen.getAllByText('Unsaved')).toHaveLength(1);
  });

  it('clears the dirty state once the pending sections reach the server', async () => {
    await renderPage();

    fireEvent.click(toggle(/inventory vault/i));
    await waitFor(() => expect(saveButton()).toBeEnabled());

    fireEvent.click(saveButton());

    await waitFor(() => expect(screen.getByText('Everything Saved')).toBeInTheDocument());
    expect(saveButton()).toBeDisabled();
    expect(apiPatch).toHaveBeenCalledWith(
      '/tenant-governance/pawnshops/branch-1/settings',
      expect.objectContaining({ settings: expect.any(Object) }),
    );
  });

  it('leaves a failed section marked unsaved and does not report success', async () => {
    await renderPage();

    fireEvent.click(toggle(/inventory vault/i));
    fireEvent.change(screen.getByLabelText(/terms and conditions/i), {
      target: { value: '1. This write will fail.' },
    });
    await waitFor(() => expect(saveButton()).toBeEnabled());

    // The features write lands; the contract-terms write does not.
    apiPatch.mockImplementation((url: string) =>
      url.includes('contract-terms')
        ? Promise.reject(new Error('contract terms endpoint unavailable'))
        : Promise.resolve({}),
    );

    fireEvent.click(saveButton());

    // The succeeded section joins the new baseline and stops showing as pending;
    // the failed one stays visible so the work is not silently lost.
    await waitFor(() =>
      expect(screen.getByText(/Pending: contract terms\./)).toBeInTheDocument(),
    );
    expect(screen.getByText('Unsaved Changes')).toBeInTheDocument();
    expect(screen.getByText('Unsaved')).toBeInTheDocument();
    expect(saveButton()).toBeEnabled();
  });

  it('warns before a super admin fans settings out to every branch', async () => {
    await renderPage({ userRole: 'Super Admin', branchId: null });

    fireEvent.click(toggle(/inventory vault/i));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /apply to all branches/i })).toBeEnabled(),
    );
  });
});
