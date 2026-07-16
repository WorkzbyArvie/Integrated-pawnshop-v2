import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './index.css';
import App from './App.tsx';
import { BrandingProvider } from './context/BrandingContext';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrandingProvider defaultBrandingId={1}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </BrandingProvider>
  </StrictMode>,
);
