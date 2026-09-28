# PawnGold — Session Handoff (end of 2026-09-29)

**Defense: 3rd week of October 2026.** Roughly two and a half weeks.
**HEAD at handoff:** `a5c94f4` — pushed, in sync with `origin/main`, working tree clean.

This file records state that is expensive to rediscover. Read it before touching anything.

---

## 1. Live production state

| | |
|---|---|
| Frontend | `integrated-pawnshop-v2.vercel.app` (deployed, current) |
| Backend | `integrated-pawnshop-v2.onrender.com` (`/health` → 200) |
| Supabase ref | `bxayczllpdhrvutubzbg` |
| Tests | backend 740/740 across 52 suites · frontend 243 passing, tsc + build clean both sides |
| Known failures | 3 pre-existing frontend: `kycDocs` ×2, `InventoryVault` ×1. Not ours, not touched. |

## 2. CRITICAL — still open

### 2a. RLS is off on 6 tables (highest remaining risk)

**Confirmed live and exploitable.** The public anon key ships in the JS bundle (verified:
`project ref bxayczllpdhrvutubzbg` found in `/assets/index-BUja1-EP.js`). With RLS off and
Supabase's default broad grants, the anon role could read *and write* every row.

**Already fixed:** 42 tables. RLS + FORCE enabled, no policies. Verified: `payslips` 0,
`loan` 0, `transaction` 0 when queried as anon. Backend is unaffected — `postgres` and
`supabase_admin` both have `rolbypassrls = true`, and that **overrides** `FORCE RLS`.
Verified safe: the backend wrote an MFA challenge through it post-migration.

**Still open — 6 tables, deliberately excluded because the browser reads them directly:**

| Table | Anon count at handoff |
|---|---|
| `customer` | **17 rows** (PII) |
| `profiles` | **34 rows** |
| `ticket` | **33 rows** |
| `pawnshops` | — |
| `branch` | — |
| `loan_application` | — |

### 2b. `service_role` rotation (user action, ~2 min)

The key is in Git history (`d9d199a` deleted 13 secret files). True regardless of RLS state.
Supabase → Project Settings → API → rotate `service_role` → update Render env → redeploy.
Then rotate **JWT Secret** (invalidates all sessions; everyone signs in again — expected).

## 3. Next task, when ready: the 6-table RLS policies

Already scoped. Four browser call sites **will break** when policies land, so this must ship
as one change:

| Call site | Problem | Fix needed |
|---|---|---|
| `frontend/src/components/InventoryVault.tsx:286` | reads **every** ticket, no tenant filter | add `.eq('pawnshop_id', …)` |
| `frontend/src/components/Redemption.tsx:77` | same | add `.eq('pawnshop_id', …)` |
| `frontend/src/pages/admin/SystemSettings.tsx:161` | reads `pawnshops` unfiltered | scope to current shop |
| `frontend/src/components/Auth/Login.tsx:64` | pre-auth `profiles` lookup by email | move behind backend — cannot be made RLS-safe from a browser, is an enumeration oracle |

Policy model: scope on the authenticated user's **own** `profiles.pawnshop_id`, never a
client-supplied tenant id. Add tests that fail if any policy would grant a cross-tenant read.

Browser access map (41 files, but only 6 tables): `profiles` (own row by id, update by id),
`ticket` (by pawnshop_id / pawnshop_id+branch_id), `pawnshops` + `branch` (by id),
`customer` + `loan_application` (by pawnshop_id).

## 4. Smaller known issues

- **`account-security.guard.ts`**: `mfaRequired()` returns
  `"Email verification is required for this account."` — but it is thrown when the **MFA
  assertion** is missing/rejected. Misleading; sends anyone debugging it down the wrong path.
  Two-line fix.
- **App shell fires 5 doomed requests before MFA is satisfied** (branding, branches,
  client-registrations, subscriptions ×2). Fails closed correctly, but it's console noise and
  wasted round-trips.
- **43 orphan auth accounts** (no `profiles` row). Registration path verified **correct**
  (upsert + recovery) — these are historical test residue on disposable domains. Repair SQL is
  in the previous session's chat; sets them to `STAFF` with no tenant deliberately.
- **`buildUndeliveredView`** returns a fabricated success for an unknown address. Correct for
  anti-enumeration, but indistinguishable from a state-drift case. Latent, not your bug.
