import { getBackendUrl } from '../lib/backendUrl';
import { unwrapEnvelope } from '../lib/responseEnvelope';

export interface Branding {
  id: number;
  name: string;
  primaryColor?: string;
  secondaryColor?: string;
  accentColor?: string;
  logoUrl?: string;
  faviconUrl?: string;
  theme?: string;
  customCss?: string;
  createdAt: string;
  updatedAt: string;
}

const BASE_URL = `${getBackendUrl()}/branding`;

/**
 * The backend wraps responses in `{ success, data }`, so the raw `Response` body
 * is the envelope rather than a `Branding`. Returning it unparsed meant every
 * field was undefined at runtime while the types claimed otherwise, which left
 * the auction branding silently inert and masked by CSS fallbacks.
 */
async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: 'no-store', ...init });
  if (!res.ok) {
    throw new Error(`Branding request failed with status ${res.status}`);
  }
  if (res.status === 204) {
    return undefined as T;
  }
  return unwrapEnvelope<T>(await res.json());
}

export const fetchBranding = (id: number): Promise<Branding> =>
  request<Branding>(`${BASE_URL}/${id}`);

export const fetchAllBrandings = (): Promise<Branding[]> =>
  request<Branding[]>(BASE_URL);

export const createBranding = (branding: Partial<Branding>): Promise<Branding> =>
  request<Branding>(BASE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(branding),
  });

export const updateBranding = (
  id: number,
  branding: Partial<Branding>,
): Promise<Branding> =>
  request<Branding>(`${BASE_URL}/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(branding),
  });

export const deleteBranding = async (id: number): Promise<void> => {
  await request<undefined>(`${BASE_URL}/${id}`, { method: 'DELETE' });
};
