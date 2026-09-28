# PAWNGOLD — System Audit

**Audited:** 2026-09-28
**Scope:** `backend/` (NestJS + Prisma), `frontend/` (dashboard), `auction-frontend/`, `mobile/` (Flutter)
**Method:** six targeted static audits — pricing/valuation, public surface, loan lifecycle,
backend dead code, frontend dead code, root scripts/config, state-machine completeness.
**Status:** authoritative. Every finding below is file-and-line evidenced.

> **Why this file exists.** It was written so that nobody has to re-derive it. If you are
> picking up this project cold, read this before reading code. It is the fastest route to
> understanding what works, what is broken, and what was deliberately left undone.

---

## Severity

| | Meaning |
|---|---|
| **S1 — Critical** | Money loss, forged document, legal exposure, or security breach. Fix before any defense. |
| **S2 — High** | Correctness failure. The system silently produces a wrong result. |
| **S3 — Medium** | A process has no defined end, or a feature is absent. Honest limitation if documented. |
| **S4 — Low** | Dead code, dead config, incorrect documentation. No runtime effect. |

**Disposition** is one of: `FIXED`, `IN PROGRESS`, `PUBLISHED` (documented as a known
limitation), or `DEFERRED`.

---

## Part 1 — What the system genuinely does well

State this at a defense. It is a real body of work.

| Area | Evidence |
|---|---|
| **Loan lifecycle transition table** | 27 explicit transitions with per-transition role gates — `common/state-machine/pawn-lifecycle.ts:3-31`. Well designed. |
| **Contracts** | Generated server-side with ordered customer/staff signature, and a contract cannot be signed out of order (`loan-contract.service.ts`) |
| **Proof + receipt records** | `LegalProof` and `Receipt` are append-only and never deleted — exactly right for an audit trail |
| **Credential security** | MFA with email challenge, 5-attempt lockout, challenge consumed atomically in a transaction, forced-password-change scoped to weak/admin-issued passwords only |
| **Bid concurrency** | Optimistic lock on `currentBid` plus a guarded bid insert — `auction.service.ts:1133-1178`. Genuinely prevents double-spend. |
| **Auction winner compliance** | The **one fully-terminating loop in the system.** 2-hour cron, deadline column, terminal value, exhausted-bidder exit, per-record try/catch — `auction-settlement.service.ts:271-407` |
| **Grace + forfeiture crons** | Sound: daily, individually error-wrapped, emit `LegalProof` + `Receipt` on every action |
| **Notification delivery job** | Has a real scheduler and a real purge path (`notification.service.ts:611, 652`) |
| **Global request hardening** | `RbacGuard` via `@RequiresPermission`, `Throttle` + `RateLimitGuard`, `ValidationPipe` with `forbidNonWhitelisted`, subscription-freeze middleware correctly tenant-scoped |
| **Test coverage** | 695 backend tests across 49 suites, all green |

---

## Part 2 — S1 Critical

### S1-1 · Redemption accepts ₱0 and releases the collateral
`backend/src/loan/dto/redeem-ticket.dto.ts:4-6` validates only `@IsNumber() @Min(0)`.
`performRedemptionRelease` (`pawn-ticket.service.ts:573-707`) writes `dto.amountPaid`
straight to `Payment` and transitions to `REDEEMED`. **The charge calculator's `totalDue`
is never called from this path.** A teller — or any authenticated client — can release a
₱20,000 pawned item for ₱0.00 and the system will print a receipt attesting to a
completed redemption.
*Disposition: **IN PROGRESS** (Phase 0.1)*
*Compounding:* `pawn-ticket.service.spec.ts` currently **asserts** that `amountPaid: 60000`
passes through verbatim. The test protects the defect and must be inverted.

### S1-2 · Online redemption bypasses the approval that walk-in requires
Walk-in redemption creates a `PENDING` `ApprovalRecord` and requires owner sign-off
(`pawn-ticket.service.ts:528-548`). Online PayMongo redemption
(`user-loans.service.ts:360-477`) transitions directly to `REDEEMED` — no approval, no
`ApprovalRecord`. **The digital path is the weaker one.**
*Disposition: **IN PROGRESS** (Phase 0.2)*

