import { getBackendUrl } from '../lib/backendUrl';

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

export const fetchBranding = async (id: number): Promise<Branding> => {
  const res = await fetch(`${BASE_URL}/${id}`);
  return res.json();
};

export const fetchAllBrandings = async (): Promise<Branding[]> => {
  const res = await fetch(BASE_URL);
  return res.json();
};

export const createBranding = async (branding: Partial<Branding>): Promise<Branding> => {
  const res = await fetch(BASE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(branding),
  });
  return res.json();
};

export const updateBranding = async (id: number, branding: Partial<Branding>): Promise<Branding> => {
  const res = await fetch(`${BASE_URL}/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(branding),
  });
  return res.json();
};

export const deleteBranding = async (id: number): Promise<void> => {
  await fetch(`${BASE_URL}/${id}`, { method: 'DELETE' });
};
