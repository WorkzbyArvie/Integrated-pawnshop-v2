# Phase 9: KYC Verification & Disbursement Guardrail - Pattern Map

**Mapped:** 2026-08-08
**Files analyzed:** 25 (10 new, 15 modified)
**Analogs found:** 23 / 25 (2 new-file cases with partial analogs: `kycDocs.ts`, `SECURITY_KYC05_STORAGE_RLS.sql`)

> **Project root for all paths:** `Integrated-pawnshop-v2/` (the actual repo; the thesis-root `.planning/` is empty).

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `backend/src/kyc/kyc.module.ts` (NEW) | module | — | `backend/src/approval/approval.module.ts` | exact |
| `backend/src/kyc/kyc.controller.ts` (NEW) | controller | request-response | `backend/src/approval/approval.controller.ts` | exact |
| `backend/src/kyc/kyc.service.ts` (NEW) | service | CRUD | `backend/src/approval/approval.service.ts` | exact |
| `backend/src/kyc/dto/upsert-customer-kyc.dto.ts` (NEW) | DTO | request-response | `backend/src/approval/dto/decide-approval.dto.ts` + `backend/src/loan/dto/create-pawn-ticket.dto.ts` | role-match |
| `backend/src/kyc/dto/review-customer-kyc.dto.ts` (NEW) | DTO | request-response | `backend/src/approval/dto/decide-approval.dto.ts` | exact |
| `backend/src/kyc/kyc.service.spec.ts` (NEW) | test | CRUD | `backend/src/approval/approval.service.spec.ts` | exact |
| `backend/src/kyc/kyc.controller.spec.ts` (NEW) | test | request-response | `backend/src/approval/approval.controller.spec.ts` | exact |
| `frontend/src/components/CustomerKycReview.tsx` (NEW) | component | request-response | `frontend/src/components/BidderKycReview.tsx` | exact |
| `frontend/src/lib/kycDocs.ts` (NEW) | utility | transform | partial: `frontend/src/lib/apiClient.ts` (module style) + `supabaseClient.ts` (storage client); no existing storage-helper analog | partial |
| `SECURITY_KYC05_STORAGE_RLS.sql` (NEW) | migration | — | `SUPABASE_STORAGE_RLS_FIX.sql` (repo root) | exact |
| `backend/src/kyc/kyc-validation.ts` (MOD) | utility | transform | self (lines 129-131 bug fix) | exact |
| `backend/src/common/permissions/permissions.const.ts` (MOD) | config | — | self (MANAGER block :91-113) | exact |
| `backend/src/common/permissions/permissions-catalog.spec.ts` (MOD) | test | — | self (KNOWN_TUPLES :15-27, MATRIX :31-300) | exact |
| `backend/src/loan/pawn-ticket.service.ts` (MOD) | service | CRUD | self (`createTicket` :29, `approveWithContract` :269) | exact |
| `backend/src/loan/pawn-ticket.service.spec.ts` (MOD) | test | CRUD | self + `approval.service.spec.ts` 2nd describe block (:250-434) | exact |
| `backend/src/loan/loan.service.ts` (MOD) | service | CRUD | self (`disburseLoan` :626) | exact |
| `backend/src/loan/loan.service.spec.ts` (NEW — does NOT exist despite RESEARCH claim) | test | CRUD | `approval.service.spec.ts` mocked-Prisma pattern | role-match |
| `backend/src/app.service.ts` (MOD) | service | request-response | self (`createMobileTicket` :1596) | exact |
| `backend/src/app.service.spec.ts` (NEW — does NOT exist despite RESEARCH claim) | test | request-response | `app.controller.spec.ts` + `approval.service.spec.ts` | role-match |
| `backend/src/app.module.ts` (MOD) | module | — | self (imports :19, registration :44) | exact |
| `frontend/src/components/BidderKycReview.tsx` (MOD) | component | request-response | self (:185-193 signed-URL flip) | exact |
| `frontend/src/pages/admin/SuperAdminComplianceOverview.tsx` (MOD) | component | request-response | self (KYC dialog :540-577 signed-URL flip) | exact |
| `frontend/src/pages/admin/TrialRequestsPanel.tsx` (MOD) | component | request-response | self (preview modal :470-509 signed-URL flip) | exact |
| `frontend/src/components/AuctionMarketplace.tsx` (classified — NO change) | component | producer-only | self (:515 `getPublicUrl` forms stored URL string — COVERAGE.md row 10) | exact |
| `frontend/src/components/PendingAccessDashboard.tsx` (classified — NO change) | component | producer-only | self (:166 `getPublicUrl` forms stored URL string — COVERAGE.md row 10) | exact |
| `frontend/src/App.tsx` (MOD) | config/nav | — | self (TAB_TO_PATH :131-163, navItems :1195-1232, render :1635) | exact |
| `backend/prisma/seed.ts` (MOD) | seed | — | self (customer seed section :83-101) | exact |

---

## Pattern Assignments

### `backend/src/kyc/kyc.module.ts` (module)

**Analog:** `backend/src/approval/approval.module.ts` (full file, 14 lines)

