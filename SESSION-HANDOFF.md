# PawnGold — Session Handoff (end of 2026-09-30, session 4)

**Defense: 3rd week of October 2026.** About two weeks.

**Everything is committed and pushed.** `origin/main` == `HEAD` == `ef6846a`.
Nothing is uncommitted in source; the only dirty files are GSD planning docs
(`.planning/*`, not maintained — this file is authoritative) and the deliberately
deleted `CAPSTONE CHAP 1-3.docx` decoy.

**Verified state:** backend **1072** tests / 67 suites green, frontend **321** /
28 files green, tsc clean both sides, both builds clean.

| Commit | What it did | Deployed? |
|---|---|---|
| `46433c1` | Appraisal rates + risk scoring off the client | yes |
| `7768089` | Two interest unit bugs; POS/redemption/dashboard stop computing money | yes |
| `dad2f62` | Renewal closed, plus three defects in `renewLoan` | yes |
| `f920ab2` | Session 3 handoff | yes |
| `0b6945c` | Dashboard branch name; declines gated on a reason | yes |
| `de23cf4` | Review dialog rebuilt; design system recorded | yes |
| `e48bddb` | Review dialog closes before the contract opens | yes |
| `d3d3e16` | Review dialog was 512px, not 672px, and clipped its action | yes |
| `310b891` | `contract.view` needs a forward migration, not a baseline edit | yes |
| `5cacca2` | Contract PDF layout rebuilt; "30 days months" fixed | yes |
| `e6be121` | Ignore generated preview PDFs | yes |
| `5db5c12` | Signer's printed name on the contract | **no** |
| `f31b0f8` | Fix the broken signer-names migration | **no** |
| `ef6846a` | Document `DATABASE_URL` and the P3018 recovery | **no** |

The last three are **not live**. They are blocked on the SQL statement in the
next section. Everything above them is deployed and was confirmed by the
operator: POS quotes ₱440 on 10g of silver, the contract shows grace 90 days and
interest 3.50%.

## Session 5 — pick up here

Ten commits, all pushed, none verified in a browser. **The single most useful
thing you can do is click through the app.** Everything below says what to look
at and what "correct" looks like.

**Suite state:** backend **1028** / 63 suites green, frontend **318** / 28 files
green, tsc clean both sides, both builds clean. The two `kycDocs` failures are
**fixed** — see below; they were ours, not pre-existing.

---

## Session 4 — read this first

The pattern from session 3 held: almost nothing here was found by reading code
carefully. The bugs were found by the operator clicking through, and by tests
that were asked to fail before being believed.

**Two things to know before you trust any of it:**

1. **The agent still cannot reach the database.** `backend/.env` holds a dead
   credential (P1000). Every live claim below rests on operator-run queries.
2. **Nothing in session 4 has been seen in a browser by the author.** It is unit
   tests against mocks, plus a build. The click-through is still the top open
   item, and it is now the *only* verification that has not happened.

## The money bug behind "Failed to fetch"

Clicking **Download Contract PDF** produced `Failed to fetch`.

The handler hand-rolled a `fetch` against `import.meta.env.VITE_API_URL`. **This
project does not define `VITE_API_URL`** — it defines `VITE_BACKEND_URL`, read
through `src/lib/backendUrl.ts`. So the expression was always falsy and the URL
silently fell back to `http://localhost:3000`. The browser asked the user's own
machine for a contract that lives on Render, and reported the network failure
with no hint of the cause.

`InventoryVault.handleShowContract` had the identical line, so "view contract" on
a redeemed item was broken the same way and would not have been noticed.

Both now go through a new `api.blob()` in `apiClient`, which reuses
`getBackendUrl()` and the same auth/tenant headers as every other call. There is
no `VITE_API_URL` anywhere in the repo now — worth a grep before you add one.

**Generalisable:** a raw `fetch` in a component is a defect in this codebase,
not a style choice. It skips the base URL resolution, the MFA gate, the token
refresh, and the `no-store` policy, and it is the only way a component can end up
pointing at localhost.

## Security: the contract PDF route was cross-tenant

Found while fixing the above, and it is the most serious item in this session.

