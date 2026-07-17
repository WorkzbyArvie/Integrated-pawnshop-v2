<!-- refreshed: 2026-07-17 -->
# Architecture

**Analysis Date:** 2026-07-17

## System Overview

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                            CLIENT LAYER                                     │
├──────────────────┬──────────────────┬───────────────────────┬───────────────┤
│  Dashboard SPA   │ Auction SPA      │ Mobile App            │ Landing Page  │
│  `frontend/`     │ `auction-frontend/` │ `mobile/`           │ `frontend/`   │
│  React 19+Vite   │ React 19+Vite 7  │ Flutter 3.10+Dart    │               │
│  TailwindCSS 4   │ TypeScript       │ BLoC state mgmt      │               │
│  shadcn/Radix UI │ Supabase JS      │ flutter_map           │               │
└────────┬─────────┴────────┬─────────┴──────────┬────────────┴───────────────┘
         │                  │                    │
         │  Supabase JS     │  Supabase JS       │  Supabase Flutter
         │  + fetch/api     │  + fetch/api       │  + Dio HTTP
         │                  │                    │
         ▼                  ▼                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         BACKEND API LAYER                                   │
│                     `backend/` — NestJS 10 + TypeScript                     │
├─────────────────────────────────────────────────────────────────────────────┤
│  Guards (Pawnshop → RBAC → RateLimit)  │  Interceptors (Audit → Request)   │
├─────────────────────────────────────────────────────────────────────────────┤
│  Modules: loan | auction | contract | receipt | finance | queue            │
│           compliance | attendance | payroll | notification | subscription   │
│           profile | security | payment-methods | tenant-governance          │
│           branding | analytics | kyc | common                               │
├─────────────────────────────────────────────────────────────────────────────┤
│  StateMachine  │  LegalProofService  │  ReceiptService  │  FinanceService  │
└────────────────────────┬────────────────────────────────────────────────────┘
                         │
                         │  Prisma ORM 5.22
                         ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         DATA LAYER                                          │
│              Supabase PostgreSQL + Row-Level Security                       │
│              23 Prisma Models + 23 Enums                                    │
│              `backend/prisma/schema.prisma`                                 │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| **AppController** | Root auth endpoints (login, bidder registration, KYC, staff mgmt, tickets, customers) | `backend/src/app.controller.ts` |
| **AppService** | Core business logic for auth, user creation, ticket CRUD, Supabase admin API calls | `backend/src/app.service.ts` |
| **LoanModule** | Loan lifecycle: creation, disbursement, repayment, forfeiture, renewal, history | `backend/src/loan/` |
| **AuctionModule** | Auction listings, bidding, payments, settlement, public listing API | `backend/src/auction/` |
| **ContractModule** | Template management, contract rendering, TOS generation | `backend/src/contract/` |
| **ReceiptModule** | Receipt generation and retrieval for all financial events | `backend/src/receipt/` |
| **FinanceModule** | Cash ledger entries, financial reporting, pawn charge calculator | `backend/src/finance/` |
| **QueueModule** | Customer queue ticketing (create, serve, cancel) | `backend/src/queue/` |
| **StateMachineService** | Enforces valid state transitions with RBAC role checks per domain | `backend/src/common/state-machine/` |
| **RbacGuard** | Global RBAC enforcement — validates auth token, resolves role from profile, checks `@Roles()` | `backend/src/common/guards/rbac.guard.ts` |
| **PawnshopGuard** | Validates `pawnshop-id` header on non-exempt routes | `backend/src/common/guards/pawnshop.guard.ts` |
| **AnalyticsModule** | Dashboard statistics and reporting | `backend/src/analytics/` |
| **TenantGovernanceModule** | Multi-branch management, client registration, support access, branding | `backend/src/tenant-governance/` |
| **SubscriptionModule** | Subscription tiers, PayMongo payments, webhook handling | `backend/src/subscription/` |
| **Frontend SPA** | Full admin/staff dashboard — 30+ pages, role-based sidebar, Supabase auth | `frontend/src/App.tsx` |
| **Auction Frontend** | Public auction house — listing browsing, bidding, KYC, terms | `auction-frontend/src/App.tsx` |
| **Mobile App** | Bidder-facing Flutter app — map, queue tickets, loan history, auctions | `mobile/lib/main.dart` |

## Pattern Overview

**Overall:** Modular Monolith with Frontend-Oriented Monorepo

**Key Characteristics:**
- Backend is a **NestJS modular monolith** — all domain modules live in a single deployable NestJS app
- Frontends are **separate Vite SPAs** sharing a single NestJS backend via REST
- Multi-tenancy via **pawnshop-id header** propagated from client → backend → database queries
- **State machine** pattern for pawn ticket and loan application lifecycle enforcement
- **Defense-in-depth** security: Helmet → rate limiting → CORS → global guards (PawnshopGuard → RbacGuard → RateLimitGuard) → per-route DTO validation
- **Response envelope** pattern: all backend responses wrapped in `{ success: true, data: ... }` by interceptor

