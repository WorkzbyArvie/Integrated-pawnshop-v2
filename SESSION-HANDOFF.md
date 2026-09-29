# PawnGold — Session Handoff (end of 2026-09-29, session 2)

**Defense: 3rd week of October 2026.** Roughly two and a half weeks.

**HEAD:** `5c6f85a`, pushed to `origin/main`. 10 commits on top of the previous
handoff's `5db6f10`. **Both services are deployed and verified live** — the code
work, the database migration, and the rollout are all done.

Supersedes `5db6f10`'s handoff. Read section 1 first: the previous handoff said
this task was scoped; it was not.

---

## 1. What happened this session

Section 2a and 3 of the previous handoff are **complete, deployed, and verified**.
The migration is applied to production. There is no outstanding action on the
security work.

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
| `fecec05` | The RLS migration + 46 containment assertions. |
| `3acd657` | First rewrite of this handoff. |
| `4b4771a` | Handoff updated once the migration was verified live. |
| `5c6f85a` | `.gitattributes` pins `*.sql text eol=lf` so Prisma migration checksums stay stable. **Pushed.** |

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

## 3a. Deployed and verified live

`main` fast-forwarded `5db6f10..5c6f85a` and pushed. Both services redeployed.
Verified from outside, by reading the deployed artifacts rather than trusting a
200:

| | Evidence |
|---|---|
| Backend is the new build | `/profile/session-context` returns **401, not 404**. The route did not exist before this push, so a 404 would have meant the old build. 401 is correct — the route exists and refuses an unauthenticated call. |
| Frontend is the new build | entry chunk changed `index-BUja1-EP.js` → `index-D02rnHjY.js`; every rewritten lazy chunk confirmed to call the backend and to contain **zero** `.from()` table calls |

Confirmed per chunk in the served bundle: `CrmTable` → `/customers`, `Dashboard`
→ `/analytics/branch-activity`, `StaffMatrix` → `/tenant-governance/staff`,
`InventoryVault` and `Redemption` → `/tickets`, `SystemSettings` →
`/tenant-governance/pawnshops/`. The old direct reads of `customer`, `profiles`,
`ticket` and `pawnshops` are absent from all of them.

The backend happened to finish before the frontend, so the window where a new
frontend was live against an old backend never opened. **That was luck.** Vite
builds faster than the NestJS build, so the normal outcome is the opposite, and
the frontend would be live calling endpoints that do not exist — sign-in breaks
first. If deploying again, expect to wait on Render before testing on Vercel.

### Not yet done — a human needs to eyeball this

The rollout is verified structurally. Nobody has clicked through the app. Check,
in this order:

1. **Sign in.** Highest risk — it depends on a brand-new endpoint.
2. **Dashboard** — counts non-zero. It will **stop live-updating**; that is the
   documented Realtime consequence, not a regression, because the data now comes
   from `GET /analytics/branch-activity`.
3. **Inventory Vault, Redemption, CRM, Staff Matrix, System Settings, Branch
   Analytics** — the six surfaces moved to the backend.
4. **Sign out, sign back in, confirm someone shows Active.** This is the one that
   would expose a mistake in the `profiles` column grant: if the grant were wrong
   the presence heartbeat fails silently and every user looks permanently
   offline.

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

## 6. Tooling traps — six new ones, all cost real time

The previous handoff's list still stands. Six more:

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
14. **A code-split bundle hides most of the app from the entry chunk.** Verifying
    the deployed frontend by grepping `index-*.js` for new API paths reported
    "PARTIAL" and looked like a failed deploy. It was not: Dashboard, StaffMatrix,
    CrmTable, InventoryVault, Redemption and SystemSettings are all lazy chunks
    listed in the entry's dynamic-import map, which the script was not following
    because Vite references them relatively (`./Dashboard-BxY.js`) rather than by
    absolute `/assets/...` path. Dump the `.js` string literals in the entry chunk
    to learn the real naming, then fetch the chunks you care about.
15. **Pick verification markers that cannot be confused with a near-miss.** I
    searched for `/tickets/` and reported a false alarm on `Redemption`; the code
    calls `api.get('/tickets')` with no trailing slash, and only the vault matched
    because its photo path is a template literal that happens to contain that
    prefix. A marker that is a near-miss of the real string produces a wrong
    answer with total confidence. Match the exact call, and when a check fails,
    confirm the marker is right before believing the result.

Also still true: never read `.env` through the shell - the secret guard blocks
it, correctly. To check whether a key exists, parse it in a Node script and print
only presence and length.

## 7. Still open

**Nothing in the security work is outstanding.** These are the rest:

- **Click through the deployed app** (section 3a) — the rollout is verified
  structurally, but nobody has used it yet. Sign-in first.
- **§2b from the old handoff, still yours:** rotate `service_role` in Supabase →
  update Render env → redeploy, then rotate the JWT secret. The key is in Git
  history via `d9d199a`. Unaffected by anything here, and it was true before.
- **`account-security.guard.ts`**: `mfaRequired()` returns "Email verification is
  required for this account" when the **MFA assertion** is missing. Misleading;
  two-line fix.
- **43 orphan auth accounts** (no `profiles` row). Registration verified correct;
  these are historical test residue. Note that with `profiles` now locked to
  `auth.uid()`, nothing in the browser can read them, which is the intent.
- **The DB credential in `backend/.env` is dead.** `prisma migrate status` fails
  with P1000 locally. Resetting it is optional but worth doing so a future session
  can verify the database independently instead of relying on screenshots — the
  live claims in section 3 all rest on operator-run queries, not on a connection
  of my own.
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
- **Dashboard live-update is gone** and has not been replaced. If it matters for
  the defense, the fix is a Realtime broadcast fed by a database trigger, not a
  browser SELECT policy on `ticket` — the latter would undo section 3 entirely.
