# PAWNGOLD - Integrated Pawnshop Management System

## Project Overview
**Full-stack SaaS pawnshop management platform** with auction house website and mobile app. Built as a capstone/thesis project for Dasmarinas, Cavite.

**Repo:** https://github.com/WorkzbyArvie/Integrated-Pawnshop-System-with-Decision-Support-in-Dasmarinas-Cavite

## Tech Stack
| Layer | Technology |
|-------|-----------|
| Frontend (Dashboard) | React 19 + Vite 6 + TypeScript + TailwindCSS 4 + shadcn/Radix UI |
| Auction Frontend | React 19 + Vite 7 + TypeScript |
| Backend API | NestJS 10 + TypeScript + Prisma ORM 5.22 |
| Database | PostgreSQL (Supabase) with Row-Level Security |
| Mobile | Flutter 3.10+ (Dart) with BLoC state management |
| Auth | Supabase Auth + custom OTP + role-based (10 roles) |
| Maps | Leaflet (web) + flutter_map (mobile) |
| Payments | PayMongo |
| Deployment | Railway (backend), Supabase (DB) |

## Key Architecture
- **Monorepo**: frontend/, backend/, auction-frontend/, mobile/
- **23 Prisma models** + 23 enums
- **11 User Roles**: SUPER_ADMIN, OWNER, ADMIN, MANAGER, STAFF, HR, CASHIER_TELLER, APPRAISER, INVENTORY_CUSTODIAN, AUDITOR, APPROVER (approves loans + redemptions)

---

## Thesis Status
- **Thesis A**: Passed (system had flaws but was let through)
- **Thesis B**: In progress - must fix all panel red marks
- **Panel Feedback**: System lacks contracts, proofs, receipts, payment history, terms & agreements, proper transaction traceability

## Critical Requirements for Thesis B Defense
1. **Legality** - Contracts for loans, auction bids, customer agreements
2. **Proof & Audit Trail** - Immutable records for every transaction
3. **Receipts** - Automated receipt generation for payments, redemptions, auctions
4. **Payment History** - Full transaction history with customer visibility
5. **Terms & Agreements** - TOS acceptance flow for auction bidders, loan borrowers
6. **State Machine** - Proper lifecycle: Appraisal -> Contract -> Release -> Repayment -> Redemption/Forfeiture -> Auction
7. **Traceability** - Who-did-what-when across the entire system
8. **Realistic Process Flow** - Match real-world pawnshop operations
9. **Security** - RLS, RBAC, input validation, rate limiting

---

## Current Roadmap

### Phase 1: LEGALITY & CONTRACT BACKBONE ✅
- [x] Schema: Add contract templates, receipt generation, proof wiring
- [x] Contract Engine: Auto-generate loan contracts, bidder agreements, TOS
- [x] LegalProof Wiring: Emit proof records for EVERY transaction
- [x] State Machine: Proper lifecycle status transitions with RBAC
- [x] Finance Math: Deterministic interest, penalty, grace period calculator
- [x] Receipt System: Generate receipts for all financial events
- [x] Frontend: Contract viewing/signing, receipt printing, history views

### Phase 2: SYSTEM FLOW PROFESSIONALIZATION ✅
- [x] Auto-overdue cron integration with state machine
- [x] Auto-forfeiture cron (daily) + manual trigger
- [x] Disbursement -> Active transition endpoint
- [x] Forfeiture -> Auction queue handoff
- [x] Renewal flow endpoint

### Phase 2.5: PROCESS FLOW COMPLETION ✅
- [x] Appraisal endpoint (`POST /pawn-tickets/:id/appraise`) — RECEIVED → APPRAISED with valuation, LegalProof, receipt
- [x] Grace period auto-entry cron — OVERDUE → GRACE_PERIOD after 5 days with notification + LegalProof
- [x] In-person redemption endpoint (`POST /pawn-tickets/:id/redeem`) — staff walk-in payment with receipt + LegalProof
- [x] NotificationModule wiring — alerts for overdue, grace period, forfeiture, redemption