- **Pre-existing mojibake** in `backend/src/app.controller.ts` console.log strings (from
  `7b1cee4`, not ours).

## 5. Fixed on 2026-09-29 (don't re-investigate)

| Commit | Fix |
|---|---|
| `0bdeefe` | Gold `#C9A05C` + white text = 2.43:1 contrast failure, 35 sites / 24 files. System Control 4 save buttons → 1 commit point. Toggle a11y + label associations. |
| `1f7139d` | Security activity showed "Account security event" for every row — frontend knew 7 of 9 backend actions under *wrong names*. Guard test added. |
| `3c8a286` | MFA refocus dismissal: gate was a window blur/focus **race** that lost whenever focus returned to docked DevTools. Now decided from the event alone. |
| `34e3158` | Password change reported a wrong current password as "check the fields below". Handled 2 of 8 failure modes; now handles all, attributes the field. |
| `6fdd2fd` | Wrong password reported as "too many requests" — throttle on the wrong boundary. New per-account `MfaPasswordAttemptService`. |
| `48f766a` | Rate-limited enable-mode user had no retry path (button was disable-mode only). |
| `bf70e46` | MFA lockout leaked across dialog sessions (always-mounted component, `reauthLocked` never reset). |
| `341d95b` | MFA rate-limit cooldown didn't count down — 3 separate causes. |
| `a5c94f4` | `enableMfa`/`disableMfa` used bare `update()` which throws on a missing row → MFA dead-end. Now upsert. |

Also: the "page reloads on alt-tab" bug was **not** a reload. No `document` request in the
Network log. The app was blanking itself to its own "Loading your vault" shell because the
subscription effects depended on the `session` **object** (new reference every token refresh /
tab resume) *and* cleared the gating flags mid-fetch. Fixed in `093ea52`.

## 6. Tooling traps hit today — do not repeat

These cost real time. All are environment issues, not code issues.

1. **`[System.IO.File]::WriteAllText` re-encodes and corrupts.** It turned every non-ASCII
   char in a test file's masked-email fixtures into mojibake. **I committed that corruption
   and shipped it** in `341d95b`; fixed in `48f766a`. Use Node `fs.readFileSync/writeFileSync`
   for any file containing non-ASCII.
2. **`git show <ref>:<path> > file` in PowerShell writes UTF-16LE.** Node then read the file
   as one giant BOM'd line and every match failed. Capture bytes with
   `execFileSync('git', [...])` instead.
3. **`git checkout` restores CRLF**, so a patch script written with bare `\n` silently stops
   matching. Normalise on read, restore on write.
4. **`src\**\*.tsx` in PowerShell does not match `src\App.tsx`** — it needs at least one
   directory level. This made me miss "Loading your vault" in `App.tsx` and wrongly conclude
   it wasn't in the codebase. Use `Get-ChildItem -Recurse -Include`.
5. **Scripts in `C:\Users\...\Temp\opencode` must resolve paths from `process.cwd()`**, not
   `__dirname`. A `__dirname` walk silently found 0 files and reported "0 tables".
6. **PowerShell mangles inline `node -e` with quotes/braces.** Always write a `.cjs` file.
7. My `update`→`upsert` change made 4 assertions in `security.service.spec.ts` **pass
   vacuously** — they asserted on a call the service no longer made. Green tests that verify
   nothing. **Always re-verify tests after changing a call shape**, and confirm new tests are
   load-bearing by breaking the fix and watching them fail.

## 7. Verification habits that worked

- **Read the deployed artifact, not local source.** Fetching the served bundle is what proved
  the anon key is public, that no app code reloads the page, and that "Loading your vault"
  really is in `App.tsx`.
- **When a diagnosis is wrong, say so plainly and stop guessing.** Three commits were burned on
  the alt-tab bug before the Network log settled it.
- **Distinguish "config is wrong" from "config is exploitable."** Broad grants alone are
  Supabase's default and not a finding; broad grants *plus* RLS off is a breach.

## 8. Still recommended, not done

- Thesis prose reconciliation (~1h, draft-level): renewal "8 months" → 30 days; drop the
  at-rest encryption claim; narrow "weighted forecasts"; fix "Forfeiture" (state seizure →
  lender takes collateral); "Based on google"; verify Tan and Lim (2022); standardise
  "Dasmariñas".
- 6 RLS tables + 4 call-site fixes (§3) — **do this first**.
- `service_role` + JWT rotation (§2b).
