import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Guards the Express tenant middleware against modules it cannot see.
 *
 * `main.ts` applies a `pawnshop-id` requirement to a hand-maintained list of
 * path prefixes, and short-circuits with a 400 before Nest routing happens. A
 * new module that is not on that list is therefore *completely unreachable* -
 * every request 400s, authenticated or not, and nothing in the unit suite or a
 * type check notices, because neither of them loads `main.ts`.
 *
 * That is exactly what happened to `/decision-support`: the routes compiled, the
 * tests passed, the deploy succeeded, and every call returned
 * `"Missing pawnshop-id header"`.
 *
 * This test enumerates every `@Controller('...')` prefix in the source tree and
 * requires each one to be either covered by the tenant guard, explicitly
 * public, or acknowledged in `KNOWN_UNGUARDED` with a reason. Adding a module
 * without deciding which of the three it is now fails here.
 */

// This spec lives at src/common/guards/, so the source root is two levels up.
const SRC = join(__dirname, '..', '..');

/** Mirrors `operationalPrefixes` in main.ts. Keep both in step deliberately. */
const TENANT_GUARDED_PREFIXES = [
  '/analytics',
  '/auction',
  '/decision-support',
  '/finance',
  '/payroll',
  '/compliance',
  '/queue',
  '/notifications',
  '/attendance',
  '/loan',
  '/loans',
];

/**
 * Routes that legitimately have no tenant header, each with the reason. A new
 * entry needs a justification, not just a path.
 */
const KNOWN_UNGUARDED: Record<string, string> = {
  '': 'root / health / version probes, no tenant data',
  '/auth': 'authentication entry points, the tenant is not known until sign-in',
  '/security': 'credential and MFA flows, reachable pre- and post-authentication',
  '/branding': 'public tenant branding, deliberately readable before sign-in',
  '/reviews': 'public review feed and submission, no tenant data returned',
  '/receipts': 'tenant-scoped in the controller; the download route is signed',
  '/subscriptions': 'public plan catalogue and provider webhooks',
  '/customers': 'duplicate check, gated on pawn_ticket.create and tenant-scoped',
  '/healthz': 'liveness probe',
  '/health': 'liveness probe',
  // The public half of the pawn application flow. `GET /public/pawn/branches`,
  // `POST /public/pawn/quote`, `POST /public/pawn/reservations`,
  // `GET /public/pawn/reservations/:reference` and `POST /public/pawn/uploads`
  // are `@Public()` by necessity — a prospective pawner has no account, which is
  // the entire reason the flow exists. They are all rate limited, and a pawner
  // has no tenant header because they belong to no tenant.
  //
  // The sixth route, `GET /public/pawn/reservations`, is the shop-side queue. It
  // is permission-gated and resolves the tenant from `req.user`, so a
  // `?pawnshopId=` may only narrow the read and only for SUPER_ADMIN.
  '/public/pawn': 'applicant routes are unauthenticated by necessity; the shop-side queue is scoped to req.user',
};

/**
 * Modules that are **not yet reviewed**, as opposed to deliberately unguarded.
 *
 * This list was produced by this test on its first run, and it is a real
 * finding rather than a bookkeeping entry: these controllers have tenant-scoped
 * data but are not on the `operationalPrefixes` list, so the Express guard does
 * not apply to them. They are not necessarily exploitable - most scope by
 * `req.user` in the controller - but the second, independent check is missing.
 *
 * They are listed separately so that "unreviewed" never silently becomes
 * "accepted". Each needs a decision: add it to the guard, or confirm that
 * controller-level scoping is the intended and sufficient control. Tracked in
 * AUDIT.md. Do not move an entry into KNOWN_UNGUARDED without that decision.
 */
const PENDING_REVIEW: Record<string, string> = {
  '/approval-queue': 'approval decisions gate redemption; confirm controller scoping is sufficient',
  '/contracts': 'loan contracts are legal documents holding customer data',
  '/kyc': 'customer KYC records are personal data',
  '/payment-methods': 'stored payment instruments',
  '/profile': 'user profile and identity records',
  '/tenant-governance': 'platform-operator surface, expected to be role-gated rather than tenant-gated',
};

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist') continue;
      walk(full, out);
    } else if (entry.endsWith('.controller.ts') && !entry.endsWith('.spec.ts')) {
      out.push(full);
    }
  }
  return out;
}

describe('tenant guard covers every controller', () => {
  const mainSource = readFileSync(join(SRC, 'main.ts'), 'utf8');

  it('keeps the list in this test in step with main.ts', () => {
    // If someone edits main.ts and forgets this test, the tripwire is worthless.
    const block = mainSource.match(/const operationalPrefixes = \[([\s\S]*?)\]/);
    expect(block).not.toBeNull();
    const inMain = [...(block![1].matchAll(/'([^']+)'/g))].map((m) => m[1]).sort();
    expect([...TENANT_GUARDED_PREFIXES].sort()).toEqual(inMain);
  });

  it('guards or explicitly accounts for every controller prefix', () => {
    const prefixes = new Set<string>();

    for (const file of walk(SRC)) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(/@Controller\(\s*'([^']*)'\s*\)/g)) {
        prefixes.add(match[1]);
      }
    }

    expect(prefixes.size).toBeGreaterThan(5);

    // main.ts writes its prefixes with a leading slash; @Controller does not.
    // Normalise both sides so the comparison is about the path, not the syntax.
    const guards = TENANT_GUARDED_PREFIXES.map((p) => p.replace(/^\//, ''));
    const knownUnguarded = new Set(
      Object.keys(KNOWN_UNGUARDED).map((p) => p.replace(/^\//, '')),
    );
    const pending = new Set(
      Object.keys(PENDING_REVIEW).map((p) => p.replace(/^\//, '')),
    );

    const uncovered: string[] = [];
    const reviewed: string[] = [];
    for (const prefix of prefixes) {
      if (knownUnguarded.has(prefix)) continue;
      const guarded = guards.some(
        (guard) => prefix === guard || prefix.startsWith(`${guard}/`),
      );
      if (guarded) continue;
      if (pending.has(prefix)) {
        reviewed.push(prefix);
        continue;
      }
      uncovered.push(prefix);
    }

    if (uncovered.length) {
      throw new Error(
        `Controller prefixes with no tenant guard and no entry in KNOWN_UNGUARDED or PENDING_REVIEW: ${uncovered.join(', ')}.\n` +
          `Add the prefix to operationalPrefixes in main.ts and to TENANT_GUARDED_PREFIXES here, ` +
          `or account for it in one of the two lists with a reason.`,
      );
    }
    expect(uncovered).toEqual([]);

    // Surfaced rather than silently absorbed, so the outstanding review stays
    // visible every time the suite runs.
    if (reviewed.length) {
      // eslint-disable-next-line no-console
      console.warn(
        `[tenant-guard] ${reviewed.length} module(s) await a tenant-guard decision: ${reviewed.join(', ')}`,
      );
    }
  });

  it('covers the decision-support routes that were unreachable', () => {
    // The specific regression: these 400d for every caller until the prefix was
    // added to operationalPrefixes.
    expect(TENANT_GUARDED_PREFIXES).toContain('/decision-support');
  });
});
