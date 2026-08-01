# Phase 8: Approval Workflows & Unified Approval Queue - Pattern Map

**Mapped:** 2026-08-01
**Files analyzed:** 17 new/modified files
**Analogs found:** 16 / 17 (1 partial — no controller-spec precedent exists)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `backend/src/approval/approval.module.ts` (NEW) | module | config | `backend/src/loan/loan.module.ts` | exact |
| `backend/src/approval/approval.controller.ts` (NEW) | controller | request-response | `backend/src/loan/pawn-ticket.controller.ts` | exact |
| `backend/src/approval/approval.service.ts` (NEW) | service | CRUD | `backend/src/loan/pawn-ticket.service.ts` + `backend/src/finance/finance.service.ts` | exact |
| `backend/src/approval/dto/decide-approval.dto.ts` (NEW) | dto | validation | `backend/src/loan/dto/appraise-ticket.dto.ts` | exact |
| `backend/src/approval/dto/approval-queue-query.dto.ts` (NEW) | dto | validation | `backend/src/loan/dto/appraise-ticket.dto.ts` | exact |
| `backend/src/approval/approval.service.spec.ts` (NEW) | test | unit | `backend/src/loan/legal-proof.service.spec.ts` | exact |
| `backend/src/approval/approval.controller.spec.ts` (NEW) | test | unit | `backend/src/loan/legal-proof.service.spec.ts` | partial (no controller-spec precedent; use service-spec mock pattern) |
| `backend/prisma/schema.prisma` (EDIT) | model | config | self — `ApprovalRecord` model (lines 1860-1882) | exact |
| `backend/prisma/migrations/<ts>_add_approval_payload/migration.sql` (NEW) | migration | config | `backend/prisma/migrations/20260707_migrate_loan_status/migration.sql` | exact |
| `backend/src/common/state-machine/pawn-lifecycle.ts` (EDIT) | config | state machine | self (lines 3-25) | exact |
| `backend/src/loan/pawn-ticket.service.ts` (EDIT) | service | CRUD | self — `appraiseTicket` (364-439), `redeemTicket` (441-585), `approveWithContract` (249-362) | exact |
| `backend/src/common/permissions/permissions-catalog.spec.ts` (EDIT) | test | unit | self — MATRIX (31-284), count assertions (354-374), 63-site scan (377-448) | exact |
| `backend/src/app.module.ts` (EDIT) | module | config | self — imports array (lines 32-53) | exact |
| `backend/src/common/guards/pawnshop.guard.ts` (EDIT) | middleware | request-response | self — `EXEMPT_PREFIXES` (lines 21-49) | exact |
| `frontend/src/components/ApprovalQueue.tsx` (NEW) | component | request-response | `frontend/src/components/AppraisalApproval.tsx` | exact |
| `frontend/src/components/__tests__/ApprovalQueue.test.tsx` (NEW) | test | unit | `frontend/src/components/__tests__/AuctionQueue.test.tsx` | exact |
| `frontend/src/App.tsx` (EDIT) | route | request-response | self — import (:57), TAB_TO_PATH (:131-162), nav item (:1205), FREE_ALLOWED_NAV (:1232), render (:1619) | exact |

## Pattern Assignments

### `backend/src/approval/approval.module.ts` (module)

**Analog:** `backend/src/loan/loan.module.ts` (imports pattern) + `backend/src/finance/finance.module.ts` (module shape)

**Module shape** (finance.module.ts:1-13):
```typescript
import { Module } from '@nestjs/common';
import { FinanceController } from './finance.controller';
import { FinanceService } from './finance.service';
import { PrismaModule } from '../prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [FinanceController],
  providers: [FinanceService],
  exports: [FinanceService],
})
export class FinanceModule {}
```

**Cross-module imports** (loan.module.ts:22-38) — ApprovalModule imports `LoanModule` (exports `PawnTicketService`, loan.module.ts:48) and `NotificationModule`; one-way dependency, NO `forwardRef` (per RESEARCH):
```typescript
imports: [FinanceModule, ContractModule, ReceiptModule, NotificationModule],
controllers: [LoanController, UserLoansController, PawnTicketController],
providers: [LoanService, ..., PawnTicketService, GracePeriodService],
exports: [..., PawnTicketService, ...],
```

