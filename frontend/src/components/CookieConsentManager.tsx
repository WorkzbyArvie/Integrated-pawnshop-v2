import { useSyncExternalStore } from 'react';
import {
  acceptConsent,
  getConsentSnapshot,
  readConsent,
  subscribeConsent,
  withdrawConsent,
  CONSENT_VERSION,
  STORAGE_INVENTORY,
} from '../lib/cookieConsent';

/**
 * Consent controls for the Cookie Policy page.
 *
 * This is what makes the notice reversible. Previously `pawngold_cookie_consent`
 * was written once and never cleared by anything in the app, so a decision could
 * only be undone by clearing site data in browser settings. That is not a
 * withdrawal mechanism a user can find, and it left the notice unable to honour a
 * request to stop.
 *
 * It also renders the storage inventory, so section 2 of the policy and this
 * control describe the same list. The claim that only essential data is kept is
 * checked against `STORAGE_INVENTORY` rather than asserted in prose, which is
 * what a panel would otherwise have to take on trust.
 */
export function CookieConsentManager() {
  const accepted = useSyncExternalStore(
    subscribeConsent,
    getConsentSnapshot,
    () => false,
  );
  const record = readConsent();

  const decided = record
    ? `${record.method === 'accept' ? 'Accepted' : 'Withdrawn'} on ${new Date(
        record.decidedAt,
      ).toLocaleString()} (policy version ${record.version})`
    : 'No decision recorded yet.';

  return (
    <section
      className="mt-10 rounded-[16px] p-5"
      style={{ background: 'rgba(201,160,92,0.05)', border: '1px solid rgba(201,160,92,0.15)' }}
    >
      <h2
        className="text-[18px] font-bold tracking-tight"
        style={{ fontFamily: 'var(--font-display)', color: 'var(--gold)' }}
      >
        Your choice
      </h2>
      <p className="mt-2 text-[14px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
        You can accept or withdraw at any time. Withdrawing does not delete data
        held on our servers, and clearing local storage in your browser remains
        available as a separate option.
      </p>

      <p
        className="mt-4 rounded-[12px] px-4 py-3 text-[13px]"
        data-testid="consent-status"
        style={{ background: 'rgba(13,13,20,0.7)', color: 'var(--text-secondary)' }}
      >
        <span style={{ color: 'var(--text-dim)' }}>Status: </span>
        {accepted ? 'Local storage notice accepted.' : 'Local storage notice not accepted.'}
        <br />
        <span style={{ color: 'var(--text-dim)' }}>{decided}</span>
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => acceptConsent()}
          className="rounded-[10px] px-4 py-2 text-[13px] font-semibold transition-opacity hover:opacity-90"
          style={{
            background: 'linear-gradient(135deg, #C9A05C 0%, #A07D40 100%)',
            color: '#0A0A0F',
            border: '1px solid rgba(201,160,92,0.45)',
          }}
        >
          {accepted ? 'Re-accept' : 'Accept'}
        </button>
        <button
          type="button"
          onClick={() => withdrawConsent()}
          disabled={!accepted}
          className="rounded-[10px] px-4 py-2 text-[13px] font-medium transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
          style={{
            border: '1px solid rgba(255,255,255,0.12)',
            color: 'var(--text-secondary)',
          }}
        >
          Withdraw consent
        </button>
      </div>

      <h3 className="mt-8 text-[15px] font-semibold" style={{ color: 'var(--text-primary)' }}>
        What is actually stored in your browser
      </h3>
      <ul className="mt-3 space-y-3">
        {STORAGE_INVENTORY.map((entry) => (
          <li
            key={entry.purpose}
            className="rounded-[12px] p-4 text-[13px] leading-relaxed"
            style={{ background: 'rgba(13,13,20,0.7)', color: 'var(--text-secondary)' }}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span style={{ color: 'var(--text-primary)' }}>{entry.purpose}</span>
              <span
                className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
                style={
                  entry.essential
                    ? { background: 'rgba(201,160,92,0.12)', color: 'var(--gold)' }
                    : { background: 'rgba(255,255,255,0.06)', color: 'var(--text-dim)' }
                }
              >
                {entry.essential ? 'Essential' : 'Preference'}
              </span>
            </div>
            <div className="mt-1.5 font-mono text-[12px]" style={{ color: 'var(--text-dim)' }}>
              {entry.items.join(', ')}
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-[12px]" style={{ color: 'var(--text-dim)' }}>
        This notice applies to policy version {CONSENT_VERSION}. If the policy
        changes materially, the version increases and the notice is shown again so
        you can decide against the new text.
      </p>
    </section>
  );
}
