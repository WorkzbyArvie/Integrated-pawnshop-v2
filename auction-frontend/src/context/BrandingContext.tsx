import React, { createContext, useContext, useEffect, useState } from 'react';
import type { Branding } from '../services/brandingApi';
import { fetchBranding } from '../services/brandingApi';

interface BrandingContextProps {
  branding: Branding | null;
  setBrandingId: (id: number) => void;
}

const BrandingContext = createContext<BrandingContextProps>({
  branding: null,
  setBrandingId: () => {},
});

export const useBranding = () => useContext(BrandingContext);

export const BrandingProvider: React.FC<{ defaultBrandingId: number; children: React.ReactNode }> = ({ defaultBrandingId, children }) => {
  const [branding, setBranding] = useState<Branding | null>(null);
  const [brandingId, setBrandingId] = useState<number>(defaultBrandingId);

  useEffect(() => {
    fetchBranding(brandingId)
      .then(setBranding)
      .catch(() => setBranding(null));
  }, [brandingId]);

  return (
    <BrandingContext.Provider value={{ branding, setBrandingId }}>
      {children}
    </BrandingContext.Provider>
  );
};