### S1-3 · Payment webhooks are unauthenticated
Four `@Public()` routes with no signature verification. `auction.controller.ts:208-233`
will confirm an auction sale from any request body containing a `complianceId`.
Test-mode keys, so no live money is at risk — but it is a payment path that trusts its
caller.
*Disposition: **IN PROGRESS** (Phase 0.3)*

### S1-4 · A customer's collateral can be destroyed permanently and silently
Legacy `app.service.createTicket:1753-1772` writes `status:'ACTIVE'` +
`lifecycleStatus:'RECEIVED'` with **no `Loan` row, no `LegalProof`, and no state-machine
transition.** The ticket is counted as active capital in analytics and tenant-governance
totals, but `redeemTicket:510` throws *"No loan found."*
**That customer can never reclaim their item, and no record exists that they ever had it.**
*Disposition: **IN PROGRESS** (Phase 1a.1)*

### S1-5 · Disbursement receipts are never written
`loan.service.ts:724` writes `receiptType:'DISBURSEMENT'`, which **is not a member of the
`ReceiptType` enum.** The resulting error is swallowed by a `try/catch` at `:737`.
The receipt for handing out a customer's money does not exist in the database. The thesis
panel specifically marked receipts.
*Disposition: **IN PROGRESS** (Phase 1a.2)*

### S1-6 · Compliance documents never expire
`checkExpiringDocuments` (`compliance.service.ts:467-557`) sends a notification and
**never writes `EXPIRED`**. The only DB write of `EXPIRED` is a human uploading a
replacement (`:144`). Read paths project the status at query time
(`compliance.service.ts:285, 631`) but never persist it.
**A pawnshop whose DTI, AMLC or BSP registration has lapsed continues to operate** with no
system-enforced block and no audit record of the lapse.
*Disposition: **IN PROGRESS** (Phase 5a)*

### S1-7 · Cross-tenant financial data exposure
`analytics.controller.ts` declares **no `@Roles` and no tenant scoping.**
`analytics.service.ts:55-78` runs `prisma.customer.count()` and `prisma.ticket.aggregate()`
with **no `where` clause** — every tenant in the database. `/branch/:pawnshopId` and
`/branch-stats/batch?ids=` accept any tenant ID from the caller.
Requires a login (global `PawnshopGuard` + `RbacGuard`), so severity is high, not critical.
*Disposition: **IN PROGRESS** (Phase 0.5)*

### S1-8 · Unauthenticated customer PII enumeration
`GET /customers/check?fullName=&contactNumber=&pawnshopId=` is `@Public()`, returns
`{ id, fullName, contactNumber, pawnshopId }`, and **`pawnshopId` is optional** — omit it
and the search spans every tenant. `app.controller.ts:85-93`.
*Disposition: **IN PROGRESS** (Phase 0.6)*

### S1-9 · Receipt PDFs downloadable without authentication
`receipt/receipt.controller.ts:45-52` is `@Public()` with no ownership check. Receipt PDFs
carry customer name, address, amounts and line items.
*Disposition: **IN PROGRESS** (Phase 0.7)*

### S1-10 · One staff click destroys a live, unexpired loan
`pawn-ticket.service.ts:955-999` (`sendToAuction`, called from `InventoryVault.tsx:379`)
checks only `ticket.status === 'ACTIVE'`, then writes
`status:'AUCTION', lifecycleStatus:'FORFEITED'`. It does **not** call the state machine,
skips grace period and forfeiture entirely, never updates `Loan.status`, and emits no
forfeiture proof. The loan table then permanently disagrees with the ticket.
*Disposition: **IN PROGRESS** (Phase 1a.3)*

---

## Part 3 — S2 High

### S2-1 · The server does not validate money at all
There is **no appraised-value column** in the schema. `Ticket.loanAmount` is client-supplied
with no cap (`create-pawn-ticket.dto.ts:27-33`). The only "suggested" figure is computed
**in the browser** from a four-row hardcoded table — `SalesPos.tsx:187`
(`weight * rate * 0.7`) — and is rendered **read-only**, so the appraiser cannot override
it. The appraisal endpoint `POST /pawn-tickets/:id/appraise` **has no caller in either
frontend**; the live path sets `appraisedValue = loanAmount`, making the two identical by
construction.
*Disposition: **IN PROGRESS** (Phase 1b.2)*

