# PawnGold — Session Handoff (end of 2026-10-01, session 6)

**Defense: 3rd week of October 2026.** About two weeks.

**Everything is committed and pushed.** `origin/main` == `HEAD` == `cb7d35c`.

**Verified state:** backend **1145** tests / 72 suites green, frontend **361** /
31 files green, tsc clean both sides, both builds clean.

**`DATABASE_URL` is fixed.** `backend/.env` points at the live Supabase
database, so `npx prisma migrate deploy` now works locally — and because it is
the *same* database Render uses, running a migration locally **is** deploying
it. Migration `20260930220000_add_pawn_reservations` is applied and verified
against the live database: table present, 38 columns, enum and both foreign keys
resolving, 0 rows.

---

## What this session built

### The online pawn application

A prospective pawner picks a branch, describes an item, sees it priced by that
branch's own rate table, uploads photographs and ID, and receives a reference
with a **24-hour window** to visit. Reachable at `/apply`, no login.

| Piece | Path |
|---|---|
| Public page | `frontend/src/pages/ApplyPage.tsx` |
| Backend module | `backend/src/public-appraisal/` |
| Table | `pawn_reservation` |
| Mobile spec | `docs/MOBILE-PAWN-APPLICATION.md` |

**It is a quote and a booking, never a loan.** A pawn loan requires physical
possession of the collateral, so nothing in this flow can create one. There is
no signature capture, no "loan approved" screen, and `PawnReservation` has no
relation to `Loan` or `Ticket`. If a panel member asks where the e-signature is,
the answer is that a pawn loan is a possession transaction and the item is not
in our hands yet.

### Commits this session

| Commit | What it did | Deployed? |
|---|---|---|
| `791a9ad` | The online application: backend, page, table, mobile spec | yes |
| `2335a8e` | Show a closed branch instead of hiding it | yes |
| `9dee2f8` | A pawner can reach the flow from the landing page | yes |
| `37a606a` | Dead Back button; footer buttons read as pressed | yes |
| `cb7d35c` | The wordmark is the way off the page | yes |

---

## Defects found and fixed

### The identity signals were forgeable

`app.service.ts` read `faceMatched`, `ocrNameMatch` and `tamperClean` out of the
**request body** and stored them as findings. It never auto-approved anyone — a
human still decided — but the reviewer saw green ticks the server had
established nothing, and anyone could POST one. The system performs no OCR, no
face match and no document forensics, so it now records only what it observed
and says so explicitly. Claims are kept under `clientAsserted.trusted: false`.

The same rule applies to the new reservation flow: `kycStatus` is always
`PENDING`, never `VERIFIED`. A reviewer adjudicates and stamps `reviewed_by`.

### A cross-tenant read I introduced

The shop-side queue resolved its tenant from `?pawnshopId=`, so any account
holding `pawn_ticket.create` could read another shop's applicants by typing a
different ID. Fixed to read from `req.user`, matching `getPendingApproval`. The
permission-catalog and tenant-guard tripwires both fired unprompted on the new
controller — they are why it was caught.

### The compliance gate made the page empty

All 13 shops in the live database are missing regulatory documents. My first
version filtered non-compliant shops out of the listing, so `/apply` rendered
**nothing** — indistinguishable from a loading failure. Now every shop is listed
with `canAcceptApplications`, marked Accepting or Closed, with the reason.
Compliant shops sort first. The transaction is still refused; only what a pawner
can *see* widened.

### A silent no-op in the new page

The price is debounced 450 ms. You could change your weight, hit Continue inside
that window, reach the last step holding a price for a different item, and
click Submit and have *nothing happen*. Continue now stays disabled until the
price matches the form. Same defect that made "Approve" look broken on the
approval queue.

### Four smaller ones

- **Two Radix `SelectItem value=""`** — the empty string is reserved for
  clearing a Select, so the "preferred outlet" and "not sure" dropdowns threw
  when opened. Replaced with a sentinel.
- **Category pickers are closed lists, deliberately.** `collateralClassFor` maps
  an unrecognised name to `DIAMOND_JEWELRY`, which carries the *highest*
  per-gram rate. A free-text field would let a typo quote a diamond price for a
  gold ring.
