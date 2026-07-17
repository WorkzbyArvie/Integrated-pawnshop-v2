# External Integrations

**Analysis Date:** 2026-07-17

## APIs & External Services

**Supabase (Auth, Database, Storage):**
- Full Supabase platform usage: PostgreSQL database, Auth (JWT), and Storage
- Auth: Used for user authentication across all clients (dashboard, auction, mobile)
  - Service role client: `backend/src/main.ts:33-38`, `backend/src/common/auth-user.service.ts`
  - Frontend client: `frontend/src/lib/supabaseClient.ts`
  - Auction client: `auction-frontend/src/lib/supabaseClient.ts`
  - Mobile client: `mobile/lib/config/supabase_config.dart`
- SDK/Client: `@supabase/supabase-js` 2.90+ (backend + web), `supabase_flutter` 2.0.2 (mobile)
- Auth: `SUPABASE_SERVICE_ROLE_KEY` (backend admin), `VITE_SUPABASE_ANON_KEY` (frontend), `SUPABASE_ANON_KEY` (mobile)
- Custom OTP flow implemented in `backend/src/app.service.ts` (request-auth-code → verify-auth-code → register-bidder)
- 10 user roles managed via RBAC: SUPER_ADMIN, OWNER, ADMIN, MANAGER, STAFF, HR, CASHIER_TELLER, APPRAISER, INVENTORY_CUSTODIAN, AUDITOR + BIDDER (mobile)

**PayMongo (Payment Processing - Legacy/Alternative):**
- Subscription billing and payment link creation
- SDK/Client: Direct REST API calls via `fetch` (no SDK)
- Service: `backend/src/subscription/paymongo.service.ts`
- API Base: `https://api.paymongo.com/v1`
- Auth: `PAYMONGO_SECRET_KEY` (Basic auth header)
- Webhook secret: `PAYMONGO_WEBHOOK_SECRET`
- Supports: Plans, Subscriptions, Payment Links, Test Cycles
- Note: Configured but PayMongo provider is secondary to Xendit in current deployment

**Xendit (Payment Processing - Primary):**
- Invoice-based checkout for subscription payments
- SDK/Client: Direct REST API calls via `fetch` (no SDK)
- Service: `backend/src/subscription/paymongo.service.ts` (lines 115-145, 250-289)
- API Base: `https://api.xendit.co`
- Auth: `XENDIT_SECRET_KEY` (Basic auth header)
- Supports: Invoice creation, status retrieval
- Payment methods: Cards, GCash, PayMaya, GrabPay
- Redirect URLs: `XENDIT_SUCCESS_REDIRECT_URL`, `XENDIT_FAILURE_REDIRECT_URL`

**Brevo (Email Delivery - Fallback):**
- Transactional email delivery via Brevo SMTP API
- SDK/Client: Direct REST API calls via `fetch`
- Service: `backend/src/app.service.ts` (lines 209-265)
- API: `https://api.brevo.com/v3/smtp/email`
- Auth: `BREVO_API_KEY`
- Used for: Auth code delivery (OTP)

**Resend (Email Delivery - Fallback):**
- Transactional email delivery via Resend API
- SDK/Client: Direct REST API calls via `fetch`
- Service: `backend/src/app.service.ts` (lines 150-207)
- Auth: `RESEND_API_KEY`

**Nodemailer (Email Delivery - Primary SMTP):**
- Direct SMTP email delivery with multi-provider support
- SDK/Client: `nodemailer` 8.x (`createTransport`)
- Service: `backend/src/app.service.ts` (lines 267-400+)
- Auth: `SMTP_USER` + `SMTP_PASS`
- Providers supported: Gmail, any SMTP server
- Features: IPv4/IPv6 fallback, multiple transport profiles (465/587), DNS resolution optimization
- Timeout tuning: `SMTP_CONNECTION_TIMEOUT_MS`, `SMTP_GREETING_TIMEOUT_MS`, `SMTP_SOCKET_TIMEOUT_MS`

**Leaflet / react-leaflet (Maps - Frontend):**
- Interactive maps for pawnshop location display and location picking
- SDK/Client: `leaflet` 1.9.4, `react-leaflet` 5.0
- Service: Frontend components (`LocationPicker.tsx`, map views)
- No API key required (OpenStreetMap tiles)

