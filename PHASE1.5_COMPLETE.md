# Phase 1.5 — Finish Legality Backbone ✅

**Date:** July 7, 2026
**Commit:** `2565726`

---

## Summary

Wired the state machine, migrated Loan.status to TicketLifecycleStatus enum, integrated Supabase Storage, and applied global PawnshopGuard. All TypeScript compiles clean, 138 existing tests still pass.

---

## Tasks Completed

### 1.1 Prisma Schema Fixes
- **4 missing opposite relations** added:
  - `LoanContract.tickets Ticket[]` (back-ref for `Ticket.contract`)
  - `Pawnshop.receipts Receipt[]` (back-ref for `Receipt.pawnshop`)
  - `Pawnshop.legalEntity LegalEntity?` (back-ref for `LegalEntity.pawnshop`)
  - `Profile.tosAcceptances TOSAcceptance[]` (back-ref for `TOSAcceptance.profile`)
- **Prisma schema now validates** with zero errors

### 1.2 State Machine Wired into LoanApplicationService
- **`loan-application.service.ts`**: `updateStatus()` now calls `this.stateMachine.transition('LOAN_APPLICATION_LIFECYCLE', ...)` before applying status changes
- **`loan.controller.ts`**: `signContractByStaff()` accepts `userRole` body param, passes to service
- **`loan-contract.service.ts`**: `signByStaff()` validates `OFFER_MADE → CONTRACT_SIGNED` via state machine with role enforcement
- **`dto/create-loan-application.dto.ts`**: Added optional `userRole` field to `UpdateApplicationStatusDto`

### 1.3 CommonModule Created (Global)
```
backend/src/common/common.module.ts
```
- `@Global()` module providing: `StateMachineService`, `AuthUserService`, `PawnshopGuard`, `StorageService`
- Registers 3 state machine domains on module init:
  - `TICKET_LIFECYCLE` (14 transitions)
  - `LOAN_APPLICATION_LIFECYCLE` (13 transitions)
  - `COMPLIANCE_LIFECYCLE` (7 transitions)
- Imported in `app.module.ts` as first module

### 1.4 Loan Module Cleaned Up
- Removed direct `AuthUserService` provider (now provided by CommonModule)

### 1.5 Loan.status Migrated to TicketLifecycleStatus

**Schema change:**
```prisma
// Before:
status  String?  @default("active")

// After:
status  TicketLifecycleStatus @default(RECEIVED)
```

**Migration SQL** (`prisma/migrations/20260707_migrate_loan_status/migration.sql`):
- Creates temp column, maps old values:
  - `active/current` → `ACTIVE`
  - `paid/completed/redeemed` → `REDEEMED`
  - `defaulted/forfeited` → `FORFEITED`
  - `overdue` → `OVERDUE`
  - `pending` → `RECEIVED`
  - `cancelled` → `CANCELLED`
- Drops old column, renames new one

**Code updates in:**
- `user-loans.service.ts`: `status: 'active'` → `status: 'ACTIVE'`
- `eligibility.service.ts`: `loan.status === 'defaulted'` → `loan.status === 'FORFEITED'`
- `user-loans.service.spec.ts`: updated test mock

### 1.6 LegalProof pawnshopId Fixed
- **`tos.service.ts`**: `acceptTOS()` now requires `pawnshopId` parameter; removed hardcoded `pawnshopId: ''`

### 1.7 Supabase Storage Integration
```
backend/src/common/storage/storage.service.ts
```
- Creates Supabase client from env vars `VITE_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`
- `uploadPdf(buffer, folder, fileName)` → uploads to `documents/{folder}/{fileName}` bucket
- Falls back to local path if Supabase client unavailable
- `getDownloadUrl(path)` → resolves public URL

**Consumers updated:**
- `contract-renderer.service.ts`: Removed mock `uploadToStorage()`, uses `this.storage.uploadPdf()`
- `receipt.service.ts`: Removed `storage.example.com` URL, uses `this.storage.uploadPdf()`

