---
status: resolved
resolved_date: 2026-08-31
trigger: "it says account already exist even the account is new or too many request sometimes, fix it and analyze whats the cause of the problem because weve deleted the data in supabase but still same error"
created: 2026-04-07T00:00:00Z
updated: 2026-04-07T00:43:00Z
related_fix: |
  2026-08-31 session: While testing the app, Auction Queue returned HTTP 500 "column auction_listings.item_condition does not exist"
  and the dashboard threw "Maximum update depth exceeded".
  Root causes + fixes committed below.
---

## Current Focus

hypothesis: Confirmed. Duplicate and throttle behavior were produced by backend auth flows, not only by profile table contents.
test: Completed code patch and backend build verification.
expecting: Signup retries with same credentials recover successfully; auth OTP/register endpoints no longer hit global 429s.
next_action: deploy commit and have user verify in real workflow.

## Symptoms

expected: New owner email should register successfully after data reset; OTP request should not fail with too many requests under normal usage.
actual: Signup sometimes says account already exists for seemingly new email; OTP flow sometimes returns too many requests.
errors: "An account with this email already exists. Sign in instead of creating a new account." and intermittent too many request(s) responses.
reproduction: Open owner registration modal, request/enter code, then verify/create; sometimes fails with existing account or rate-limit message.
started: Ongoing during recent auth/signup changes.

## Eliminated

## Evidence

- timestamp: 2026-04-07T00:00:00Z
  checked: Initial user report
  found: Deleting data in Supabase did not remove the error behavior
  implication: Source of truth likely includes data outside the deleted table/scope (e.g., Supabase auth users or throttle state).

- timestamp: 2026-04-07T00:18:00Z
  checked: backend/src/app.service.ts registerBidder
  found: Duplicate message is thrown when supabaseAdmin.auth.admin.createUser reports "already been registered".
  implication: Deleting from public profiles alone does not remove Auth users; duplicate checks still fail.

- timestamp: 2026-04-07T00:19:00Z
  checked: backend/src/main.ts global express-rate-limit middleware
  found: Global limiter returns "Too many requests. Please try again later." for all routes except webhook.
  implication: OTP/auth endpoints can intermittently return 429 due to unrelated request volume on shared client IP.

- timestamp: 2026-04-07T00:19:30Z
  checked: mobile/lib/features/auth/data/datasources/auth_remote_datasource.dart
  found: Signup path calls backend /auth/register-bidder and surfaces backend duplicate message directly.
  implication: Fixing backend registration idempotency directly resolves client-facing false duplicate failures.

- timestamp: 2026-04-07T00:31:00Z
  checked: backend/src/app.service.ts + backend/src/main.ts
  found: registerBidder now performs idempotent recovery for existing auth users with matching password and syncs profile via upsert; global limiter now skips auth request/verify/register bidder routes.
  implication: Prevents false duplicate dead-ends and reduces intermittent too-many-requests during onboarding.

- timestamp: 2026-04-07T00:33:00Z
  checked: backend build
  found: npm run build completed successfully after patches.
  implication: Fix is compile-safe for deployment.

- timestamp: 2026-04-07T00:42:00Z
  checked: live Railway smoke test (GET /health and 2 consecutive POST /auth/request-auth-code for same email)
  found: Health is OK; both auth-code requests succeeded with deliveryMethod EMAIL and no 429 response.
  implication: Global limiter is no longer blocking auth OTP endpoint in production.

## Resolution

root_cause: Duplicate detection relied on Supabase Auth users (not only profiles), and the signup path was non-idempotent when account creation had already happened once. Global API rate limiter also throttled auth OTP/register routes, causing intermittent "too many requests" during onboarding.
fix: Implemented idempotent bidder registration recovery in backend/src/app.service.ts and excluded auth OTP/register endpoints from global express-rate-limit in backend/src/main.ts.
verification: Backend TypeScript diagnostics clean; npm run build passes locally; production smoke test confirms auth request-auth-code is healthy and not globally rate-limited.
files_changed: [backend/src/app.service.ts, backend/src/main.ts]

---

## 2026-08-31: Auction Queue 500 (missing column) + React infinite render loop

### Symptom
- `GET /auction/queue` returned HTTP 500: `The column auction_listings.item_condition does not exist in the current database` (auction.service.ts:1440 ticket.findMany).
- Dashboard console flooded with `Maximum update depth exceeded` (setState inside useEffect, dependency changes every render).

### Root cause 1 (backend/DB)
The Prisma schema for `AuctionListing` maps `itemCondition` -> `item_condition` (plus `item_specifications`, `provenance_details`, `disclosure_notes`), added by migration `20260830000000_add_listing_details_and_edits`. That migration (and 3 sibling ones) were never applied to the live Supabase DB — `prisma migrate status` showed 4 pending.

### Fix 1
Ran `npx prisma migrate deploy` in `backend/`. Applied:
- 20260813000000_add_subscription_pending_tier
- 20260818000000_add_missing_performance_indexes
- 20260824000000_add_approver_role
- 20260830000000_add_listing_details_and_edits
`prisma migrate status` now reports "Database schema is up to date!". The `/auction/queue` 500 is resolved at the data layer.

### Root cause 2 (frontend React loop)
`frontend/src/App.tsx` — two effects fought over `activeTab`:
- Effect A (line ~334, route sync) force-set `activeTab = resolveTabFromPath(pathname)` whenever tab != route.
- Effect B (line ~1362, access guard) reset `activeTab = filteredNavItems[0]` whenever the active tab was not accessible.
When the URL routes to a tab the user cannot access (e.g. Admin on /auction-queue with auctions disabled), A kept re-introducing the inaccessible tab while B kept reverting it -> infinite loop. `filteredNavItems` (a fresh `.filter()` array each render) was a dependency of B, so it re-ran on every render — matching the exact "dependency changes on every render" error.

### Fix 2
- Hoisted static nav config (`STATIC_NAV_ITEMS`, `FREE_ALLOWED_NAV_IDS`, `TRIAL_RESTRICTED_OWNER_NAV_IDS`) to module scope for stable references.
- Wrapped `filteredNavItems` in `useMemo` keyed on real inputs (role/tier/frozen/pending/feature state), so it no longer changes identity every render.
- Access-guard effect now also calls `navigate(TAB_TO_PATH[fallbackId], { replace: true })` when redirecting an inaccessible tab, so the URL stays in sync and the route-sync effect stops fighting -> loop terminates.
Verified: `npx tsc --noEmit` clean in `frontend/`; `npx vite build` passes.

### Files changed
- backend/... (no code change; DB migration applied via `npx prisma migrate deploy`)
- frontend/src/App.tsx (useMemo import, hoisted static nav, memoized filteredNavItems, URL-sync redirect in access-guard effect)
