# Codebase Concerns

**Analysis Date:** 2026-07-17

## Tech Debt

**App.tsx God Component:**
- Issue: `frontend/src/App.tsx` is 1665 lines containing ALL auth logic, role resolution, subscription gating, branch management, sidebar rendering, and page routing in a single component.
- Files: `frontend/src/App.tsx`
- Impact: Impossible to test, reason about, or modify any subsystem without risking regression in others. Auth session management, role normalization, and branch switching are all interleaved with rendering.
- Fix approach: Extract `AuthProvider`, `BranchProvider`, `SubscriptionGate` as separate context providers. Move role normalization to `frontend/src/lib/roleUtils.ts`. Move sidebar to its own component.

**Massive Frontend Components:**
- Issue: Multiple frontend components exceed 500 lines with inline state, API calls, and rendering all mixed together.
- Files: `frontend/src/components/AuctionMarketplace.tsx` (1242 lines), `frontend/src/pages/LandingPage.tsx` (1081 lines), `frontend/src/components/Dashboard.tsx` (852 lines), `frontend/src/components/InventoryVault.tsx` (770 lines), `frontend/src/components/AttendanceTracker.tsx` (768 lines)
- Impact: High cognitive load, poor testability, difficult to maintain.
- Fix approach: Extract custom hooks (e.g., `useAuctionListings`, `useInventoryData`), split into presentational/container components.

**AppService God Service (Backend):**
- Issue: `backend/src/app.service.ts` is 2000+ lines containing auth code management, email delivery (SMTP/Resend/Brevo), ticket CRUD, pawnshop management, staff role assignment, and mobile ticket logic.
- Files: `backend/src/app.service.ts` (~2061 lines)
- Impact: Violates Single Responsibility. Testing any feature requires mocking the entire service. Changes to email delivery risk breaking staff management.
- Fix approach: Extract `AuthService`, `TicketService`, `StaffManagementService`, `EmailDeliveryService` into separate NestJS modules.

**In-Memory State for Auth Codes:**
- Issue: OTP auth codes and verification tokens stored in `Map` objects on `AppService`. Lost on every server restart. Not shared across instances.
- Files: `backend/src/app.service.ts` (lines 27-46)
- Impact: In production with multiple instances or restarts, users lose pending verification codes. No horizontal scaling possible for auth flow.
- Fix approach: Store in Redis or database with TTL-based expiry. The Prisma schema already has infrastructure; use a dedicated `auth_codes` table.

**In-Memory Rate Limiting:**
- Issue: `RateLimitGuard` uses `Map<string, RateLimitEntry>` which is per-process memory only.
- Files: `backend/src/common/guards/rate-limit.guard.ts` (line 23)
- Impact: Rate limits reset on server restart. Different app instances have independent counters. An attacker can bypass limits by hitting different instances.
- Fix approach: Use Redis-backed rate limiting (e.g., `@nestjs/throttler` with Redis storage) or a shared store.

**Duplicated Role Normalization:**
- Issue: Role normalization logic (`normalizeRole`) is duplicated across at least 4 files with slightly different implementations.
- Files: `frontend/src/App.tsx` (line 251), `backend/src/app.service.ts` (line 488), `backend/src/auction/auction.service.ts` (line 33), `backend/src/main.ts` (line 274)
- Impact: Role strings can be normalized differently between frontend and backend, causing authorization mismatches. E.g., frontend maps `BRANCH_ADMIN` to `Admin` display name while backend maps to `ADMIN` enum.
- Fix approach: Create a shared role enum and normalization utility. Backend should use Prisma enum `Role` consistently; frontend should derive display names from the canonical enum.