**Registration** — add `ApprovalModule` to `backend/src/app.module.ts` imports array (app.module.ts:32-53), alphabetical placement between `AuctionModule`/`AttendanceModule` and `BrandingModule`:
```typescript
imports: [
  CommonModule,
  ScheduleModule.forRoot(),
  PrismaModule,
  AnalyticsModule,
  AuctionModule,
  // ... add: ApprovalModule,
```

---

### `backend/src/approval/approval.controller.ts` (controller, request-response)

**Analog:** `backend/src/loan/pawn-ticket.controller.ts` — VERIFIED as the project's permission-gated controller pattern (research lines 420-430 cite this exact shape).

**Imports pattern** (pawn-ticket.controller.ts:1-10):
```typescript
import { Controller, Post, Get, Param, Body, Req, Query, HttpCode, HttpStatus, Logger, InternalServerErrorException } from '@nestjs/common';
import type { Request } from 'express';
import { ApprovalService } from './approval.service';
import { DecideApprovalDto } from './dto/decide-approval.dto';
import { ApprovalQueueQueryDto } from './dto/approval-queue-query.dto';
import { AuditLog } from '../common/decorators/audit-log.decorator';
import { RequiresPermission } from '../common/decorators/requires-permission.decorator';
import { PERMISSIONS } from '../common/permissions/permissions.const';
```

**GET list endpoint pattern** (pawn-ticket.controller.ts:92-105) — copy for `GET /approval-queue`:
```typescript
@Get('approval-queue')
@HttpCode(HttpStatus.OK)
@RequiresPermission(PERMISSIONS['approval.view_queue'])
getQueue(
  @Req() req: Request,
  @Query() query: ApprovalQueueQueryDto,
) {
  const user = (req as any).user as { pawnshopId?: string } | undefined;
  return this.approvalService.getQueue(query);
}
```

**POST decide endpoint pattern** (pawn-ticket.controller.ts:107-121 + 123-139) — copy for `POST /approval-queue/:id/approve|reject` with `PERMISSIONS['approval.approve_appraisal']` / `['approval.approve_redemption']`:
```typescript
@AuditLog('APPROVE_APPRAISAL')   // use existing @AuditLog decorator convention
@Post('approval-queue/:id/approve')
@HttpCode(HttpStatus.OK)
@RequiresPermission(PERMISSIONS['approval.approve_appraisal'])
approve(
  @Param('id') id: string,
  @Body() dto: DecideApprovalDto,
  @Req() req: Request,
) {
  const user = (req as any).user as { id: string; role: string } | undefined;
  return this.approvalService.decideApproval(
    id,
    dto,
    user?.id ?? '',
    user?.role,
    true, // approve
  );
}
```

**Error wrapper** (pawn-ticket.controller.ts:28-39) — only the `createTicket` handler wraps in try/catch; the rest let NestJS handle thrown `NotFoundException`/`BadRequestException`/`ForbiddenException` directly. Follow the thin style for queue endpoints (no try/catch — services throw typed exceptions).

---

### `backend/src/approval/approval.service.ts` (service, CRUD)

**Analog:** `backend/src/loan/pawn-ticket.service.ts` (state machine + prisma + notification + LegalProof patterns) + `backend/src/finance/finance.service.ts` (settings getter).

**Class scaffold + constructor** (pawn-ticket.service.ts:15-27):
```typescript
@Injectable()
export class ApprovalService {
  private readonly logger = new Logger(ApprovalService.name);

  constructor(
    private prisma: PrismaService,
    private pawnTicketService: PawnTicketService,   // from LoanModule (one-way)
    private notificationService: NotificationService,
  ) {}
```

**State machine transition pattern** (pawn-ticket.service.ts:377-382) — used for D-03 (approve → OFFER_MADE) and D-04 (reject → RECEIVED):
```typescript
await this.stateMachine.transition(
  'TICKET_LIFECYCLE',
  ticket.lifecycleStatus,
  'OFFER_MADE',
  { userRole },
);
```

**ApprovalRecord chokepoint creation** (NEW pattern — RESEARCH Pattern 1, lines 224-241; note: records are created inside `appraiseTicket`/`redeemTicket` in pawn-ticket.service.ts, NOT in the approval service — this avoids the circular dependency):
```typescript
const approval = await this.prisma.approvalRecord.create({
  data: {
    pawnshopId: this.assertPawnshopId(ticket),
    targetType: 'APPRAISAL',
    targetId: String(ticket.id),
    amount: dto.appraisedValue,
    requestedById: appraisedBy,
    status: 'PENDING',
    payload: {
      appraisedValue: dto.appraisedValue,
      riskScore: dto.riskScore ?? 0,
      recommendedLoanAmount: dto.recommendedLoanAmount,
      itemCondition: dto.itemCondition,
      appraisalNotes: dto.appraisalNotes,
    } as Prisma.InputJsonValue,
  },
});
```

