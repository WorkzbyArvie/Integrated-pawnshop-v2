/**
 * Cookie / local-storage consent.
 *
 * The previous implementation stored the bare string `'accepted'` in
 * `localStorage`, read it from a `useState` initialiser inside `LandingPage`, and
 * offered no way to reverse the decision. That produced four real defects:
 *
 *   1. The notice was reachable only from the landing page. A user who opened
 *      `/login` or any dashboard route directly never saw it and so could never
 *      record a decision.
 *   2. Consent could not be withdrawn once given. Nothing in the app cleared the
 *      key, so the notice became irreversible.
 *   3. The stored value carried no timestamp and no policy version, so there was
 *      no consent record to point at in an audit, and no way to re-prompt after
 *      the policy changed.
 *   4. The banner asserted that only essential session data is stored, but
 *      nothing tied that claim to the code. `STORAGE_INVENTORY` below is the
 *      disclosure the notice and the Cookie Policy actually render from, so the
 *      claim is verifiable rather than decorative.
 */

/**
 * Bump when the Cookie Policy materially changes. A stored record from an older
 * version no longer counts as consent, so the notice reappears for existing
 * users instead of silently carrying forward a decision they never made against
 * the new text.
 */
export const CONSENT_VERSION = 2;

const STORAGE_KEY = 'pawngold_cookie_consent';

export interface CookieConsentRecord {
  /** Policy version the user agreed to. */
  version: number;
  /** ISO-8601 timestamp of the decision. */
  decidedAt: string;
  /** `accept` records a decision; `withdraw` is kept so a reversal is auditable. */
  method: 'accept' | 'withdraw';
}

/**
 * What the app actually persists in the browser, grouped by purpose. This is
 * the single source for both the notice and section 2 of the Cookie Policy, so
 * the two cannot drift apart.
 */
export const STORAGE_INVENTORY: ReadonlyArray<{
  purpose: string;
  items: readonly string[];
  essential: boolean;
}> = [
  {
    purpose: 'Keeping you signed in',
    items: ['Supabase session tokens', 'MFA assertion for the current session'],
    essential: true,
  },
  {
    purpose: 'Remembering which branch or shop you are acting for',
    items: ['active_pawnshop_id', 'active_branch_id', 'user_role', 'user_email'],
    essential: false,
  },
  {
    purpose: 'Remembering interface preferences',
    items: ['active_tab', 'app_perspective'],
    essential: false,
  },
  {
    purpose: 'Caching summary figures for a faster dashboard',
    items: ['branch_dashboard_stats'],
    essential: false,
  },
  {
    purpose: 'Remembering that you dismissed this notice',
    items: [STORAGE_KEY],
    essential: false,
  },
];

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    // Private-mode or blocked storage. The notice still works for the session;
    // it just cannot be remembered, so it reappears next visit.
    return null;
  }
}

export function readConsent(): CookieConsentRecord | null {
  const raw = storage()?.getItem(STORAGE_KEY);
  if (!raw) return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const record = parsed as Partial<CookieConsentRecord>;
    if (typeof record.version !== 'number') return null;
    if (record.method !== 'accept' && record.method !== 'withdraw') return null;
    if (typeof record.decidedAt !== 'string') return null;
    return {
      version: record.version,
      decidedAt: record.decidedAt,
      method: record.method,
    };
  } catch {
    // A value written by the old implementation (`'accepted'`) is not JSON, so it
    // fails here and is treated as no decision. Returning null re-prompts once
    // rather than trusting an unreadable record.
    return null;
  }
}

/** True only for a current-version record that was accepted, not withdrawn. */
export function hasAcceptedConsent(): boolean {
  const record = readConsent();
  return record?.method === 'accept' && record.version === CONSENT_VERSION;
}

function write(record: CookieConsentRecord): void {
  try {
    storage()?.setItem(STORAGE_KEY, JSON.stringify(record));
  } catch {
    // A full or unavailable quota must not break the decision for this visit.
  }
}

export function acceptConsent(): CookieConsentRecord {
  const record: CookieConsentRecord = {
    version: CONSENT_VERSION,
    decidedAt: new Date().toISOString(),
    method: 'accept',
  };
  write(record);
  notify();
  return record;
}

/**
 * Reverse a previous decision.
 *
 * The record is retained as a `withdraw` entry rather than deleted. An audit
 * needs to show that consent was given and later withdrawn; erasing the key
 * would leave no record of either. Only the latest entry is authoritative, so
 * re-accepting afterwards simply overwrites it.
 */
export function withdrawConsent(): CookieConsentRecord {
  const record: CookieConsentRecord = {
    version: CONSENT_VERSION,
    decidedAt: new Date().toISOString(),
    method: 'withdraw',
  };
  write(record);
  notify();
  return record;
}

/* ------------------------------------------------------------------ *
 * Change notification
 *
 * The notice is mounted once, above the router's routes, so it cannot read
 * another component's state. A tiny subscription keeps every mounted copy in
 * step, which is what makes a withdrawal taken on the Cookie Policy page close
 * the notice immediately instead of at the next reload.
 * ------------------------------------------------------------------ */

const listeners = new Set<() => void>();

/** Drops the memoised snapshot, then wakes subscribers. Order matters: a
 *  subscriber that read the snapshot before the cache was cleared would be handed
 *  the previous value and `useSyncExternalStore` would keep the stale result. */
function notify(): void {
  cachedSnapshot = null;
  for (const listener of listeners) listener();
}

export function subscribeConsent(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Keeps open tabs in step.
 *
 * The memoised snapshot below is only invalidated by this tab calling accept or
 * withdraw, so a decision made in a second tab would otherwise leave this one
 * showing a stale notice until reload. The `storage` event fires in every *other*
 * document on the origin, which is exactly the gap to close.
 */
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('storage', (event) => {
    if (event.key !== null && event.key !== STORAGE_KEY) return;
    notify();
  });
}

/** Memoised read. `useSyncExternalStore` requires a referentially stable value
 *  between notifications, so this may not simply re-read storage every render. */
let cachedSnapshot: boolean | null = null;

/** Forces the next snapshot read to hit storage. Needed whenever storage is
 *  changed without going through this module, including test setup. */
export function invalidateConsentSnapshot(): void {
  cachedSnapshot = null;
}

/** Re-reads on demand; used as the `useSyncExternalStore` snapshot. */
export function getConsentSnapshot(): boolean {
  if (cachedSnapshot === null) cachedSnapshot = hasAcceptedConsent();
  return cachedSnapshot;
}
