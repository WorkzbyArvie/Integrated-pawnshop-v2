import fs from 'fs';
import path from 'path';

/**
 * Row Level Security containment for the last six tables.
 *
 * These assertions read the migration as source rather than querying a live
 * database, so they run in CI and cannot be satisfied by a policy that only
 * exists in someone's Supabase session. The live check is the verification
 * block at the bottom of the migration itself; this spec is the tripwire.
 *
 * The browser no longer reads `customer`, `ticket`, `pawnshops`, `branch` or
 * `loan_applications` - every such read moved behind the backend in commits
 * c8c9409..c8447a7 - so those five tables must end up with RLS on and no policy
 * at all. `profiles` keeps one row-scoped UPDATE policy for the presence
 * heartbeat, paired with a column-scoped grant so a user cannot promote their
 * own role.
 */

const TABLES = ['customer', 'ticket', 'pawnshops', 'branch', 'loan_applications', 'profiles'];
const FULLY_LOCKED = TABLES.filter((t) => t !== 'profiles');

const MIGRATION =
  'prisma/migrations/20260929140000_lock_last_six_tables/migration.sql';

/**
 * The presence-heartbeat grant ships as a follow-up migration rather than an edit
 * to the lock, so the lock's own checksum stays stable and the two changes can be
 * applied independently. It is concatenated here so the assertions below see one
 * body: a `REVOKE ALL` in the lock and a later narrow `GRANT` are the same
 * statement sequence, and reading only the first file would assert against a
 * half-applied policy set.
 */
const FOLLOW_UP_MIGRATIONS = [
  'prisma/migrations/20260929150000_profiles_presence_heartbeat_grant/migration.sql',
];

const sql = [
  MIGRATION,
  ...FOLLOW_UP_MIGRATIONS,
]
  .map((m) => fs.readFileSync(path.join(__dirname, '..', m), 'utf8'))
  .join('\n');

/** Statements with SQL comments and string literals stripped. */
const stripped = sql
  .replace(/--[^\n]*/g, '')
  .replace(/'[^']*'/g, "''");

const createdPolicies = [...stripped.matchAll(/CREATE\s+POLICY\s+"?([\w]+)"?\s+ON\s+([\w.]+)([\s\S]*?);/gi)]
  .map((m) => ({
    name: m[1],
    table: m[2].replace(/^public\./, ''),
    body: m[3],
  }));

const droppedPolicies = [...stripped.matchAll(/DROP\s+POLICY\s+IF\s+EXISTS\s+"?([\w]+)"?\s+ON\s+([\w.]+)/gi)]
  .map((m) => m[1]);

const policiesFor = (table: string) => createdPolicies.filter((p) => p.table === table);

const alters = (table: string, kind: 'ENABLE' | 'FORCE') =>
  new RegExp(`ALTER\\s+TABLE\\s+(?:public\\.)?${table}\\s+${kind}\\s+ROW\\s+LEVEL\\s+SECURITY`, 'i').test(
    stripped,
  );