**Floating Point for Financial Amounts:**
- Issue: Prisma schema uses `Float` for monetary fields (`principalAmount`, `interestAmount`, `loanAmount`, `startingPrice`, `currentBid`, `amount`). AGENTS.md states "integer-cents to avoid float drift" but schema still uses Float.
- Files: `backend/prisma/schema.prisma` (lines 138-162, 73-107, 255-258)
- Impact: Floating-point arithmetic causes rounding errors in financial calculations. ₱100.10 × 3 may not equal ₱300.30 exactly.
- Fix approach: Migrate all monetary `Float` columns to `Decimal` (already used for `weight` and `riskScore`). Update `pawn-charge-calculator.ts` and all payment logic to use integer cents.

## Known Bugs

**Silent Catch Blocks Throughout Codebase:**
- Symptoms: Errors are swallowed with empty `catch {}` blocks, preventing error visibility.
- Files: `backend/scripts/seed-staff-accounts.ts` (line 133), `frontend/src/components/QueueManagement.tsx` (line 620), `frontend/src/components/Dashboard.tsx` (line 125), `auction-frontend/src/services/auctionApi.ts` (lines 105, 106, 133, 154, 235, 258)
- Trigger: Any database error, network timeout, or service failure.
- Workaround: None — errors disappear silently. Users see stale UI with no indication of failure.

**Push Notifications Not Implemented:**
- Symptoms: `deliverNotification()` marks all push notifications as "SENT" without actually delivering to devices. Push tokens are collected but never used.
- Files: `backend/src/notification/notification.service.ts` (line 155-163)
- Trigger: Any non-IN_APP notification.
- Workaround: Users only see in-app notifications; no real push delivery occurs.

**Missing Subscription Expiry Notifications:**
- Symptoms: Cron job finds expiring subscriptions but the TODO on line 1379 is not implemented — no notification sent.
- Files: `backend/src/subscription/subscription.service.ts` (line 1379)
- Trigger: Subscription nearing end date.
- Workaround: Tenant owners are not alerted and may lose access unexpectedly.

**Missing Auction Winner Notifications:**
- Symptoms: When compliance expires and auto-transfers to next bidder, no notification is sent to either party.
- Files: `backend/src/auction/auction-settlement.service.ts` (lines 340-341)
- Trigger: Compliance window expiration on auction.
- Workaround: Winners may not know they won; pawnshops may not know to follow up.

## Security Considerations

**Frontend Direct Supabase Access Bypasses Backend:**
- Risk: Multiple frontend components bypass the NestJS backend and write directly to Supabase via the client SDK. This bypasses RBAC guards, audit logging, state machine validation, and LegalProof generation.
- Files: `frontend/src/pages/admin/PlatformControl.tsx` (lines 123-167 — direct `supabase.from('pawnshops').delete()`), `frontend/src/components/Dashboard.tsx` (lines 231-232 — direct `supabase.from('ticket').select()`), `frontend/src/App.tsx` (lines 450, 534, 590, 600 — direct profile updates)
- Current mitigation: RLS policies provide some protection, but pawnshop-level deletion logic in `PlatformControl.tsx` performs cascading deletes client-side with no audit trail.
- Recommendations: Move ALL write operations through the NestJS backend. The PlatformControl pawnshop deletion should be a backend endpoint with proper cleanup, audit logging, and SoftDelete.

**`$executeRawUnsafe` SQL Usage:**
- Risk: `tenant-governance.service.ts` uses `$executeRawUnsafe` for DDL (CREATE TABLE/INDEX) at runtime. While the current usage is schema-creation (not user input), the pattern is dangerous.
- Files: `backend/src/tenant-governance/tenant-governance.service.ts` (lines 227-311 — 11 calls to `$executeRawUnsafe`)
- Current mitigation: The SQL strings are hardcoded, not interpolated with user data.
- Recommendations: Move DDL to proper Prisma migrations. Remove runtime `CREATE TABLE` calls. This is the biggest SQL injection surface in the codebase.

**Auth Code Logged to Console in Plain Text:**
- Risk: OTP verification codes are printed to console.log in plain text, which persists in log files.
- Files: `backend/src/app.service.ts` (line 621: `console.log(\`[auth-code] ${purpose} for ${email}: ${code}\`);`)
- Current mitigation: Only visible in server logs.
- Recommendations: Remove or gate behind `NODE_ENV !== 'production'`. Log only that a code was sent, not the code itself.

