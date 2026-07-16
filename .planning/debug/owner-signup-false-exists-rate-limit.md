---
status: awaiting_human_verify
trigger: "it says account already exist even the account is new or too many request sometimes, fix it and analyze whats the cause of the problem because weve deleted the data in supabase but still same error"
created: 2026-04-07T00:00:00Z
updated: 2026-04-07T00:43:00Z
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