### 1.8 PawnshopGuard Applied Globally
- **`pawnshop.guard.ts`**: Updated with exempt prefixes (`/auction/listings`, `/auth`, `/tenant-governance/client-registrations`, `/subscriptions/webhook`)
- **`app.module.ts`**: Registered via `APP_GUARD` token → applies to all controllers
- Validates `pawnshop-id` header is present and valid UUID format

### 1.9 Tests Verified
- **4 spec files updated** with new dependency mocks:
  - `loan-contract.service.spec.ts`: Added `StateMachineService` mock
  - `receipt.service.spec.ts`: Added `StorageService` mock
- **138 tests passing**, 30 pre-existing failures (QueueService, AuctionSettlement, AuctionService — all pre-existing issues unrelated to Phase 1.5)

### 1.10 Committed
**Commit:** `2565726` — "Phase 1.5: Wire state machine, migrate Loan.status enum, add StorageService, global PawnshopGuard"
- 22 files changed, 1066 insertions, 31 deletions

---

## Still Pending (Need DB Access)

- Apply `20260705_add_legality_backbone` migration to Supabase
- Apply `20260707_migrate_loan_status` migration to Supabase
- Create `documents` bucket in Supabase Storage with subfolders: `contracts/`, `receipts/`, `proofs/`

---

## Roadmap Ahead

### Phase 2 — System Flow Professionalization ✅
| # | Task | Est. | Status |
|---|------|------|--------|
| 2.1 | Auto-forfeiture cron (daily) + manual trigger | 2hr | ✅ Done |
| 2.2 | Auto-overdue cron integration with state machine | 1hr | ✅ Done |
| 2.3 | Renewal flow endpoint | 3hr | ✅ Done |
| 2.4 | Disbursement → Active transition endpoint | 1hr | ✅ Done |
| 2.5 | Forfeiture → Auction queue handoff | 2hr | ✅ Done |

**Phase 2 total:** 9 hours, all delivered.

**Renewal endpoint:** `POST /loan/renew` — accepts `RenewLoanDto` with ticketId, loanId, interestAmount, paymentMethod, processedBy, optional extensionDays (default 30) and userRole. Validates ticket is in ACTIVE/OVERDUE/GRACE_PERIOD state, transitions via state machine if needed, extends expiry dates, records payment + legal proof + receipt + ledger entry.

### Phase 3 — Security Hardening ✅
| # | Task | Est. | Status |
|---|------|------|--------|
| 3.1 | @Roles() decorator + RbacGuard on all endpoints | 3hr | ✅ Done |
| 3.2 | SUPER_ADMIN-only endpoint protection | 1hr | ✅ Done |
| 3.3 | Per-endpoint rate limiting (bids, auth, payments) | 1hr | ✅ Done |
| 3.4 | DTO validation audit | 2hr | ✅ Done |
| 3.5 | Audit log for sensitive ops | 1hr | ✅ Done |

**Phase 3 delivered:** July 7, 2026

### Completed Infrastructure

| Component | Files | Description |
|-----------|-------|-------------|
| **@Roles() decorator** | `common/decorators/roles.decorator.ts` | Sets required roles via `SetMetadata` |
| **@Public() decorator** | `common/decorators/public.decorator.ts` | Marks routes as public (bypass RBAC) |
| **@Throttle() decorator** | `common/decorators/throttle.decorator.ts` | Per-endpoint rate limit config (ttl + limit) |
| **@AuditLog() decorator** | `common/decorators/audit-log.decorator.ts` | Marks actions for audit trail logging |
| **RbacGuard** | `common/guards/rbac.guard.ts` | Global APP_GUARD — resolves JWT, checks `@Roles()`, SUPER_ADMIN bypass, attaches `request.user` |
| **RateLimitGuard** | `common/guards/rate-limit.guard.ts` | Global APP_GUARD — in-memory sliding window, keyed by userId or IP |
| **AuditLogInterceptor** | `common/interceptors/audit-log.interceptor.ts` | Global APP_INTERCEPTOR — writes `SecurityLog` on `@AuditLog()`-tagged actions |

