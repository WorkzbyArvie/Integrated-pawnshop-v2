# PawnGold — Session Handoff (end of 2026-09-29, session 2)

**Defense: 3rd week of October 2026.** Roughly two and a half weeks.
**HEAD at handoff:** `fecec05` — 7 commits on top of the previous handoff's
`5db6f10`. Working tree clean apart from unrelated `.planning/` edits.

Supersedes `5db6f10`'s handoff for the RLS work. Read section 1 first: the
previous handoff said this task was scoped; it was not.

---

## 1. What happened this session

Section 2a and 3 of the previous handoff are **code-complete and committed**. The
migration is written but **not applied** — see section 3.

The previous handoff listed 4 call sites to fix. The real number was **25**,
across 6 tables, and two of them were worse than anything documented:

| Site | Previous handoff | Reality |
|---|---|---|
| `CrmTable.tsx:89` | not mentioned | `customer.select('*')`, **zero filters** when no shop selected |
| `StaffMatrix.tsx:224` | not mentioned | `profiles.select('*')`, zero filters — every email on the platform |
| `App.tsx:1106` | not mentioned | `pawnshops.select('settings').limit(1)`, no WHERE, ran on every app load for Super Admin |
| `App.tsx:687`, `Login.tsx:64` | one entry | `profiles` looked up **by email** — an enumeration oracle |

Worse: the same class of bug already existed **in the backend**, where the handoff
did not look. `GET /customers`, `GET /customers/:id` and `GET /tickets` were
unguarded *and* unscoped — any authenticated profile could list every customer in
the platform, or fetch one by id across tenants, or list every ticket with each
customer's full row attached.

## 2. Commits

| Commit | Fix |
|---|---|
| `c8c9409` | `GET /customers`, `/customers/:id`, `/tickets` scoped to the caller's shop. New `PATCH /tickets/:id/description`. CrmTable + InventoryVault moved to the backend. |
| `ef8ad44` | `?pawnshopId` no longer beats the authenticated tenant on pending approvals. `GET /loan/applications` requires the caller's tenant. Redemption moved to the backend. |
| `30f5c6f` | StaffMatrix no longer reads every profile. New `GET /tenant-governance/staff`. |
| `36c4ebf` | The email-fallback oracle is gone. New `GET /profile/session-context`. SystemSettings + App branding moved to guarded endpoints. |
| `766af21` | Dashboard and BranchAnalytics stop trusting `?pawnshop=`. New `GET /analytics/branch-activity`. |
| `c8447a7` | Branch name resolved from the tenant-scoped branch list instead of by localStorage id. |
| `fecec05` | The RLS migration + 46 containment assertions. **Not applied.** |

Backend 867 tests across 55 suites, all green. Frontend 256 passing, tsc clean
both sides. Three pre-existing frontend failures remain (`kycDocs` ×2), still out
of scope and still not ours.

### One real bug fixed along the way

`BranchAnalytics.tsx` queried a table called `loan_application`. The table is
`loan_applications`. That read has been 404ing silently, so the loan count badge
has always read zero.

## 3. The migration is APPLIED and verified

Applied by hand in the Supabase SQL editor on 2026-09-29 (the agent has no
working DB credential — see section 8). Verified on the live project:

| Check | Result |
|---|---|
| RLS enabled **and** forced | all six tables `on=true force=true` |
| Policies on the six | exactly one: `profiles_update_own [UPDATE] roles={authenticated}` |
| anon / authenticated table grants | **zero rows** — hard-denied at the privilege layer |
| `authenticated` UPDATE columns on `profiles` | exactly two: `is_online`, `last_seen_at` |
| Backend unaffected | `customer=17 profiles=34 ticket=33` still readable as owner |

So the anon key is now blocked twice over: no table privilege *and* forced RLS.
`postgres`/`supabase_admin` have `rolbypassrls = true`, which overrides FORCE, so
the backend on Render is unaffected.

**Do not grant the anon role anything back.** Postgres emits a `HINT: Grant
SELECT ... TO anon` on any 42501. That hint is generic and applying it would
re-create the breach condition — RLS would still deny, but the only remaining
barrier would be a single policy someone could later drop.

## 3a. Still to do: deploy, in this order

**Backend to Render first, then the frontend to Vercel.** The new frontend calls
eight endpoints that do not exist on the deployed backend yet. Shipping the
frontend first breaks sign-in outright (`/profile/session-context` 404s), plus
the app shell, System Settings, Staff Matrix, Dashboard and Branch Analytics.

After deploying, check in this order — the first is the highest risk:

1. Sign in as an OWNER (depends on a brand-new endpoint).
2. Dashboard loads with non-zero counts. It will **stop live-updating** — that
   is the documented Realtime consequence, not a regression: the data now comes
   from `GET /analytics/branch-activity`.
3. Inventory Vault, Redemption, CRM, Staff Matrix, System Settings, Branch
   Analytics — the six surfaces moved to the backend.
4. Sign out and back in, then confirm someone shows as **Active**, not Offline.
   This is the one that would expose a mistake in the `profiles` column grant:
   if it were wrong, the presence heartbeat would fail silently and every user
   would look permanently offline.