**Core pattern** (lines 1-14):
```typescript
import { Module } from '@nestjs/common';

import { ApprovalController } from './approval.controller';
import { ApprovalService } from './approval.service';
import { PrismaModule } from '../prisma.module';
import { LoanModule } from '../loan/loan.module';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [PrismaModule, LoanModule, NotificationModule],
  controllers: [ApprovalController],
  providers: [ApprovalService],
})
export class ApprovalModule {}
```
**Apply to kyc:** imports `[PrismaModule]` (LoanModule only if KycService injects PawnTicketService — not needed if gates live in loan services, so `PrismaModule` alone likely suffices); controllers `[KycController]`; providers `[KycService]`.

---

### `backend/src/kyc/kyc.controller.ts` (controller, request-response)

**Analog:** `backend/src/approval/approval.controller.ts` (full file, 80 lines)

**Imports pattern** (lines 1-19):
```typescript
import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  RequestMethod,
} from '@nestjs/common';
import type { Request } from 'express';

import { ApprovalService } from './approval.service';
import { ApprovalQueueQueryDto } from './dto/approval-queue-query.dto';
import { DecideApprovalDto } from './dto/decide-approval.dto';
import { AuditLog } from '../common/decorators/audit-log.decorator';
import { RequiresPermission } from '../common/decorators/requires-permission.decorator';
import { PERMISSIONS } from '../common/permissions/permissions.const';
```

**Tenant-scoping pattern** (lines 38-47) — THE pattern to copy for `GET /kyc/customers` and `PATCH /kyc/customers/:id/review`:
```typescript
@Controller('approval-queue')
export class ApprovalController {
  constructor(private readonly approvalService: ApprovalService) {}

  @GetRoot()
  @HttpCode(HttpStatus.OK)
  @RequiresPermission(PERMISSIONS['approval.view_queue'])
  getQueue(@Query() query: ApprovalQueueQueryDto, @Req() req: Request) {
    const user = (req as any).user ?? req;
    return this.approvalService.getQueue(
      query,
      user.pawnshopId ?? req.headers?.['pawnshop-id'],
    );
  }
```
**Key details:**
- `const user = (req as any).user ?? req;` then `user.pawnshopId ?? req.headers?.['pawnshop-id']` — this exact fallback must be mirrored in KycController (RESEARCH A2).
- `@RequiresPermission(PERMISSIONS['kyc.view'])` on list, `@RequiresPermission(PERMISSIONS['kyc.verify'])` on review.
- Use `@Patch('customers/:id/review')` (approval uses `@Post`; D-04 mandates PATCH) and `@Get('customers')`.
- `@AuditLog('KYC_REVIEW')` decorator available from `../common/decorators/audit-log.decorator` for the review route (approval uses `@AuditLog('APPROVAL_APPROVE')` :49, :65).
- `GetRoot` shim (:24-32) is needed only for the root path — not needed here since routes are `customers` / `customers/:id/review`.
- REVIEW DTO body: pass `@Body() dto: ReviewCustomerKycDto` and `req` user id for `reviewedBy`.

---

### `backend/src/kyc/kyc.service.ts` (service, CRUD)

**Analog:** `backend/src/approval/approval.service.ts` (full file, 222 lines)

**Imports pattern** (lines 1-13):
```typescript
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { NotificationChannel, NotificationType } from '@prisma/client';

import { PrismaService } from '../prisma.service';
import { PawnTicketService } from '../loan/pawn-ticket.service';
import { NotificationService } from '../notification/notification.service';
import { ApprovalQueueQueryDto } from './dto/approval-queue-query.dto';
import { DecideApprovalDto } from './dto/decide-approval.dto';

@Injectable()
export class ApprovalService {
  constructor(
    private prisma: PrismaService,
    private pawnTicketService: PawnTicketService,
    private notificationService: NotificationService,
  ) {}
```

**Tenant-scoped query pattern** (lines 23-37) — copy for `listCustomers(callerPawnshopId)`:
```typescript
async getQueue(query: ApprovalQueueQueryDto, callerPawnshopId: string) {
  const where: any = {
    pawnshopId: callerPawnshopId,
    status:
      query.status === 'DECIDED'
        ? { in: ['APPROVED', 'REJECTED', 'CANCELLED'] }
        : 'PENDING',
  };
  if (query.targetType ?? query.type) where.targetType = query.targetType ?? query.type;

  const records = await this.prisma.approvalRecord.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: { requestedBy: true },
  });
```

**Cross-tenant guard pattern** (lines 119-121) — copy for review:
```typescript
if (record.pawnshopId !== callerPawnshopId && userRole !== 'SUPER_ADMIN') {
  throw new ForbiddenException('Approval record belongs to another pawnshop');
}
```
For KYC: resolve the `CustomerKyc` row first (`findUnique({ where: { id } })`, throw `NotFoundException` if missing like :106), then scope-check `kyc.pawnshopId !== callerPawnshopId` → `ForbiddenException`, and guard `status !== 'PENDING'` → `BadRequestException` (mirror :108-112).