## Layers

**Common (Cross-cutting Infrastructure):**
- Purpose: Shared services, guards, decorators, interceptors, state machine
- Location: `backend/src/common/`
- Contains: `StateMachineService`, `AuthUserService`, `PawnshopGuard`, `RbacGuard`, `RateLimitGuard`, decorators (`@Public()`, `@Roles()`, `@Throttle()`, `@AuditLog()`), interceptors, `StorageService`, `GlobalExceptionFilter`
- Depends on: PrismaService
- Used by: All backend modules

**Domain Modules:**
- Purpose: Business logic per domain area (loan, auction, finance, etc.)
- Location: `backend/src/{domain}/`
- Contains: Controller, Service, Module, DTOs per domain
- Depends on: Common module, PrismaService, cross-module services (e.g., LoanModule uses FinanceService, LegalProofService, ReceiptService)
- Used by: Frontend clients via REST

**Database / ORM:**
- Purpose: Schema definition, migrations, seed data
- Location: `backend/prisma/schema.prisma`
- Contains: 23 Prisma models, 23 enums, Supabase PostgreSQL with RLS
- Depends on: PostgreSQL via Supabase
- Used by: PrismaService (singleton NestJS injectable wrapping PrismaClient)

**Frontend Dashboard:**
- Purpose: Full admin/staff SPA for managing pawnshop operations
- Location: `frontend/src/`
- Contains: React 19 components, pages, lib utilities (API client, Supabase client, formatters)
- Depends on: Supabase JS (auth), NestJS backend (data operations)
- Used by: Pawnshop staff, managers, owners, super admins

**Auction Frontend:**
- Purpose: Public-facing auction house website for bidders
- Location: `auction-frontend/src/`
- Contains: React 19 pages (Home, ListingDetail, MyBids, MyWinnings, KYC, Terms, Profile), services, auth context
- Depends on: Supabase JS (auth), NestJS backend (listings, bids)
- Used by: Public bidders

**Mobile App:**
- Purpose: Bidder-facing Flutter mobile application
- Location: `mobile/lib/`
- Contains: Features (auth), core services (BackendApiService, SupabaseService, SecureStorage), shared widgets
- Depends on: Supabase Flutter, NestJS backend (via Dio HTTP), flutter_map for GPS
- Used by: Mobile bidders

## Data Flow

### Primary Request Path (Dashboard → Backend)

1. Frontend calls `api.get()`/`api.post()` (`frontend/src/lib/apiClient.ts:69-137`)
2. `apiClient` attaches auth headers: `Authorization` (Supabase JWT), `pawnshop-id`, `user-id`, `branch-id` (`frontend/src/lib/apiClient.ts:30-67`)
3. Backend receives request → **PawnshopGuard** validates `pawnshop-id` header (`backend/src/common/guards/pawnshop.guard.ts:29-54`)
4. **RbacGuard** validates JWT via Supabase, resolves user profile from DB, checks `@Roles()` decorator (`backend/src/common/guards/rbac.guard.ts:27-92`)
5. **RateLimitGuard** enforces per-endpoint throttle
6. Controller method executes → calls Service → Service uses PrismaService for DB operations
7. **ResponseTransformInterceptor** wraps result in `{ success: true, data: ... }` (`backend/src/common/interceptors/response-transform.interceptor.ts:13-31`)
8. **RequestLoggerInterceptor** logs request/response
9. Frontend unwraps `{ success, data }` envelope in `apiClient` (`frontend/src/lib/apiClient.ts:131-136`)

### Pawn Ticket Lifecycle Flow

1. Staff creates pawn ticket → `RECEIVED` state (`backend/src/loan/pawn-ticket.controller.ts`)
2. Appraiser evaluates → transitions to `APPRAISED` or `PENDING_APPROVAL`
3. Manager approves → transitions to `OFFER_MADE`
4. Customer signs contract → `CONTRACT_SIGNED`
5. Cashier disburses funds → `DISBURSED` → auto-transitions to `ACTIVE`
6. Customer redeems → `REDEEMED` (or overdue → `GRACE_PERIOD` → `FORFEITED` → `AUCTION_QUEUED`)
7. Each transition enforced by `StateMachineService.transition()` with role checks (`backend/src/common/state-machine/pawn-lifecycle.ts:3-25`)
8. Each state change emits `LegalProof` record and `Receipt` via cross-module service calls

### Bidder Registration Flow (Auction Frontend / Mobile)