### S2-2 · The finance math contradicts itself in seven places
| Value | Location |
|---|---|
| 3.0% | `schema.prisma:282` DB default |
| **3.5%** | `pawn-ticket.service.ts:77` — what actually happens |
| 2% / 3% | `loan-contract.service.ts:53` — **what the customer is told** |
| 5% | `analytics.service.ts:75` — fabricated earnings |
| 3% | `Redemption.tsx:178` — comment claims it matches the default; it does not |
| grace 5 days | `grace-period.service.ts:12` |
| **grace 30 days** | `loan-contract.service.ts:60` — what the customer is told |
| maturity | 1 month / 30 days / 90 days across three files |

Four independent redemption formulas exist. `AGENTS.md` claims *"Finance math will use
integer-cents to avoid float drift"* — true of the calculator, **false of the live path**,
which uses `Math.round(loanAmount * 0.035)` on floats.
*Disposition: **IN PROGRESS** (Phase 1b.1)*

### S2-3 · The deterministic calculator's penalty branch never executes
`finance/pawn-charge-calculator.ts:23-55` correctly converts to integer cents, but both
callers (`finance.service.ts:72-76`, `app.service.ts:1804-1808`) pass only three of six
arguments, so `graceDays` and `latePenaltyRatePercent` arrive as `0` and the late-penalty
branch is dead.
*Disposition: **IN PROGRESS** (Phase 1b.3)*

### S2-4 · The overdue → grace → forfeiture chain never fires
`repayment.service.ts:163-225` (the only `ACTIVE → OVERDUE` implementation) selects
`RepaymentSchedule` rows. Those are created **only** by `generateSchedule()`
(`repayment.service.ts:83`), reachable only from the manual endpoint
`loan.controller.ts:144`, which nothing in the pawn flow calls.
**Verified: exactly one `createMany` in the codebase, unreachable from the pawn process.**
Grace and forfeiture crons then have no input, so nothing ever reaches auction
automatically. `AGENTS.md` marks this Phase 2 ✅.
*Disposition: **IN PROGRESS** (Phase 2.1)*

### S2-5 · The grace-period timer measures from the wrong date
`grace-period.service.ts:45-46` computes `daysOverdue` from `ticket.updatedAt`, which
changes on any edit. A customer can sit overdue indefinitely by having their record
touched. It should measure from `expiryDate`.
*Disposition: **IN PROGRESS** (Phase 2.2)*

### S2-6 · An auction can silently never open
`AuctionListing.status` is written `SCHEDULED` at `auction.service.ts:506` and read at
`:618`, but **no cron promotes it to `LIVE`** — and the settlement cron filters
`status: LIVE` only (`auction-settlement.service.ts:34`). The auction never opens, never
sells, never settles, and never creates a compliance record. Silent revenue loss.
*Disposition: **IN PROGRESS** (Phase 2.7)*

### S2-7 · A winning bidder pays in full and is never handed the item
`AuctionWinnerCompliance.COMPLIED` has **no timeout** — release is a manual human step at
`auction.service.ts:1806` with no fallback. The escalation cron only handles
`PENDING_COMPLIANCE` (`:271-408`).
*Disposition: **IN PROGRESS** (Phase 5c)*

### S2-8 · Any bid wins, including ₱1
`AuctionListing.reservePrice` is supported by the API and validated
(`auction.service.ts:341-343`), but **`AuctionQueue.tsx:233-245` never sends it.** The
settlement check `bids[0].amount >= (auction.reservePrice || 0)` therefore evaluates
`>= 0`. A shop can sell collateral below what it is owed and the system records success.
*Disposition: **IN PROGRESS** (Phase 2.6)*

### S2-9 · Unsold auction items are permanently un-recoverable
On no-bid, `auction-settlement.service.ts:164-224` sets `Ticket.status = 'FORFEITED'` (the
legacy String field) and logs *"Ticket returned to queue"* while **doing nothing** —
`lifecycleStatus` is untouched. `AUCTION_UNSOLD` and `AUCTION_SOLD` have **zero writers**
despite being defined in the enum and the transition table.
Worse, **re-listing is structurally impossible**: `AuctionListing.ticketId` is `@unique`
(`schema.prisma:85`) with a 1:1 back-relation and no delete path, so a second listing
raises a constraint violation. There is no storage-fee accrual, no wholesale/consolidator
route, no write-off, and no buy-back for the original borrower.
*Disposition: **IN PROGRESS** (Phase 2.5 + Tier 2 storage)*

