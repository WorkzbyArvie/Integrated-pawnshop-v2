import { describe, it, expect, vi, beforeEach } from 'vitest';

import { getSignedKycDocUrl, storagePathFromPublicUrl } from './kycDocs';

const createSignedUrlMock = vi.hoisted(() => vi.fn());

vi.mock('./supabaseClient', () => ({
  supabase: {
    storage: {
      from: vi.fn(() => ({
        createSignedUrl: createSignedUrlMock,
      })),
    },
  },
}));

describe('getSignedKycDocUrl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createSignedUrlMock.mockResolvedValue({ data: { signedUrl: 'https://signed.example/object' }, error: null });
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

  it('rejects when supabase returns an error', async () => {
    createSignedUrlMock.mockResolvedValue({ data: null, error: { message: 'forbidden' } });

    await expect(getSignedKycDocUrl('id-front/user_1.jpg')).rejects.toThrow(
      'Unable to sign KYC document URL',
    );
  });

  it('rejects when no signedUrl is returned', async () => {
    createSignedUrlMock.mockResolvedValue({ data: { signedUrl: null }, error: null });

    await expect(getSignedKycDocUrl('id-front/user_1.jpg')).rejects.toThrow(
      'Unable to sign KYC document URL',
    );
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