1. User submits email → `POST /auth/request-auth-code` with `purpose: BIDDER_REGISTRATION`
2. Backend generates 6-digit code, hashes it, attempts email delivery (Brevo → Resend → SMTP fallback), stores in-memory map
3. User receives code → `POST /auth/verify-auth-code` → backend returns `verificationToken`
4. User submits registration form with token → `POST /auth/register-bidder`
5. Backend creates Supabase auth user (admin API) + Prisma profile record with `BIDDER` role
6. Mobile follows same flow via `BackendApiService` (`mobile/lib/core/services/backend_api_service.dart`)

**State Management:**
- Frontend Dashboard: `useState` + `useEffect` hooks in `App.tsx` — no Redux/Zustand; session state managed via Supabase auth listener (`frontend/src/App.tsx:528-583`). Branch/role/subscription state in component-level `useState`.
- Auction Frontend: React Context (`AuthContext`, `BrandingContext`) (`auction-frontend/src/context/`)
- Mobile: **BLoC pattern** (`AuthBloc`) via `flutter_bloc` package (`mobile/lib/features/auth/presentation/bloc/`)
- Backend: Stateless NestJS modules; in-memory Maps for auth codes (`AppService.pendingAuthCodes`, `AppService.verifiedAuthTokens`)

## Key Abstractions

**StateMachineService:**
- Purpose: Enforces legal/operational lifecycle transitions with RBAC
- Examples: `backend/src/common/state-machine/state-machine.service.ts`, `backend/src/common/state-machine/pawn-lifecycle.ts`
- Pattern: Domain registration → transition validation (from/to + allowedRoles)

**PrismaService:**
- Purpose: Singleton Prisma client with auto-reconnect and connection health checks
- Examples: `backend/src/prisma.service.ts`
- Pattern: Extends PrismaClient, implements OnModuleInit/OnModuleDestroy, provides `ensureConnected()` for resilient queries

**ApiClient (Frontend):**
- Purpose: Centralized HTTP client with auto-auth headers, token refresh, error normalization
- Examples: `frontend/src/lib/apiClient.ts`
- Pattern: Module-level singleton with `api.get/post/patch/del` convenience methods

**BackendApiService (Mobile):**
- Purpose: Dio-based HTTP client with retry logic for Flutter
- Examples: `mobile/lib/core/services/backend_api_service.dart`
- Pattern: Singleton with configurable retry/delay, auth header injection

**PawnChargeCalculator:**
- Purpose: Deterministic integer-cents math for pawn interest, penalties, service fees
- Examples: `backend/src/finance/pawn-charge-calculator.ts`
- Pattern: Pure function — `toCents()` → integer math → `fromCents()` → no float drift

## Entry Points

**Backend API:**
- Location: `backend/src/main.ts`
- Triggers: `npm run start:dev` (dev), `node dist/src/main` (prod)
- Responsibilities: Bootstrap NestJS app, configure CORS (localhost + Railway production URLs), Helmet, rate limiting, subscription freeze middleware, global ValidationPipe, global exception filter, global interceptors, listen on `0.0.0.0:PORT`

**Frontend Dashboard:**
- Location: `frontend/src/main.jsx` → `frontend/src/App.tsx`
- Triggers: Vite dev server (`npm run dev`), production build (`npm run build`)
- Responsibilities: Initialize Supabase auth, restore session, resolve user role from profile, render role-based sidebar navigation, route to page components

**Auction Frontend:**
- Location: `auction-frontend/src/main.tsx` → `auction-frontend/src/App.tsx`
- Triggers: Vite dev server (port 5174), production build
- Responsibilities: Wrap in `AuthProvider`, render routes (Home, ListingDetail, KycVerification, Terms, MyBids, MyWinnings, Profile)

**Mobile App:**
- Location: `mobile/lib/main.dart`
- Triggers: Flutter run / build
- Responsibilities: Load dotenv, initialize Supabase, set up BLoC providers, KYC gate check, render MainNavigationScreen (Home/Loans/Auction/Account tabs)

**Prisma Schema:**
- Location: `backend/prisma/schema.prisma`
- Triggers: `npx prisma generate`, `npx prisma db push`, `tsx prisma/seed.ts`
- Responsibilities: Define 23 models mapping to Supabase PostgreSQL `public` schema, manage migrations

## Architectural Constraints

- **Threading:** Single-threaded Node.js event loop for backend. No worker threads. All DB operations are async/await via Prisma.
- **Global state:** `AppService` holds in-memory Maps (`pendingAuthCodes`, `verifiedAuthTokens`) — these do NOT survive restarts and are NOT shared across instances. This is acceptable for single-instance deployment.
- **Circular imports:** No known circular dependency chains. NestJS module system enforces one-directional imports.
- **Multi-tenancy:** Enforced via `pawnshop-id` HTTP header. Backend middleware + service-level queries filter by tenant. RLS policies in Supabase provide database-level isolation.
- **Deployment constraint:** Backend deployed as single instance on Railway. In-memory auth code state is not shared across replicas.

