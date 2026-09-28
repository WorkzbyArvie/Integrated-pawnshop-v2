import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { CookieConsentBanner } from './components/CookieConsentBanner';
import './index.css';

/**
 * Entry point for the Integrated Pawnshop System.
 * We wrap the <App /> with <BrowserRouter> here to provide
 * routing context to all sub-components, including <Login />.
 *
 * The cookie notice is mounted here, as a sibling of <App />, rather than inside
 * a page. It previously lived in LandingPage, which meant it was unreachable from
 * any other route: a user who opened /login directly never saw it and so could
 * never record a decision. Mounted at this level it survives route changes and
 * reaches every surface, and the component itself stands down on the routes
 * where a notice would be intrusive.
 */
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
      <CookieConsentBanner />
    </BrowserRouter>
  </React.StrictMode>
);