### S2-10 · Two status fields kept in sync by hand
`Ticket.status` is a free-text `String` with a **three-way split-brain**: schema default
`"ACTIVE"` (`:283`), ticket creation writes `'PENDING'` (`pawn-ticket.service.ts:74`), and
the legacy path writes `'ACTIVE'` (`app.service.ts:1761`). Auction code writes `'AUCTION'`
(`auction.service.ts:1405`) while forfeiture writes `'AUCTION_QUEUED'`
(`loan-forfeiture.service.ts:130`) — so **forfeited tickets are invisible to the auction
queue query** (`auction.service.ts:1443`).
*Disposition: **IN PROGRESS** (Phase 1a.7 / 2.3)*

### S2-11 · A crash during disbursement is unrecoverable
`StateMachineService.transition()` is a **pure validator — it never writes to the
database** (`state-machine.service.ts:18-57`; it has no Prisma member, and its only
side-effect hook `onSuccess` has zero callers repo-wide). `disburseLoan` therefore
performs two independent ticket writes — `DISBURSED` at `loan.service.ts:666-669`, then
`ACTIVE` at `:677-684` — with **no `$transaction`**. A restart in that window strands the
ticket at `DISBURSED` permanently: interest does not accrue, it cannot be redeemed, it
cannot go overdue. Re-running fails, because the transition requires `CONTRACT_SIGNED`.
No cron scans for stranded `DISBURSED` tickets.
*Disposition: **IN PROGRESS** (Phase 1a.4)*

### S2-12 · An approved appraisal is deliberately saved as PENDING
`approval.service.ts:291` — `status: !approve ? 'REJECTED' : isAppraisalApprove ? 'PENDING' : 'APPROVED'`
An **approved** appraisal is persisted as `PENDING` with `decidedById` and `decidedAt` set.
The approval queue filters on `PENDING` (`approval.service.ts:29`), so it re-appears forever
for a decision already made.
*Disposition: **IN PROGRESS** (Phase 1a.5)*

### S2-13 · A stale approval permanently blocks a customer's redemption
`pawn-ticket.service.ts:514-526` throws *"Redemption for this ticket is already pending
approval"* if any `PENDING` redemption record exists. `ApprovalRecord.PENDING` has **no
SLA, no expiry, no escalation, and no auto-approve** anywhere in the codebase. Combined
with S2-12, a customer can hand over cash and be refused indefinitely.
*Disposition: **IN PROGRESS** (Phase 1a.5 + 5b)*

### S2-14 · Cash reconciliation can never detect a discrepancy
`finance.service.ts:800, 810` calls `createDailyReconciliation(pawnshop.id, null)` — the
`null` is `branchId` (param 2); `physicalCash` (param 3) is **never passed**. The variance
is therefore always `null` (`:714-715`). Aggravating: `:670-674` throws
*"Reconciliation already exists"*, caught and only logged, so the 23:59 cron **can never be
re-run**. Any claim about cash integrity has no teeth until a human counts the till.
*Disposition: **IN PROGRESS** (Phase 5a)*

### S2-15 · A shop that stops paying keeps full access indefinitely
With `autoRenew: true`, `subscription.service.ts:1508-1577` **auto-promotes to `ACTIVE`**,
inserts a `pending` `SubscriptionPayment`, **posts a DEBIT ledger entry for money never
collected**, and rolls `nextBillingDate` forward — forever, unpaid. With auto-renew off, an
`EXPIRED` tenant is 403'd on every operation with **no grace period, no recovery screen, and
no data export.** `SubscriptionPayment.status = 'pending'` has zero updaters.
*Disposition: **IN PROGRESS** (Phase 5a)*