- **The branch list's last entry was cut in half** behind the sticky footer. A
  `sticky` footer paints over content rather than pushing it up.
- **A dead Back button on step one.** Rendered disabled, which reads as broken
  rather than as "there is nothing before this step". Now absent on step one,
  present from step two.

---

## Blockers, in priority order

### 1. Upload compliance documents — blocks the demo entirely

Every branch renders as **Closed**. Super Admin → Compliance → **Cebuana** needs
`DTI_SEC`, `BIR_CERTIFICATE`, `VALID_GOVT_ID`, `PROOF_OF_BUSINESS`. That is the
only shop needing just four.

Until one shop is open, nobody can complete an application. This also blocks
pawning at the counter, since `ComplianceGuard` gates the POS too.

### 2. Convert a reservation into a ticket — the biggest functional gap

An application currently ends there. The appraiser can see it but has no way to
turn it into a `Ticket`. The `convertedTicketId` column exists and is unused.

### 3. Track-by-reference page

`GET /public/pawn/reservations/:reference` works and is verified live. There is
no UI. A pawner who closes the tab has no way back in.

### 4. Branch staff queue screen

`GET /public/pawn/reservations` exists, permission-gated and tenant-scoped.
Nothing renders it, so a shop cannot see applications it has received.

### 5. Mobile app

Per `docs/MOBILE-PAWN-APPLICATION.md`. Written to be followed without reading
the backend.

---

## Open from earlier sessions, unchanged

- **Rotate `service_role`, then the JWT secret.** A Supabase key is in git
  history via `d9d199a`. Then delete the 43 orphan auth accounts. A panel may
  not ask, but a live key in a public repo is a real problem.
- **`app.service.ts` no longer trusts the body** for KYC flags — fixed this
  session. Confirm no other controller does.
- **P.D. 114 §14 sale notice** — the remaining legality red mark.
- **Thesis prose reconciliation** (~1h). The real file is `CHAPTER201-4.docx`,
  not the `CAPSTONE CHAP 1-3.docx` that is still tracked and now deleted from
  the working tree — worth confirming that deletion was intended.

---

## What has not been verified

I called the deployed endpoints directly and they behave:

| Check | Result |
|---|---|
| `GET /public/pawn/branches` | 200, 13 shops, compliance state on each |
| `POST /public/pawn/quote` on a closed shop | 400, names the document count |
| `POST /public/pawn/uploads` with no file | 400 |
| `POST /public/pawn/reservations` with no name | 400, lists every missing field |

**Not verified in a browser.** The frontend has no visual check from this
session. Two of the four defects fixed above (the clipped branch, the pressed
buttons) were found from an operator screenshot, not from a test — jsdom does no
layout, so overlap cannot be observed from the DOM.

**Click `/apply` once and walk the five steps** when a shop is compliant. That is
the single most useful thing left to do.

---

## A note on the tests

Three assertions written this session passed against the code they were supposed
to catch, and only failed once the fix was reverted and re-run:

- `/pb-2\d/` matched the `sm:pb-28` variant, so deleting the base `pb-24` still
  passed.
- `\bpb-2\d` *still* matched it, because `:` is a non-word character, so the
  word boundary sits between `sm:` and `pb-28`.
- A loose `className="[^"]*pb-2\d[^"]*"` matched some other element on the same
  screen.

A source-reading test has to be the thing that fails when the fix is reverted,
or it is decoration. This is the same trap as the rule that a test must be shown
failing before it is trusted — and it caught three of mine in a row.

`LandingPage` had **zero** test coverage until this session, which is why the
missing route to `/apply` survived review. It also could not be rendered under
jsdom at all: it uses `IntersectionObserver` and `onAuthStateChange`, neither of
which jsdom implements. Both are now stubbed in `src/test/setup.ts`.

---

## State of the working tree

Dirty, all uncommitted and none of it source:

- `.planning/*` — GSD docs, not maintained; this file is authoritative
- `.opencode/`
- `CHAPTER201-4.docx` untracked, `CAPSTONE CHAP 1-3.docx` deleted from the
  working tree but still tracked