**Hardcoded Supabase URL Fallback:**
- Risk: When env vars are missing, `AppService` creates a Supabase client with a hardcoded project URL and `INVALID_KEY`. This still leaks the project ID.
- Files: `backend/src/app.service.ts` (lines 62-63: `supabaseUrl || 'https://bxayczllpdhrvutubzbg.supabase.co'`)
- Current mitigation: The key is `INVALID_KEY` so requests will fail auth.
- Recommendations: Throw an error and refuse to start when Supabase credentials are missing in production.

**Rate Limit Bypass for Auth Routes:**
- Risk: The global rate limiter explicitly skips several auth-related endpoints.
- Files: `backend/src/main.ts` (lines 107-113 — skips `/auth/request-auth-code`, `/auth/verify-auth-code`, `/auth/register-bidder`)
- Current mitigation: The per-endpoint `@Throttle()` decorator provides per-route limits on some endpoints.
- Recommendations: Ensure all auth endpoints have per-endpoint `@Throttle()` decorators. Audit which auth routes lack per-endpoint limits.

**Rate Limit Skip for Webhook Routes:**
- Risk: PayMongo webhook endpoint bypasses rate limiting entirely. A malicious actor could flood the endpoint.
- Files: `backend/src/main.ts` (line 107: `if (req.path.includes('/loans/paymongo/webhook')) return true;`)
- Current mitigation: PayMongo webhook secret validation (if configured).
- Recommendations: Verify `PAYMONGO_WEBHOOK_SECRET` is always configured in production. Add IP-based rate limiting for webhook routes separately.

**Frontend Role Stored in localStorage:**
- Risk: User role is stored in `localStorage` and used as a fallback for authorization decisions. An attacker who can inject into localStorage can escalate privileges client-side.
- Files: `frontend/src/App.tsx` (lines 304, 462, 477, 486, 542, 560, 570 — extensive `localStorage.setItem('user_role', ...)`)
- Current mitigation: Backend RBAC guard independently verifies role from database on each request.
- Recommendations: Never trust `localStorage` for authorization. The backend is the source of truth. Remove all `user_role` fallback logic from localStorage; only use server-verified role.

**Pawnshop ID from localStorage:**
- Risk: `pawnshop-id` header sent with every API request is read from `localStorage`, which can be modified by the user to access other tenants' data.
- Files: `frontend/src/lib/apiClient.ts` (lines 55-58)
- Current mitigation: Backend `PawnshopGuard` validates UUID format, and `main.ts` subscription middleware checks `actor.pawnshopId` against the header. RBAC guard checks `profile.pawnshopId`.
- Recommendations: This is defense-in-depth. Ensure the RBAC guard cross-checks `request.user.pawnshopId` against the `pawnshop-id` header on every tenant-scoped request.

## Performance Bottlenecks

**N+1 Query Pattern in Subscription Freeze Middleware:**
- Problem: The subscription freeze middleware in `main.ts` performs a `profile.findUnique` + `subscription.findFirst` on EVERY request to operational endpoints. This is 2 DB queries per request before the actual handler runs.
- Files: `backend/src/main.ts` (lines 261-312)
- Cause: Authentication and subscription validation happen sequentially in middleware.
- Improvement path: Cache subscription status with short TTL (30-60s) in memory. Use NestJS `@UseGuards` with a cached subscription check instead of inline middleware.

**Mobile App 10-Second Notification Polling:**
- Problem: Mobile app polls `/notifications/user/:id` every 10 seconds, creating constant DB load even when nothing changes.
- Files: `mobile/lib/main.dart` (lines 336-339 — `Timer.periodic(Duration(seconds: 10))`)
- Cause: No WebSocket or SSE support for real-time notifications.
- Improvement path: Implement WebSocket connection for push/in-app notifications. Use Supabase Realtime subscriptions which the frontend already partially uses.