### S2-16 · `@Roles()` is used on zero endpoints — and a test enforces it
The decorator exists (`common/decorators/roles.decorator.ts`) and `RbacGuard` reads it at
`rbac.guard.ts:92, 118, 166`, but **no controller applies it.** RBAC runs entirely on
`@RequiresPermission(...)`, which is real and does work. However,
`permissions-catalog.spec.ts:408, 532, 584` **scans source text and asserts that no
`@Roles(` exists anywhere.** A security gap was converted into a passing test.
Consequence: `POST /branding` (rewrites a tenant's name, logo, favicon and colours)
requires only any authenticated profile.
*Disposition: **IN PROGRESS** — invert the spec to assert coverage, do not delete the guard*

### S2-17 · Notifications report delivery that never happened
`notification.service.ts:155-163`:
```
// TODO: Integrate with FCM/APNs/OneSignal for actual push delivery
// For now, mark as sent
```
It sets `status: SENT`, `sentAt: now`, and logs *"delivered to N devices"* without
delivering anything. Any consumer building a feature on notifications is building on a lie.
*Disposition: **IN PROGRESS** (Phase 0.4)*

### S2-18 · MFA sessions cannot be revoked
`MfaSessionAssertion` has exactly two operations repo-wide: `create`
(`mfa-assertion.service.ts:43`) and `findFirst` (`:67`). **No `update`, no `delete`, no
`deleteMany`.** The `expire()` method has zero call sites, and the schema has no
`revokedAt`. **Changing a password or signing out does not revoke a verified MFA session.**
*Disposition: **IN PROGRESS** (Phase 5b)*

---

## Part 4 — S3 Medium · processes with no defined end

Full inventory in the plan. Summary of the material ones:

| Process | Stuck in | Mover |
|---|---|---|
| Abandoned PayMongo checkout | `Payment.PENDING` forever; the pawn path creates **no `Payment` row at all** | none |
| Queue ticket abandoned by customer | `WAITING` — blocks the customer from re-queuing; `SERVING` — holds a counter slot and blocks everyone behind | none (partly addressed by Phase 3) |
| KYC submitted, never reviewed | `KycStatus.PENDING` forever — no SLA | none |
| Registration request unanswered | `ClientRegistrationRequest.PENDING` forever | none |
| Support conversation | `OPEN`/`HANDLING`/`FIXING` never auto-close | none |
| Unpaid payslip | `DRAFT`/`APPROVED` never age out | none |
| Failed notifications | `FAILED` matches neither purge rule; `retryCount` incremented, never read | none |
| MFA challenges / assertions | never purged; unbounded growth | none |
| `LoanApplication` | 7 non-terminal states; `updateStatus:210` writes `dto.status` with **no transition call** | none |
| `RepaymentSchedule.OVERDUE` / `PARTIAL` | no mover | none |

**Design note:** most of these are one remedy — an expiry timestamp plus one shared sweep
cron, copying the pattern already proven in `auction-settlement.service.ts:271-407`. That
loop has a deadline column, a terminal value, an exhausted-candidate exit, and per-record
error handling. **It is the only fully-terminating loop in the system, and the template for
all the others.**

---

## Part 5 — S4 Low

### S5-1 · Dead code — 7,392 lines, all verified zero-reference

**Dashboard (6,478 lines):** `pages/loans/{LoanApplicationForm, ApplicationsList,
ApplicationDetail, RepaymentSchedule, DocumentUpload, ApprovalWorkflow}.tsx`,
`pages/CRM.tsx`, `components/{ShopOwnerDashboard, BranchManagement, BranchAnalytics,
RejectedAppraisalHistory, PendingApprovalPanel, AuctionTab, ComplianceDashboard, Sidebar,
AppraisalApproval, KycStatusBadge, CookieConsentBanner}.tsx`,
`components/modal/AddAdminModal.tsx`, `data/mockStore.ts`, `lib/toast.ts`
**24 unused shadcn `ui/*` components** (1,993 lines; `ui/utils.ts` is used)
**Auction (921 lines):** `lib/{idOcr, faceMatch, tamperDetect, watchlist}.ts`, plus **~11 MB
of committed face-recognition model weights** serving `faceMatch.ts`
**Mobile (776 lines):** `lib/home_screen.dart` (443 lines, orphaned, writes to a
non-existent `pawn_tickets` table, contains hardcoded fake data),
`lib/shared/widgets/app_button.dart`, `lib/config/supabase_config.dart`, `lib/core/web_compat/`

### S5-2 · Dead database objects
`Inventory`, `ActivityLog`, `Category`, `LoanApproval`, `LoanDocument`; enums `TicketStatus`
and `Role` (both bound to no field — `Profile.role` and `Ticket.status` are `String`);
`Staff.password` (plaintext by construction, never populated).
**Do not delete `SystemSettings`** — dead, but it is the intended home for the canonical
rate set.
`Staff` is *read* by two tier-limit gates, both wrapped in `.catch(() => 0)`.
`Transaction` is *read* by `analytics.service.ts:123` but **never written by any service**,
which is why owner earnings are structurally `0`.
`Customer.loyaltyTier` is a denormalised duplicate of the `tier` enum; `loan.service.ts:616`
reads one to populate the other.
*Disposition: **IN PROGRESS** (Phase 4)*

### S5-3 · ~35 orphaned loan endpoints
`/loan/renew`, `/loan/forfeitures/process`, `/loan/forfeitures/:ticketId/queue-auction`,
`/loan/schedule/*`, `/loan/penalties/*`, `/loan/:loanId/payments`, `/loan/contracts/*/proofs`,
`/loan/eligibility/*` — a complete consumer-credit servicing API with no caller in any client.
`POST /loan/renew` (`loan.service.ts:801-945`) is a real, correct feature — 30/30/15-day
extension with proof and receipt — that simply has no UI.
*Disposition: **PUBLISHED** — delete the consumer-credit surface, surface renewal*

### S5-4 · Orphaned components calling endpoints that do not exist
`ComplianceDashboard.tsx` (659 lines) calls `/compliance/statistics`, `/:id/verify`,
`/release`, `/extend-deadline` — **none exist** — and is not rendered anywhere.
`DocumentUpload.tsx` XHRs `POST /loan/documents/upload`, also absent.

### S5-5 · Secrets committed to the repository
A Supabase `service_role` JWT in `SUPABASE_KEY_FIX.md` and `backend/scripts/e2e-verify.js`;
Postgres URLs with passwords in `README.md`, `.planning/codebase/INTEGRATIONS.md`,
`ADMIN_CREATION_COMPLETE_FIX.md`; password assignments in `mobile/QUICK_REFERENCE.md` and
`ARCHITECTURE_DIAGRAM.md`; personal email addresses in `FIX_EVERYTHING.sql`,
`DATA_FIXES.sql`, `otp_body.json`, `mobile/otp_body.json`; the Supabase project reference
in several files.
**Assessment:** the `SUPABASE_KEY_FIX.md` key carries `exp: 2024-02-29` (expired) and the
`e2e-verify.js` key carries a project reference (`…vutzbg`) that does **not** match the real
project (`…vutubzbg`), so neither is expected to validate. **Exploitability is low — this
is hygiene, not an incident.** Rotation is still two minutes and ends the question.
*Disposition: **IN PROGRESS** — rotate the key, delete the six files*

### S5-6 · Dangerous dev scripts committed
`DISABLE_ALL_RLS_AND_POLICIES.sql` and `DISABLE_RLS_TEST.sql` disable row-level security
schema-wide. Anyone who runs them against the live database disables the primary defence.
`backend/scripts/fix-permissions.js` grants `anon` SELECT on every table, directly
counter to the RLS posture.
*Disposition: **IN PROGRESS** (Phase 4)*

### S5-7 · Two migration files Prisma will never run
`backend/prisma/migrations/add_performance_indexes.sql` and
`20260723_compliance_documents.sql` are loose `.sql` files, not timestamped folders.
`prisma migrate` ignores them. **Verify in Supabase whether the compliance-document
changes were ever applied.**

### S5-8 · Two Prisma migration folders that are live schema but live outside migrations
`TENANT_GOVERNANCE_MIGRATION.sql` and `RLS_SUPER_ADMIN_SUPPORT_ACCESS_ENFORCEMENT.sql` are
depended on by `tenant-governance.service.ts` via `$queryRaw`. They should become proper
migration folders.

### S5-9 · Test file with no subject
`backend/src/loan/loan-history.service.spec.ts` imports `LoanService` because
`loan-history.service.ts` does not exist.

### S5-10 · A false-green test
`loan.service.spec.ts:80-90` asserts the transition `OFFER_MADE → DISBURSED`, which **is
not in the transition table** (`pawn-lifecycle.ts:14` only allows `CONTRACT_SIGNED →
DISBURSED`). It passes because `StateMachineService` is mocked. If contract signing is ever
skipped, `disburseLoan` throws at runtime.

### S5-11 · A test protecting a defect
`pawn-ticket.service.spec.ts` asserts `amountPaid` passes through verbatim — encoding the
absence of validation as expected behaviour. See S1-1.

### S5-12 · Dead enum values
`APPRAISED`, `AUCTION_SOLD`, `AUCTION_UNSOLD`, `REMINDER_SENT`, `READY_FOR_RELEASE`,
`REFUNDED`, `PROCESSING`, `FAILED`, `WAIVED`, `UNDER_REVIEW`, `CANCELLED` (ApprovalRecord),
`NO_SHOW`, `SOLD` — declared, never written.

---

## Part 6 — Documentation that misstates the system

Correct these. Overstated documentation is what puts otherwise-good work in doubt.

| File | Claim | Reality |
|---|---|---|
| `AGENTS.md` | "Loan History page wired into sidebar (`LoanHistoryPage.tsx`)" | **The file does not exist.** `LoanHistoryTimeline.tsx` exists and is used inside `CustomerHistory.tsx`; there is no page and no sidebar entry |
| `AGENTS.md` | "Immutable records for every transaction" | `LegalProof.sourceHash` is written and **never verified**. No DB trigger or constraint blocks UPDATE/DELETE. Immutability is the absence of update code, not an enforced guarantee |
| `AGENTS.md` | "RBAC enforcement at every endpoint" | `@Roles()` has **zero** usages, and a test asserts its absence. RBAC does work via `@RequiresPermission`, but 25 `@Public()` endpoints bypass it |
| `AGENTS.md` | "Finance math will use integer-cents to avoid float drift" | True of `pawn-charge-calculator.ts`; **false of the live path**, which uses `Math.round(loanAmount * 0.035)` |
| `AGENTS.md` | "23 Prisma models / 23 enums" | 63 models / 42 enums |
| `AGENTS.md` | "Phase 2.5 In Progress" | `.planning/STATE.md` records phase 10.1 complete |
| `SystemSettings.tsx:207` | "Algorithmic appraisal assistance and market volatility protection" | No such code exists |
| `README.md` | "Decision Support: AI-powered insights and recommendations" | There is no decision-support module |
| `README.md` | "See `.env.example`" | No root `.env.example` exists; `backend/.env.example` holds 1 variable of 6 |
| `README.md` | "Visit `http://localhost:5174`" | `frontend/vite.config.js:34` defaults to **4173** |
| `frontend/src/guidelines/guidelines.md` | "Decision Support \| AI risk assessment based on branch liquidity" | No AI, no risk model |

### 41 markdown files at the repository root — delete 24
**Thirty-nine were committed on the same day (2026-07-17).** They are session summaries, not
documentation. A reviewer opening the root sees 41 files, 24 titled `COMPLETE` / `FIXED` /
`SUMMARY`, and concludes the project lost track of its own state.

**Keep and correct:** `README.md`, `AGENTS.md`, `ARCHITECTURE_DIAGRAM.md`,
`BACKEND_DEVELOPMENT_GUIDE.md`, `PRODUCTION_DEPLOYMENT_GUIDE.md`, `LEGAL-COMPLIANCE.md`,
`RISK-ASSESSMENT.md`, `docs/DEMO-SCRIPT.md`, `docs/KNOWN-LIMITATIONS.md`.

---

## Part 7 — Verification commands

```bash
# The check that catches a double-wrapped response — must be FLAT
curl -s https://integrated-pawnshop-v2.onrender.com/health
# → {"success":true,"status":"ok","uptime":...}     correct
# → {"success":true,"data":{...}}                  interceptor fix not live

# Suites
cd backend        && npx jest --runInBand      # expect 695
cd frontend       && npx vitest run            # 19/21 (3 known pre-existing failures)
cd auction-frontend && npx vitest run          # 8/8
cd frontend       && npx tsc --noEmit && npm run build
```

**Known pre-existing frontend failures** (not regressions): `kycDocs.test.ts` ×2,
`InventoryVault.test.tsx` ×1.

---

## Part 8 — The thesis argument

If the remediation completes, the defence position is:

> Pawnshops operate on cash, collateral and deadlines, and most still run on paper. This
> platform makes the **money** server-authoritative and auditable, makes the **lifecycle**
> run itself without anyone remembering to check a date, gives the **customer** a real
> place in the queue instead of a physical line, and gives the **owner** a decision-support
> engine built from their own service history — one that admits when it does not know.

Four claims. Each demonstrable. None requires a claim that cannot be proven.
