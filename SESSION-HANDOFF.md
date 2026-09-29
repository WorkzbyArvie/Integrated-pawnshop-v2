# PawnGold — Session Handoff (end of 2026-09-30, session 3)

**Defense: 3rd week of October 2026.** About two weeks.

**HEAD:** `dad2f62`, **local only — NOT pushed.** Three commits are unpushed and
therefore **not deployed**:

| Commit | Not yet live |
|---|---|
| `46433c1` | Appraisal rates + risk scoring moved off the client |
| `7768089` | Two interest unit bugs; POS/redemption/dashboard stop computing money |
| `dad2f62` | Renewal closed, plus three defects in `renewLoan` |

Supersedes the `5c6f85a` handoff. Everything in that file about the RLS work and
the section-3a deploy verification still stands and is not restated here. What
follows is what changed since, and what is now wrong.

Backend **1014** tests / 61 suites, all green. Frontend **287** passing, tsc clean
both sides. The same two pre-existing `kycDocs` failures remain, still not ours.

---

## 1. Read this first

**None of this session's work has been seen in a browser, and the agent cannot
reach the database.** Everything below is unit tests against mocks. Three
previous deploys in this project failed on migration details, all caused by me.
Treat the three commits as unreviewed until you have clicked through them.

The defects fixed this session were not found by reading the code carefully. They
were found by the tests disagreeing with me — several times the failing test was
my own arithmetic being wrong, but four times it was a real bug in code I had
just written. **The pattern that worked: write the test that states the
*invariant* rather than the expected number, and let it tell you.** A test
asserting "the bank cannot be cheaper than the customer" found the 3%-vs-3.5%
mismatch; a test asserting "summing rates is not an average" found the 10.5×
projected-interest bug.

## 2. The four real money bugs

### 2a. Every POS-created ticket recorded 350% interest

`createTicket` wrote `interestRate: 3.5` into `ticket.interestRate`, which is a
**fraction** (column default `0.035` = 3.5%). A percentage into a fraction column.
A redemption priced off that column would have demanded 3.5× principal. Now
resolves the shop's configured rate like everything else.

### 2b. Projected interest was 100× out *and* scaled with ticket count

`analytics.service.ts`, both `getBranchActivity` and `getDashboardStats`:

- Summed the `interestRate` column across tickets, then multiplied by total
  principal. Summing rates is not an average. Three tickets at 3.5% sum to 10.5
  and reported **10.5× principal** as monthly interest — and the error grew with
  the number of tickets, not the amount of money.
- Both then divided by 100 as if the column were a percentage. It is a fraction.
  That was 100× out *on top of* the scaling bug.

**Why it survived:** the test fixtures used `interestRate: 3` instead of `0.035`.
At 3 the `/100` is invisible. A test asserting a plausible-looking wrong number
is worse than no test. See trap 18.

### 2c. The redemption screen charged a flat ₱50 and the wrong interest rate

`Redemption.tsx` computed `principal * 0.03` plus a hardcoded `serviceFee = 50`
and sent that as `amountPaid`. Two independent errors: loans issued at 3.5% so the
branch absorbed the difference on every redemption; and P.D. 114 §10 caps the
service fee at the **lesser of 1% of principal and ₱5**, so a flat ₱50 was up to
ten times the legal maximum. A ticket is money already owed, so it is now priced
from the loan's own recorded rate.

### 2d. A refused renewal still granted the pawner 30 days

`renewLoan` validated the tender **after** the ticket had been transitioned to
`ACTIVE` with its expiry, grace and forfeiture dates rewritten. A renewal
rejected for the wrong amount handed the pawner another 30 days and buried the
mismatch in the database with no payment, no receipt and no proof. The check now
runs before any write, and there is a test asserting that a refusal leaves
`ticket.update`, `loan.update`, `stateMachine.transition` and `payment.create`
all uncalled.

## 3. The other things fixed

| Defect | Where |
|---|---|
| Appraisal rates lived in a React component; nothing recorded what produced a valuation | `SalesPos.tsx` → `backend/src/loan/appraisal.ts` |
| Silver priced at ₱42/gram — a pre-2020 figure against a real market of ₱70–90 | same |
| Risk curve read `w > 100 ? 20 : 32`: **heavier scored safer** | same |
| Dashboard showed `totalPrincipal * 0.035`, discarding the per-ticket figure the endpoint had just computed | `Dashboard.tsx` |
| `riskScore \|\| undefined` turned a legitimate score of `0` into `undefined` | `SalesPos.tsx` |
| Every `<label>` in the POS form was unassociated with its input | `SalesPos.tsx` |
| Panel printed `interestRate.toFixed(2)` on a fraction → "Interest (0.04%)" on a 3.5% loan | `Redemption.tsx` |
| `POST /loans/renew` existed with **no caller at all** | dead code |
| `renewLoan` fetched `ticketId` and `loanId` independently and never checked they were related — could extend one pawn's dates while collecting another loan's interest | `loan.service.ts` |
| `processedBy` came from the **request body**, so receipts named whoever the client typed | `loan.controller.ts` |

## 4. Decision waiting on you

**`frontend/src/lib/loanTerms.ts` is untracked and contradicts the backend.**

| | Grace period |
|---|---|
| `backend/src/loan/loan-terms.ts` (verified against lawphil, P.D. 114 §13) | **90 days** |
| `frontend/src/lib/loanTerms.ts` | **30 days** |

