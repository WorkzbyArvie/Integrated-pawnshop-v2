const configuredBackendUrl = import.meta.env.VITE_BACKEND_URL?.replace(/\/$/, '') || '';
const configuredBackendFallbackUrl =
  import.meta.env.VITE_BACKEND_URL_FALLBACK?.replace(/\/$/, '') || '';
const configuredAuctionUrl = import.meta.env.VITE_AUCTION_URL?.replace(/\/$/, '') || '';
const configuredAuctionFallbackUrl =
  import.meta.env.VITE_AUCTION_URL_FALLBACK?.replace(/\/$/, '') || '';

const LOCAL_BACKEND_URL = 'http://localhost:3000';
const LOCAL_AUCTION_URL = 'http://localhost:5174';
const FALLBACK_BACKEND_URL = 'https://pawngold-backend-production.up.railway.app';
const FALLBACK_AUCTION_URL = 'https://pawngold-auction-house-production.up.railway.app';

const isLocalRuntime =
  typeof window !== 'undefined' &&
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

function isLocalhostUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  } catch {
    return /localhost|127\.0\.0\.1/.test(url);
  }
}

function resolveUrl(
  configuredUrl: string,
  fallbackUrl: string,
  secondaryConfiguredUrl: string,
): string {
  const primaryUrl = configuredUrl;
  const secondaryUrl = secondaryConfiguredUrl;

  if (!primaryUrl && !secondaryUrl) {
    return isLocalRuntime
      ? (fallbackUrl === FALLBACK_BACKEND_URL ? LOCAL_BACKEND_URL : LOCAL_AUCTION_URL)
      : fallbackUrl;
  }

  const selectedUrl = primaryUrl || secondaryUrl;

  // In production runtime, never honor localhost env URLs.
  if (!isLocalRuntime && selectedUrl && isLocalhostUrl(selectedUrl)) {
    return fallbackUrl;
  }

  return selectedUrl;
}

export function getBackendUrl(): string {
  return resolveUrl(
    configuredBackendUrl,
    FALLBACK_BACKEND_URL,
    configuredBackendFallbackUrl,
  );
}

export function getAuctionFrontendUrl(): string {
  return resolveUrl(
    configuredAuctionUrl,
    FALLBACK_AUCTION_URL,
    configuredAuctionFallbackUrl,
  );
}