`GET /loan/contracts/:contractId/pdf` had **no `@Roles` and no
`@RequiresPermission`**, and `downloadContractPdf` looked the contract up with a
bare `findUnique({ where: { id } })` — no tenant check at all. So:

- any authenticated profile, of any role, could reach the route; and
- the contract belongs to whichever shop owns it, not the caller's shop.

That is a cross-tenant read of a **signed legal document** — the contract the
whole thesis rests on being able to produce. A manager of one shop could render
another shop's contract by guessing a UUID.

Fixed on both halves, because they are different questions:

- **May this role read a contract?** New `contract.view` permission, granted to
  exactly the roles that already hold `contract.sign` (OWNER, MANAGER, STAFF,
  CASHIER_TELLER, APPRAISER). Declared in the permission matrix, and seeded by
  the forward migration in trap 25 — **a baseline edit alone left every live
  environment refusing the owner**, which the operator caught immediately.
- **Whose contract?** The service now compares the contract's owning
  `application.pawnshopId` against the caller's, and 404s on a mismatch. A 404,
  not a 403 — a 403 confirms the id exists, which is itself a disclosure about
  another shop's records. `SUPER_ADMIN` is exempt **at the service layer only**:
  `RbacGuard` holds super admin to an allowlist and `/loan` is not a governance
  prefix, so over HTTP the guard refuses before the service runs. Support access
  is delivered by `/tenant-governance/request-support-access` instead.

The scoping tests were reverted-and-checked: 4 of 7 fail without the fix.

**This class of bug has now appeared four times** in this codebase — the browser
branch-name read, the analytics aggregates, the KYC doc URLs, and now this. Every
one was a read assembled outside the tenant the request was scoped to. The
recurring shape is worth naming in the defense: *the browser was trusted to know
whose data it was looking at.*

## Test traps — three more, and a rule

20. **A new test must be shown to fail against the old code.** Twice in these two
    sessions a test passed both before and after a fix, asserting nothing. One
    was an approval-dialog assertion checking the wrong element; one was a
    revert that did not apply and I read the green run as success. Revert, watch
    it fail, restore. Non-negotiable now.
21. **Radix `Select` will not open in jsdom from a pointer event.** It reads
    `hasPointerCapture`, and a bare `pointerdown` still leaves the listbox shut
    even with the stub in `setup.ts`. Use `keyDown` + `ArrowDown` — which is
    also the keyboard-user path. A test that "opens" a dropdown and asserts
    nothing is the trap.
22. **Radix `Tabs` activate on `mouseDown`, not `click`.** Same failure mode.
23. **The permission-matrix tripwire earned its keep again.** Guarding the PDF
    route failed 6 of 12 catalog tests until the counts (40→41 constants, 118→123
    mappings, 106→111 SQL rows, 102→103 guarded sites) and the matrix entry were
    updated. It will fail on any unguarded or drifted endpoint. Do not "fix" it by
    loosening the assertions.
24. **A bare `max-w-*` does not override a component's `sm:max-w-*`.** Equal
    specificity, and Tailwind emits the responsive rule later, so on desktop the
    base wins. The review dialog passed `max-w-2xl`, stayed at 512px, and clipped
    the approve label. Confirmed in the built CSS: `.sm\:max-w-lg` is at byte
    104719 inside `@media(min-width:40rem)`; bare `max-w-*` is near 23000. Pass
    the same breakpoint prefix. This is a **live bug in 17 other dialogs** — every
    `DialogContent className="max-w-*"` in the app is probably rendering at
    `sm:max-w-lg` instead of its intended width. Not yet swept; see open items.
25. **A new permission needs a FORWARD migration, never a baseline edit.** This
    is the most important deployment lesson in the file, and I got it wrong.
    Adding `contract.view` to `permissions.const.ts` **and** to
    `20260731120000_v2_schema_baseline` passed every test — and did nothing
    live, because the baseline has already run in every environment.
    `PermissionService.resolveEffectivePermissions` reads the
    `role_permissions` **table**, so an owner with no row was refused with
    `Access denied. Required permission(s): contract.view. Your role: OWNER`.
    The whole catalog suite was green while the feature was dead in production.
    Fixed by `20260930120000_add_contract_view_permission`, which is the same
    pattern as `20260910100000_add_review_permissions` — a file that already
    documented this exact trap. The baseline edit was kept, because fresh
    installs need it. Two catalog tests now assert every declared permission is
    seeded by *some* migration, and that `contract.view` specifically has a
    forward migration; the second was verified to fail when the migration is
    removed.

    **Before shipping any new permission:** create a new migration directory
    with `YYYYMMDDHHMMSS_name`, insert the permission and its role grants with
    `ON CONFLICT DO NOTHING`, and do not rely on the baseline. Prisma's
    `migrate deploy` runs on Render via `prestart:prod`, so a correct forward
    migration is applied automatically on deploy.