Nothing imports it, so it is harmless today. But its header claims a
`loanTerms.sync.test.ts` that **does not exist** — the one safeguard it names is
not running. A stale mirror of a statutory constant is precisely the drift that
caused 2c above.

My recommendation is to **delete it**. The constants now arrive in the API
responses (`termDays`, `gracePeriodDays`, `newGracePeriodEnd`), so the client has
nothing to mirror. I did not delete it unilaterally because it is untracked and I
did not create it — confirm and I will remove it.

## 5. Push and deploy, in this order

1. `git push origin main`
2. **Wait for Render.** Vite builds faster than NestJS, so the normal failure mode
   is a new frontend live against an old backend — sign-in breaks first. (This
   bit us before; the last deploy got lucky and the order was favourable.)
3. Click through, in this order:
   - **Sign in.** Highest risk — depends on endpoints added across several pushes.
   - **POS → Calculate.** This is the one that changed most. A 10g silver
     bracelet should quote **₱440** (₱80/g × 55% LTV). It used to say ₱294. If it
     still says ₱294 the rates did not deploy. Check the panel shows the rate, the
     LTV, the 30-day term and the risk factors — that disclosure is new.
   - **Redemption → Calculate.** Should show principal + interest at the *loan's*
     rate + a ₱5 service fee, not ₱50. Then **Authorize Release** and confirm the
     receipt matches.
   - **Redemption → "Customer is renewing instead" → Collect Interest & Renew.**
     Entirely new. Confirms ₱350 on a ₱10,000 loan at 3.5%.
   - **Dashboard** projected interest. Was 100× out; there is no obviously
     "correct" value to eyeball, so compare a portfolio figure against what the
     loans actually are.
4. **Nothing was deployed this session. Do not assume the live app has any of it.**

## 6. New tooling traps

The previous handoff's list (traps 1–15) still stands. Four more, all of which
cost real time:

16. **PowerShell has no heredoc.** `git commit -F - <<'EOF'` fails with a
    parser error that looks like a git problem. Write the message to a temp file
    and use `git commit -F <path>`.
17. **jsdom swallows clicks on submit buttons inside a form with `required`
    fields.** Native validation runs first and the handler never fires. Use
    `fireEvent.submit(form)`, not `fireEvent.click(button)`. The button is a
    submit *inside a form* that also collects customer details — this is normal
    markup, not a test artifact.
18. **A fixture that asserts a plausible wrong number is worse than no test.**
    `interestRate: 3` in a column that stores `0.035` made a 100× error look
    correct. When a unit is in question, assert the *invariant* ("this figure
    does not move when a loan is split in two") rather than the expected value.
19. **The permission matrix is a tripwire and it earns its keep.** It caught me
    declaring `pawn_ticket.create` on the redemption quote where
    `pawn_ticket.redeem` was correct, and it pins the count of guarded endpoints
    as an explicit number. Every new guarded endpoint must be added to
    `permissions-catalog.spec.ts` **and** the count bumped, or the suite fails.
    That is the system working, not an obstacle.

## 7. Still open

Unchanged from the `5c6f85a` handoff unless noted:

- **Click through the app** — see section 5. This is the top item.
- **Thesis prose reconciliation** (~1h, draft-level): renewal "8 months" → 30
  days; drop the at-rest encryption claim; narrow "weighted forecasts"; fix
  "Forfeiture" (state seizure → lender takes collateral); "Based on google";
  verify "Tan and Lim (2022)"; standardise "Dasmariñas". The real thesis is
  `CHAPTER201-4.docx` — `CAPSTONE CHAP 1-3.docx` is a decoy (a flower-shop
  project, byte-identical across five copies). Note it currently shows as
  **deleted-but-unstaged** in `git status`; that deletion predates this session
  and is not mine, so I left it alone.
- **P.D. 114 §14 sale notice** (date, hour, place, on or before the end of the
  90-day period) — not implemented. The grace period is right; the required
  notice before disposal is missing.
- **You must verify the 7 compliance documents as Super Admin.** Until they are
  VERIFIED, `ComplianceGuard` blocks pawn tickets, loans and auction bids. This
  is the single most likely reason a demo fails live.
- **§2b from the older handoff, still yours:** rotate `service_role`, then the
  JWT secret. Key is in git history via `d9d199a`.
- **43 orphan auth accounts** — no `profiles` row. You told me to delete them;
  never confirmed done.
- **The DB credential in `backend/.env` is dead** (P1000). Every live claim in
  this handoff rests on operator-run queries, not on a connection of mine.
- **Mobile app has no credential-security code at all** — see
  `.planning/phases/10.1-.../MOBILE-HANDOFF.md`. A bidder can set a weak
  password on mobile. Largest remaining gap for the defense; you have not yet
  confirmed whether to build it.
- **Phase 11 (Contract Management Upgrade)** and **Phase 12** untouched.
- **`account-security.guard.ts`**: `mfaRequired()` says "Email verification is
  required" when the *MFA assertion* is missing. Misleading; two-line fix.
- **Dashboard live-update is gone** and unreplaced. The fix is a Realtime
  broadcast fed by a database trigger, **not** a browser SELECT policy on
  `ticket` — the latter would undo the RLS work in `5c6f85a` entirely.
- **`.planning/STATE.md` and `state.json` disagree** with each other and with
  this file. GSD bookkeeping, not maintained. This file is authoritative.
