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

## 3. What you must do — the migration is NOT applied

`backend/.env` and `DIRECT_URL` both point at the same Supabase pooler and **the
credentials are rejected**. I could not run or verify anything against the live
database. Two consequences:

**a) Apply the migration.** Paste
`backend/prisma/migrations/20260929140000_lock_last_six_tables/migration.sql`
into the Supabase SQL editor. It is transactional, idempotent, and has a rollback
block at the bottom. Then run the verification block in the same file — every
count must be 0.

**b) Reset the pooler password** if you want me to be able to verify things
directly: Supabase → Project Settings → Database → reset the pooler password,
then update `backend/.env`. The current one is dead.

**Behaviour change to expect:** `Dashboard.tsx` subscribes to `postgres_changes`
on `ticket`. Supabase applies RLS to realtime subscribers, so that live-update
subscription goes quiet once the migration lands. The dashboard still loads
correctly on mount and on refresh, because the data now comes from
`GET /analytics/branch-activity`. If live updates matter for the defense demo,
the follow-up is a Realtime broadcast fed by a database trigger, not a browser
SELECT policy on `ticket`.

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

The previous handoff's list still stands. Two more:

8. **A mutation harness must restore in a `finally`, not after the loop.** An
   early throw once left `app.service.ts` holding a mutated `tenantId`, and the
   next `tsc` reported three unrelated type errors. Restoring from a snapshot
   taken at start, in `finally`, is the only version that is safe.
9. **`git checkout -- <file>` silently reverts work in progress.** It undid the
   whole customer-ledger rewrite once, because the file had uncommitted changes
   from the same session. It restored a *correct* file, so nothing looked broken —
   the code was simply gone. Verify the diff after any checkout.

Also still true: never read `.env` through the shell — the secret guard blocks
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