**Mobile App 10-Second Queue Ticket Polling:**
- Problem: Mobile HomeScreen also polls `/queue/my-tickets` every 10 seconds.
- Files: `mobile/lib/main.dart` (lines 625-628 — `_ticketPollTimer = Timer.periodic(Duration(seconds: 10))`)
- Cause: Same lack of real-time channel as notifications.
- Improvement path: Consolidate polling into a single timer or use WebSocket for both notifications and queue updates.

**Supabase Realtime Channel Leak on Unmount:**
- Problem: Dashboard creates a Supabase realtime channel but only removes it in the `useEffect` cleanup. If the component unmounts before the channel is created, the old channel persists.
- Files: `frontend/src/components/Dashboard.tsx` (line 125 — `supabase.removeChannel(channel).catch(() => {})`)
- Cause: Cleanup runs asynchronously; channel creation is async.
- Improvement path: Track channel creation with a ref and ensure cleanup in the effect's return function.

## Fragile Areas

**Tenant Governance Runtime Schema Migration:**
- Files: `backend/src/tenant-governance/tenant-governance.service.ts`
- Why fragile: Creates tables via `$executeRawUnsafe` on first access. Race conditions possible if two requests trigger simultaneously. DDL operations are not transactional in PostgreSQL. Schema changes require code changes instead of migrations.
- Safe modification: Replace with proper Prisma migrations. The `schema_extensions.prisma` file exists but appears unused.

**State Machine Not Persisting Transitions:**
- Files: `backend/src/common/state-machine/state-machine.service.ts`
- Why fragile: Transitions are in-memory (`Map<string, TransitionDefinition[]>`) and must be registered on every process startup. If no domain is registered for a transition, it throws but the database state has already been read.
- Safe modification: Ensure all domain registrations happen in module `onModuleInit`. Add a health check that verifies all expected domains are registered.

**Dual Supabase Client Usage:**
- Files: `backend/src/main.ts` (lines 33-38), `backend/src/app.service.ts` (lines 26, 48-70)
- Why fragile: The backend creates TWO independent Supabase admin clients — one in `main.ts` for middleware and one in `AppService` for business logic. If credentials differ or one fails to initialize, behavior is inconsistent.
- Safe modification: Create a singleton `SupabaseAdminService` module. Inject it where needed instead of creating clients ad-hoc.

**CORS Origin Regex Patterns:**
- Files: `backend/src/main.ts` (lines 68-71)
- Why fragile: Railway deployment patterns are hardcoded regexes. If the deployment URL format changes (e.g., new hosting provider), CORS blocks all requests silently.
- Safe modification: Make allowed origins fully configurable via `CORS_ALLOWED_ORIGINS` env var. Remove hardcoded regex patterns.

## Scaling Limits

**Single-Process Architecture:**
- Current capacity: One backend process on Railway handles all requests.
- Limit: Rate limiting, auth code storage, and state machine registration are all in-memory. Cannot scale horizontally.
- Scaling path: Move shared state to Redis. Use `@nestjs/throttler` with Redis store. Consider NestJS microservices architecture if multi-branch load grows.

**Database Connection Pool:**
- Current capacity: Default Supabase pool (likely 15-20 connections on free tier).
- Limit: Each middleware request opens 2 queries. High concurrency exhausts pool.
- Scaling path: Use PgBouncer or Supabase's built-in connection pooler. Add connection pool monitoring.

**No Database Indexing Strategy:**
- Current capacity: Some explicit indexes on `auction_bids`, `auction_images`, `security_logs`.
- Limit: Queries filtering on `pawnshopId` across many tables lack composite indexes. `subscription` query in middleware lacks an index on `(pawnshopId, createdAt)`.
- Scaling path: Add `@@index([pawnshopId])` to `Loan`, `Ticket`, `Customer`, `QueueTicket`. Add `@@index([pawnshopId, createdAt])` to `Subscription`.

## Dependencies at Risk