## Anti-Patterns

### Monolithic AppController/AppService

**What happens:** `AppController` (376 lines) and `AppService` (1600+ lines) contain auth endpoints, ticket CRUD, staff management, KYC, customer management, and pawnshop operations — all in one file.
**Why it's wrong:** Violates single-responsibility. Makes it hard to locate, test, or modify individual features. Creates merge conflicts.
**Do this instead:** Extract auth endpoints into `AuthModule`, staff management into `StaffModule`, ticket operations into `LoanModule` (which already exists with `pawn-ticket.controller.ts`). Move remaining endpoints from `AppController` to their respective domain modules.

### Frontend App.tsx Monolith

**What happens:** `frontend/src/App.tsx` is 1400+ lines containing auth logic, sidebar rendering, role resolution, subscription checks, clock-in/out, navigation filtering, and branding — all in a single component.
**Why it's wrong:** Extremely difficult to maintain, test, or modify any single feature. Every change risks regressions across unrelated functionality.
**Do this instead:** Extract into: `AuthProvider` (auth session management), `Sidebar` component (already exists at `frontend/src/components/Sidebar.tsx` but routing logic remains in App), `SubscriptionGuard`, `BranchSelector`, `ClockWidget`. Use React Router properly with layout routes.

### Direct Supabase Client Queries in Frontend

**What happens:** `App.tsx` makes direct `supabase.from('profiles').select(...)` calls for user data (`frontend/src/App.tsx:394-434`, `frontend/src/App.tsx:829-855`), bypassing the NestJS backend.
**Why it's wrong:** Bypasses backend RBAC, validation, and audit logging. Creates inconsistent data access paths. Makes it harder to migrate away from Supabase client-side queries.
**Do this instead:** Route all data access through the NestJS backend API. Use `api.get('/profiles/me')` instead of direct Supabase queries.

### In-Memory Auth State

**What happens:** Auth codes and verification tokens are stored in `Map` objects in `AppService` (`backend/src/app.service.ts:27-46`).
**Why it's wrong:** State is lost on server restart. Cannot scale to multiple instances. No TTL-based cleanup except on next request.
**Do this instead:** Use Redis or a database table for auth code storage with built-in TTL expiration. Acceptable for single-instance deployment but a scaling risk.

## Error Handling

**Strategy:** Global exception filter + per-controller try/catch + NestJS HttpException

**Patterns:**
- `GlobalExceptionFilter` catches all unhandled exceptions and returns consistent error shape (`backend/src/common/filters/global-exception.filter.ts`)
- Controllers wrap service calls in try/catch, re-throw as `HttpException` with `{ success: false, message }` shape
- Frontend `ApiError` class normalizes HTTP errors with `status` and `body` (`frontend/src/lib/apiClient.ts:18-28`)
- Prisma errors caught and re-mapped to user-friendly messages in services
- Auth token refresh: Frontend auto-retries once on 401 (`frontend/src/apiClient.ts:109-118`)

## Cross-Cutting Concerns

**Logging:** `RequestLoggerInterceptor` logs all incoming requests (`backend/src/common/interceptors/request-logger.interceptor.ts`). NestJS `Logger` class used throughout services.
**Validation:** Global `ValidationPipe` with `whitelist: true`, `forbidNonWhitelisted: true`, `forbidUnknownValues: true` (`backend/src/main.ts:336-346`). DTOs use `class-validator` decorators.
**Authentication:** Supabase Auth (JWT). Backend verifies tokens via `supabaseAdmin.auth.getUser(token)`. Frontend holds session via `supabase.auth.getSession()`.
**Authorization:** `@Roles()` decorator on controller methods → `RbacGuard` checks user role from profile table. `@Public()` decorator skips auth. SUPER_ADMIN bypasses all role checks.
**Audit Trail:** `AuditLogInterceptor` intercepts sensitive operations. `LegalProof` service creates immutable proof records for every financial transaction.
**Rate Limiting:** Express-rate-limit middleware in `main.ts` (global). `@Throttle()` decorator for per-endpoint overrides.
**CORS:** Configurable via env vars (`FRONTEND_URL`, `AUCTION_FRONTEND_URL`, `CORS_ALLOWED_ORIGINS`). Hardcoded Railway production URLs plus localhost dev patterns.
**Security Headers:** Helmet.js with `crossOriginResourcePolicy: cross-origin`.

---

*Architecture analysis: 2026-07-17*
