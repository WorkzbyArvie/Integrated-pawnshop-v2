const configuredBackendUrl = import.meta.env.VITE_BACKEND_URL?.replace(/\/$/, '') || '';
const configuredBackendFallbackUrl =
  import.meta.env.VITE_BACKEND_URL_FALLBACK?.replace(/\/$/, '') || '';

const LOCAL_BACKEND_URL = 'http://localhost:3000';
const FALLBACK_BACKEND_URL = 'https://pawngold-backend-production.up.railway.app';

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

export function getBackendUrl(): string {
  if (!configuredBackendUrl && !configuredBackendFallbackUrl) {
    return isLocalRuntime ? LOCAL_BACKEND_URL : FALLBACK_BACKEND_URL;
  }

  const selectedUrl = configuredBackendUrl || configuredBackendFallbackUrl;

  if (!isLocalRuntime && selectedUrl && isLocalhostUrl(selectedUrl)) {
    return FALLBACK_BACKEND_URL;
  }

  return selectedUrl;
}