describe('RLS migration — the last six tables', () => {
  describe.each(TABLES)('%s', (table) => {
    it('enables row level security', () => {
      expect(alters(table, 'ENABLE')).toBe(true);
    });

    it('forces row level security so the table owner is also subject to it', () => {
      // FORCE matters: without it the table owner bypasses every policy. The
      // backend is unaffected because postgres/supabase_admin have
      // rolbypassrls = true, which overrides FORCE.
      expect(alters(table, 'FORCE')).toBe(true);
    });

    it('drops every policy that previously existed on it', () => {
      // A surviving pre-existing policy is the failure mode this whole change
      // exists to prevent, so each one is named explicitly rather than swept.
      const prior = policiesFor(table);
      for (const policy of prior) {
        expect(droppedPolicies).toContain(policy.name);
      }
    });
  });

  describe.each(FULLY_LOCKED)('%s has no browser access at all', (table) => {
    it('creates no policy for it', () => {
      expect(policiesFor(table)).toEqual([]);
    });

    it('revokes all privileges from anon and authenticated', () => {
      const revoke = new RegExp(
        `REVOKE\\s+ALL\\s+ON\\s+(?:public\\.)?${table}\\s+FROM\\s+anon\\s*,\\s*authenticated`,
        'i',
      );
      expect(revoke.test(stripped)).toBe(true);
    });
  });

  describe('no policy anywhere grants a blanket read on the locked tables', () => {
    // The specific mistake this guards against is a policy written as
    // `USING (true)`, which looks correct in review and is a full data leak.
    it.each(FULLY_LOCKED)('%s has no USING (true) policy', (table) => {
      for (const policy of policiesFor(table)) {
        expect(policy.body).not.toMatch(/USING\s*\(\s*true\s*\)/i);
      }
    });

    it('creates no policy for the anon role on any of the six', () => {
      for (const policy of createdPolicies) {
        expect(policy.body).not.toMatch(/\bTO\s+anon\b/i);
      }
    });
  });

  describe('profiles keeps exactly the presence heartbeat', () => {
    it('creates only the own-row update policy', () => {
      expect(policiesFor('profiles').map((p) => p.name)).toEqual(['profiles_update_own']);
    });

    it('scopes that policy to the caller own row', () => {
      const [policy] = policiesFor('profiles');
      expect(policy.body).toMatch(/FOR\s+UPDATE/i);
      expect(policy.body).toMatch(/USING\s*\(\s*id\s*=\s*auth\.uid\(\)\s*\)/i);
      // WITH CHECK matters: without it a row could be re-pointed at another id.
      expect(policy.body).toMatch(/WITH\s+CHECK\s*\(\s*id\s*=\s*auth\.uid\(\)\s*\)/i);
    });

    it('creates no read policy, because the browser has no read path left', () => {
      // Session bootstrap, staff roster and owner status all resolve server-side
      // now, so granting a read here would be giving back ground the code gave up.
      for (const policy of policiesFor('profiles')) {
        expect(policy.body).not.toMatch(/FOR\s+SELECT/i);
      }
    });

    // A row policy alone still permits updating any column of your own row,
    // which includes `role`. Without the column-scoped grant a signed-in STAFF
    // could set their own role to OWNER and satisfy every @Roles() check.
    it('grants update on the presence columns only', () => {
      expect(
        /GRANT\s+UPDATE\s*\(\s*is_online\s*,\s*last_seen_at\s*\)\s+ON\s+(?:public\.)?profiles\s+TO\s+authenticated/i.test(
          stripped,
        ),
      ).toBe(true);
    });

    it('does not grant a blanket update on profiles', () => {
      expect(
        /GRANT\s+ALL\s+ON\s+(?:public\.)?profiles\s+TO\s+authenticated/i.test(stripped),
      ).toBe(false);
    });

    it('keeps the presence columns out of an unconstrained grant', () => {
      const grants = [...stripped.matchAll(/GRANT\s+UPDATE\s*\(([^)]*)\)\s+ON\s+[^;]*profiles[^;]*TO\s+(\w+)/gi)];
      expect(grants.length).toBeGreaterThan(0);
      for (const [, columns, grantee] of grants) {
        expect(grantee).toBe('authenticated');
        const allowed = columns.split(',').map((c) => c.trim().toLowerCase());
        expect(allowed.sort()).toEqual(['is_online', 'last_seen_at']);
        // `role`, `pawnshop_id` and `branch_id` are the escalation columns.
        expect(allowed).not.toContain('role');
        expect(allowed).not.toContain('pawnshop_id');
        expect(allowed).not.toContain('staff_type');
      }
    });

    // The heartbeat grant.
    //
    // `profiles_update_own` qualifies on `id = auth.uid()`. A Postgres UPDATE
    // policy is evaluated by reading the row it is deciding about, and
    // `REVOKE ALL` left `authenticated` unable to read `id`, so the policy could
    // not be evaluated and every presence write was refused with a 403 that no
    // user would ever see. `GRANT SELECT (id)` is the minimum that makes the
    // existing policy evaluable.
    //
    // It is a read of the caller's own identifier and nothing else. It does not
    // reopen the breach the lock closed: it cannot enumerate rows, and the policy
    // pins the row to `auth.uid()`. The thing that must not come back is a read
    // or write of `role` - that is what would let a STAFF satisfy @Roles().
    it('grants select on the id column so the update policy can be evaluated', () => {
      expect(
        /GRANT\s+SELECT\s*\(\s*id\s*\)\s+ON\s+(?:public\.)?profiles\s+TO\s+authenticated/i.test(
          stripped,
        ),
      ).toBe(true);
    });

    it('never grants a blanket select on profiles', () => {
      expect(
        /GRANT\s+ALL\s+ON\s+(?:public\.)?profiles\s+TO\s+authenticated/i.test(stripped),
      ).toBe(false);
      expect(
        /GRANT\s+SELECT\s+ON\s+(?:public\.)?profiles\s+TO\s+authenticated/i.test(
          stripped,
        ),
      ).toBe(false);
    });

    it('keeps role unreadable by authenticated', () => {
      const selectGrants = [
        ...stripped.matchAll(
          /GRANT\s+SELECT\s*\(([^)]*)\)\s+ON\s+[^;]*profiles[^;]*TO\s+(\w+)/gi,
        ),
      ];
      expect(selectGrants.length).toBeGreaterThan(0);
      for (const [, columns, grantee] of selectGrants) {
        expect(grantee).toBe('authenticated');
        const allowed = columns.split(',').map((c) => c.trim().toLowerCase());
        expect(allowed.sort()).toEqual(['id']);
        // Reading roles across the platform is the enumeration path back in.
        expect(allowed).not.toContain('role');
        expect(allowed).not.toContain('email');
        expect(allowed).not.toContain('pawnshop_id');
        expect(allowed).not.toContain('full_name');
      }
    });
  });

  describe('helper functions', () => {
    // A policy on `profiles` that subqueries `profiles` recurses (PostgreSQL
    // 42P17). The functions must be SECURITY DEFINER to break that cycle.
    it('recreates get_my_role as SECURITY DEFINER', () => {
      expect(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.get_my_role\(\)/i.test(stripped)).toBe(true);
      expect(/get_my_role\(\)[\s\S]*?SECURITY\s+DEFINER/i.test(stripped)).toBe(true);
    });

    it('recreates get_my_pawnshop_id as SECURITY DEFINER', () => {
      expect(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.get_my_pawnshop_id\(\)/i.test(stripped)).toBe(true);
      expect(/get_my_pawnshop_id\(\)[\s\S]*?SECURITY\s+DEFINER/i.test(stripped)).toBe(true);
    });

    it('pins a search_path so the definer functions cannot be hijacked', () => {
      const fns = [...stripped.matchAll(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.get_my_\w+\(\)[\s\S]*?\$\$/gi)];
      expect(fns.length).toBeGreaterThanOrEqual(2);
      for (const [body] of fns) {
        expect(body).toMatch(/SET\s+search_path\s*=\s*public/i);
      }
    });
  });

  describe('deployment safety', () => {
    it('does not open its own transaction, because Prisma already has one', () => {
      // Previously this asserted the opposite: that a BEGIN was present, so a
      // failure would leave nothing half-applied.
      //
      // Prisma wraps every migration in a transaction on PostgreSQL, so a nested
      // BEGIN is at best a no-op and at worst commits Prisma's transaction
      // before its bookkeeping runs. The cost was concrete rather than
      // theoretical: a deploy failed reporting "current transaction is aborted,
      // commands ignored until end of transaction block" when the real error was
      // a column that did not exist. An aborted transaction reports the abort,
      // not the cause, and Prisma logs what Postgres said last - so the nested
      // wrapper cost an hour of diagnosis by hiding the cause of its own failure.
      //
      // Atomicity is still guaranteed. It is now Prisma's transaction rather than
      // a second one, and that is the one that actually governs.
      expect(stripped).not.toMatch(/^\s*BEGIN\s*;/m);
      expect(stripped).not.toMatch(/^\s*COMMIT\s*;/m);
    });

    it('documents the realtime consequence of locking ticket', () => {
      // Dashboard.tsx subscribes to postgres_changes on `ticket`. Supabase
      // applies RLS to realtime subscribers, so that subscription goes quiet.
      // Whoever deploys this needs to be told rather than left to discover it.
      expect(sql).toMatch(/Realtime behaviour change/i);
      expect(sql).toMatch(/postgres_changes/);
    });

    it('includes a rollback path', () => {
      expect(sql).toMatch(/ROLLBACK/i);
    });
  });
});