### Phase 3: SECURITY HARDENING ✅
- [x] @Roles() decorator + RbacGuard (RBAC enforcement at every endpoint)
- [x] SUPER_ADMIN-only endpoint protection (built into RbacGuard)
- [x] Per-endpoint rate limiting (Throttle decorator + RateLimitGuard)
- [x] DTO validation audit (4 DTOs fixed)
- [x] Audit log interceptor for sensitive ops

### Phase 4: FRONTEND & UX REFINEMENT ✅
- [x] Loan timeline history component (`LoanHistoryTimeline.tsx`)
- [x] Loan status progress bar + valid transitions (`LoanStatusProgress.tsx`)
- [x] Customer dashboard with aggregate stats (`CustomerHistory.tsx`)
- [x] Receipt viewer/print modal (`ReceiptViewer.tsx`)
- [x] Contract viewer + digital signature canvas (`ContractViewer.tsx`)
- [x] Loan History page wired into sidebar (`LoanHistoryPage.tsx`)

### Phase 5: LEGALITY ENFORCEMENT (PAWN TICKET FLOW) ✅
- [x] Backend: `POST /pawn-tickets` endpoint (ticket creation with LegalProof)
- [x] Backend: `POST /pawn-tickets/:id/approve` (approve → contract generation → OFFER_MADE)
- [x] Backend: `disburseLoan()` now creates LegalProof + Receipt
- [x] Backend: `redeemTicket()` now uses state machine + creates LegalProof + Receipt
- [x] Backend: Online redemption (PayMongo webhook) now creates LegalProof + Receipt
- [x] Backend: Fixed contract template lookup (by type fallback)
- [x] Frontend: `SalesPos.tsx` calls backend API instead of direct Supabase
- [x] Frontend: `AppraisalApproval.tsx` integrated with ContractViewer signing + disbursement
- [x] Frontend: `ContractViewer.tsx` added `onSignComplete` callback for workflow

### Phase 6: AUCTION & MOBILE PARITY
- [ ] Auction site contract enforcement
- [ ] Mobile app integration with new backend

---

## Active Tasks
| Task | Status |
|------|--------|
| ECC for Opencode setup | Done |
| AGENTS.md creation | Done |
| Deep code audit | Done |
| Architecture proposal | Done |
| Phase 1 development | Done |
| Phase 2 development | Done |
| Phase 2.5 (Process Flow Completion) | In Progress |
| Phase 3 development | Done |
| Phase 4 development | Done |
| Phase 5 (Legality Enforcement) | Done |
| Phase 6 (Auction & Mobile) | Pending |
| Full UI redesign (Gilded Reserve) | Done |
| Gilded Reserve color sweep (39+49 files, 70+ patterns) | Done |

---

### Additional Fixes
- **Receipt modal after redemption** — ReceiptViewer now opens automatically after redeem, and a "Receipt" button appears in Inventory Vault for redeemed items (2026-07-24)
- **Audit history fix** — Changed controller from `@Roles('SUPER_ADMIN')` to `@Roles('SUPER_ADMIN', 'OWNER', 'ADMIN')` so owners/admins can see their tenant's audit logs. Removed insecure Supabase `security_logs` fallback that leaked cross-tenant data (2026-07-24)

## Recent Architectural Decisions
1. **ECC installed at user-level** - provides skills, agents, security scanning, memory hooks
2. **Phase order**: Backend first (NestJS/Prisma) -> Frontend -> Auction -> Mobile
3. **Finance math** will use integer-cents to avoid float drift
4. **State machine** will use explicit enum transitions with RBAC guards
5. **Pawn ticket flow** now goes through NestJS backend with contract enforcement (2026-07-07)
6. **Contract renderer** supports both UUID lookup and type-based fallback (2026-07-07)
7. **Redemption** now creates LegalProof + Receipt + proper lifecycleStatus transition (2026-07-07)
8. **Phase 2.5 added** to fill process gaps: appraisal endpoint, grace period cron, in-person redemption, notifications (2026-07-17)

---

## Knowledge Graph (graphify)

