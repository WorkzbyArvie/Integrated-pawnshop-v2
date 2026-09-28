import { describe, expect, it, vi, afterEach } from 'vitest';
import { unwrapEnvelope } from './responseEnvelope';
import { fetchBranding } from '../services/brandingApi';

function jsonResponse(status: number, body: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('unwrapEnvelope', () => {
  it('unwraps a single envelope', () => {
    expect(unwrapEnvelope({ success: true, data: { id: 1 } })).toEqual({ id: 1 });
  });

  it('unwraps a double-wrapped envelope to the payload', () => {
    const payload = { mustChangePassword: false, mfaEnabled: false };
    expect(
      unwrapEnvelope({ success: true, data: { success: true, data: payload } }),
    ).toEqual(payload);
  });

  it('leaves a bare payload untouched', () => {
    expect(unwrapEnvelope({ id: 7 })).toEqual({ id: 7 });
  });

  it('returns an array payload without descending into it', () => {
    expect(unwrapEnvelope({ success: true, data: [1, 2] })).toEqual([1, 2]);
  });

  it('stops at a non-boolean success flag', () => {
    const value = { success: 'yes', data: 1 };
    expect(unwrapEnvelope(value)).toBe(value);
  });
});

describe('brandingApi', () => {
  it('returns the branding payload, not the envelope', async () => {
    // Regression: `res.json()` was returned raw and typed as `Branding`, so every
    // field was undefined at runtime. The auction branding looked correct only
    // because the CSS falls back to defaults when a value is missing.
    const branding = {
      id: 1,
      name: 'PawnGold',
      primaryColor: '#C9A05C',
      logoUrl: 'https://cdn.example/logo.png',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { success: true, data: branding })));

    await expect(fetchBranding(1)).resolves.toEqual(branding);
  });

  it('unwraps a double-wrapped branding payload', async () => {
    const branding = { id: 1, name: 'PawnGold' };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(200, { success: true, data: { success: true, data: branding } }),
      ),
    );

    await expect(fetchBranding(1)).resolves.toEqual(branding);
  });

  it('does not cache an authenticated read', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { success: true, data: { id: 1 } }));
    vi.stubGlobal('fetch', fetchMock);

    await fetchBranding(1);

    const [, init] = fetchMock.mock.calls[0];
    expect(init.cache).toBe('no-store');
  });

  it('throws on a failed branding request instead of returning an envelope', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(500, { success: false })));
    await expect(fetchBranding(1)).rejects.toThrow('status 500');
  });
});