**Tenant settings read** (finance.service.ts:158-174) — copy for the redemption threshold (D-05/D-06); RESEARCH Pattern 2 says read inline in `redeemTicket`:
```typescript
private async getPawnshopSettings(pawnshopId: string): Promise<{
  settings: Record<string, unknown>;
}> {
  const pawnshop = await this.prisma.pawnshop.findUnique({
    where: { id: pawnshopId },
    select: { settings: true },
  });
  if (!pawnshop) {
    throw new NotFoundException('Pawnshop not found');
  }
  const settings = (pawnshop.settings as Record<string, unknown> | null) || {};
  return { settings };
}
```

**Decide + side effects** (RESEARCH Pattern 3, lines 272-297; record update is the audit source of truth — persist LAST):
```typescript
async decideApproval(id: string, dto: DecideApprovalDto, decidedBy: string, userRole?: string, approve = true) {
  const record = await this.prisma.approvalRecord.findUnique({ where: { id } });
  if (!record) throw new NotFoundException('Approval record not found');
  if (record.status !== 'PENDING') throw new BadRequestException('Record already decided');
  if (record.requestedById === decidedBy) throw new ForbiddenException('Cannot approve your own request');

  if (approve) {
    if (record.targetType === 'APPRAISAL') {
      await this.pawnTicketService.applyApprovedAppraisal(Number(record.targetId), record.payload, decidedBy, userRole);
    } else {
      await this.pawnTicketService.releaseApprovedRedemption(Number(record.targetId), { amountPaid: record.amount ?? 0 }, decidedBy, userRole);
    }
  }
  // reject: appraisal → PENDING_APPROVAL → RECEIVED (D-04); redemption → no ticket change (D-12)

  return this.prisma.approvalRecord.update({
    where: { id },
    data: {
      status: approve ? 'APPROVED' : 'REJECTED',
      decidedById: decidedBy,
      decidedAt: new Date(),
      decisionComment: dto.decisionComment,
    },
  });
}
```

**Prisma interactive transaction** (from RESEARCH, for atomic decide when record + ticket must update together):
```typescript
const result = await this.prisma.$transaction(async (tx) => {
  const record = await tx.approvalRecord.update({ /* APPROVED */ });
  const ticket = await tx.ticket.update({ /* apply payload, OFFER_MADE */ });
  return { record, ticket };
}, { maxWait: 2000, timeout: 5000 });
```

**Notification pattern** (pawn-ticket.service.ts:559-571) — wrap in try/catch, never fail the operation:
```typescript
try {
  await this.notificationService.sendNotification({
    recipientId: ticket.customerId,
    channel: NotificationChannel.IN_APP,
    type: NotificationType.PAYMENT_DUE,
    title: 'Item Redeemed Successfully',
    body: `...`,
    data: { ticketId: ticket.id, ticketNumber: ticket.ticketNumber },
  });
} catch (notifErr) {
  console.error('Failed to send notification:', notifErr);
}
```

**`assertPawnshopId` helper** (pawn-ticket.service.ts:740-745) — reuse pattern for record↔ticket pawnshopId reconciliation:
```typescript
private assertPawnshopId(ticket: { pawnshopId?: string | null }): string {
  if (!ticket.pawnshopId) {
    throw new BadRequestException('Ticket is not associated with any pawnshop');
  }
  return ticket.pawnshopId;
}
```

---

### `backend/src/approval/dto/decide-approval.dto.ts` (dto, validation)

**Analog:** `backend/src/loan/dto/appraise-ticket.dto.ts` — class-validator decorator style.

**Core pattern** (appraise-ticket.dto.ts:1-26):
```typescript
import { IsNumber, IsOptional, IsString, Min, Max } from 'class-validator';

export class AppraiseTicketDto {
  @IsNumber()
  @Min(0)
  appraisedValue: number;
  ...
}
```

**For decide-approval.dto.ts** — `decisionComment` required on reject (D-09/D-13), length limits per ASVS V5:
```typescript
import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class DecideApprovalDto {
  @IsBoolean()
  @IsOptional()
  approve?: boolean;             // or use separate approve/reject endpoints (see controller)

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  decisionComment?: string;
}
```