Project knowledge graph is built and queryable — **use it instead of re-reading the codebase**.

- Artifacts: `.planning/graphs/graph.json` (11k+ nodes), `graph.html`, `GRAPH_REPORT.md`
- Enabled via `graphify.enabled: true` in `.planning/config.json`; PyPI package is `graphifyy`, the CLI binary is `graphify` (Python 3.12, `~/AppData/Local/Programs/Python/Python312/Scripts/graphify.exe`)
- Graph output (`graphify-out/`, `.planning/graphs/`) is gitignored — regenerate with `graphify update .`
- Auto-rebuilds after every commit via the `post-commit` / `post-checkout` git hooks (`graphify hook status` to check, `graphify hook uninstall` to remove)
- The global plugin `~/.config/opencode/plugins/graphify.js` injects this guidance into every new session automatically and puts `graphify` on PATH — you do not need to be reminded

**Querying (token-efficient, prefer these):**

`--graph` is required when your cwd is a subfolder — `graphify` only looks for `./graphify-out` by default.

| Need | Command |
|------|---------|
| Architectural hubs | `graphify god-nodes --top 10 --graph "<root>/graphify-out/graph.json"` |
| Codebase question | `graphify query "<question>" --budget 800 --graph "<root>/graphify-out/graph.json"` |
| One symbol's context | `graphify explain "<Symbol>" --graph "<root>/graphify-out/graph.json"` |
| How two things connect | `graphify path "<A>" "<B>" --graph "<root>/graphify-out/graph.json"` |
| Blast radius of a change | `graphify affected "<Symbol>" --graph "<root>/graphify-out/graph.json"` |
| GSD-integrated | `node <config>/gsd-core/bin/gsd-tools.cjs graphify query <term>` |

Always pass `--budget` — the default traversal can dump 500+ nodes and burn thousands of tokens.
`query` truncates silently and prints `[!] TRUNCATED ... N nodes cut`; if you see that, raise the budget or narrow the query rather than concluding a symbol is absent.

## Coding Conventions
- **No comments** in source code unless explicitly asked
- **NestJS modules** follow: controller, service, module, dto/
- **Prisma** snake_case for DB columns, camelCase for JS fields
- **Prefer edit over write** for existing files
- **Backend-first** approach for all new features

---