26. **A Prisma model name is not a table name.** `@@map` renames the table, and
    `LoanContract` lives in `loan_contracts`. A migration written against
    `loan_contract` failed on deploy with P3018 / 42P01, `relation
    "loan_contract" does not exist`. **Read the `@@map` line for every model a
    migration touches, before writing the SQL.** This is the fifth migration
    deploy this project has lost, and the fourth caused by this author.
    `migration-table-names.spec.ts` now validates table references in forward
    migrations against `schema.prisma` and rejects a model name used where
    `@@map` renames the table — verified by reintroducing the bug and watching it
    fail.
27. **A failed migration blocks every later one.** Prisma records it in
    `_prisma_migrations` with `finished_at` NULL and then refuses to apply
    anything until it is resolved. Correcting the SQL and pushing is *not*
    enough — the row must be cleared by hand or every later deploy fails
    identically with P3018. See the unblock section. `migrate resolve
    --rolled-back` needs a working `DATABASE_URL`, which is why the equivalent
    `UPDATE ... SET rolled_back_at = NOW()` is documented in `.env.example`: it
    needs no credential at all.
28. **The theme across sessions 3–5: a green suite did not mean working.**
    Every defect in this file shipped past a full test run and a clean build,
    because none of them was visible from TypeScript. The browser was trusted to
    know whose data it was looking at; a percentage went into a fraction column;
    a template was edited but the live row was not; a model name was used where
    a table name belonged. Tests that assert the *invariant* rather than the
    expected number found more of these than reading the code did, and the
    "show the test failing first" rule caught three fixes that were reported
    done and were not.

## UI: the design system is now written down

`AGENTS.md` has a standing **UI Design System — Gilded Reserve** section, and
`docs/UI-DESIGN-SYSTEM.md` holds the detail plus the `ui-ux-pro-max` queries that
produce it. Every rule is there because it was broken once: one primary action,
money gets hierarchy, the action must be visible without scrolling, overlays
open in sequence and never share a z-index.

`frontend/harness/` renders a component against fixtures with no auth or API, for
checking a design without a live backend:

```bash
cd frontend && npx vite dev   # then /harness/index.html
```

Dev-only, and verified absent from the production bundle.

## Test checklist — do this first

Nothing below has been seen in a browser. Each row is a thing that changed and
what "correct" looks like, so a failure is unambiguous.

| # | Where | Expect |
|---|---|---|
| 1 | Dashboard header | The shop's name. It said `Loading...` forever because the state was seeded with that string and a non-empty string is truthy, so the `\|\|` fallback could never fire. |
| 2 | Approval Queue rows | A real figure, not `₱0.00`, labelled **Recommended loan**. The endpoint returns `recommendedLoanAmount`, never `amount` — the old helper read the field that does not exist. |
| 3 | Review & Decide | Dialog opens at full width, **not** 512px. Label and value share a baseline. `Approve & Generate Contract` is fully visible, not clipped. |
| 4 | Decline (in the dialog) | Opens a **dropdown** of reasons per request type, disabled until one is chosen. `Other` requires typed text. Applies to all three surfaces. |
| 5 | Approve & Generate Contract | The review dialog **closes** and the contract opens in front. Both used to mount at `z-50`, so the contract was behind the dialog. |
| 6 | Download Contract PDF | Downloads. **A 404 is correct** if you switched shops — that is the tenant scoping working, not a regression. |
| 7 | The PDF itself | Labels and values on one row; terms numbered 1–8; **one** SIGNATURES block, not two; "Page 1 of 2" bottom-right; `Loan Term: 30 days` **not** `30 days months`. |
| 8 | Signature names | `JUAN DELA CRUZ` in caps under the signature rule, role beneath. **Needs the unblock below first** — this is the not-yet-deployed part. |
| 9 | Renewal | Redemption → "Customer is renewing instead" → Collect Interest & Renew. ₱350 on a ₱10,000 loan at 3.5%. |