**Dual-column sync (D-02)** — NOT in approval module; use RESEARCH Pattern 2 (interactive `$transaction`). Anchor excerpts from approval service that fit the shape — `update` call :169-177:
```typescript
const updated = await this.prisma.approvalRecord.update({
  where: { id },
  data: {
    status: !approve ? 'REJECTED' : isAppraisalApprove ? 'PENDING' : 'APPROVED',
    decidedById: decidedBy,
    decidedAt: new Date(),
    decisionComment: dto.decisionComment,
  },
});
```
`KycService.review` wraps `tx.customerKyc.update` (status/rejectionReason/reviewedBy/reviewedAt) + `tx.customer.update` (kycStatus) in one `this.prisma.$transaction(async (tx) => {...})` (RESEARCH Pattern 2, lines 220-239 of RESEARCH.md). Upsert path (`upsertCustomerKyc`) similarly: `tx.customerKyc.upsert` + `tx.customer.update({ kycStatus: 'PENDING' })`, reusing validators from `kyc-validation.ts` and `assertValidKycDocumentUrl` for `idFrontUrl`/`idBackUrl`/`selfieUrl`.

**Import for conflict:** `ConflictException` from `@nestjs/common` — existing usage precedent at `backend/src/auction/auction.service.ts:3,225`.

---

### `backend/src/kyc/dto/review-customer-kyc.dto.ts` (DTO, request-response)

**Analog:** `backend/src/approval/dto/decide-approval.dto.ts` (full file, 8 lines):
```typescript
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class DecideApprovalDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  decisionComment?: string;
}
```
**Apply to kyc:** `decision` — `@IsEnum(KycStatus)` restricted to `VERIFIED | REJECTED` (import `KycStatus` from `@prisma/client`, same as approval-queue-query.dto.ts:2) — note ValidationPipe whitelist (`main.ts:364-366`) strips unknown keys, so DTO field names must exactly match the client payload (`decision`, `rejectionReason`).

### `backend/src/kyc/dto/upsert-customer-kyc.dto.ts` (DTO, request-response)

**Analogs:** `decide-approval.dto.ts` (class-validator style) + `backend/src/loan/dto/create-pawn-ticket.dto.ts` (larger counter-form DTO — check `customerId`, `fullName`, `contactNumber`, `pawnshopId` fields for the find-or-create shape). Fields per D-01: `customerId?`, `fullName`, `contactNumber`, `address`, `idType` (`@IsEnum(KycIdType)`), `idNumber`, `idFrontUrl`, `idBackUrl?`, `selfieUrl?`, `verificationData?`. `@IsOptional()` on the optional ones, `@IsString()`/`@MaxLength(...)` on the rest. Reuse `normalizeAndValidatePhoneNumber`, `normalizeKycFullName`, `normalizeAndValidateKycIdNumber`, `assertValidKycDocumentUrl` from `kyc-validation.ts` inside the service or as `@Validate`-style calls — the established codebase style is service-level validator calls (kyc-validation.ts is a plain-function module, not class-validator decorators).

---

### `backend/src/kyc/kyc.service.spec.ts` (test, CRUD)

**Analog:** `backend/src/approval/approval.service.spec.ts` (full file, 434 lines)

**Mocked-Prisma typing pattern** (lines 16-30):
```typescript
let prisma: {
  approvalRecord: {
    create: jest.Mock;
    findMany: jest.Mock;
    findUnique: jest.Mock;
    update: jest.Mock;
  };
  ticket: { findMany: jest.Mock; findUnique: jest.Mock };
};
```
**Harness pattern** (lines 63-73):
```typescript
const module = await Test.createTestingModule({
  providers: [
    ApprovalService,
    { provide: PrismaService, useValue: prisma },
    { provide: PawnTicketService, useValue: pawnTicketService },
    { provide: NotificationService, useValue: notificationService },
  ],
}).compile();

service = module.get(ApprovalService);
```
**For KycService:** mock `prisma.customerKyc = { upsert, findMany, findUnique, update }`, `prisma.customer = { findUnique, update }`, plus `$transaction` — **important:** the mocked `$transaction` must invoke the callback with a `tx` object of mocked models (jest.fn). Cover: upsert dual-column sync (KYC-01), review VERIFIED/REJECTED dual-write + rejectionReason required on REJECTED (KYC-02), tenant scoping + cross-tenant `ForbiddenException` (mirror :237-246), non-PENDING review → `BadRequestException` (mirror :215-224).

---

### `backend/src/kyc/kyc.controller.spec.ts` (test, request-response)

**Analog:** `backend/src/approval/approval.controller.spec.ts` (full file, 102 lines)

**Core pattern** — delegate assertions + metadata reflection (lines 28-51, 73-81):
```typescript
it('GET /approval-queue delegates to ApprovalService.getQueue(query, callerPawnshopId)', async () => {
  approvalService.getQueue.mockResolvedValue([]);
  await controller.getQueue({ targetType: 'APPRAISAL' }, caller);
  expect(approvalService.getQueue).toHaveBeenCalledWith(
    { targetType: 'APPRAISAL' },
    'ps_1',
  );
});

it('exposes GET /approval-queue guarded by approval.view_queue', () => {
  const handler = ApprovalController.prototype.getQueue;
  expect(Reflect.getMetadata('method', handler)).toBe(RequestMethod.GET);
  expect(Reflect.getMetadata('path', handler)).toBe('');
  expect(Reflect.getMetadata(PERMISSIONS_KEY, handler)).toEqual([
    'approval.view_queue',
  ]);
});
```
**For KycController:** assert `PERMISSIONS_KEY` = `['kyc.view']` on `list` and `['kyc.verify']` on `review`, path metadata `'customers'` / `'customers/:id/review'`, `RequestMethod.GET` / `RequestMethod.PATCH`, and that the controller passes `user.pawnshopId ?? headers['pawnshop-id']` through to the service. Caller fixture: `{ id: 'mgr_1', pawnshopId: 'ps_1', role: 'MANAGER' }` (:15).