## Decision Log
| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-07-05 | Use ECC opencode profile | Get skills, agents, security + memory persistence |
| 2026-07-05 | Phase 1 first (Legality) | Panel's biggest red mark |
| 2026-07-05 | Backend-first approach | Database/logic must be solid before UI |
| 2026-07-07 | Phase 1.5 complete | Legality backbone wired: state machine, contracts, proofs, receipts, storage |
| 2026-07-07 | Phase 2 complete | System flow professionalization: auto-crons, renewal, disbursement, auction handoff |
| 2026-07-07 | Phase 3 complete | Security hardening: RBAC guard, rate limiting, DTO audit, audit log |
| 2026-07-07 | Phase 4 complete | Frontend: history timeline, status progress, customer dashboard, receipt viewer, contract viewer |
| 2026-07-07 | Phase 5 complete | Legality enforcement: pawn ticket flow now enforces contract generation + signing + disbursement receipt + redemption proof |
| 2026-07-07 | Contract renderer fallback | Template lookup falls back to `type` when `id` not found (fixes `'loan-contract'` → `LOAN_CONTRACT`) |
| 2026-07-07 | Phase 7: Gilded Reserve UI redesign | Full dark mode redesign across dashboard + auction frontend — Syne + DM Sans typography, gold (#C9A05C) accent, noise grain overlay, geometric precision, unified design system |
| 2026-09-30 | UI consistency is a standing rule, not a per-task decision | Any new or reworked UI surface is designed against the Gilded Reserve tokens below, via the `ui-ux-pro-max` skill. Prevents the drift where a dialog was invented ad hoc and did not match the app around it |

## UI Design System — Gilded Reserve (standing rules)

Authoritative for any new or reworked surface. Verify with the `ui-ux-pro-max`
skill before building; the queries are in `docs/UI-DESIGN-SYSTEM.md`.

**Tokens — use these, never a raw hex.** The app already declares them as CSS
variables, so a hardcoded `#C9A05C` is a bug even when it matches today.

| Role | Token / value |
|---|---|
| Gold accent (primary action) | `--gold` / `#C9A05C` |
| Destructive (decline, deny, delete) | `--red` / `#D44545` |
| Caution (high risk, pending) | `--amber` / `#D4A84B` |
| Positive (low risk, verified) | `--green` / `#3DA86C` |
| Page background | `--bg-deep` / `#0A0A0F` |
| Card / dialog surface | `#14141B` |
| Raised surface (inputs, wells) | `#1C1C26` |
| Primary / secondary / muted text | `--text-primary` / `--text-secondary` / `--text-muted` |
| Display font (figures, headings) | `--font-display` (Syne) |
| Body font | `--font-body` (DM Sans) |
| Label font (uppercase micro-labels) | `--font-mono` (JetBrains Mono) |

**Components — build on `src/components/ui/`, do not hand-roll.** `Button`,
`Dialog`, `Badge`, `Input`, `Textarea`, `Select`, `Tabs`, `Table`, `Skeleton` all
carry the focus ring, hover treatment and press behaviour already.

**Rules that exist because they were each violated:**

1. **One primary action per view.** A screen with two equally-weighted gold
   buttons has no primary action. Secondary is `outline`; destructive is `destructive`.
2. **Money gets hierarchy.** A figure the user must act on is `text-4xl` in
   `--font-display` at `--gold`. Never three equal-weight rows of figures — a
   valuation and a loan that happen to match must not render as the same number
   twice. Label which figure is which. Printed output follows the same rule: a
   document the borrower signs leads with the amount, not with a flat field list.
   See `contract-renderer.service.ts` and `scripts/preview-contract-pdf.ts`.
3. **The action must be visible without scrolling.** In a dialog, the primary
   action goes in a pinned footer, not at the end of the scroll area.
4. **Uppercase micro-labels use `--font-mono`,** 9–10px, `tracking-widest`, and
   are always muted — they are field names, not content.
5. **No emoji as structural icons.** Lucide only, matching stroke weight.
6. **Every interactive element** needs a visible `focus-visible` ring, a
   `cursor-pointer`, and a hover transition in the 150–300ms range.
7. **A destructive action is never one click.** It opens a reason picker and
   stays disabled until a reason exists — see `DeclineReasonPicker.tsx`.
8. **Overlays stack in sequence, and only one is open at a time.** Closing a
   dialog must always set the state that opened the next one, otherwise two
   overlays mount together and the one mounted first wins. Each overlay owns a
   distinct z-index — base `z-50`, contract `z-[100]` — and equal z-index is
   never acceptable between two surfaces that can be open simultaneously.
9. **Override a component's width at its breakpoint.** `DialogContent` ships
   `sm:max-w-lg`; a bare `max-w-2xl` loses to it on desktop (equal specificity,
   responsive rule emitted later) and the dialog silently stays 512px. Pass
   `sm:max-w-2xl`. Any label longer than its button also needs
   `whitespace-normal` + `h-auto`, because `Button` sets `whitespace-nowrap`.
   Verify at 200% zoom, not just 100%.
10. **Test with `jsdom` caveats in mind:** Radix `Select` will not open from
    `pointerDown`; use `keyDown` with `ArrowDown`. Radix `Tabs` activate on
    `mouseDown`, not `click`. Both silently find zero matches otherwise.
11. **A new test must be shown to fail against the old code.** A test that passes
    both before and after a fix is asserting nothing — revert the fix, watch it
    fail, then restore. This has caught three "fixed" bugs that were not.

**Visual harness.** `frontend/harness/` renders a component against fixture
data with no auth or API, for checking a design without a live backend:

```bash
cd frontend && npx vite dev
# then open http://127.0.0.1:5173/harness/index.html
```

It is dev-only and must never be imported from `src/`.