**Google Maps / flutter_map (Maps - Mobile):**
- Maps display in mobile app
- SDK/Client: `google_maps_flutter` 2.5.3, `flutter_map` 6.1.0
- Location services: `geolocator` 12.0
- Coordinate handling: `latlong2` 0.9.1

## Data Storage

**Databases:**
- PostgreSQL (via Supabase)
  - Connection: `DATABASE_URL` env var (format: `postgresql://[user]:[password]@[host]:[port]/[database]`)
  - Client: Prisma ORM 5.22 (`@prisma/client`)
  - Schema: `backend/prisma/schema.prisma` (1604 lines, 30+ models, 23+ enums)
  - SSL: Required for Supabase hosts (auto-added in `backend/src/prisma.service.ts:42`)
  - Connection pool: `connection_limit=1`, `pool_timeout=20` (configurable via env)
  - Single schema: `public` (multiSchema preview feature enabled)
  - Legacy: `backend/server.js` uses raw `pg` Pool with up to 20 connections

**File Storage:**
- Supabase Storage
  - Client: `backend/src/common/storage/storage.service.ts`
  - Bucket: `documents` (configurable via `SUPABASE_STORAGE_BUCKET`)
  - Folders: `contracts/`, `receipts/`, `proofs/`
  - Auth: Uses Supabase service role key for admin access
  - Fallback: Local file paths when Supabase is not configured
  - Content type: PDF (contracts, receipts, proofs)

**Caching:**
- In-memory only (no Redis/Memcached)
  - `PaymongoService.planCache` - PayMongo plan ID cache (Map)
  - `AppService.pendingAuthCodes` - OTP code store (Map, ephemeral)
  - `AppService.verifiedAuthTokens` - Verified auth tokens (Map, ephemeral)

## Authentication & Identity

**Auth Provider:**
- Supabase Auth
  - Implementation: JWT-based with Bearer token pattern
  - Token validation: `supabaseAdmin.auth.getUser(token)` in middleware (`backend/src/main.ts:249`)
  - Token refresh: Handled transparently by frontend API client (`frontend/src/lib/apiClient.ts:42-44`)
  - Custom OTP flow: Request auth code → verify code → register/verify bidder (`backend/src/app.service.ts`)
  - Multi-tenant: Pawnshop-scoped access via `pawnshop-id` header

**RBAC (Role-Based Access Control):**
- Custom implementation
  - Guard: `backend/src/common/guards/rbac.guard.ts`
  - Decorator: `backend/src/common/decorators/roles.decorator.ts`
  - 10 user roles + BIDDER
  - Applied globally via `APP_GUARD` in `backend/src/app.module.ts:57`

**Tenant Isolation:**
- Custom multi-tenant guard
  - Guard: `backend/src/common/guards/pawnshop.guard.ts`
  - Header-based: `pawnshop-id` header required for operational endpoints
  - Subscription enforcement: Non-ACTIVE/TRIAL subscriptions block operational access (`backend/src/main.ts:122-333`)

**KYC (Know Your Customer):**
- Custom KYC verification for auction bidders
  - Model: `BidderKyc` in Prisma schema
  - Validation: `backend/src/kyc/kyc-validation.ts`
  - ID types: National ID, Passport, Driver's License, SSS, PhilHealth, TIN, Voter's, Postal
  - Flow: Submit → Pending → Admin Review → Verified/Rejected

## Monitoring & Observability

**Error Tracking:**
- Custom global exception filter
  - Filter: `backend/src/common/filters/global-exception.filter.ts`

**Logs:**
- NestJS Logger (`@nestjs/common` Logger)
  - Used throughout all services (e.g., `backend/src/prisma.service.ts`, `backend/src/subscription/paymongo.service.ts`)
- Request logging interceptor: `backend/src/common/interceptors/request-logger.interceptor.ts`
- Audit log interceptor: `backend/src/common/interceptors/audit-log.interceptor.ts`
  - Decorator: `@AuditLog()` for sensitive operations (`backend/src/common/decorators/audit-log.decorator.ts`)

**Security Logging:**
- `SecurityLog` model in Prisma schema - records auth actions with IP, user agent, success/fail