**For approval-queue-query.dto.ts** — type/status filter + pawnshopId/branchId optional strings (mirrors controller `@Query` usage at pawn-ticket.controller.ts:97-98).

---

### `backend/src/approval/approval.service.spec.ts` (test)

**Analog:** `backend/src/loan/legal-proof.service.spec.ts` — the established Jest TestingModule + prisma-mock pattern (no DB needed).

**Core pattern** (legal-proof.service.spec.ts:1-22):
```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { LegalProofService } from './legal-proof.service';
import { PrismaService } from '../prisma.service';

describe('LegalProofService', () => {
  let service: LegalProofService;
  let prisma: Record<string, any>;

  beforeEach(async () => {
    prisma = {
      legalProof: {
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'proof-1', ...data })),
        findMany: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [LegalProofService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<LegalProofService>(LegalProofService);
  });
  ...
});
```

For `approval.service.spec.ts`, mock `approvalRecord.create/findMany/findUnique/update` plus `PawnTicketService` (`{ applyApprovedAppraisal: jest.fn(), releaseApprovedRedemption: jest.fn() }`) and `NotificationService` — cover RBAC-03/04/06 (record creation, threshold gate, decision persistence). Mock `stateMachine.transition` via `{ transition: jest.fn() }` in the PawnTicketService mock set.

---

### `backend/src/approval/approval.controller.spec.ts` (test) — partial analog

**Analog:** `backend/src/loan/legal-proof.service.spec.ts` — no controller-spec exists in the codebase today; use the same TestingModule pattern but with `providers: [ApprovalController, { provide: ApprovalService, useValue: mock }]` (controller + mocked service), and assert endpoint returns + permission metadata. The `permissions-catalog.spec.ts` (see below) is the other controller-surface guard — it scans filesystem for `@RequiresPermission`/`@Roles` decorators, so the new controller is automatically covered by it once MATRIX is extended.

---

### `backend/prisma/schema.prisma` (model — EDIT)

**Analog:** self — `ApprovalRecord` model (schema.prisma:1860-1882). Add `payload Json?` per RESEARCH Pitfall 4:

**Current model** (1860-1872):
```prisma
model ApprovalRecord {
  id              String             @id @default(uuid()) @db.Uuid
  pawnshopId      String             @map("pawnshop_id") @db.Uuid
  targetType      ApprovalTargetType @map("target_type")
  targetId        String             @map("target_id")
  status          ApprovalStatus     @default(PENDING)
  amount          Float?
  requestedById   String             @map("requested_by_id") @db.Uuid
  decidedById     String?            @map("decided_by_id") @db.Uuid
  decidedAt       DateTime?          @map("decided_at")
  decisionComment String?            @map("decision_comment")
  createdAt       DateTime           @default(now()) @map("created_at")
  updatedAt       DateTime           @updatedAt @map("updated_at")
  ...
```

**Add:** `payload Json? @map("payload")` after `decisionComment` (line 1870). Keep `@@index([pawnshopId, status])` and `@@index([targetType, targetId])` as-is. Then run `npm run prisma:generate` in `backend/` (local prisma 5.22 — NOT bare `npx prisma` which resolves 7.9.1).

---

### `backend/prisma/migrations/<timestamp>_add_approval_payload/migration.sql` (migration — NEW)

**Analog:** `backend/prisma/migrations/20260707_migrate_loan_status/migration.sql` — additive ALTER style with header comment + `"public"` schema qualification:

```sql
-- Migration: Add ApprovalRecord.payload JSON column
-- Date: August 1, 2026
ALTER TABLE "public"."approval_records"
ADD COLUMN "payload" JSONB;
```

**Matching DDL reference:** the `approval_records` table already exists from `20260731120000_v2_schema_baseline` (verified by RESEARCH). No backfill needed (table unused — Assumption A6).

---

### `backend/src/common/state-machine/pawn-lifecycle.ts` (config — EDIT)

**Analog:** self (lines 3-25). Two edits per RESEARCH Pitfalls 2-3:

**Current approval-relevant transitions** (lines 8-10):
```typescript
{ from: 'RECEIVED', to: 'PENDING_APPROVAL', allowedRoles: ['APPRAISER', 'STAFF', 'MANAGER', 'OWNER'] },
{ from: 'PENDING_APPROVAL', to: 'OFFER_MADE', allowedRoles: ['MANAGER', 'OWNER'] },
{ from: 'PENDING_APPROVAL', to: 'CANCELLED', allowedRoles: ['MANAGER', 'OWNER'] },
```

