/**
 * Tracks whether a blocking security surface is on screen.
 *
 * The credential preflight surfaces (status unavailable, forced password change)
 * take over the whole viewport and are the only route by which a locked-out user
 * can get back in. The cookie notice is mounted above the router so it can reach
 * every route, which means it would otherwise float over those screens and could
 * sit on top of the form or the sign-out control the user needs.
 *
 * `App` reports the active surface here; the notice subscribes and stands down.
 * Kept deliberately tiny and dependency-free so it can be imported from either
 * side without a cycle.
 */

export type BlockingSurface = 'none' | 'credential-gate';

let current: BlockingSurface = 'none';

const listeners = new Set<() => void>();

export function setBlockingSurface(next: BlockingSurface): void {
  if (current === next) return;
  current = next;
  for (const listener of listeners) listener();
}

export function subscribeBlockingSurface(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Referentially stable primitive, so it is safe as a `useSyncExternalStore`
 *  snapshot: equality is by value, not identity. */
export function getBlockingSurface(): BlockingSurface {
  return current;
}

/** Test-only reset so each test starts from a known state. */
export function resetBlockingSurface(): void {
  setBlockingSurface('none');
}
