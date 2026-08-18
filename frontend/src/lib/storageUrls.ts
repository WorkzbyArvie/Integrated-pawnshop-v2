import { supabase } from './supabaseClient';

const STORAGE_API_PREFIX = 'storage/v1/object/public/';

const PRIVATE_BUCKETS = new Set(['kyc-documents']);

const signedUrlCache = new Map<string, Promise<string>>();

export function storagePartsFromPublicUrl(
  storedUrl: string,
): { bucket: string; path: string } | null {
  try {
    const url = new URL(storedUrl);
    const pathname = url.pathname.replace(/^\//, '');
    const afterPrefix = pathname.startsWith(STORAGE_API_PREFIX)
      ? pathname.slice(STORAGE_API_PREFIX.length)
      : pathname;
    const slash = afterPrefix.indexOf('/');
    if (slash <= 0) return null;
    return {
      bucket: afterPrefix.slice(0, slash),
      path: afterPrefix.slice(slash + 1),
    };
  } catch {
    return null;
  }
}

export function getDisplayableStorageUrl(storedUrl: string): Promise<string> {
  const parts = storagePartsFromPublicUrl(storedUrl);
  if (!parts || !PRIVATE_BUCKETS.has(parts.bucket)) {
    return Promise.resolve(storedUrl);
  }

  const cached = signedUrlCache.get(storedUrl);
  if (cached) return cached;

  const pending = supabase.storage
    .from(parts.bucket)
    .createSignedUrl(parts.path, 3600)
    .then(({ data, error }) => {
      if (error || !data?.signedUrl) {
        signedUrlCache.delete(storedUrl);
        throw new Error(error?.message || 'Unable to sign storage URL');
      }
      return data.signedUrl;
    });
  signedUrlCache.set(storedUrl, pending);
  return pending;
}