**Changes:**
1. Add `'ADMIN'` to `allowedRoles` on `PENDING_APPROVAL -> OFFER_MADE` (line 9) and on `ACTIVE -> REDEEMED` (line 15) + `GRACE_PERIOD -> REDEEMED` (line 18) — D-01 names ADMIN as approver; without this, `stateMachine.transition` throws `ForbiddenException` (state-machine.service.ts:43-50).
2. Add the D-04 return path:
```typescript
{ from: 'PENDING_APPROVAL', to: 'RECEIVED', allowedRoles: ['MANAGER', 'OWNER', 'ADMIN'] },
```

**Do NOT** add new lifecycle states — `PENDING_APPROVAL` already exists in the `TicketLifecycleStatus` enum (schema.prisma:420) and transitions (pawn-lifecycle.ts:8-10).

---

### `backend/src/loan/pawn-ticket.service.ts` (service, CRUD — EDIT)

**Analog:** self. Three edits at verified chokepoints:

**Edit 1 — `appraiseTicket` (364-439):** change transition target `'APPRAISED'` → `'PENDING_APPROVAL'` (line 380), and REMOVE the immediate `loanAmount` write (line 388) per D-02. Instead create the `ApprovalRecord` row (chokepoint pattern above) then return with `lifecycleStatus: 'PENDING_APPROVAL'`. Keep the existing `legalProofService.createProof` + `receiptService.generateReceipt` calls (they emit the appraisal trail). Note the current guard at line 371 checks `lifecycleStatus !== 'RECEIVED'` — keep it (reject-to-reappraise returns the ticket to RECEIVED).

**Edit 2 — `redeemTicket` (441-585):** add threshold gate at the top after the `loan` lookup (line 457). Current include (line 442-445) does NOT load `pawnshop.settings` — extend it (Pitfall 5):
```typescript
const ticket = await this.prisma.ticket.findUnique({
  where: { id: ticketId },
  include: { customer: true, loans: true, pawnshop: { select: { settings: true } } },
});
```
Then (RESEARCH Pattern 2):
```typescript
const REDEMPTION_APPROVAL_THRESHOLD_KEY = 'redemptionApprovalThreshold';
const settings = (ticket.pawnshop?.settings as Record<string, unknown>) ?? {};
const threshold = Number(settings[REDEMPTION_APPROVAL_THRESHOLD_KEY] ?? 50_000);
if (dto.amountPaid > threshold) {
  const approval = await this.prisma.approvalRecord.create({
    data: {
      pawnshopId: this.assertPawnshopId(ticket),
      targetType: 'REDEMPTION',
      targetId: String(ticket.id),
      amount: dto.amountPaid,
      requestedById: processedBy,
      status: 'PENDING',
    },
  });
  return { ticketId: ticket.id, requiresApproval: true, approvalId: approval.id, message: 'Approval required for high-value redemption' };
}
```
Below-threshold flow proceeds unchanged through the existing release (payment → ledger → LegalProof → receipt → tier → notification, lines 468-575) — this is the code `releaseApprovedRedemption` must share/reuse for D-12 (extract the release body into a private method callable by both paths, or have the approval service call `redeemTicket` after threshold is satisfied).

**Edit 3 — new public methods called by ApprovalService (D-03/D-12):** `applyApprovedAppraisal(ticketId, payload, decidedBy, userRole)` — write `loanAmount` from payload (the write forbidden at D-02 now happens here), transition `PENDING_APPROVAL -> OFFER_MADE`, then call the existing `approveWithContract` (249-362) to run the offer flow (RESEARCH Open Question 2 recommends one-click approve). And `releaseApprovedRedemption(ticketId, dto, decidedBy, userRole)` — runs the shared release logic (D-12). **Anti-pattern:** never re-implement contract generation or release — reuse `approveWithContract` / `redeemTicket`.

---

### `backend/src/common/permissions/permissions-catalog.spec.ts` (test — EDIT)

**Analog:** self. Hard counts WILL break when the new controller lands (RESEARCH Pitfall 1). Three edits:

1. **MATRIX** (lines 31-284) — add entries:
```typescript
'approval.controller.ts::getQueue': {
  tuple: ['OWNER', 'ADMIN', 'MANAGER', 'CASHIER_TELLER', 'APPRAISER'],
  permission: 'approval.view_queue',
},
'approval.controller.ts::approveAppraisal': {
  tuple: ['OWNER', 'ADMIN'],
  permission: 'approval.approve_appraisal',
},
'approval.controller.ts::approveRedemption': {
  tuple: ['OWNER', 'ADMIN'],
  permission: 'approval.approve_redemption',
},
'approval.controller.ts::reject': {
  tuple: ['OWNER', 'ADMIN'],
  permission: 'approval.approve_appraisal',   // or approval.approve_redemption depending on route
},
```
2. **Site count** — `expect(total).toBe(63)` (line 394) → new controller's guarded sites added. Note the scan `findControllerFiles` filters out `\common\` only (lines 378-380), so `approval/` WILL be scanned.
3. **KNOWN_TUPLES** (lines 15-27) — any new `@Roles` tuple (e.g. `['OWNER','ADMIN','MANAGER','CASHIER_TELLER','APPRAISER']` for the queue view) must be added. Prefer reusing existing tuples (`['OWNER','ADMIN','MANAGER']` exists at line 21).
4. Permission counts (37 perms / 101 mappings, lines 354-374) are UNCHANGED — `approval.*` permissions already seeded (permissions.const.ts:28-30); no new permissions.

---

### `backend/src/common/guards/pawnshop.guard.ts` (middleware — EDIT)

**Analog:** self — `EXEMPT_PREFIXES` (lines 21-49). Per CONTEXT integration points, add a sibling for the new queue endpoint (note: this array controls the pawnshop-id header requirement, NOT auth — RbacGuard still enforces permissions):
```typescript
'/pawn-tickets/pending-approval',   // existing entry (line 45)
'/approval-queue',                  // NEW — sibling for the unified queue
```

---

### `frontend/src/components/ApprovalQueue.tsx` (component, request-response)

**Analog:** `frontend/src/components/AppraisalApproval.tsx` — the established Gilded Reserve queue-style page (apiClient + Swal + toast + role gating).

**Imports pattern** (AppraisalApproval.tsx:1-10):
```typescript
import { useState, useEffect, useCallback } from 'react';
import { CheckCircle2, XCircle, Search, Loader2, AlertTriangle, CheckCheck, ... } from 'lucide-react';
import { useToast } from '../App';
import api from '../lib/apiClient';
import { formatCurrency } from '../lib/formatters';
import Swal from 'sweetalert2';
```

**Role-gated actions** (AppraisalApproval.tsx:85-90):
```typescript
const normalizedRole = String(userRole || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
const canonicalRole = normalizedRole === 'BRANCH_ADMIN' ? 'ADMIN' : normalizedRole;
const canApprove = ['MANAGER', 'OWNER', 'ADMIN', 'SUPER_ADMIN'].includes(canonicalRole);
```

**Data fetch via apiClient** (AppraisalApproval.tsx:117-127) — new page calls `api.get<ApprovalQueueItem[]>('/approval-queue', { pawnshopId, type })`:
```typescript
const fetchQueue = useCallback(async () => {
  setLoading(true);
  try {
    const query: Record<string, string | number | boolean | undefined> = {};
    if (branchId) query.pawnshopId = branchId;
    const items = await api.get<ApprovalQueueItem[]>('/approval-queue', query);
    setItems(items);
  } catch (error: any) {
    console.error('Error fetching approval queue:', error);
    showToast('Failed to load approval queue', 'error');
  } finally {
    setLoading(false);
  }
}, [branchId, showToast]);

useEffect(() => { fetchQueue(); }, [fetchQueue]);
```

**Swal confirm + post** (AppraisalApproval.tsx:166-207) — approve/reject actions; comment REQUIRED on reject (D-09) mirrors the existing rejectionReason textarea + guard at 243-246:
```typescript
const confirm = await Swal.fire({
  title: 'Confirm Action',
  text: 'Approve this item and continue?',
  icon: 'question',
  showCancelButton: true,
  confirmButtonColor: '#C9A05C',
  cancelButtonColor: '#6B655C',
  confirmButtonText: 'Yes, proceed',
  cancelButtonText: 'Cancel',
});
if (!confirm.isConfirmed) return;

const result = await api.post(`/approval-queue/${id}/approve`, { decisionComment: '' });
showToast('Approval recorded', 'success');
fetchQueue();
```