## Cron Jobs & Scheduled Tasks

**Backend Scheduler (`@nestjs/schedule`):**
- `NotificationService.checkAuctionEndingSoon` - Every minute (15/5/1 minute warnings)
- `NotificationService.processScheduledNotifications` - Every minute (delivery of scheduled notifications)
- `NotificationService.checkComplianceReminders` - Every hour (auction payment deadlines)
- `NotificationService.checkPawnTicketDeadlineReminders` - Every 6 hours (pawn payment deadlines)
- `NotificationService.cleanupExpiredNotifications` - Daily at midnight
- Loan auto-overdue cron (mentioned in AGENTS.md Phase 2)
- Loan auto-forfeiture cron (daily + manual trigger, Phase 2)

## CI/CD & Deployment

**Hosting:**
- Railway
  - Backend: `pawngold-backend-production.up.railway.app` (NestJS)
  - Frontend: `pawngold-production.up.railway.app` (static)
  - Auction Frontend: `pawngold-auction-house-production.up.railway.app` (static)
  - Dev port: Backend 3000, Frontend 5173, Auction 5174

**CI Pipeline:**
- GitHub Agents (`.github/agents/`) - 3 custom agent profiles
  - `flutter expert.agent.md`, `flutter master.agent.md`, `senDev.agent.md`

**Build Commands:**
```bash
# Backend
npm run build        # prisma generate + nest build
npm run start:prod   # node dist/src/main

# Frontend
npm run build        # vite build
npm run preview      # vite preview

# Auction Frontend
npm run build        # tsc -b && vite build

# Mobile
flutter build apk    # Android
```

## Environment Configuration

**Required env vars (Backend):**
- `DATABASE_URL` - PostgreSQL connection string (Supabase)
- `VITE_SUPABASE_URL` - Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` - Supabase service role key
- `PORT` - Server port (default: 3000)
- `NODE_ENV` - Environment mode
- `FRONTEND_URL` - Dashboard frontend URL for CORS
- `AUCTION_FRONTEND_URL` - Auction frontend URL for CORS

**Required env vars (Frontend):**
- `VITE_SUPABASE_URL` - Supabase project URL
- `VITE_SUPABASE_ANON_KEY` - Supabase anonymous key
- `VITE_BACKEND_URL` - Backend API URL

**Required env vars (Auction Frontend):**
- `VITE_SUPABASE_URL` - Supabase project URL
- `VITE_SUPABASE_ANON_KEY` - Supabase anonymous key
- `VITE_BACKEND_URL` - Backend API URL

**Required env vars (Mobile):**
- `SUPABASE_URL` - Supabase project URL
- `SUPABASE_ANON_KEY` - Supabase anonymous key
- `BACKEND_URL` - Backend API URL

**Optional env vars (Backend - Payment):**
- `XENDIT_SECRET_KEY` - Xendit API key (primary payment provider)
- `PAYMONGO_SECRET_KEY` - PayMongo API key (alternative)
- `PAYMONGO_WEBHOOK_SECRET` - Webhook signature verification

**Optional env vars (Backend - Email):**
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` - SMTP delivery
- `SMTP_PROVIDER` - Provider shortcut (e.g., "gmail")
- `BREVO_API_KEY` - Brevo email API fallback
- `RESEND_API_KEY` - Resend email API fallback

**Secrets location:**
- `.env` files per app directory (private repo, committed per `.gitignore` policy)
- Railway environment variables for production

## Webhooks & Callbacks

**Incoming:**
- PayMongo webhook: `POST /loans/paymongo/webhook` (rate-limited skip in `backend/src/main.ts:107`)
- Subscription webhook handling via `PaymongoService.verifyWebhookSignature()`

**Outgoing:**
- Xendit invoice redirect: `XENDIT_SUCCESS_REDIRECT_URL`, `XENDIT_FAILURE_REDIRECT_URL`

**API Proxy (Frontend → Backend):**
- Frontend Vite dev server proxies these paths to backend (`frontend/vite.config.js:40-80`):
  - `/analytics`, `/queue`, `/finance`, `/attendance`, `/payroll`, `/compliance`, `/notifications`, `/subscriptions`
  - All proxy to `http://localhost:3333`

---

*Integration audit: 2026-07-17*