To inspect a PDF without the app:

```bash
cd backend
$env:TS_NODE_COMPILER_OPTIONS='{"module":"commonjs","target":"es2021","esModuleInterop":true,"experimentalDecorators":true,"emitDecoratorMetadata":true,"skipLibCheck":true}'
npx ts-node scripts/preview-contract-pdf.ts    # contract-{unsigned,signed,half-signed}.pdf
node ../docs/pdf-rows.cjs scripts/contract-signed.pdf   # prints text + x/y per run
```

`pdf-rows.cjs` asserts rows line up, which a screenshot cannot. Two runs on the
same `y` are on one visual row.

## Session 4 additions — a security fix and a UI rebuild

### The contract PDF route was cross-tenant (most serious item of session 4)

`GET /loan/contracts/:contractId/pdf` had **no `@Roles` and no
`@RequiresPermission`**, and `downloadContractPdf` looked the contract up with a
bare `findUnique({ where: { id } })` — no tenant check at all. Any authenticated
profile of any role could render **any shop's signed contract** by guessing a
UUID. That is a cross-tenant read of the document the whole thesis rests on.

Fixed on both halves, because they are separate questions:

- **May this role read a contract?** `contract.view`, granted to exactly the
  roles that already hold `contract.sign` (OWNER, MANAGER, STAFF, CASHIER_TELLER,
  APPRAISER). Seeded by the forward migration in trap 25 — a baseline edit alone
  left every live environment refusing the owner, which the operator caught
  immediately.
- **Whose contract?** The service compares the contract's owning
  `application.pawnshopId` against the caller's and 404s on a mismatch. A 404,
  not a 403 — a 403 confirms the id exists. `SUPER_ADMIN` is exempt **at the
  service layer only**: `RbacGuard` holds super admin to an allowlist and
  `/loan` is not a governance prefix, so over HTTP the guard refuses first.
  Support access is `/tenant-governance/request-support-access`.

The scoping tests were reverted-and-checked: 4 of 7 fail without the fix.

**This is the fourth instance of the same class** — the browser branch-name read,
the analytics aggregates, the KYC doc URLs, and this. Every one was a read
assembled outside the tenant the request was scoped to. That shape is worth
naming in the defense: *the browser was trusted to know whose data it was
looking at.*

### The contract PDF, rebuilt

The renderer was `html.replace(/<[^>]*>/g, '\n')` — it replaced **every tag**
with a newline, including the `<br/>` the templates use deliberately to keep a
label and its value on one row. Every field printed as two lines. The same line
of code produced underlined headings that read as hyperlinks, unnumbered terms,
and no page numbers. It also printed **two** SIGNATURES blocks: the template's
blank ruled one, then the renderer's signed one.

Now: a real parser (`htmlToBlocks`), label/value as an aligned two-column table
with a fixed gutter, the amount on a shaded band at 13pt, numbered terms with a
hanging indent, one signature block, and a footer on every page with the contract
number and "Page N of M". Signer names now print in caps under their own rule,
snapshotted at signing time (`customer_signer_name` / `staff_signer_name`,
migration `20260930160000`) — deliberately not joined at render time, because a
deleted staff record must not change what a signed contract says.

Layout was verified by extracting text and baselines from the generated PDF, not
by eye: `docs/pdf-rows.cjs`. That caught a sign error in my own baseline-alignment
fix, which had *doubled* the error instead of removing it.

## Still open

Ordered by what actually blocks a live demo.

1. **Verify the 7 compliance documents as Super Admin.** Until each is
   `VERIFIED`, `ComplianceGuard` blocks pawn tickets, loans and auction bids.
   Single most likely reason a demo fails, and entirely outside the code.
2. **Rotate `service_role`, then the JWT secret.** Key is in git history via
   `d9d199a`. Urgent: the cross-tenant PDF read existed, so treat the credentials
   as exposed. Rotating the *database* password in Supabase also fixes the dead
   `backend/.env` credential — see the unblock section.