**UI container + theme** (AppraisalApproval.tsx:276, 289-304) — `bg-[#1C1C26]/50 min-h-screen`, `#C9A05C` gold accents, `#14141B` cards, `formatCurrency` for amounts. Tabs per D-09: use the vendored `frontend/src/components/ui/` Radix Tabs/Table/Dialog (RESEARCH Standard Stack) or simple button-tabs consistent with existing components.

---

### `frontend/src/components/__tests__/ApprovalQueue.test.tsx` (test)

**Analog:** `frontend/src/components/__tests__/AuctionQueue.test.tsx` — Vitest + Testing Library + `vi.stubGlobal('fetch')` + `useToast` mock.

**Core pattern** (AuctionQueue.test.tsx:1-31):
```typescript
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, it, vi } from 'vitest';
import { ApprovalQueue } from '../ApprovalQueue';

vi.mock('../../lib/supabaseClient', () => ({
  supabase: { auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'test-token' } } }) } },
}));

vi.mock('../../App', () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

describe('ApprovalQueue', () => {
  it('renders the approval queue header and empty state', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => [] }));
    render(<ApprovalQueue branchId="pawnshop-1" />);
    expect(screen.getByText('Approval Queue')).toBeInTheDocument();
    await waitFor(() => { /* empty state */ });
  });
});
```
Cover RBAC-05 UI: tabs render, approve/reject flow, comment-required-on-reject (mirror `fireEvent` patterns at AuctionQueue.test.tsx:33-69).

---

### `frontend/src/App.tsx` (route — EDIT)

**Analog:** self. Four registration points (D-08/D-10 — add the new tab, retire `appraisal-approval`):

1. **Import** (line 57): `import { ApprovalQueue } from './components/ApprovalQueue';` — replacing `AppraisalApproval` import (line 57).
2. **TAB_TO_PATH** (lines 131-162): add `'approval-queue': '/approval-queue',`; remove `'appraisal-approval': '/appraisal-approval',` (line 144).
3. **Nav item** (line 1205): replace with `{ id: 'approval-queue', label: 'Approval Queue', icon: ShieldCheck, roles: ['Owner', 'Admin', 'Manager'], type: 'OPERATIONAL' }`. Update `FREE_ALLOWED_NAV` (line 1232) — replace `'appraisal-approval'` with `'approval-queue'`.
4. **Render** (line 1619): `{activeTab === 'approval-queue' && <ApprovalQueue branchId={currentBranchId} activeBranchId={activeOperationalBranchId} userRole={userRole} />}`.

**IMPORTANT (Pitfall 8):** keep the `/pending-approval` tab + `PendingApprovalPanel` intact (ticket-creation approval is a separate concern — D-10 explicitly preserves `/pawn-tickets/pending-approval`).

---

## Shared Patterns

### Permission Gating (all new controller endpoints)
**Source:** `backend/src/loan/pawn-ticket.controller.ts:123-139` + `backend/src/common/permissions/permissions.const.ts:28-30`
**Apply to:** `approval.controller.ts` (all routes)
```typescript
@RequiresPermission(PERMISSIONS['approval.view_queue'])         // GET /approval-queue
@RequiresPermission(PERMISSIONS['approval.approve_appraisal'])  // POST .../approve (APPRAISAL)
@RequiresPermission(PERMISSIONS['approval.approve_redemption']) // POST .../approve (REDEMPTION)
```
Permissions already seeded in ROLE_PERMISSIONS — OWNER (lines 69-71), ADMIN (85-87), MANAGER + CASHIER_TELLER + APPRAISER have `view_queue` only. SUPER_ADMIN bypasses via RbacGuard spec (rbac.guard.spec.ts:66-76). NO new permission names — keep the 37-permission catalog stable.

### Audit Logging
**Source:** `backend/src/common/decorators/audit-log.decorator.ts` (used at pawn-ticket.controller.ts:18-19, 42, 58, 107, 123, 141)
**Apply to:** All approve/reject endpoints (`@AuditLog('APPROVE_APPRAISAL')`, `'REJECT_APPRAISAL'`, `'APPROVE_REDEMPTION'`, `'REJECT_REDEMPTION'`). Decision rows also carry decidedBy/decidedAt/comment on `ApprovalRecord` (D-13 — the immutable trail).