---

### `frontend/src/components/CustomerKycReview.tsx` (component, request-response)

**Analog:** `frontend/src/components/BidderKycReview.tsx` (full file, 276 lines) — clone styling + flows, swap endpoints

**Imports + status styles** (lines 1-37):
```typescript
import { useEffect, useState, useCallback } from 'react';
import { CheckCircle, XCircle, Clock, Eye, Shield, RefreshCw, ExternalLink, AlertTriangle } from 'lucide-react';
import { api } from '../lib/apiClient';

const STATUS_STYLES: Record<string, { color: string; bg: string; icon: React.ReactNode }> = {
  PENDING: { color: 'text-amber-400', bg: 'bg-amber-500/10', icon: <Clock className="w-4 h-4" /> },
  VERIFIED: { color: 'text-emerald-400', bg: 'bg-emerald-500/10', icon: <CheckCircle className="w-4 h-4" /> },
  REJECTED: { color: 'text-red-400', bg: 'bg-red-500/10', icon: <XCircle className="w-4 h-4" /> },
};
```
**Data load + review action** (lines 58-94) — swap `/auth/kyc/pending`+`/auth/kyc/all` → `GET /kyc/customers?status=pending` and `/auth/kyc/:id/review` → `PATCH /kyc/customers/:id/review`:
```typescript
const load = useCallback(async () => {
  setLoading(true);
  try {
    const data = await api.get<KycRecord[]>('/auth/kyc/pending');
    setRecords(data);
  } catch (err: any) {
    console.error('Failed to load KYC records:', err);
    setRecords([]);
  } finally {
    setLoading(false);
  }
}, [tab]);

const handleReview = async (id: string, decision: 'VERIFIED' | 'REJECTED') => {
  if (decision === 'REJECTED' && !rejectReason.trim()) return;
  setActionLoading(true);
  try {
    await api.patch(`/auth/kyc/${id}/review`, {
      decision,
      rejectionReason: decision === 'REJECTED' ? rejectReason.trim() : undefined,
    });
    setSelected(null);
    setRejectReason('');
    await load();
  } catch (err: any) {
    alert(err.message || 'Review failed');
  } finally {
    setActionLoading(false);
  }
};
```
> **NOTE:** CONTEXT says "Swal confirms" but the actual `BidderKycReview.tsx` uses inline buttons + `alert()` (:78-94, :234-260). Clone the real file, not the description.

**Document links to flip (KYC-05)** — lines 185-193 (public `<a href>` → minted signed URL via `kycDocs`):
```typescript
<a href={selected.idFrontUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm text-[#C9A05C] hover:underline">
  <ExternalLink className="w-3 h-3" /> View ID Front
</a>
{selected.idBackUrl && (
  <a href={selected.idBackUrl} ... ><ExternalLink className="w-3 h-3" /> View ID Back</a>
)}
<a href={selected.selfieUrl} ... ><ExternalLink className="w-3 h-3" /> View Selfie</a>
```
Replace `selected.idFrontUrl` etc. with state resolved through `getSignedKycDocUrl(...)` (D-13).

**Gilded Reserve theme tokens:** `text-[#EAE2D6]`, `text-[#9B9488]`, `bg-[#1C1C26]`, `bg-[#14141C]`, accent `#C9A05C`, `rgba(201,160,92,...)` borders, `fontFamily: "'Syne', sans-serif"` for headings (:100, :139, :173).

---

### `frontend/src/lib/kycDocs.ts` (utility, transform) — partial analog

**No existing storage-helper analog.** Module style from `frontend/src/lib/apiClient.ts` (default-export-free named `export const api`; error-tolerant null returns) and client import from `frontend/src/lib/supabaseClient.ts`:
```typescript
import { createClient } from '@supabase/supabase-js';
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const supabase = createClient(supabaseUrl, supabaseKey);
```
Use RESEARCH Pattern 5 verbatim (RESEARCH.md lines 289-311): `storagePathFromPublicUrl(url)` parses `/storage/v1/object/public/kyc-documents/` prefix, `getSignedKycDocUrl(storedUrl, ttlSeconds = 3600)` calls `supabase.storage.from('kyc-documents').createSignedUrl(path, ttlSeconds)` and throws `'Unable to sign KYC document URL'` on error. Exported functions for vitest unit test (`cd frontend && npx vitest run kycDocs` — new spec file `frontend/src/lib/kycDocs.test.ts` per frontend convention; RESEARCH calls it the signed-URL helper spec).

---

### `SECURITY_KYC05_STORAGE_RLS.sql` (migration) — D-14 deliverable

**Analog:** `SUPABASE_STORAGE_RLS_FIX.sql` (repo root — SQL deliverables live at repo root, not `supabase/`; 09-04 Task 1 creates `SECURITY_KYC05_STORAGE_RLS.sql`).

