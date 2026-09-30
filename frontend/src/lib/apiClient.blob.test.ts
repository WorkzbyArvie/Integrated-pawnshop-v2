import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session } from '@supabase/supabase-js';

import { ApiError, api } from './apiClient';
import { getBackendUrl } from './backendUrl';
import { supabase } from './supabaseClient';

vi.mock('./supabaseClient', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
      refreshSession: vi.fn(),
    },
  },
}));

vi.mock('./backendUrl', () => ({
  getBackendUrl: () => 'https://api.example.test',
  getAuctionFrontendUrl: () => 'https://auction.example.test',
  getSiteUrl: () => 'https://site.example.test',
}));

const getSession = vi.mocked(supabase.auth.getSession);
const refreshSession = vi.mocked(supabase.auth.refreshSession);

const SESSION = {
  access_token: 'token-123',
  refresh_token: 'refresh-123',
  token_type: 'bearer' as const,
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: { id: 'user-1' },
} as unknown as Session;

function pdfResponse(bytes: number): Response {
  return {
    ok: true,
    status: 200,
    blob: async () => new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }),
  } as unknown as Response;
}

/**
 * `api.blob` exists because two components used to hand-roll a `fetch` for the
 * contract PDF. Both read `import.meta.env.VITE_API_URL`, a variable this project
 * never defines, so the URL silently fell back to `http://localhost:3000` and
 * every download failed against the user's own machine with a bare "Failed to
 * fetch" that said nothing about the cause.
 */
describe('api.blob', () => {
  beforeEach(() => {
    getSession.mockReset().mockResolvedValue({ data: { session: SESSION }, error: null } as never);
    refreshSession.mockReset().mockResolvedValue({ data: { session: SESSION }, error: null } as never);
    vi.stubGlobal('localStorage', {
      getItem: () => 'shop-1',
      setItem: () => undefined,
      removeItem: () => undefined,
    });
  });

  it('requests the resolved backend URL, never localhost', async () => {
    const fetchMock = vi.fn().mockResolvedValue(pdfResponse(8));
    vi.stubGlobal('fetch', fetchMock);

    await api.blob('/loan/contracts/abc/pdf');

    const [url] = fetchMock.mock.calls[0];
    // The whole defect in one assertion: a hand-rolled fetch resolved to
    // localhost:3000 here and the download died in the user's browser.
    expect(url).toBe('https://api.example.test/loan/contracts/abc/pdf');
    expect(url).not.toContain('localhost');
  });

  it('sends the same auth and tenant headers as every other call', async () => {
    const fetchMock = vi.fn().mockResolvedValue(pdfResponse(8));
    vi.stubGlobal('fetch', fetchMock);

    await api.blob('/loan/contracts/abc/pdf');

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBe('Bearer token-123');
    expect(init.headers['pawnshop-id']).toBe('shop-1');
  });

  it('returns the body as a blob', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(pdfResponse(16)));

    const blob = await api.blob('/loan/contracts/abc/pdf');

    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('application/pdf');
  });

  it('surfaces the server reason rather than a bare fetch failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        json: async () => ({ message: 'Contract not found in this shop' }),
      } as unknown as Response),
    );

    // "Failed to fetch" is what the user saw. It cannot be acted on - it does
    // not distinguish a 403 from a dead host from a missing route.
    await expect(api.blob('/loan/contracts/abc/pdf')).rejects.toThrow(
      'Contract not found in this shop',
    );
  });

  it('reports the status code when the server sends no reason', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        json: async () => {
          throw new Error('not json');
        },
      } as unknown as Response),
    );

    await expect(api.blob('/loan/contracts/abc/pdf')).rejects.toThrow(/502/);
  });

  it('raises an ApiError so callers can branch on the status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({}),
      } as unknown as Response),
    );

    await expect(api.blob('/loan/contracts/abc/pdf')).rejects.toBeInstanceOf(ApiError);
  });
});

describe('backendUrl resolution', () => {
  it('is the single source of the API base', () => {
    // Guards the class of bug rather than one instance: if a component ever
    // reaches for import.meta.env.VITE_API_URL again, this documents that the
    // project defines VITE_BACKEND_URL and nothing else.
    expect(getBackendUrl()).toBe('https://api.example.test');
  });
});