### Error Handling
**Source:** `backend/src/loan/pawn-ticket.service.ts:136, 200-205, 370-375` + `state-machine.service.ts:33-50`
**Apply to:** `approval.service.ts` and edits in `pawn-ticket.service.ts`
- Not found → `NotFoundException`; invalid state/precondition → `BadRequestException`; role not allowed → `ForbiddenException` (thrown by `stateMachine.transition`, state-machine.service.ts:43-50).
- Controllers are thin — no try/catch except `createTicket`'s P-code mapper (pawn-ticket.controller.ts:28-39). Let typed exceptions propagate to the global handler.
- Best-effort side effects (notifications, receipts) are wrapped in try/catch with `console.error` (pawn-ticket.service.ts:414-430, 552-575).

### Validation
**Source:** `backend/src/loan/dto/appraise-ticket.dto.ts` (class-validator) + `redeem-ticket.dto.ts:3-6`
**Apply to:** Both new DTOs. Reject requires non-empty `decisionComment` (enforce in service when `approve === false`); `amountPaid` already `@IsNumber() @Min(0)` (redeem-ticket.dto.ts:4-6) — the value compared against the threshold.

### State Machine Discipline
**Source:** `backend/src/common/state-machine/state-machine.service.ts:18-57`
**Apply to:** Every ticket status change in the new paths. Never `prisma.ticket.update({ lifecycleStatus })` without a preceding `stateMachine.transition` (see pawn-ticket.service.ts:143-153 for the correct pair). The ADMIN role additions and `PENDING_APPROVAL -> RECEIVED` transition must land in `pawn-lifecycle.ts` BEFORE the service code references them.

### Tenant Settings (threshold)
**Source:** `backend/src/finance/finance.service.ts:158-184` (getPawnshopSettings/savePawnshopSettings)
**Apply to:** `redeemTicket` gate (D-05/D-06). Namespaced key `redemptionApprovalThreshold`, default `50_000`, strict `>` comparison (Assumption A1). Config surface is the existing `PATCH /pawnshops/:id/settings` (tenant-governance.controller.ts:377-386) — no new endpoint. NOTE (Pitfall 6/7): that endpoint is `platform.manage` = SUPER_ADMIN-only at the guard and its service does a wholesale `SET settings =` (tenant-governance.service.ts:2554) — plan must decide threshold edit ownership and merge-on-write.

### Frontend apiClient + theme
**Source:** `frontend/src/components/AppraisalApproval.tsx` + `frontend/src/lib/apiClient.ts`
**Apply to:** `ApprovalQueue.tsx`. All calls via `api.get/post` (auto-attaches auth + pawnshop-id headers). Gilded Reserve palette: `#C9A05C` gold, `#14141B` cards, `#1C1C26` surfaces, `#030213` headings, `#6B655C` muted text. Currency via `formatCurrency` (PHP en-PH).

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `backend/src/approval/approval.controller.spec.ts` | test | unit | No controller-spec precedent in the codebase (only service specs + the filesystem-scan `permissions-catalog.spec.ts`). Use the `legal-proof.service.spec.ts` TestingModule pattern with a mocked `ApprovalService`, plus RESEARCH's RBAC-05 endpoint-surface assertions. |

Also note: `applyApprovedAppraisal` / `releaseApprovedRedemption` are new public methods with no existing analog (they orchestrate existing machinery — `approveWithContract` at pawn-ticket.service.ts:249-362 and the release body at 468-575 — per RESEARCH "don't hand-roll" guidance). The plan should reference those methods as the side-effect sources, not copy any new pattern.

## Metadata

**Analog search scope:** `backend/src/loan/` (controller, service, module, dto, specs), `backend/src/finance/`, `backend/src/common/` (state-machine, guards, permissions), `backend/src/tenant-governance/`, `backend/src/app.module.ts`, `backend/prisma/` (schema.prisma, migrations), `frontend/src/components/` (AppraisalApproval, PendingApprovalPanel, `__tests__/AuctionQueue.test.tsx`), `frontend/src/App.tsx`
**Files scanned:** 21 (12 read fully, 9 targeted ranges)
**Pattern extraction date:** 2026-08-01
**Key line anchors:** pawn-ticket.service.ts:364/388/441 | pawn-ticket.controller.ts:92/107/123/141 | pawn-lifecycle.ts:8-10 | schema.prisma:1860-1882 | permissions-catalog.spec.ts:31/354/394 | finance.service.ts:158-184 | App.tsx:57/144/1205/1232/1619