**Bucket + policy statement style** (SUPABASE_STORAGE_RLS_FIX.sql:6-28):
```sql
-- Run this in Supabase SQL Editor for the target project.
insert into storage.buckets (id, name, public)
values
  ('kyc-documents', 'kyc-documents', true),
  ...
on conflict (id) do nothing;

drop policy if exists "storage_public_read_supported_buckets" on storage.objects;

create policy "storage_public_read_supported_buckets"
on storage.objects
for select
to public
using (
  bucket_id in ('kyc-documents', 'loan-documents', 'loan-contracts')
);
```
**KYC-05 changes:** `public=true` → `false` for `kyc-documents` (update statement), drop `storage_public_read_supported_buckets`, replace with `create policy "storage_kyc_documents_authenticated_read" ... for select to authenticated using (bucket_id = 'kyc-documents');` (COVERAGE.md row 13 — the policy `createSignedUrl` callers pass, else minting 403s); enable `row level security` on `public.bidder_kyc` + 3-tier policies (RESEARCH Pattern 4, RESEARCH.md lines 265-282). Reuse the `drop policy if exists ... on storage.objects;` guard style for idempotent re-runs.

---

### `backend/src/kyc/kyc-validation.ts` (MOD, utility) — 16→12 digit fix

**Self-analog, lines 129-131:**
```typescript
if (idType === 'NATIONAL_ID' && !/^\d{16}$/.test(compareValue)) {
  throw new Error('National ID must contain exactly 16 digits'); // BUG
}
```
Change to `^\d{12}$` + `'National ID must contain exactly 12 digits'` (RESEARCH Pitfall 1, lines 453-463). **Do not touch** `normalizeKycIdNumberForCompare` (:97-102) — the spec asserts hyphenated input `'1234-5678-9012'` normalizes to `'123456789012'` (kyc-validation.spec.ts:41-43). The 2 failing tests at kyc-validation.spec.ts:40-50 are the fix targets — they already assert 12-digit behavior.

---

### `backend/src/common/permissions/permissions.const.ts` (MOD, config) — MANAGER grant

**Self-analog, MANAGER block lines 91-113** — add `'kyc.view'` and `'kyc.verify'` (exact strings from :31-32). Insertion point — after line 109 (`'approval.view_queue',`):
```typescript
MANAGER: [
  'tenant.manage_branches',
  ...
  'approval.view_queue',
  'kyc.view',      // <-- add (D-06)
  'kyc.verify',    // <-- add (D-06)
  'contract.sign',
  ...
],
```

---

### `backend/src/common/permissions/permissions-catalog.spec.ts` (MOD, test)

**Self-analog structure:** `KNOWN_TUPLES` (:15-27) lists allowed role tuples; `MATRIX` (:31-300) maps `'controller.ts::method'` → `{ tuple, permission }`. The spec scans controller files (`findControllerFiles` :302+) and derives tuples from `ROLE_PERMISSIONS` — **after adding MANAGER to `kyc.view`/`kyc.verify` AND creating kyc.controller.ts, the catalog scan will pick up new kyc controller entries automatically** (same mechanism that picked up approval.controller.ts). Planner must:
1. Add the new `'kyc.controller.ts::list'` → `{ tuple: ['OWNER', 'ADMIN', 'MANAGER'], permission: 'kyc.view' }` and `'kyc.controller.ts::review'` → `{ tuple: ['OWNER', 'ADMIN', 'MANAGER'], permission: 'kyc.verify' }` entries to `MATRIX` (or the spec will fail with "unknown site").
2. Verify tuple `['OWNER', 'ADMIN', 'MANAGER']` is in `KNOWN_TUPLES` (it already is, :21) — no KNOWN_TUPLES change needed.
3. If the upsert route is NOT permission-gated (RESEARCH A3), the catalog may flag it — check how the scan treats controllers without `@RequiresPermission` (see the `permissions?: string[]` optional in `Site` interface :9-13) and confirm no entry is expected.

---

### `backend/src/loan/pawn-ticket.service.ts` (MOD, service) — Gate 1 + Gate 2

**Self-analog, imports line 1-13** — add `ConflictException` to the `@nestjs/common` import (line 2 currently: `Injectable, NotFoundException, BadRequestException, ForbiddenException, Logger`).

