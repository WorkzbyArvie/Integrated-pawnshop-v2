# Phase 9: KYC Verification & Disbursement Guardrail - Research

**Researched:** 2026-08-08
**Domain:** KYC verification flow (NestJS/Prisma), RBAC permissions, Supabase RLS + storage security
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Customer KYC Capture (KYC-01)
- **D-01:** Customer KYC is captured staff-assisted in-store. A new tenant-scoped endpoint in the `backend/src/kyc/` module upserts a `CustomerKyc` row from counter data (fullName, contactNumber, address, idType, idNumber, idFrontUrl, idBackUrl?, selfieUrl?, verificationData?) and sets status to `PENDING`.
- **D-02:** `Customer.kycStatus` is the denormalized source of truth read by all gates (cheap, no join). `CustomerKyc.status` mirrors it. Every write path (upsert submit, review approve/reject) updates BOTH columns in one transaction.
- **D-03:** Self-serve customer KYC submission is NOT built this phase (pawn walk-ins have no account; `CreatePawnTicketDto` carries name/contact and `resolveCustomerId` find-or-creates the customer). Self-serve remains a deferred future requirement.

#### Review Surface & Permissions (KYC-02)
- **D-04:** New `backend/src/kyc/` module (directory already holds `kyc-validation.ts`). Tenant-scoped endpoints: `GET /kyc/customers` (pending/all, scoped to caller's pawnshop) gated by `kyc.view`; `PATCH /kyc/customers/:id/review` (decision `VERIFIED|REJECTED` + optional `rejectionReason`) gated by `kyc.verify`. Tenant scoping follows the Phase 8 approval-module pattern (callerPawnshopId from the request user).
- **D-05:** Existing SUPER_ADMIN-only bidder endpoints (`GET /auth/kyc/pending`, `GET /auth/kyc/all`, `PATCH /auth/kyc/:id/review` in app.controller.ts) are untouched — auction-bidder domain stays separate.
- **D-06:** `kyc.view` + `kyc.verify` are currently granted to OWNER (permissions.const.ts:72-73) and ADMIN (:88-89) only. Add BOTH to MANAGER to satisfy the KYC-02 OWNER/MANAGER wording (MANAGER block at :91-113).
- **D-07:** New `frontend/src/components/CustomerKycReview.tsx` reusing `BidderKycReview.tsx` styling/patterns (image links, approve/reject with reason), wired into the admin side nav.

#### Gate Placement & Strictness (KYC-03 / KYC-04)
- **D-08:** Hard-block (409 conflict with a clear message) at all three gates. No soft `PENDING_KYC` lifecycle states, no exemptions.
- **D-09:** Gate anchors: `pawnTicketService.createTicket` (and the mobile ticket-creation path `POST /tickets/mobile` in app.controller.ts:313), `approveWithContract` (both `POST /pawn-tickets/:id/manager-approve` and `/pawn-tickets/:id/approve`), and `loanService.disburseLoan` (`POST /loans/:loanId/disburse`, loan.controller.ts:245). Each resolves the ticket/loan → `customerId` → `Customer.kycStatus` and rejects unless `VERIFIED`.
- **D-10:** Enforcement order matters: creating an unverified customer's ticket is impossible, so the approve/disburse gates are defense-in-depth for the Phase 8 PENDING_APPROVAL→OFFER_MADE→disburse chain rather than the primary control.
- **D-11:** Loan application creation is NOT gated — only disbursement (KYC-04 verbatim). A loan can be created/approved but cannot be disbursed until the customer is VERIFIED.

#### KYC Storage Security (KYC-05)
- **D-12:** Enable RLS on `bidder_kyc` with three tiers: (a) own-row read for the bidder (`auth.uid() = profile_id`), (b) tenant-staff read via a policy join through staff pawnshopId, (c) service-role bypass for super-admin. `bidder_kyc` has no `pawnshopId` column — the tenant-staff tier uses a join, no schema change.
- **D-13:** Flip the Supabase `kyc-documents` storage bucket from public-read to private. Document rendering in `BidderKycReview.tsx` (public `<a href>` links, lines ~185-193) and the new `CustomerKycReview.tsx` switches to signed URLs (parse stored object path → `supabase.storage.from('kyc-documents').createSignedUrl(...)`).
- **D-14:** Deliverables are migration SQL (to run against Supabase — dev DB historically unreachable, `getaddrinfo ENOTFOUND`) plus mocked Prisma specs. No live-DB test dependency.

### the agent's Discretion
- Exact kyc-module endpoint paths/DTO shapes and the upsert/review service signatures — follow the Phase 8 approval-module conventions.
- Signed-URL helper implementation (path parsing from stored public URLs, TTL).
- Demo seed data: add a few VERIFIED customers with `CustomerKyc` rows so the post-gate demo flow works end-to-end (existing seeds default to NOT_SUBMITTED and would otherwise be hard-blocked).
- RLS policy function shape for the tenant-staff join.

### Deferred Ideas (OUT OF SCOPE)
- Self-service customer KYC submission from the mobile app — future requirement (REQUIREMENTS.md Future list).
- Admin KYC analytics / verification-rate dashboard — future requirement.
- Super-admin global customer-KYC review view — deliberately skipped this phase to keep the surface tenant-scoped; bidder KYC already has a super-admin view.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| KYC-01 | Customer record carries KYC verification status linked to a KYC record | `Customer.kycStatus` (schema.prisma:53) + `CustomerKyc` (schema.prisma:1885) already migrated in Phase 7 baseline (20260731120000_v2_schema_baseline). Activation is data-flow work: new `KycModule` upsert endpoint + dual-column sync (D-01/D-02). |
| KYC-02 | OWNER/MANAGER can review client KYC submissions, set VERIFIED/REJECTED | Tenant-scoped `GET /kyc/customers` + `PATCH /kyc/customers/:id/review` gated by `kyc.view`/`kyc.verify` (D-04). Permission defs at permissions.const.ts:31-32; grants exist for OWNER (:72-73) + ADMIN (:88-89); MANAGER block (:91-113) needs both added (D-06). New `CustomerKycReview.tsx` (D-07). |
| KYC-03 | Pawn ticket creation and approval require client KYC = VERIFIED | Gate anchors verified: `createTicket` (pawn-ticket.service.ts:29, resolves customer :33), `approveWithContract` (:269, both manager-approve :59 and approve :108 routes), mobile path `POST /tickets/mobile` (app.controller.ts:313). All read `Customer.kycStatus` via ticket.customerId (required FK, schema.prisma:268). |
| KYC-04 | Loan disbursement blocked when client KYC ≠ VERIFIED | `disburseLoan` (loan.service.ts:626) → loan → `customerId` → `Customer.kycStatus`. Loan application creation intentionally NOT gated (D-11). |
| KYC-05 | KYC document storage secured — RLS on `bidder_kyc`, `kyc-documents` bucket no longer public-read | Current state verified: `SUPABASE_STORAGE_RLS_FIX.sql` creates bucket with `public=true` (:9) and `storage_public_read_supported_buckets` policy `to public` (:22-28). `bidder_kyc` has NO RLS (no policies in repo SQL). Signed-URL rendering required after flip; `createSignedUrl` needs a `storage.objects` SELECT policy for the caller. |

## Summary

Phase 9 activates the dormant `CustomerKyc` schema (already migrated in Phase 7) into a tenant-scoped, staff-assisted customer-KYC verification flow, and hard-blocks the pawn loan pipeline (ticket create, ticket approve, loan disburse) until the customer is VERIFIED. The backend work is a new `backend/src/kyc/` module mirroring the Phase 8 approval-module conventions (tenant scoping via `callerPawnshopId`, `@RequiresPermission` guards, mocked-Prisma specs), plus three gate checks and one validation fix (National ID 12-digit vs the current 16-digit bug at kyc-validation.ts:129-131). No schema changes are required — the Phase 7 baseline already shipped `Customer.kycStatus`, `CustomerKyc`, and the `[pawnshopId, status]` index.

The security half (KYC-05) is the highest-risk part. The `kyc-documents` bucket is currently `public=true` with a `to public` SELECT policy on `storage.objects` ([VERIFIED] SUPABASE_STORAGE_RLS_FIX.sql:9,22-28), and `bidder_kyc` has no RLS at all. Flipping the bucket to private is not a one-line change: three frontend consumers call `getPublicUrl` on `kyc-documents` (AuctionMarketplace.tsx:515, PendingAccessDashboard.tsx:166, and BidderKycReview.tsx's stored full-URL `<a href>` links at :185-193), and Supabase's `createSignedUrl` requires the caller to have a SELECT policy on `storage.objects` — the current `to public` policy must become `to authenticated` + bucket scoping, or review links 403 after the flip. The RLS design is a SQL deliverable (dev DB unreachable, `getaddrinfo ENOTFOUND` — D-14), with mocked-Prisma specs as the executable contract.

**Primary recommendation:** Build the backend-first in four vertical slices — (1) KycModule upsert/list/review + MANAGER permission grant + 12-digit fix, (2) three KYC gates + mobile path + dual-column sync, (3) RLS migration SQL + private-bucket flip + signed-URL helper + `CustomerKycReview.tsx`, (4) demo seed data. All gate behavior must be covered by unit specs with mocked Prisma; the RLS SQL is applied manually against Supabase and verified by the user.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| KYC record persistence & dual-column status sync | API / Backend | Database / Storage | Prisma writes `CustomerKyc` + `Customer.kycStatus` in one interactive `$transaction` (D-02) — app-layer authority, per Phase 7 documented architecture |
| KYC gate enforcement (ticket create/approve, disburse) | API / Backend | — | Gates read denormalized `Customer.kycStatus` inside service methods; RLS is bypassed by service-role by design, so the app guard is the authority |
| KYC review surface & RBAC | API / Backend | Browser / Client | Tenant-scoped endpoints gated by `kyc.view`/`kyc.verify` via `@RequiresPermission` + RbacGuard; UI (`CustomerKycReview.tsx`) is a thin consumer |
| KYC document access control | Database / Storage | API / Backend | RLS on `bidder_kyc` + private `kyc-documents` bucket + `storage.objects` policies are the enforcement layer; the backend/frontend generate signed URLs |
| Signed-URL rendering | Browser / Client | API / Backend | Review UIs mint `createSignedUrl` per document; a shared helper (frontend util) parses stored paths |
| National ID validation | API / Backend | — | `kyc-validation.ts` normalizer + format rules (12-digit PhilSys fix) reused by the upsert DTO |

## Standard Stack

This phase introduces **zero new npm dependencies** — everything needed is already in `backend/package.json` and the frontend. Verified against the repo's lockfile entries.

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @nestjs/common / @nestjs/core | ^10.0.0 | Module, controller, service, `ConflictException` (409), DI | Existing stack; KYC module mirrors approval module conventions [VERIFIED: backend/package.json] |
| @nestjs/config | ^4.0.3 | Supabase URL/key env config | Existing storage wiring |
| @prisma/client / prisma | ^5.22.0 | `CustomerKyc` upsert, gates' `Customer.kycStatus` reads, interactive `$transaction` for dual-column sync | Existing stack; schema already migrated (20260731120000_v2_schema_baseline) |
| @supabase/supabase-js | ^2.90.1 | `createSignedUrl` / `getPublicUrl` for `kyc-documents` | Existing dependency; supports both public URLs (pre-flip) and signed URLs (post-flip) |
| class-validator + class-transformer | ^0.14.1 / ^0.5.1 | DTO validation on upsert/review endpoints | Global ValidationPipe (main.ts:364-369 whitelist) already active |
| jest + ts-jest | ^29.5.0 | Unit specs with mocked Prisma | Existing test setup; `testRegex: .*\.spec\.ts$`, `rootDir: src` |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @nestjs/testing | ^10.0.0 | Module-level spec harness for KycModule | Unit tests for KycService/KycController |
| supertest | ^6.3.3 | e2e route tests (optional this phase) | Only if controller wiring test needed; unit-level mocking is the established pattern |
| express-rate-limit / @nestjs/throttler | ^7.5.0 | Per-endpoint rate limiting on review endpoints | Optional hardening; existing RateLimitGuard pattern from Phase 3 |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Interactive `prisma.$transaction(async tx => ...)` for dual-column sync | Two sequential awaits | Two awaits can interleave writes and leave `Customer.kycStatus`/`CustomerKyc.status` divergent — breaks D-02's invariant |
| `ConflictException` (built-in, → 409) | `BadRequestException` (400) or custom error | D-08 mandates 409 with a clear message; `ConflictException` maps exactly and is already used in the codebase |
| Signed URLs via `createSignedUrl` (Supabase SDK) | Hand-built expiring-token URL scheme | Supabase already implements HMAC-signed URLs + RLS checks; hand-rolling is a security anti-pattern |
| RLS policies as SQL deliverable | Prisma migrate for RLS | Prisma does not manage Postgres policies; RLS belongs in Supabase SQL migrations (D-14) |

**Installation:** none required — all packages are already installed. `npm run build` in `backend/` regenerates Prisma client.

**Version verification:** `backend/package.json` (read 2026-08-08): NestJS ^10.0.0, @prisma/client ^5.22.0, @supabase/supabase-js ^2.90.1, jest ^29.5.0. Local `npx prisma --version` from repo root reports 7.9.1 only because the global runner was invoked outside `backend/` — the project pins 5.22.0. Node v26.4.0 / npm 11.17.0 present on this machine.

## Package Legitimacy Audit

**No new packages are installed by this phase.** The audit gate therefore has nothing to vet: the entire stack above is already declared in `backend/package.json` (verified directly, 2026-08-08). The only new "dependency" is the RLS SQL deliverable, which has no package surface.

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| @nestjs/common | npm | 6+ yrs | high (100M+/wk) | github.com/nestjs/nest | OK | Existing — no action |
| @prisma/client | npm | 6+ yrs | high | github.com/prisma/prisma | OK | Existing — no action |
| @supabase/supabase-js | npm | 5+ yrs | high | github.com/supabase/supabase-js | OK | Existing — no action |

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none
**New installs required:** none — do NOT add any package to `backend/package.json` or `frontend/package.json` during this phase.

## Architecture Patterns

### System Architecture Diagram

```
                 ┌──────────────────────────────────────────────────────┐
                 │                  Supabase (Postgres)                  │
                 │                                                      │
 ┌──────────┐    │  ┌─────────────────┐   ┌──────────────────────────┐  │
 │ Frontend │    │  │  customer_kyc   │   │   bidder_kyc  (RLS ON)   │  │
 │ Dashboard│    │  │  + Customer.    │   │   tier a: own-row read   │  │
 │ (React)  │    │  │  kyc_status     │   │   tier b: tenant-staff   │  │
 └────┬─────┘    │  │  (dual-sync)    │   │   tier c: service_role   │  │
      │ apiClient│  └────────┬────────┘   └──────────────────────────┘  │
      ▼          │           │                                          │
┌────────────────┐  ┌────────▼───────────────┐   ┌──────────────────┐  │
│ NestJS Backend │  │ KycModule              │   │ storage.objects  │  │
│                │  │  upsert/list/review    │   │ kyc-documents    │  │
│ ┌────────────┐ │  └────────────────────────┘   │ (PRIVATE bucket) │  │
│ │ Gate 1:    │ │              │                │  SELECT policy   │  │
│ │ createTicket│ │   ┌─────────▼─────────┐      │  to authenticated│  │
│ │ (incl.     │ │   │ KycService         │      │  + bucket check  │  │
│ │ mobile)    │ │   │ (tenant-scoped,    │      └───────┬──────────┘  │
│ │ Gate 2:    │ │   │  callerPawnshopId) │              │             │
│ │ approve    │ │   └─────────┬─────────┘              │ createSigned│
│ │ Gate 3:    │ │             │ Customer.kycStatus     │ Url         │
│ │ disburse   │ │  ┌──────────▼──────────┐             │             │
│ │ (D-08 409) │ │  │ RbacGuard +         │             │             │
│ └────────────┘ │  │ RequiresPermission  │             │             │
└────────────────┘  └─────────────────────┘             │             │
      │  apiClient (signed URLs, gated by RLS)          │             │
      ▼                                                 ▼             │
 ┌─────────────────────┐   ┌──────────────────────────────────────────┘
 │ CustomerKycReview    │   │ BidderKycReview (migrate to signed URLs)
 │ (admin, kyc.view/    │   │ AuctionMarketplace / PendingAccessDashboard
 │  kyc.verify)         │   │ (flip getPublicUrl → signed-URL helper)
 └─────────────────────┘   └───────────────────────────────────────────
```

**Data flow:** Staff captures KYC at counter → `POST /kyc/customers` upsert (writes both `CustomerKyc` and `Customer.kycStatus=PENDING` in one `$transaction`) → OWNER/MANAGER sees it in `CustomerKycReview.tsx` via `GET /kyc/customers?pawnshopId=caller` → `PATCH /kyc/customers/:id/review` sets `VERIFIED|REJECTED` in both columns → subsequent `createTicket`/`approveWithContract`/`disburseLoan` read `Customer.kycStatus` and hard-block with 409 unless `VERIFIED`. Document access: review UIs mint `createSignedUrl` from stored paths; Supabase enforces the private-bucket RLS policy.

### Recommended Project Structure
```
backend/src/
├── kyc/
│   ├── kyc.module.ts          # imports PrismaModule; controllers/providers/exports KycService
│   ├── kyc.controller.ts      # GET /kyc/customers, PATCH /kyc/customers/:id/review (+ upsert route)
│   ├── kyc.service.ts         # tenant-scoped upsert/list/review; dual-column sync via $transaction
│   ├── dto/
│   │   ├── upsert-customer-kyc.dto.ts
│   │   └── review-customer-kyc.dto.ts
│   ├── kyc-validation.ts      # existing — 12-digit National ID fix only
│   └── kyc.service.spec.ts    # mocked Prisma; gates + dual-sync invariants
frontend/src/
├── components/
│   ├── CustomerKycReview.tsx  # NEW — clone of BidderKycReview styling
│   └── BidderKycReview.tsx    # flip :185-193 to signed URLs
├── lib/
│   └── kycSignedUrl.ts        # NEW — path parse + createSignedUrl helper (shared)
└── pages/                     # admin nav + route wiring for CustomerKycReview
supabase/
└── kyc-rls-migration.sql      # NEW — bidder_kyc RLS + storage.objects policy flip (D-14 deliverable)
backend/prisma/seed.ts         # add VERIFIED demo customers + CustomerKyc rows (discretion)
```

### Pattern 1: Tenant-Scoped Module (mirror Phase 8 approval module)
**What:** A module whose service resolves `callerPawnshopId` from the request user and scopes every query to it; permissions enforced via `@RequiresPermission` + RbacGuard.
**When to use:** Every phase-9 endpoint that touches customer data (KYC-02 review surface).
**Example:**
```typescript
// KycController (pattern from backend/src/approval/approval.controller.ts)
@Controller('kyc')
export class KycController {
  constructor(private readonly kycService: KycService) {}

  @Get('customers')
  @RequiresPermission('kyc.view')
  list(@Req() req: Request) {
    const callerPawnshopId = req.user?.pawnshopId ?? req.headers['pawnshop-id'];
    return this.kycService.listCustomers(callerPawnshopId);
  }

  @Patch('customers/:id/review')
  @RequiresPermission('kyc.verify')
  review(@Param('id') id: string, @Body() dto: ReviewCustomerKycDto, @Req() req: Request) {
    const callerPawnshopId = req.user?.pawnshopId ?? req.headers['pawnshop-id'];
    return this.kycService.review(id, dto, callerPawnshopId, req.user?.id);
  }
}
```
**Caveat:** `main.ts:364-369` ValidationPipe whitelist strips unknown query/body keys — DTO field names must match the client payload exactly (Phase 8 lesson, STATE.md).

### Pattern 2: Dual-Column Status Sync (D-02 invariant)
**What:** Every write updates `Customer.kycStatus` and `CustomerKyc.status` in one interactive transaction so the cheap gate read never diverges from the KYC record.
**When to use:** Upsert submit and review approve/reject.
**Example:**
```typescript
// KycService — interactive transaction guarantees D-02
async review(id: string, dto: ReviewCustomerKycDto, callerPawnshopId: string, reviewedBy: string) {
  const result = await this.prisma.$transaction(async (tx) => {
    const kyc = await tx.customerKyc.update({
      where: { id },
      data: {
        status: dto.decision,
        rejectionReason: dto.decision === 'REJECTED' ? dto.rejectionReason : null,
        reviewedBy,
        reviewedAt: new Date(),
      },
    });
    await tx.customer.update({
      where: { id: kyc.customerId },
      data: { kycStatus: dto.decision },
    });
    return kyc;
  });
  return result;
}
```
[VERIFIED: Prisma interactive $transaction pattern — prisma.io/docs/orm/prisma-client/queries/transactions (CITED)]

### Pattern 3: KYC Gate Check (D-08 hard-block, 409)
**What:** Resolve ticket/loan → customerId → `Customer.kycStatus`; reject unless `VERIFIED`.
**When to use:** `createTicket` (pawn-ticket.service.ts:29), mobile path (app.controller.ts:313), `approveWithContract` (:269), `disburseLoan` (loan.service.ts:626).
**Example:**
```typescript
private async assertCustomerKycVerified(customerId: string): Promise<void> {
  const customer = await this.prisma.customer.findUnique({
    where: { id: customerId },
    select: { kycStatus: true },
  });
  if (!customer || customer.kycStatus !== 'VERIFIED') {
    throw new ConflictException(
      'Customer KYC must be VERIFIED before this action is allowed.',
    );
  }
}
```

### Pattern 4: Storage RLS with Tenant-Staff Join (D-12)
**What:** `bidder_kyc` RLS: own-row (`auth.uid() = profile_id`), tenant-staff via subquery join through `profiles.pawnshop_id`, service-role implicit bypass.
**When to use:** The KYC-05 SQL deliverable.
**Example (SQL):**
```sql
alter table public.bidder_kyc enable row level security;

create policy "bidder_kyc_own_row" on public.bidder_kyc
  for select to authenticated
  using (auth.uid() = profile_id);

create policy "bidder_kyc_tenant_staff" on public.bidder_kyc
  for select to authenticated
  using (
    exists (
      select 1 from public.profiles p
      join public.staff s on s."userId" = p.id
      where p.id = auth.uid()
        and s."pawnshopId" = (select "pawnshopId" from public.bidder_kyc bk where bk.id = bidder_kyc.id)
    )
  );
```
**Note:** `service_role` bypasses RLS automatically [VERIFIED: Supabase docs — service role bypasses RLS incl. storage.objects]; the explicit super-admin tier is optional documentation, not enforcement. Exact join shape is the agent's discretion (CONTEXT).

### Pattern 5: Signed-URL Helper (D-13)
**What:** Parse the stored public URL string back to its object path, then mint a time-limited signed URL (TTL ≤ 7 days).
**When to use:** BidderKycReview.tsx :185-193, CustomerKycReview.tsx, and the two `getPublicUrl('kyc-documents')` consumers (AuctionMarketplace.tsx:515, PendingAccessDashboard.tsx:166).
**Example:**
```typescript
// frontend/src/lib/kycSignedUrl.ts
import { supabase } from '../lib/supabaseClient';

/** Stored URLs look like https://<ref>.supabase.co/storage/v1/object/public/kyc-documents/<path> */
export function storagePathFromPublicUrl(url: string): string | null {
  const marker = '/storage/v1/object/public/kyc-documents/';
  const idx = url.indexOf(marker);
  return idx === -1 ? null : decodeURIComponent(url.slice(idx + marker.length));
}

export async function kycSignedUrl(storedUrl: string | null, expiresIn = 3600): Promise<string | null> {
  if (!storedUrl) return null;
  const path = storagePathFromPublicUrl(storedUrl);
  if (!path) return null;
  const { data, error } = await supabase
    .storage
    .from('kyc-documents')
    .createSignedUrl(path, expiresIn);
  return error ? null : data?.signedUrl ?? null;
}
```
[VERIFIED: createSignedUrl(path, expiresIn) signature + 7-day TTL cap — supabase.com/docs/reference/javascript/file-buckets-createsignedurl; expiresIn max 604800s — supabase storage API docs]

### Anti-Patterns to Avoid
- **Sequential writes for dual-column sync:** `await prisma.customerKyc.update(...); await prisma.customer.update(...)` without a transaction — a failure between the two leaves gates reading stale `kycStatus`. Use interactive `$transaction`.
- **Flipping the bucket without fixing consumers first:** after `public=false`, every existing `getPublicUrl`-based document link 403s. Migrate consumers (BidderKycReview, AuctionMarketplace:515, PendingAccessDashboard:166) to the signed-URL helper in the same change as the bucket flip.
- **Keeping the `to public` SELECT policy while flipping the bucket:** signed URLs still enforce the caller's SELECT policy on `storage.objects` — the current `storage_public_read_supported_buckets` policy (`to public`, SUPABASE_STORAGE_RLS_FIX.sql:22-28) must be dropped and replaced with `to authenticated` + `bucket_id = 'kyc-documents'`, or documents remain publicly downloadable regardless of bucket visibility.
- **Gating via `CustomerKyc` join instead of `Customer.kycStatus`:** D-02 exists precisely to keep gate reads a single cheap column read; joining the KYC table adds a query and risks reading a row that D-02's sync already covers.
- **Adding kyc permissions to STAFF:** D-06 adds MANAGER only. STAFF captures data at the counter (upsert is not permission-gated by `kyc.view` in the approved decision list), but staff must NOT be able to list/review other customers' KYC.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Expiring document URLs | Custom HMAC/token scheme | Supabase `createSignedUrl` | Supabase already signs + validates against RLS; custom schemes are a security anti-pattern and drift from platform behavior |
| Postgres RLS enforcement | Prisma-level WHERE filtering on bidder_kyc | SQL policies in a migration | RLS is enforced by the DB for any client (anon/authenticated) direct access; app-layer filtering does not stop `supabase` client reads |
| 409 conflict responses | Custom exception/status codes | Nest `ConflictException` (built-in) | Existing codebase convention; maps to 409 with message; no new dependency |
| DTO validation | Hand-written field checks in service | class-validator decorators + global ValidationPipe | Already wired (main.ts:364-369); whitelist behavior is the established contract |
| Atomic dual-write | Two independent awaits | Prisma interactive `$transaction` | Guarantees D-02 invariant; rolls back on any failure |
| 12-digit National ID normalization | Custom regex in each gate | Reuse `normalizeAndValidateKycIdNumber` (kyc-validation.ts) | Single source of truth; the spec set already asserts the correct 12-digit behavior |

**Key insight:** Every deceptively complex problem in this phase (URL expiry, DB security, validation, atomicity) has a platform/built-in solution already present in the stack. The phase's real work is *wiring and gating*, not building infrastructure.

## Runtime State Inventory

> Included because KYC-05 mutates live Supabase state (bucket visibility + RLS policies) and existing stored rows carry URLs that break under the new policy.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `bidder_kyc` rows store full public-URL strings (`idFrontUrl`/`idBackUrl`/`selfieUrl` — verified app.service.ts:1996-1999, 2129-2131). After the bucket flip these URLs 403 for clients. | No data migration — the signed-URL helper parses the path from the stored URL string at render time (Pattern 5), so historical rows keep working. Verify with one real row post-flip. |
| Live service config | Supabase `kyc-documents` bucket currently `public=true` (SUPABASE_STORAGE_RLS_FIX.sql:9) with `storage_public_read_supported_buckets` policy `to public` (:22-28). `bidder_kyc` has NO RLS policies. | SQL deliverable (D-14): flip bucket to private, drop public policy, add authenticated SELECT policy; enable RLS on `bidder_kyc` + 3-tier policies. Must be run manually in Supabase SQL Editor — not in git alone. |
| OS-registered state | None — no OS/registry registration involved. | — |
| Secrets/env vars | `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`/`SUPABASE_ANON_KEY` in `backend/.env` (untracked, working-tree modified) and `frontend/.env`. No key renames this phase. | None — verify the anon key is used client-side (needed for `createSignedUrl` from the browser) and the service key stays server-side only. |
| Build artifacts | None — no binary/package rename. Prisma client regenerated by `npm run build` (scripts/prisma-generate-safe.js). | None. |

**Canonical question answered:** After every repo file is updated, the live Supabase project still has a public bucket + permissive policy + no `bidder_kyc` RLS — that is the migration SQL deliverable, and it cannot be verified from git alone.

## Common Pitfalls

### Pitfall 1: 16-digit vs 12-digit National ID (known bug)
**What goes wrong:** `kyc-validation.ts:129-131` enforces `^\d{16}$` for `NATIONAL_ID`, so a valid PhilSys PSN (12 digits, e.g. `1234-5678-9012`) is rejected. `kyc-validation.spec.ts:41-50` asserts the correct 12-digit behavior and is currently failing (2 tests).
**Why it happens:** The PhilSys Number (PSN) is a randomly generated 12-digit number [CITED: PSA PhilSys FAQ via prior research]; the validator predates that fact.
**How to avoid:** Change the NATIONAL_ID branch to `^\d{12}$` (after hyphen stripping via `normalizeKycIdNumberForCompare`); run `kyc-validation.spec.ts` to green.
**Warning signs:** `kyc-validation.spec.ts` red; National ID captures of valid 12-digit IDs failing at the counter.

### Pitfall 2: Signed URLs 403 after bucket flip
**What goes wrong:** Bucket set private + public SELECT policy dropped, but no `to authenticated` SELECT policy on `storage.objects` for `kyc-documents` → `createSignedUrl` returns null/403 for every document.
**Why it happens:** `createSignedUrl` requires the caller to pass the storage SELECT policy for the object [VERIFIED: Supabase docs — signed URLs require SELECT access to the object].
**How to avoid:** Ship the policy replacement in the same SQL deliverable as the bucket flip; test a real signed URL immediately after applying.
**Warning signs:** Review screens show broken image links; `data.signedUrl` null with RLS error in console.

### Pitfall 3: Public-URL consumers missed in the flip
**What goes wrong:** `BidderKycReview.tsx:185-193` renders stored full-URL hrefs directly; `AuctionMarketplace.tsx:515` and `PendingAccessDashboard.tsx:166` call `getPublicUrl('kyc-documents', path)`. Post-flip, all three break.
**Why it happens:** The flip's blast radius spans components beyond the review screens (verified via grep — 7 `getPublicUrl` call sites across the frontend; 3 target `kyc-documents`).
**How to avoid:** Grep for `kyc-documents` and `getPublicUrl` before the flip; route all three through the shared `kycSignedUrl` helper.
**Warning signs:** Grep finds `getPublicUrl` calls on `kyc-documents` still present at review time.

### Pitfall 4: Dual-column drift
**What goes wrong:** `Customer.kycStatus` and `CustomerKyc.status` diverge — gate reads say VERIFIED while the record says PENDING (or vice versa).
**Why it happens:** Non-transactional writes or an early-return path between the two updates.
**How to avoid:** Single interactive `$transaction` per write path (Pattern 2); spec asserts both columns updated together.
**Warning signs:** Review screen status ≠ gate behavior for the same customer.

### Pitfall 5: MANAGER permission grant missing
**What goes wrong:** KYC-02 says OWNER/MANAGER, but `kyc.view`/`kyc.verify` are granted to OWNER + ADMIN only (permissions.const.ts:72-73, 88-89; MANAGER block :91-113 lacks both). MANAGER review fails with 403.
**Why it happens:** The catalog predates the KYC-02 wording decision (D-06).
**How to avoid:** Add both to the MANAGER array; update `permissions-catalog.spec.ts` expectations (it asserts exact tuples per role).
**Warning signs:** Manager gets 403 on `/kyc/customers`; catalog spec red after the change.

### Pitfall 6: Dev DB unreachable breaks verification
**What goes wrong:** Live-DB-dependent verification fails (`getaddrinfo ENOTFOUND` — documented STATE.md; D-14). Prisma `migrate` cannot run against Supabase from this machine reliably.
**Why it happens:** Network/DNS isolation of the dev environment from the hosted DB.
**How to avoid:** Keep the executable contract as mocked-Prisma specs; ship RLS as SQL for manual Supabase execution; never gate phase completion on a live-DB operation.
**Warning signs:** Any plan task assuming a reachable Postgres.

### Pitfall 7: Seed data default blocks the demo
**What goes wrong:** `Customer.kycStatus` defaults to `NOT_SUBMITTED` (schema.prisma:53, migration :180), and seeds create customers without KYC — the post-gate demo path 403s at ticket creation for every existing customer.
**Why it happens:** D-08 hard-blocks with no exemptions; old demo customers are all unverified.
**How to avoid:** Add a few VERIFIED customers + `CustomerKyc` rows to `backend/prisma/seed.ts` (agent's discretion).
**Warning signs:** Demo ticket creation fails with the KYC 409 for pre-existing customers.

## Code Examples

Verified patterns from official sources:

### Signed URL creation (Supabase JS v2)
```typescript
// Source: supabase.com/docs/reference/javascript/file-buckets-createsignedurl
const { data, error } = await supabase
  .storage
  .from('kyc-documents')
  .createSignedUrl('folder/selfie.png', 3600);

if (error) {
  console.error('Signed URL error:', error.message);
} else {
  console.log(data.signedUrl); // expires after 3600s
}
```
[VERIFIED: official JS reference; expiresIn max 604800s (7 days) per storage API docs]

### RLS policy replacement for storage.objects (KYC-05)
```sql
-- Replace the permissive public-read policy (SUPABASE_STORAGE_RLS_FIX.sql:22-28)
drop policy if exists "storage_public_read_supported_buckets" on storage.objects;

create policy "storage_kyc_documents_authenticated_read"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'kyc-documents'
  );
```
[VERIFIED: storage.objects policy mechanics — supabase.com/docs/guides/storage/security/access-control; storage.foldername(name) available for path-scoped variants]

### Interactive transaction (Prisma)
```typescript
// Source: prisma.io/docs/orm/prisma-client/queries/transactions
const result = await prisma.$transaction(async (tx) => {
  // 1. update CustomerKyc
  // 2. update Customer.kycStatus
  // any throw rolls back both
  return result;
});
```
[CITED: Prisma official docs — interactive transactions support conditionals + rollback]

### Existing gate anchor to extend — createTicket
```typescript
// backend/src/loan/pawn-ticket.service.ts:29-35 (verified)
async createTicket(dto: CreatePawnTicketDto, createdBy: string) {
  let customerId: string;
  try {
    customerId = await this.resolveCustomerId(dto, createdBy);
  } catch (err) {
    throw new Error(`resolveCustomerId failed: ${err.message}`);
  }
  await this.assertCustomerKycVerified(customerId); // <-- new gate (D-08)
  // ... existing ticket creation
}
```

### National ID validator fix
```typescript
// backend/src/kyc/kyc-validation.ts:129-131 (verified current bug)
if (idType === 'NATIONAL_ID' && !/^\d{16}$/.test(compareValue)) {
  throw new Error('National ID must contain exactly 16 digits'); // BUG
}
// fix:
if (idType === 'NATIONAL_ID' && !/^\d{12}$/.test(compareValue)) {
  throw new Error('National ID must contain exactly 12 digits');
}
// kyc-validation.spec.ts:41-50 already asserts '1234-5678-9012' → '123456789012' (12 digits)
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `kyc-documents` public bucket + `to public` SELECT policy | Private bucket + `to authenticated` SELECT policy + signed URLs | This phase (KYC-05) | Any anon user can no longer fetch KYC documents by URL; review UIs mint expiring signed URLs |
| No RLS on `bidder_kyc` (anon can read all rows) | 3-tier RLS: own-row, tenant-staff join, service-role bypass | This phase (KYC-05, D-12) | Auction-bidder PII scoped to owner + tenant staff |
| National ID validated at 16 digits | 12 digits (PH PhilSys PSN) | This phase (in-scope fix) | Valid PSNs accepted; `kyc-validation.spec.ts` greens |
| Customer KYC dormant (`NOT_SUBMITTED` for all) | Activated: staff upsert → PENDING → OWNER/MANAGER review → VERIFIED/REJECTED | This phase (KYC-01/02) | Loan pipeline gains a real compliance gate |

**Deprecated/outdated:**
- `storage_public_read_supported_buckets` policy (SUPABASE_STORAGE_RLS_FIX.sql:22-28): deprecated by KYC-05; replaced by the authenticated-scoped policy. Note the same fix file also made `loan-documents`/`loan-contracts` public-read — KYC-05 only flips `kyc-documents`; leave the others as-is unless a later phase scopes them.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `supabase` client is configured and exported from `frontend/src/lib/supabaseClient.ts` (or equivalent module path) | Signed-URL helper | Helper import path wrong → build error; verify the actual supabase client module during planning |
| A2 | `req.user.pawnshopId` is populated for staff/manager tokens by the existing auth flow (Phase 8 pattern uses `req.headers['pawnshop-id']` fallback) | KycService tenant scoping | If pawnshopId only comes from header, list/review endpoints must read the same way as approval.service — mirror it exactly |
| A3 | The upsert endpoint's permission: decision list doesn't specify one for `POST /kyc/customers`; assumed it is gated only by authentication + RbacGuard role membership (STAFF captures at counter) — NOT by `kyc.view` | Upsert endpoint | If a `kyc.*` permission is wanted on upsert, STAFF needs a new grant (currently has none — verified :115-120) |
| A4 | `CustomerKyc` upsert is keyed by `customerId` (unique, schema.prisma) — the endpoint receives the customer UUID from the frontend | Upsert DTO | If the frontend only has name/contact (walk-in, D-03), `resolveCustomerId` must run server-side before upsert — plan for customer resolution inside the upsert path |
| A5 | `permissions-catalog.spec.ts` asserts exact per-role tuples and must be updated when MANAGER gains `kyc.view`/`kyc.verify` | MANAGER grant | If the catalog spec auto-derives from the const, no update needed; if it hard-codes tuples, it will go red — verify during planning |
| A6 | Signed-URL TTL ≤ 7 days (604800s) is acceptable for the review screens; helper uses 3600s default | Signed-URL helper | If reviewer sessions exceed 1h, links expire mid-review — use 3600s + re-mint on open, or 86400s (1 day) |

## Open Questions

1. **KYC capture UI — is there a form to collect customer KYC at the counter?**
   - What we know: `SalesPos.tsx` exists and surfaces ticket creation; CONTEXT says staff capture at the counter; decision D-01 requires an upsert endpoint.
   - What's unclear: whether `SalesPos.tsx` (or another screen) has an input form for fullName/contactNumber/address/idType/idNumber/document URLs, or whether Phase 9 must also add the capture UI (CONTEXT integration points say "KYC status surfaced in SalesPos so staff know when capture is needed" — implies minimal UI work, but the actual form fields may not exist).
   - Recommendation: Planner should include a small capture form/modal in the phase (staff-assisted capture is a phase deliverable per the phase boundary) — flag for user confirmation of scope.

2. **How are KYC document files uploaded today, and where is the upload code?**
   - What we know: `bidder_kyc` rows store full public URLs (app.service.ts submitKyc :1996-2131); frontend uploads via `supabase.storage.from(bucket).upload(...)` (SalesPos.tsx:114, InventoryVault.tsx:156 use getPublicUrl after upload).
   - What's unclear: whether the customer-KYC capture path reuses the same storage bucket/upload flow or needs new upload code in the capture UI.
   - Recommendation: Reuse the existing upload→getPublicUrl pattern for new captures (store the public URL as today); only the *render* path changes to signed URLs.

3. **Mobile ticket path (`POST /tickets/mobile`) — how does it resolve the customer?**
   - What we know: app.controller.ts:313 exists and must gate on KYC (D-09); `createTicket` uses `resolveCustomerId` (pawn-ticket.service.ts:784).
   - What's unclear: whether the mobile path calls `PawnTicketService.createTicket` internally (then gating it once suffices) or builds tickets independently (then a separate gate is needed).
   - Recommendation: Verify the mobile service implementation during planning; if it delegates to `createTicket`, the single gate covers it.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | backend build/tests | ✓ | v26.4.0 | — |
| npm | installs (none needed) | ✓ | 11.17.0 | — |
| Prisma (project-local) | generate/compile | ✓ | ^5.22.0 (backend/package.json) | `npx prisma generate` in backend/ |
| Jest | unit specs | ✓ | ^29.5.0 | — |
| Supabase project (hosted) | KYC-05 SQL application | ✓ (assumed — existing env keys) | — | Manual SQL Editor run (D-14); no live-DB test dependency |
| Supabase CLI | local migrations | ✗ (not installed) | — | Ship raw SQL; user applies in Supabase SQL Editor (established pattern — dev DB unreachable, `getaddrinfo ENOTFOUND`) |
| PostgreSQL dev DB | live verification | ✗ | — | Mocked-Prisma specs only (D-14) |

**Missing dependencies with no fallback:** none — the two unavailable items (Supabase CLI, dev DB) have established fallbacks used by Phases 7-8.

**Missing dependencies with fallback:**
- Supabase CLI → raw SQL migration deliverable applied manually in Supabase SQL Editor.
- Dev PostgreSQL → mocked-Prisma specs as the executable contract; migration SQL is the deliverable.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | jest ^29.5.0 + ts-jest (backend/package.json) |
| Config file | inline in backend/package.json (`rootDir: src`, `testRegex: .*\.spec\.ts$`) |
| Quick run command | `npm test -- kyc-validation` (single file, < 5s) |
| Full suite command | `npm test` (backend) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| KYC-01 | Upsert creates `CustomerKyc` PENDING + sets `Customer.kycStatus` in one transaction | unit (mocked Prisma) | `npm test -- kyc.service` | ❌ Wave 0 |
| KYC-01 | `normalizeAndValidateKycIdNumber` accepts 12-digit PhilSys PSN | unit | `npm test -- kyc-validation` | ✅ `backend/src/kyc/kyc-validation.spec.ts` (2 tests RED — fix targets) |
| KYC-02 | `GET /kyc/customers` tenant-scoped; requires `kyc.view` | unit | `npm test -- kyc.controller` | ❌ Wave 0 |
| KYC-02 | `PATCH /kyc/customers/:id/review` sets VERIFIED/REJECTED dual-column; requires `kyc.verify` | unit | `npm test -- kyc.service` | ❌ Wave 0 |
| KYC-02 | MANAGER role grants `kyc.view` + `kyc.verify` | unit | `npm test -- permissions-catalog` | ✅ `backend/src/common/permissions/permissions-catalog.spec.ts` (update expectations) |
| KYC-03 | `createTicket` rejects non-VERIFIED customer with 409 | unit (mocked Prisma) | `npm test -- pawn-ticket.service` | ✅ spec exists (extend) |
| KYC-03 | `approveWithContract` rejects non-VERIFIED customer with 409 | unit | `npm test -- pawn-ticket.service` | ✅ spec exists (extend) |
| KYC-03 | Mobile ticket path gates on KYC | unit | `npm test -- app.service` | ✅ spec exists (extend) |
| KYC-04 | `disburseLoan` rejects non-VERIFIED customer with 409 | unit | `npm test -- loan.service` | ✅ `loan.service.spec.ts` exists (extend) |
| KYC-05 | RLS SQL applies (manual) + signed-URL helper parses stored public URL to path | unit (helper) + manual SQL | `npm test -- kycSignedUrl` (if helper in repo) / manual Supabase run | ❌ Wave 0 (helper spec) |

### Sampling Rate
- **Per task commit:** `npm test -- kyc-validation` (fast file-level)
- **Per wave merge:** `npm test` full backend suite
- **Phase gate:** Full suite green before `/gsd-verify-work` (mocked-Prisma only; RLS SQL verified manually against Supabase by the user)

### Wave 0 Gaps
- [ ] `backend/src/kyc/kyc.service.spec.ts` — covers KYC-01 upsert + KYC-02 review dual-column sync + tenant scoping
- [ ] `backend/src/kyc/kyc.controller.spec.ts` — covers route + `@RequiresPermission` decorators (KYC-02)
- [ ] `backend/src/loan/pawn-ticket.service.spec.ts` — extend for KYC-03 gate (create + approve)
- [ ] `backend/src/loan/loan.service.spec.ts` — extend for KYC-04 disburse gate
- [ ] `backend/src/app.service.spec.ts` — extend for mobile ticket path gate
- [ ] `backend/src/common/permissions/permissions-catalog.spec.ts` — update MANAGER tuple
- [ ] `backend/src/kyc/kyc-validation.ts:129` — change 16 → 12 digits (greens the 2 existing failing tests)

## Security Domain

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Existing Supabase Auth + JWT flow unchanged this phase |
| V3 Session Management | no | Existing JWT sessions unchanged |
| V4 Access Control | yes | RBAC via `@RequiresPermission` + RbacGuard (existing); new MANAGER grant (D-06); tenant scoping via callerPawnshopId (D-04); RLS 3-tier on `bidder_kyc` + private bucket + `to authenticated` storage policy (D-12/D-13) |
| V5 Input Validation | yes | class-validator DTOs + global ValidationPipe whitelist; reuse `kyc-validation.ts` validators (name, DOB 18+, PH phone, ID format, `assertValidKycDocumentUrl` https-only) |
| V6 Cryptography | no | No new crypto; signed URLs are HMAC-signed by Supabase platform (never hand-roll) |

### Known Threat Patterns for {NestJS + Prisma + Supabase storage}
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Public KYC document exposure via public bucket URL | Information Disclosure | Flip `kyc-documents` to private; drop `to public` SELECT policy; replace with `to authenticated` + bucket check (KYC-05, D-13) |
| Anonymous read of `bidder_kyc` PII (no RLS today) | Information Disclosure | Enable RLS + 3-tier policies: own-row, tenant-staff join, service-role (D-12) |
| Cross-tenant review access (IDOR on `/kyc/customers/:id/review`) | Elevation of Privilege | Every query scoped by `callerPawnshopId` (mirror approval.service); 404/403 on foreign-tenant IDs |
| Service-role key leaked to client | Information Disclosure | `createSignedUrl` from browser uses ANON key; service key stays server-side only (env rule, `backend/.env` untracked) |
| KYC gate bypass by direct DB/API manipulation | Tampering | Gates live in service layer (D-08/D-09) with mocked-Prisma specs; RLS is bypassed by service-role by design — app guard is the documented authority (Phase 7 architecture) |
| Malicious document URL in upsert payload | Tampering | `assertValidKycDocumentUrl` (https/http only) reused from kyc-validation.ts; signed-URL helper parses only `storage/v1/object/public/kyc-documents/` paths |

## Sources

### Primary (HIGH confidence)
- [VERIFIED: supabase.com/docs/reference/javascript/file-buckets-createsignedurl] — `createSignedUrl(path, expiresIn, options)` signature + examples
- [VERIFIED: Supabase storage API docs (supabase-supabase.mintlify.app/api/rest/storage)] — `expiresIn` max 604800s (7 days); public vs signed URL semantics; storage.objects policy examples
- [VERIFIED: supabase.com/docs/guides/storage/security/access-control] — `storage.objects` RLS policy mechanics; `storage.foldername(name)` path scoping; SELECT needed for read/download/signed URL
- [VERIFIED: Supabase docs — service_role bypasses RLS including storage.objects]
- [VERIFIED: repo codebase] — all codebase claims read directly 2026-08-08: schema.prisma, permissions.const.ts, pawn-ticket.service.ts, loan.service.ts, app.controller.ts, kyc-validation.ts(+spec), BidderKycReview.tsx, SUPABASE_STORAGE_RLS_FIX.sql, seed.ts, package.json

### Secondary (MEDIUM confidence)
- [CITED: prisma.io/docs/orm/prisma-client/queries/transactions] — interactive `$transaction` pattern for dual-column sync
- [CITED: PSA PhilSys FAQ (psa.gov.ph)] — PhilSys Number is a 12-digit randomly assigned number (via prior research session)

### Tertiary (LOW confidence)
- None — all claims verified against codebase or official docs; assumptions isolated in Assumptions Log.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — zero new dependencies; every version verified in backend/package.json
- Architecture: HIGH — gate anchors, permission lines, URL consumers, and bucket state all verified by direct code reads this session
- Pitfalls: HIGH — each pitfall anchored to a verified file/line or documented Supabase behavior
- KYC-05 security design: MEDIUM — Supabase mechanics verified, but the tenant-staff join shape (agent's discretion) and the live bucket flip can only be proven by applying the SQL against the real project

**Research date:** 2026-08-08
**Valid until:** 2026-09-07 (30 days — stable stack, no fast-moving deps introduced)