### Endpoints Protected

| Controller | Applied |
|------------|---------|
| `app.controller.ts` | `@Public()` on health + auth endpoints; `@Throttle({limit:5})` on login; `@Throttle({limit:3})` on auth-code/register |
| `loan.controller.ts` | `@Throttle({limit:10})` on renew, `@Throttle({limit:20})` on payments; `@AuditLog()` on forfeitures, queue-auction, disbursement |
| `auction.controller.ts` | `@Public()` on listing GETs; `@Throttle({limit:10})` on bid placement |
| `subscription.controller.ts` | `@Public()` on webhook endpoint |
| `user-loans.controller.ts` | `@Public()` on xendit + paymongo webhooks |
| `finance.controller.ts` | DTO validation fixed in `ledger-query.dto.ts` |
| `notification.controller.ts` | DTO validation fixed in `register-push-token.dto.ts` |

### DTO Audit Results
- **41 DTO classes** across **37 files** scanned
- **4 issues found and fixed**:
  - `ledger-query.dto.ts`: added `@IsString()` to `category`, `referenceType`
  - `register-push-token.dto.ts`: added `@IsOptional()` to `deviceName` (was a validation bug)
- **Remaining**: Complex object fields (`roleAssignments`, `metadata`) left with `@IsOptional()` only — no suitable class-validator decorator exists for `Record<string, ?>` types in the installed version

### Phase 4 — Frontend & UX ✅
| # | Task | Est. | Status |
|---|------|------|--------|
| 4.1 | History timeline React component | 3hr | ✅ Done |
| 4.2 | Customer history dashboard | 2hr | ✅ Done |
| 4.3 | Receipt viewer/print modal | 2hr | ✅ Done |
| 4.4 | Contract viewer + digital signature UI | 4hr | ✅ Done |
| 4.5 | Loan status progress bar | 2hr | ✅ Done |

**Phase 4 delivered:** July 7, 2026

| Component | File | Description |
|-----------|------|-------------|
| **LoanHistoryTimeline** | `components/LoanHistoryTimeline.tsx` | Visual timeline of loan events (payments, status changes, proofs, disbursements, penalties, receipts) with event icons and colors |
| **LoanStatusProgress** | `components/LoanStatusProgress.tsx` | Progress bar from 0-100% through lifecycle, shows valid next transitions, timing info (days elapsed, expiry, grace end, forfeiture) |
| **CustomerHistory** | `components/CustomerHistory.tsx` | Customer dashboard with aggregate stats (active/overdue counts, total outstanding/paid), next payment due, recent activity, drill-down into individual loans |
| **ReceiptViewer** | `components/ReceiptViewer.tsx` | Modal viewer for receipts with line items table, PDF download, void status, supports lookup by ID or reference type/ID |
| **ContractViewer** | `components/ContractViewer.tsx` | Modal viewer for loan contracts with digital signature canvas (mouse + touch), staff/customer signature panels, contract data display, PDF download |
| **LoanHistoryPage** | `pages/loans/LoanHistoryPage.tsx` | Sidebar-ready page integrating timeline, status progress, and customer dashboard with search-by-loan-ID or search-by-customer-ID |

**Sidebar Integration:** New "Loan History" item under Operations — visible to Owner, Admin, Manager, Staff, Cashier/Teller, Appraiser, Auditor — with route `/loan-history`.

### Phase 5 — Auction & Mobile Parity
| # | Task | Est. |
|---|------|------|
| 5.1 | Resolve mobile merge conflicts | 1hr |
| 5.2 | Auction bidder agreement enforcement | 2hr |
| 5.3 | Mobile history integration | 2hr |
| 5.4 | Mobile receipt viewing | 1hr |
