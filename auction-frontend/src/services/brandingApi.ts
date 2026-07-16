import axios from 'axios';
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
  const { data } = await axios.get(`${BASE_URL}/${id}`);
  return data;
};

export const fetchAllBrandings = async (): Promise<Branding[]> => {
  const { data } = await axios.get(BASE_URL);
  return data;
};

export const createBranding = async (branding: Partial<Branding>): Promise<Branding> => {
  const { data } = await axios.post(BASE_URL, branding);
  return data;
};

export const updateBranding = async (id: number, branding: Partial<Branding>): Promise<Branding> => {
  const { data } = await axios.patch(`${BASE_URL}/${id}`, branding);
  return data;
};

export const deleteBranding = async (id: number): Promise<void> => {
  await axios.delete(`${BASE_URL}/${id}`);
};