## 4. Why the policy set is smaller than expected

The handoff assumed the six tables would need tenant-scoped SELECT policies for
the browser. They do not, because the code-side work removed every browser read.
So:

- `customer`, `ticket`, `pawnshops`, `branch`, `loan_applications` — **no policy
  at all.** Nothing in the browser touches them.
- `profiles` — one row-scoped UPDATE policy for the presence heartbeat, plus a
  column-scoped `GRANT UPDATE (is_online, last_seen_at)`.

That second half matters more than it looks. `USING (id = auth.uid())` permits
updating **any column of your own row**, including `role` — so without the
column-scoped grant, a signed-in STAFF could set their own role to OWNER and pass
every `@Roles()` check in the backend. The policy and the grant are both required;
neither is sufficient alone. There is a mutation test that fails if the grant ever
widens to include `role`.

## 5. Verification habits used

- **Every fix was mutation-tested.** Each commit's tests were re-run against
  deliberately broken versions of the code. 21 mutations total across the session;
  all caught. One initially "survived" — that turned out to be a bug in my
  mutation harness (a bare anchor matched the wrong call site), not a gap in the
  tests. Worth remembering that a SURVIVED verdict is a claim about the harness
  until proven otherwise.
- **The migration is asserted as source, not against a live DB.** 46 assertions
  in `backend/src/rls-containment.spec.ts` run in CI. Ten mutations that weaken
  the migration — drop FORCE, leave a stale policy, add `USING (true)`, drop
  `WITH CHECK`, widen the grant to `role`, remove `SECURITY DEFINER` — are all
  caught.

## 6. Tooling traps — two new ones, both cost real time

The previous handoff's list still stands. Five more:

8. **A mutation harness must restore in a `finally`, not after the loop.** An
   early throw once left `app.service.ts` holding a mutated `tenantId`, and the
   next `tsc` reported three unrelated type errors. Restoring from a snapshot
   taken at start, in `finally`, is the only version that is safe.
9. **`git checkout -- <file>` silently reverts work in progress.** It undid the
   whole customer-ledger rewrite once, because the file had uncommitted changes
   from the same session. It restored a *correct* file, so nothing looked broken —
   the code was simply gone. Verify the diff after any checkout.
10. **Never reason from a truncated diagnostic.** A probe that printed a
    connection URL with `slice(0, 60)` showed the pooler port as `:65` and
    briefly sent the diagnosis toward "malformed port" when it is a correct
    `:6543`. Parse the field and print the field, not a prefix of the string.
11. **The Supabase SQL editor renders only the last result set of a
    multi-statement paste, and stops at the first error.** A five-query
    verification block yields one grid, which reads as "everything else passed"
    when in fact nothing else was shown. Fold checks into a single `UNION ALL`
    statement. Related: a `SET ROLE anon` probe *errors* rather than returning
    rows once the tables are revoked - that error is the result, and reading it
    as a failure sends you down the wrong path.
12. **Ignore the Database Migrations page in the Supabase dashboard.** It shows
    "Run your first migration" because it tracks *Supabase CLI* migrations. This
    project uses Prisma, there is no `supabase/migrations` directory, and
    `supabase db push` is the wrong tool entirely.
13. **There is only one database password.** The panel labelled "Used for direct
    Postgres connections" and the "Shared pooler" connection string use the same
    credential - I initially told the user they were different and had to correct
    it. Resetting it breaks the Render backend until that service's env is
    updated, which is why applying the migration through the SQL editor was the
    better call.

Also still true: never read `.env` through the shell - the secret guard blocks
it, correctly. To check whether a key exists, parse it in a Node script and print
only presence and length.

## 7. Still open

- **§2b from the old handoff, still yours:** rotate `service_role` in Supabase →
  update Render env → redeploy, then rotate the JWT secret. The key is in Git
  history via `d9d199a`. Unaffected by anything here, and it was true before.
- **`account-security.guard.ts`**: `mfaRequired()` returns "Email verification is
  required for this account" when the **MFA assertion** is missing. Misleading;
  two-line fix.
- **43 orphan auth accounts** (no `profiles` row). Registration verified correct;
  these are historical test residue.
- **Thesis prose reconciliation** (~1h, draft-level): renewal "8 months" → 30
  days; drop the at-rest encryption claim; narrow "weighted forecasts"; fix
  "Forfeiture" (state seizure → lender takes collateral); "Based on google";
  verify Tan and Lim (2022); standardise "Dasmariñas".
- **Phase 11 (Contract Management Upgrade)** and **Phase 12 (Customer History &
  Volume-Based Tiering)** are untouched. Phase 11 has context + UI-SPEC ready.
- **Mobile app has no credential-security code at all** — see
  `.planning/phases/10.1-.../MOBILE-HANDOFF.md`. A bidder can still set a weak
  password on mobile. Independent of the RLS work, and the largest remaining gap
  for a defense.
- **`.planning/STATE.md` and `state.json` disagree** with each other and with this
  file. They are GSD bookkeeping and were not maintained this session. Treat this
  file as authoritative.
