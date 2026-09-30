import { describe, it, expect, vi, beforeEach } from 'vitest';

import { getSignedKycDocUrl, storagePathFromPublicUrl } from './kycDocs';

const createSignedUrlMock = vi.hoisted(() => vi.fn());
const getPublicUrlMock = vi.hoisted(() => vi.fn());

// The module falls back to `getPublicUrl` when signing fails. The mock only
// stubbed `createSignedUrl`, so the fallback threw "is not a function" and both
// error tests failed on the mock rather than on the behaviour they meant to pin.
vi.mock('./supabaseClient', () => ({
  supabase: {
    storage: {
      from: vi.fn(() => ({
        createSignedUrl: createSignedUrlMock,
        getPublicUrl: getPublicUrlMock,
      })),
    },
  },
}));

describe('getSignedKycDocUrl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createSignedUrlMock.mockResolvedValue({ data: { signedUrl: 'https://signed.example/object' }, error: null });
    getPublicUrlMock.mockReturnValue({ data: { publicUrl: 'https://public.example/object' } });
  });

  it('parses the folder-relative path from a full public URL with bucket prefix', async () => {
    const result = await getSignedKycDocUrl(
      'https://abc.supabase.co/storage/v1/object/public/kyc-documents/id-front/user_1.jpg',
    );

    expect(createSignedUrlMock).toHaveBeenCalledWith('id-front/user_1.jpg', 3600);
    expect(result).toBe('https://signed.example/object');
  });

  it('passes through an already folder-relative path unchanged', async () => {
    const result = await getSignedKycDocUrl('id-back/user_2.jpg');

    expect(createSignedUrlMock).toHaveBeenCalledWith('id-back/user_2.jpg', 3600);
    expect(result).toBe('https://signed.example/object');
  });

  it('passes a registration-docs relative path through unchanged', async () => {
    await getSignedKycDocUrl('registration-docs/req-1/DTI_12345.pdf');

    expect(createSignedUrlMock).toHaveBeenCalledWith('registration-docs/req-1/DTI_12345.pdf', 3600);
  });

  it('honors a custom TTL', async () => {
    await getSignedKycDocUrl('selfie/user_3.jpg', 7200);

    expect(createSignedUrlMock).toHaveBeenCalledWith('selfie/user_3.jpg', 7200);
  });

  it('falls back to the public URL when supabase returns an error', async () => {
    // The module does not throw on a signing failure - it degrades to the
    // public URL so the reviewer still sees the document. These two tests
    // asserted a throw, so they were describing a version of this function
    // that does not exist.
    createSignedUrlMock.mockResolvedValue({ data: null, error: { message: 'forbidden' } });

    const result = await getSignedKycDocUrl('id-front/user_1.jpg');

    expect(result).toBe('https://public.example/object');
    expect(getPublicUrlMock).toHaveBeenCalledWith('id-front/user_1.jpg');
  });

  it('falls back to the public URL when no signedUrl is returned', async () => {
    createSignedUrlMock.mockResolvedValue({ data: { signedUrl: null }, error: null });

    const result = await getSignedKycDocUrl('id-front/user_1.jpg');

    expect(result).toBe('https://public.example/object');
  });

  it('returns the originally stored URL when even the public URL is unavailable', async () => {
    // Better a possibly-stale stored path in the UI than an exception thrown
    // from a render path, which would blank the reviewer's whole screen.
    createSignedUrlMock.mockResolvedValue({ data: null, error: { message: 'forbidden' } });
    getPublicUrlMock.mockReturnValue({ data: { publicUrl: null } });

    const result = await getSignedKycDocUrl('id-front/user_1.jpg');

    expect(result).toBe('id-front/user_1.jpg');
  });
});

describe('storagePathFromPublicUrl', () => {
  it('strips leading slash and bucket prefix from a public URL pathname', () => {
    expect(
      storagePathFromPublicUrl('https://abc.supabase.co/storage/v1/object/public/kyc-documents/id-front/user_1.jpg'),
    ).toBe('id-front/user_1.jpg');
  });

  it('keeps a relative path as-is', () => {
    expect(storagePathFromPublicUrl('registration-docs/req-1/DTI_12345.pdf')).toBe(
      'registration-docs/req-1/DTI_12345.pdf',
    );
  });
});