**Gate 1 — `createTicket` (lines 29-37):** insert `await this.assertCustomerKycVerified(customerId);` right after `resolveCustomerId` resolves (after line 36's try/catch), before `ticketNumber` generation:
```typescript
async createTicket(dto: CreatePawnTicketDto, createdBy: string) {
  let customerId: string;

  try {
    customerId = await this.resolveCustomerId(dto, createdBy);
  } catch (err: any) {
    throw new Error(`resolveCustomerId failed: ${err.message}`);
  }

  await this.assertCustomerKycVerified(customerId); // <-- new gate (D-08)

  const ticketNumber = `TKT-${Math.floor(Date.now() / 1000)}`;
  ...
```

**Gate 2 — `approveWithContract` (lines 269-280):** the ticket already includes `customer: true` (:272), so the gate reads `ticket.customer.kycStatus` — insert after the `NotFoundException`/status guards (:275-280), before `stateMachine.transition` (:282):
```typescript
async approveWithContract(ticketId: number, approvedBy: string, userRole?: string) {
  const ticket = await this.prisma.ticket.findUnique({
    where: { id: ticketId },
    include: { customer: true, pawnshop: { include: { legalEntity: true } } },
  });

  if (!ticket) throw new NotFoundException('Ticket not found');
  ...
  await this.assertCustomerKycVerified(ticket.customerId); // <-- new gate (D-08)
```

**Shared gate helper (private method, RESEARCH Pattern 3 lines 247-259):**
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
`ConflictException` precedent: `auction.service.ts:3,225` (`throw new ConflictException('Bid conflict, please try again')`).

---

### `backend/src/loan/pawn-ticket.service.spec.ts` (MOD, test)

**Self-analog** — the file exists; the second `describe` block in `approval.service.spec.ts` (:250-434) is the exact PawnTicketService harness template (mock `PrismaService` + LegalProofService/LoanContractService/StateMachineService/ReceiptService/FinanceService/NotificationService as `useValue` stubs, :288-335). Add `customer: { findUnique: jest.Mock }` to the prisma mock object and cases:
- `createTicket` with customer `kycStatus: 'NOT_SUBMITTED'|'PENDING'|'REJECTED'` → `rejects.toBeInstanceOf(ConflictException)`; `VERIFIED` → proceeds to `prisma.ticket.create`.
- `approveWithContract` same matrix (mock `ticket.findUnique` returning `{ ...ticket, customerId: 'cust_1' }`).

---

### `backend/src/loan/loan.service.ts` (MOD, service) — Gate 3 (disburse)

**Self-analog, `disburseLoan` (lines 626-646):** the loan already includes `ticket: { include: { customer: true } }` (:629-633). Insert the gate after the `NotFoundException`/`BadRequestException` guards (:634-639) and before the first `stateMachine.transition` (:641):
```typescript
async disburseLoan(loanId: number, processedBy: string, userRole?: string) {
  const loan = await this.prisma.loan.findUnique({
    where: { id: loanId },
    include: {
      ticket: { include: { customer: true } },
      application: { select: { pawnshopId: true } },
    },
  });
  if (!loan) throw new NotFoundException('Loan not found');
  if (!loan.ticket)
    throw new BadRequestException('Loan has no linked ticket');

  await this.assertCustomerKycVerified(loan.ticket.customerId); // <-- new gate (D-08)

  const pawnshopId = loan.application?.pawnshopId || loan.ticket.pawnshopId;
  ...
```
Add the same private `assertCustomerKycVerified` helper (or import a shared one — agent's discretion; the codebase currently has no shared helper module, so a private method per service is the established style). Note `loan.ticket.customerId` is required (schema.prisma:268), so the gate read is a single `customer.findUnique` on the denormalized column (D-02).

**Controller side already wired:** `loan.controller.ts:243-258` `POST :loanId/disburse` → `loanService.disburseLoan` — no controller change needed for Gate 3 (KYC-04).

---

### `backend/src/loan/loan.service.spec.ts` (NEW — RESEARCH claims it exists; verified it does NOT)

**Analog:** mocked-Prisma pattern from `approval.service.spec.ts` (:16-73). `loan.service.ts` has many injected services — follow the PawnTicketService harness pattern (approval.service.spec.ts:288-335) with `useValue: { ...: jest.fn() }` stubs for every constructor dependency of `LoanService` (LegalProofService, ReceiptService, FinanceService, NotificationService, StateMachineService, PawnTicketService if injected). Add `customer: { findUnique: jest.Mock }` and cases: `disburseLoan` with `loan.ticket.customer.kycStatus` non-VERIFIED → `ConflictException`; VERIFIED → proceeds to state machine transition. Note: `disburseLoan`'s mocked prisma must return a `loan` whose `ticket.customer` carries `kycStatus` (the gate reads the included relation — either read from the include or re-query; the helper's `findUnique` mock must be set per-test).

---

### `backend/src/app.service.ts` (MOD, service) — Mobile path gate

**Self-analog, `createMobileTicket` (lines 1596-1636):** this method builds the ticket directly with its own `prisma.ticket.create` — it does NOT delegate to `PawnTicketService.createTicket` (verified :1622-1633), so it needs its own gate. The `customer` record is already in hand (find-or-create :1604-1616). Insert after the customer resolution block, before `ticketNumber` generation:
```typescript
if (customer.kycStatus !== 'VERIFIED') {
  throw new ConflictException('Customer KYC must be VERIFIED before this action is allowed.');
}
```
(or reuse a shared helper). Import `ConflictException` from `@nestjs/common` (check app.service.ts's existing `@nestjs/common` import line — it imports `HttpException, Injectable, ...`; add `ConflictException`).

---

### `backend/src/app.service.spec.ts` (NEW — RESEARCH claims it exists; verified it does NOT)

**Analog:** `backend/src/app.controller.spec.ts` (exists — check its mocked `AppService` harness) + mocked-Prisma pattern from `approval.service.spec.ts`. Cover: `createMobileTicket` with a customer whose `kycStatus !== 'VERIFIED'` → `ConflictException`; `VERIFIED` → ticket created. `AppService` is large with many deps — mirror the PawnTicketService harness's all-stub `useValue` approach (approval.service.spec.ts:288-331).

---

### `backend/src/app.module.ts` (MOD, module registration)

**Self-analog, lines 19 & 44:** add `import { KycModule } from './kyc/kyc.module';` after the ApprovalModule import (:19) and `KycModule,` to the `imports` array after `ApprovalModule` (:44).

---

### `frontend/src/components/BidderKycReview.tsx` (MOD, component) — signed-URL flip

**Self-analog, lines 185-193:** replace the three direct `<a href={selected.idFrontUrl/idBackUrl/selfieUrl}>` anchors with minted signed URLs. Add `getSignedKycDocUrl` import from `../lib/kycDocs` and per-record state or an async resolve-on-select effect (`useEffect` on `selected` → `Promise.all([getSignedKycDocUrl(idFrontUrl), ...])`). Research Pitfall 2/3: post-flip, direct public URLs 403 — the flip must land together with this consumer change.

### `frontend/src/pages/admin/SuperAdminComplianceOverview.tsx` (MOD, component) — KYC dialog :540-577
### `frontend/src/pages/admin/TrialRequestsPanel.tsx` (MOD, component) — preview modal :470-509

Both render kyc-documents public URLs (SuperAdminComplianceOverview: `viewingKyc.idFrontUrl/idBackUrl/selfieUrl` `<img>` inside `<a href>`; TrialRequestsPanel: `previewDoc.file_url` via `<img>`/`<iframe>`/`<a href>` — registration docs stored in `kyc-documents`). Route both through `getSignedKycDocUrl` (09-03 Task 4; D-13; RESEARCH Pitfall 3). Files live under `pages/admin/` — import path `../../lib/kycDocs`.

### `frontend/src/components/AuctionMarketplace.tsx` (classified — NO change) — line 515
### `frontend/src/components/PendingAccessDashboard.tsx` (classified — NO change) — line 166

Both call `supabase.storage.from('kyc-documents').getPublicUrl(path)` to FORM the stored URL string immediately after upload (producer-only, COVERAGE.md row 10) — they never render. **Leave unchanged** (09-03 Task 5 classifies them producer-only; the stored public-URL string is what `getSignedKycDocUrl` parses back to an object path). Upload-side `getPublicUrl` calls on OTHER buckets (SalesPos.tsx:114, InventoryVault.tsx:156, AuctionQueue.tsx:106, OwnerComplianceDashboard.tsx:154 use `appraisal-items`, `loan-documents` etc.) — also unchanged. Only the 4 kyc-documents READ surfaces flip (BidderKycReview, CustomerKycReview, SuperAdminComplianceOverview, TrialRequestsPanel).

---

### `frontend/src/App.tsx` (MOD, nav/route wiring)

**Self-analog, three touch points:**
1. Import (:69): `import BidderKycReview from './components/BidderKycReview';` → add `import CustomerKycReview from './components/CustomerKycReview';`
2. `TAB_TO_PATH` (:131-163): add `'customer-kyc': '/customer-kyc',`
3. `navItems` (:1195-1232): add alongside `bidder-kyc` (:1221) — roles `['Owner', 'Admin', 'Manager']`, `type: 'OPERATIONAL'` (NOT 'PLATFORM' — customer KYC is tenant-scoped, unlike the super-admin bidder screen):
```typescript
{ id: 'customer-kyc', label: 'Customer KYC Review', icon: Shield, roles: ['Owner', 'Admin', 'Manager'], type: 'OPERATIONAL' },
```
4. Render switch (:1635 area): `{activeTab === 'customer-kyc' && <CustomerKycReview branchId={currentBranchId} activeBranchId={activeOperationalBranchId} />}`

---

### `backend/prisma/seed.ts` (MOD, seed data)

**Self-analog, customer seed section (lines 83-101):** after each `prisma.customer.create`, add `kycStatus: 'VERIFIED'` to the `data` object for the demo customers (and optionally `customerKyc: { create: { ... } }` rows — check the `CustomerKyc` relation shape in schema.prisma:1885 first; the relation field name on Customer is `customerKyc` per CONTEXT). Follow the existing inline `create` style:
```typescript
const created = await prisma.customer.create({
  data: {
    id: randomUUID(),
    fullName: c.fullName,
    contactNumber: c.contactNumber,
    address: c.address,
    kycStatus: 'VERIFIED', // <-- add (demo-seed discretion, RESEARCH Pitfall 7)
  },
});
```

---

## Shared Patterns

### Tenant Scoping (callerPawnshopId)
**Source:** `backend/src/approval/approval.controller.ts:41-46` + `approval.service.ts:23-37,119-121`
**Apply to:** `KycController` list/review, `KycService.listCustomers/review`
```typescript
const user = (req as any).user ?? req;
// controller: user.pawnshopId ?? req.headers?.['pawnshop-id'] → pass to service
// service query: where: { pawnshopId: callerPawnshopId }
// service cross-tenant: if (record.pawnshopId !== callerPawnshopId && userRole !== 'SUPER_ADMIN') throw new ForbiddenException(...)
```

### RBAC via @RequiresPermission
**Source:** `backend/src/common/decorators/requires-permission.decorator.ts` (full, 7 lines) + `backend/src/common/guards/rbac.guard.ts`
**Apply to:** All KycController routes
```typescript
export const PERMISSIONS_KEY = 'permissions';
export const RequiresPermission = (...permissions: PermissionName[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
```
Usage: `@RequiresPermission(PERMISSIONS['kyc.view'])` / `PERMISSIONS['kyc.verify']` — new permission strings already defined at `permissions.const.ts:31-32`; only the MANAGER grant (D-06) and the catalog spec need touching.

### 409 Conflict (KYC hard-block)
**Source:** `backend/src/auction/auction.service.ts:3,225` (existing precedent) — `throw new ConflictException('...')`
**Apply to:** `pawn-ticket.service.ts` (createTicket + approveWithContract), `loan.service.ts` (disburseLoan), `app.service.ts` (createMobileTicket)

### Dual-Column Sync Transaction
**Source:** RESEARCH Pattern 2 (RESEARCH.md:219-239) — interactive `prisma.$transaction(async (tx) => {...})` updating `CustomerKyc.status` AND `Customer.kycStatus`; no in-repo analog (approval module uses single-table updates) — this is the one genuinely new backend pattern this phase.

### DTO Validation
**Source:** `backend/src/approval/dto/decide-approval.dto.ts` + global `ValidationPipe` (`backend/src/main.ts:364-366` whitelist: true)
**Apply to:** Both new DTOs — class-validator decorators; field names must match client payload exactly (unknown keys stripped).

### Mocked-Prisma Specs
**Source:** `backend/src/approval/approval.service.spec.ts:16-73` and `:288-335`
**Apply to:** kyc.service.spec.ts, kyc.controller.spec.ts, pawn-ticket.service.spec.ts (extend), loan.service.spec.ts (NEW), app.service.spec.ts (NEW)

### Frontend API Client
**Source:** `frontend/src/lib/apiClient.ts` — `api.get<T>(path, query)`, `api.patch<T>(path, body)`, auto-attaches `Authorization` + `pawnshop-id` headers, unwraps `{ success, data }` envelope (:132-137), throws `ApiError` with `.message`
**Apply to:** CustomerKycReview.tsx load/review calls

### Supabase Storage Client
**Source:** `frontend/src/lib/supabaseClient.ts` — `export const supabase = createClient(supabaseUrl, supabaseKey)` with `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`
**Apply to:** `kycDocs.ts` helper, BidderKycReview/CustomerKycReview/SuperAdminComplianceOverview/TrialRequestsPanel flips

### Gilded Reserve Theme
**Source:** `BidderKycReview.tsx` — tokens `#EAE2D6` (text), `#9B9488` (muted), `#C9A05C` (accent), `#1C1C26`/`#14141C` (surfaces), `rgba(201,160,92,0.08-0.2)` (borders), Syne headings
**Apply to:** CustomerKycReview.tsx

---

## No Analog Found / Discrepancies vs RESEARCH

| File | Role | Data Flow | Reason / Note |
|------|------|-----------|----------------|
| `frontend/src/lib/kycDocs.ts` | utility | transform | No existing storage-URL helper in repo (7 `getPublicUrl` call sites are inline). Use RESEARCH Pattern 5 verbatim + `supabaseClient.ts` import. |
| `SECURITY_KYC05_STORAGE_RLS.sql` | migration | — | No `supabase/` dir exists — existing SQL deliverables live at repo root (`SUPABASE_STORAGE_RLS_FIX.sql`). 09-04 Task 1 delivers `SECURITY_KYC05_STORAGE_RLS.sql` at repo root. |
| `backend/src/loan/loan.service.spec.ts` | test | CRUD | **Does NOT exist** — RESEARCH validation map claims "✅ exists (extend)". Verified via glob: only `user-loans`, `pawn-ticket`, `loan-history`, `loan-contract`, `legal-proof` specs exist. Must be created NEW. |
| `backend/src/app.service.spec.ts` | test | request-response | **Does NOT exist** — RESEARCH claims "✅ spec exists (extend)". Only `app.controller.spec.ts` exists. Must be created NEW. |
| `backend/src/kyc/kyc.service.spec.ts` + `kyc.controller.spec.ts` | test | — | RESEARCH lists as Wave-0 gaps; approval specs are the templates. No conflict. |

**Other planner-relevant facts verified during mapping:**
- `createMobileTicket` (app.service.ts:1596) builds tickets independently — it does NOT call `PawnTicketService.createTicket`, so the mobile gate is a separate insertion (RESEARCH Open Question 3 answered: separate gate needed).
- BidderKycReview.tsx uses inline buttons + `alert()`, not Swal (CONTEXT's "Swal confirms" is inaccurate — clone the actual file).
- Upsert route permission: RESEARCH A3 — decision list does not gate `POST /kyc/customers` with a `kyc.*` permission; STAFF has no kyc grants (permissions.const.ts:115-124). Planner decides: authentication-only upsert (matches D-01 staff-assisted capture) or a new permission.
- `permissions-catalog.spec.ts` auto-scans controller files — new kyc.controller.ts entries must be added to its `MATRIX` (:31-300) or the spec fails.

## Metadata

**Analog search scope:** `backend/src/approval/`, `backend/src/kyc/`, `backend/src/loan/`, `backend/src/common/permissions/`, `backend/src/app.{controller,service,module}.ts`, `backend/prisma/seed.ts`, `frontend/src/components/BidderKycReview.tsx`, `frontend/src/App.tsx`, `frontend/src/lib/`, `SUPABASE_STORAGE_RLS_FIX.sql`
**Files scanned:** ~40 (8 approval-module files fully read; targeted reads of 5 large files: pawn-ticket.service.ts 847→943 lines, loan.service.ts 1071→1156, app.controller.ts 409, app.service.ts 2211, loan.controller.ts 419; full reads of BidderKycReview.tsx 276, seed.ts 169, permissions.const.ts 152, kyc-validation.ts 177 + spec, apiClient.ts 168, supabaseClient.ts 7, SUPABASE_STORAGE_RLS_FIX.sql 58, App.tsx nav regions)
**Pattern extraction date:** 2026-08-08