**Supabase Service Role Key:**
- Risk: Single key with full database access. If leaked, entire database is compromised. Used in both middleware (`main.ts`) and business logic (`AppService`).
- Impact: Complete data breach. All RBAC bypassed.
- Migration plan: Rotate keys regularly. Use separate keys for different services. Store in secrets manager, not `.env` files.

**PayMongo Integration:**
- Risk: Payment processing integration has minimal error handling in webhook handler. Webhook secret may not be configured.
- Impact: Lost payments, subscription status mismatches.
- Migration plan: Ensure `PAYMONGO_WEBHOOK_SECRET` is always set. Add idempotency checks on webhook processing. Add payment reconciliation cron.

## Missing Critical Features

**No Database Migration Workflow:**
- Problem: Schema changes are managed via raw SQL files in the project root (`ADD_PAWNSHOP_ID_COLUMNS.sql`, `FIX_EVERYTHING.sql`, `DATA_FIXES.sql`, `DISABLE_ALL_RLS_AND_POLICIES.sql`, etc.). There are 15+ standalone SQL fix files with no ordering or rollback strategy.
- Blocks: Safe schema evolution. Any developer can apply random fixes. No way to know what state the production database is in.

**No RLS Policy Management:**
- Problem: Multiple SQL files toggle RLS on/off (`DISABLE_RLS_TEST.sql`, `DISABLE_ALL_RLS_AND_POLICIES.sql`, `SECURITY_FIX_RLS_COMPLETE.sql`). The `RLS_POLICIES.sql` and related files suggest policies were created and recreated multiple times.
- Blocks: Consistent security posture. Production database may have different RLS policies than expected.

**No Centralized Error Handling for Frontend:**
- Problem: Each component has its own error handling pattern (some use try/catch, some use `.catch(() => {})`, some have no error handling). No global error boundary for React.
- Blocks: Consistent user experience on failures. Difficult to add error reporting (e.g., Sentry).

**No Environment-Specific Configuration Validation:**
- Problem: Backend starts even with missing critical env vars (falls back to hardcoded Supabase URL). No startup validation for required production configuration.
- Blocks: Reliable deployments. Production outages from missing config only discovered at runtime.

## Test Coverage Gaps

**Backend Spec Files Are Sparse:**
- What's not tested: Most backend services have spec files but many are minimal. `app.service.ts` (2000+ lines) has `app.controller.spec.ts` only. No tests for auth code flow, staff management, ticket CRUD, or redemption logic.
- Files: `backend/src/app.controller.spec.ts` (only generic controller test), `backend/src/app.service.ts` (no corresponding spec)
- Risk: Changes to auth flow, staff management, or ticket operations have zero test coverage.
- Priority: High

**Frontend Has Only 3 Test Files:**
- What's not tested: All 40+ frontend components have zero test coverage except `SalesPos.test.tsx`, `InventoryVault.test.tsx`, and `AuctionQueue.test.tsx`.
- Files: `frontend/src/components/__tests__/SalesPos.test.tsx`, `frontend/src/components/__tests__/InventoryVault.test.tsx`, `frontend/src/components/__tests__/AuctionQueue.test.tsx`
- Risk: UI regressions go undetected. Role-based rendering, form validation, and API integration untested.
- Priority: High

**No Integration Tests:**
- What's not tested: Backend e2e tests exist (`backend/test/app.e2e-spec.ts`) but the file is likely a scaffold. No tests verify the full flow: login → create ticket → disburse → repay → redeem.
- Files: `backend/test/app.e2e-spec.ts`
- Risk: Critical business flows (pawn ticket lifecycle) have no end-to-end verification.
- Priority: Critical (for thesis defense)

**Mobile App Has Only 1 Test File:**
- What's not tested: Only `widget_test.dart` exists. No tests for BLoC logic, API integration, or auth flow.
- Files: `mobile/test/widget_test.dart`
- Risk: Mobile app regressions go undetected.
- Priority: Medium

---

*Concerns audit: 2026-07-17*
