import { supabase } from './supabaseClient';

const STORAGE_API_PREFIX = 'storage/v1/object/public/';
const BUCKET_PREFIX = 'kyc-documents/';

export function storagePathFromPublicUrl(storedUrl: string): string {
  let pathname = storedUrl;
  try {
    pathname = new URL(storedUrl).pathname;
  } catch {
    pathname = storedUrl;
  }
  const cleaned = pathname.replace(/^\//, '');
  const withoutApiPrefix = cleaned.startsWith(STORAGE_API_PREFIX)
    ? cleaned.slice(STORAGE_API_PREFIX.length)
    : cleaned;
  return withoutApiPrefix.startsWith(BUCKET_PREFIX)
    ? withoutApiPrefix.slice(BUCKET_PREFIX.length)
    : withoutApiPrefix;
}

export async function getSignedKycDocUrl(storedUrl: string, ttlSeconds = 3600): Promise<string> {
  const objectPath = storagePathFromPublicUrl(storedUrl);
  const { data, error } = await supabase.storage
    .from('kyc-documents')
    .createSignedUrl(objectPath, ttlSeconds);
  if (error || !data?.signedUrl) {
    return storedUrl;
  }
  return data.signedUrl;
}
