import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  acceptConsent,
  getConsentSnapshot,
  subscribeConsent,
  CONSENT_VERSION,
} from '../lib/cookieConsent';
import {
  getBlockingSurface,
  subscribeBlockingSurface,
} from '../lib/blockingSurface';

const TITLE_ID = 'cookie-notice-title';
const BODY_ID = 'cookie-notice-body';

/**
 * Routes the notice must stay off.
 *
 * `reset-password` and the recovery surfaces are security flows the user is
 * mid-way through; interrupting them with a marketing panel is hostile. The
 * credential gate is handled separately via `blockingSurface`, because it is not
 * a route but a state. `/cookies` is excluded because that page now hosts the
 * consent controls themselves, and a notice overlapping the control that changes
 * the notice is self-defeating.
 */
const SUPPRESSED_ROUTES = new Set(['/cookies', '/reset-password']);

function isRecoveryIntent(pathname: string, search: string): boolean {
  if (pathname === '/reset-password') return true;
  const params = new URLSearchParams(search);
  return (
    params.has('token_hash') ||
    params.has('code') ||
    params.has('access_token') ||
    params.has('error_code')
  );
}

export function CookieConsentBanner() {
  const location = useLocation();
  const accepted = useSyncExternalStore(
    subscribeConsent,
    getConsentSnapshot,
    () => false,
  );
  const blockingSurface = useSyncExternalStore(
    subscribeBlockingSurface,
    getBlockingSurface,
    () => 'none' as const,
  );

  const acceptRef = useRef<HTMLButtonElement>(null);
  const [justAccepted, setJustAccepted] = useAnnouncementTick();

  const handleAccept = useCallback(() => {
    acceptConsent();
    setJustAccepted();
  }, [setJustAccepted]);

  const suppressed =
    SUPPRESSED_ROUTES.has(location.pathname) ||
    isRecoveryIntent(location.pathname, location.search);

  // Deliberately no Escape handler. Escape would read as "dismiss", and
  // dismissing this panel must not silently record agreement the user never
  // expressed. The two buttons are the only ways to decide.
  useEffect(() => {
    if (justAccepted) return;
    if (accepted || suppressed || blockingSurface !== 'none') return;
    // Non-modal, so focus is not trapped, but landing on the primary action
    // means a keyboard user can clear the notice without hunting for it.
    acceptRef.current?.focus();
  }, [accepted, suppressed, blockingSurface, justAccepted]);

  if (accepted || suppressed || blockingSurface !== 'none') return null;

  return (
    <div
      className="fixed bottom-4 left-4 right-4 z-[110] sm:right-auto sm:max-w-sm"
      role="dialog"
      aria-labelledby={TITLE_ID}
      aria-describedby={BODY_ID}
    >
      <div
        className="rounded-[16px] p-5"
        style={{
          background: 'rgba(20,20,27,0.98)',
          border: '1px solid rgba(201,160,92,0.2)',
          boxShadow: '0 24px 64px rgba(0,0,0,0.5)',
        }}
      >
        <p
          id={TITLE_ID}
          className="text-[13px] font-semibold"
          style={{ color: 'var(--text-primary)' }}
        >
          Your privacy
        </p>
        <p
          id={BODY_ID}
          className="mt-1.5 text-[12px] leading-relaxed"
          style={{ color: 'var(--text-secondary)' }}
        >
          PawnGold does not use tracking or advertising cookies. We store only the
          items listed in our{' '}
          <Link to="/cookies" className="underline" style={{ color: 'var(--gold)' }}>
            Cookie Policy
          </Link>{' '}
          so you can sign in and keep your preferences. You can change this decision
          at any time from that page.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            ref={acceptRef}
            type="button"
            onClick={handleAccept}
            className="rounded-[10px] px-4 py-2 text-[12px] font-semibold transition-all active:scale-[0.97]"
            style={{
              background: 'linear-gradient(135deg, #C9A05C 0%, #A07D40 100%)',
              color: '#0A0A0F',
              border: '1px solid rgba(201,160,92,0.45)',
            }}
          >
            Got it
          </button>
          <Link
            to="/cookies"
            className="rounded-[10px] px-4 py-2 text-[12px] font-medium transition-all"
            style={{
              border: '1px solid rgba(255,255,255,0.1)',
              color: 'var(--text-secondary)',
            }}
          >
            Learn more
          </Link>
        </div>
        <p className="mt-3 text-[11px]" style={{ color: 'var(--text-dim)' }}>
          Policy version {CONSENT_VERSION}
        </p>
      </div>
    </div>
  );
}

/** Sets a one-shot flag so the focus effect does not steal focus back after the
 *  user accepts and the panel unmounts on a later render. */
function useAnnouncementTick(): [boolean, () => void] {
  const [value, setValue] = useState(0);
  const bump = useCallback(() => setValue((n) => n + 1), []);
  return [value > 0, bump];
}
