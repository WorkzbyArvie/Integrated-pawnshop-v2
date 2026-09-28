import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { CookieConsentBanner } from '../CookieConsentBanner';
import { CookieConsentManager } from '../CookieConsentManager';
import { resetBlockingSurface, setBlockingSurface } from '../../lib/blockingSurface';
import {
  acceptConsent,
  hasAcceptedConsent,
  readConsent,
  withdrawConsent,
  CONSENT_VERSION,
  invalidateConsentSnapshot,
} from '../../lib/cookieConsent';

const STORAGE_KEY = 'pawngold_cookie_consent';

function renderBanner(initialPath = '/') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="*" element={<div>page content</div>} />
      </Routes>
      <CookieConsentBanner />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.clear();
  // The module memoises its snapshot, so clearing storage alone would leave a
  // previous test's decision in place.
  invalidateConsentSnapshot();
  resetBlockingSurface();
});

afterEach(() => {
  localStorage.clear();
  invalidateConsentSnapshot();
  resetBlockingSurface();
});

describe('cookieConsent record', () => {
  it('records an acceptance with a timestamp and the current version', () => {
    const record = acceptConsent();

    expect(record.version).toBe(CONSENT_VERSION);
    expect(record.method).toBe('accept');
    expect(Number.isNaN(Date.parse(record.decidedAt))).toBe(false);
    expect(hasAcceptedConsent()).toBe(true);
  });

  it('reverses a decision on withdrawal', () => {
    acceptConsent();
    expect(hasAcceptedConsent()).toBe(true);

    const record = withdrawConsent();

    expect(record.method).toBe('withdraw');
    // The reversal is retained rather than deleted, so an audit can show that
    // consent was given and later withdrawn.
    expect(readConsent()?.method).toBe('withdraw');
    expect(hasAcceptedConsent()).toBe(false);
  });

  it('does not count consent recorded against an older policy version', () => {
    // A record from before a material policy change no longer represents
    // agreement with the current text, so the notice must reappear.
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: CONSENT_VERSION - 1,
        decidedAt: new Date().toISOString(),
        method: 'accept',
      }),
    );

    expect(hasAcceptedConsent()).toBe(false);
  });

  it('treats the old bare "accepted" value as no decision', () => {
    // The previous implementation wrote the literal string 'accepted'. It is
    // not JSON, so it cannot be read as a record and must not be trusted.
    localStorage.setItem(STORAGE_KEY, 'accepted');

    expect(readConsent()).toBeNull();
    expect(hasAcceptedConsent()).toBe(false);
  });
});

describe('CookieConsentBanner', () => {
  it('shows the notice on a dashboard route, not only the landing page', () => {
    // Regression: the notice lived in LandingPage, so a user who opened /login
    // directly never saw it and could never record a decision.
    renderBanner('/dashboard');

    expect(screen.getByText('Your privacy')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Got it' })).toBeInTheDocument();
  });

  it('persists acceptance and stops showing across a remount', async () => {
    const first = renderBanner('/');
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    first.unmount();

    expect(localStorage.getItem(STORAGE_KEY)).toContain('"method":"accept"');

    renderBanner('/');
    expect(screen.queryByText('Your privacy')).not.toBeInTheDocument();
  });

  it('stays hidden while a blocking security surface is showing', () => {
    // The forced-password gate and MFA challenge are the only routes out of a
    // lockout; a privacy panel over them can cover the control the user needs.
    setBlockingSurface('credential-gate');

    renderBanner('/');

    expect(screen.queryByText('Your privacy')).not.toBeInTheDocument();
  });

  it('stands down on the cookie policy page, which hosts the controls', () => {
    renderBanner('/cookies');
    expect(screen.queryByText('Your privacy')).not.toBeInTheDocument();
  });

  it('stands down on the password reset flow', () => {
    renderBanner('/reset-password');
    expect(screen.queryByText('Your privacy')).not.toBeInTheDocument();
  });

  it('does not record a decision when dismissed with Escape', async () => {
    // Dismissal is not agreement. Only the explicit buttons may write a record.
    renderBanner('/');

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('exposes the notice to assistive technology', () => {
    renderBanner('/');

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAccessibleName('Your privacy');
    expect(dialog).toHaveAccessibleDescription(/does not use tracking or advertising cookies/);
  });
});

describe('CookieConsentManager', () => {
  function renderManager() {
    return render(
      <MemoryRouter>
        <CookieConsentManager />
      </MemoryRouter>,
    );
  }

  it('reports no decision before the notice is answered', () => {
    renderManager();
    expect(screen.getByTestId('consent-status')).toHaveTextContent(
      'Local storage notice not accepted.',
    );
    expect(screen.getByRole('button', { name: 'Withdraw consent' })).toBeDisabled();
  });

  it('lets a user withdraw a decision they previously made', async () => {
    acceptConsent();
    renderManager();

    await waitFor(() =>
      expect(screen.getByTestId('consent-status')).toHaveTextContent('accepted.'),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw consent' }));

    expect(screen.getByTestId('consent-status')).toHaveTextContent(
      'Local storage notice not accepted.',
    );
    expect(readConsent()?.method).toBe('withdraw');
  });

  it('discloses the stored items rather than asserting essential-only storage', () => {
    // The old notice claimed only essential session data was kept, but the app
    // also persists role, tenant, tab and cached-figure keys. The disclosure has
    // to match the code.
    renderManager();

    const list = screen.getByText('What is actually stored in your browser');
    expect(list).toBeInTheDocument();
    expect(screen.getByText(/user_role/)).toBeInTheDocument();
    expect(screen.getByText(/branch_dashboard_stats/)).toBeInTheDocument();
    expect(screen.getAllByText('Preference').length).toBeGreaterThan(0);
  });
});