3. **43 orphan auth accounts** — no `profiles` row. Deletion was requested twice
   and never confirmed.
4. **Click through the app** — the checklist above.
5. **Thesis prose reconciliation** (~1h, draft level): renewal "8 months" → 30
   days, drop the at-rest encryption claim, narrow "weighted forecasts", fix
   "Forfeiture" (lender takes collateral — not the state seizing it), remove
   "Based on google", verify "Tan and Lim (2022)", standardise "Dasmariñas".
   The real thesis is `CHAPTER201-4.docx`; `CAPSTONE CHAP 1-3.docx` is a decoy
   from a flower-shop project and is already deleted in the working tree.
6. **P.D. 114 §14 sale notice** — not implemented. The 90-day grace period is
   right; the required notice before disposal is missing.
7. **17 dialogs render at the wrong width** — trap 24. Every
   `DialogContent className="max-w-*"` outside `ApprovalQueue` passes a bare
   `max-w-*`, which loses to the base `sm:max-w-lg`, so they render at 512px on
   desktop. Most ask for *narrower*, so they are accidentally fine;
   `PayrollManagement` asks for `max-w-3xl` and is definitely being squeezed. A
   mechanical `sm:` prefix sweep fixes all of them. Not done — it changes widths
   nobody has looked at.
8. **`submitForApproval` stores `appraisedValue` and `recommendedLoanAmount` as the
   same number** (`pawn-ticket.service.ts`). The review dialog now labels them
   separately so the UI is not misleading, but the stored data is still wrong: a
   ticket appraised through that path has no distinct valuation on record.
9. **Mobile app has no credential-security code at all** — a bidder can set a
   weak password on mobile. Largest remaining gap; never confirmed whether to
   build it.
10. **Dashboard live-update** gone and unreplaced. The fix is a Realtime
    broadcast fed by a database trigger, **not** a browser SELECT policy on
    `ticket` — that would undo the RLS work entirely.
11. **Phase 11 and Phase 12** untouched.
12. `.planning/STATE.md` and `state.json` disagree with each other and with this
    file. GSD bookkeeping, not maintained. **This file is authoritative.**

## BLOCKED — read this before anything else

The signer-names deploy failed and the next deploy will fail identically until
the failed migration row is resolved. **`migrate resolve` cannot be run from the
author's machine** — `backend/.env` holds a dead database credential (P1000).
This is the "DB credential in `backend/.env` is dead" item from session 3, now
load-bearing.

### The unblock, in the Supabase SQL editor

No shell, no password, no working local credential required. Check first:

```sql
SELECT migration_name, started_at, finished_at, rolled_back_at
FROM _prisma_migrations
WHERE migration_name = '20260930160000_add_contract_signer_names';
```

Expect one row with `finished_at` NULL and `rolled_back_at` NULL. Then:

```sql
UPDATE _prisma_migrations
SET rolled_back_at = NOW()
WHERE migration_name = '20260930160000_add_contract_signer_names'
  AND finished_at IS NULL;
```

This is exactly what `npx prisma migrate resolve --rolled-back` writes, so the
corrected migration re-applies on the next deploy. **Never run `migrate reset`
against production** — it drops the schema.

Then redeploy `f31b0f8`. The migration adds `customer_signer_name` and
`staff_signer_name` to `loan_contracts`.

### Then fix the local credential properly

You need a working `DATABASE_URL` for every future migration, and you need to
rotate the database password anyway as part of the credential rotation. Those
are the same action: in Supabase, Project Settings → Database, reset the
password, then copy the fresh connection string into `backend/.env`. See the
newly filled-in `backend/.env.example` for the exact form.

---

<details>
<summary>Session 3 handoff (superseded — kept for the trap list and the RLS notes)</summary>

# PawnGold — Session Handoff (end of 2026-09-30, session 3)

Backend **1014** tests / 61 suites, all green. Frontend **287** passing, tsc clean
both sides. The same two pre-existing `kycDocs` failures remain, still not ours.

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
nothing to mirror. I did not delete it unilaterally because it is untracked and
I did not create it — confirm and I will remove it.

> **Resolved in session 4.** Confirmed zero importers and deleted. It was the
> only untracked source file in the repo; the constants now come from the API.

## 6. New tooling traps

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

</details>

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
