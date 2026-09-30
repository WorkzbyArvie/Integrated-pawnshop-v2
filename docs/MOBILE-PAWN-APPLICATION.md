# Mobile Pawn Application — Build Spec

**Status:** web flow is built and merged. This document is the contract for the
Flutter app. It is written to be followed without reading the backend source.

**Do not start from the web code.** The screens differ enough (camera, no
address bar, offline tolerance) that copying the React component produces
something that fights the platform. Follow this document.

---

## 1. What this feature is, in one paragraph

A prospective pawner describes an item from their phone, sees an estimated loan
figure priced by the branch's own rate table, uploads photographs and their ID,
and receives a reference number and a 24-hour window to visit the branch. The
branch inspects the item, confirms or revises the figure, and only then is a
contract signed and the item vaulted.

## 2. The one thing you must not get wrong

**This is not a loan application. Do not call it one, and do not design it like
one.**

A pawn loan requires the shop to take physical possession of the collateral. It
cannot be created remotely under any circumstances. The API returns a
`PawnReservation` — a quote and a booking — and there is no endpoint in this
flow that creates a `Loan` or a `Ticket`.

The practical consequences:

- No signature capture. The borrower signs a contract **at the counter**, on
  paper or a signature pad, after inspection.
- No "loan approved" screen. The success state is "your quote is held until
  `<expiresAt>`".
- No repayment, no interest accrual, no redemption. Those belong to the loan,
  which does not exist yet.
- If you show a total repayment figure, it is an *estimate of a loan that may
  never happen*. Prefer not to show one.

A panel will ask why there is no contract in the mobile flow. The correct answer
is: *because a pawn loan is a possession transaction and the item is not in our
hands yet.* That is the system working, not missing.

---

## 3. Base URL and auth

```
https://integrated-pawnshop-v2.onrender.com
```

Every endpoint in §5 is `@Public()`. **Do not send a bearer token on them** and
do not build a sign-in gate around them — a pawner with no account is the
audience. Every route is rate limited; see §7.

The rest of the app's API is authenticated and needs the existing Supabase
session. The application flow does not.

---

## 4. Screens

Five steps, one screen each, matching the web flow at `/apply`.

| # | Screen | Purpose |
|---|--------|---------|
| 1 | Branch | Pick where they will pawn |
| 2 | Item | Category, weight, purity → live price |
| 3 | Photos | 1–2 item photographs |
| 4 | Identity | Name, contact, address, ID type, ID number, ID photos |
| 5 | Result | Reference, held figure, expiry, what happens next |

Add a **6th: Track**, reachable from the result screen. It looks up a reference
number (§5.4). A pawner who closes the app will want this and there is no other
way back in.

### 4.1 Step 2 is the screen that matters

Pricing is **server-side**. Never compute a gram rate, an LTV ratio or a loan
figure in Dart. The web flow already had this defect in its POS and it is the
reason the panel flagged the system: the number on screen and the number on the
ticket came from different places.

Call §5.2 on every change to category, weight or purity, debounced 450 ms. Show
the returned `recommendedLoanAmount` as the headline and `appraisedValue` as the
basis beneath it — two equally-weighted figures render identically when they
happen to coincide, and the reader cannot tell the loan from the valuation.

**Show the price only when it is current.** If the user changes the weight and
the next quote has not returned, disable Continue. Do not let them walk to the
end holding a figure for a different item. (The web flow had exactly this bug.)

### 4.2 Categories are a closed list

Use the four values verbatim:

```
GOLD_JEWELRY      "Gold jewellery"
GOLD_COINS        "Gold coins"
SILVER_JEWELRY    "Silver jewellery"
DIAMOND_JEWELRY   "Diamonds"
```

Do **not** offer a free-text category. The server maps an unrecognised name to
`DIAMOND_JEWELRY`, which carries the *highest* per-gram rate of the four — so a
typo would quote a diamond price for a gold ring. A closed list makes that
unreachable.

Purity grades differ by metal:

```
GOLD_*   →  75 (18K), 91.6 (22K), 96.5 (23K), 99.9 (24K)
SILVER   →  92.5 (sterling), 80, 70
```

Do not offer 24K for silver.

### 4.3 Step 4 wording matters

The screen must say, in substance, **"nothing here is marked verified
automatically"**. Uploading a photograph of an ID is not verification of the
person in it. A member of staff reviews it at the branch.

The system performs **no** OCR, **no** face match and **no** document
forensics. It does not claim to. If your copy implies automated identity
verification, it is lying about the product. A panel will test this by asking
what happens when someone uploads someone else's ID.

---

## 5. API

Base: `/public/pawn`. All JSON unless noted. All snake_case-free — these are
camelCase.

### 5.1 `GET /public/pawn/branches`

Branches that can **lawfully accept pawns today**. The server already filters
out any shop missing a required regulatory document, or holding an expired one,
so the list is safe to show as-is. Render it verbatim; do not add "all branches".

```jsonc
[{
  "pawnshopId": "uuid",
  "pawnshopName": "Cebuana Main",
  "address": "Dasmarinas, Cavite",
  "contactPhone": "0917 555 0100",
  "latitude": 14.4,
  "longitude": 120.9,
  "branches": [{ "id": 3, "name": "Main", "location": "Dasmarinas" }]
}]
```

`branches` is the outlets within that shop; it may be empty. If `branches` has
more than one entry, offer an optional "preferred outlet" picker.

### 5.2 `POST /public/pawn/quote`

Read-only, creates nothing. **Never cache this** — it is branch-specific and the
rate table can change.

```jsonc
// request
{ "pawnshopId": "uuid", "itemCategory": "GOLD_JEWELRY", "weight": 5.5, "purityPercent": 75 }
```

```jsonc
// response
{
  "appraisedValue": 17325.00,
  "recommendedLoanAmount": 12127.50,
  "gramRate": 4200,          // per gram
  "ltvRatio": 0.7,
  "termDays": 30,
  "maturityDate": "2026-10-30T...",
  "gracePeriodDays": 90,      // lawful, not 30
  "belowStatutoryMinimum": false,
  "statutoryMinLtv": 0.4,
  "rates": { "monthlyInterestRate": 0.035, "serviceFeeRate": 0.01 },
  "risk": {
    "score": 40, "band": "HIGH", "factors": ["ID not assessed", "KYC not assessed"],
    "blocking": false
  }
}
```

Notes:

- `purityPercent` accepts a percentage (`75`) or a finess mark (`925`) and
  normalises server-side. A bare `925` is **not** 925% — it is sterling.
- `risk.factors` says **"not assessed"**, never "not verified". Nothing has been
  checked at this point, and the distinction is the point. Do not relabel
  `factors` into pass/fail in the UI.
- `gracePeriodDays` is 90. There was a 30-day figure in a dead frontend file
  that disagreed with the backend; it was deleted. If your copy says 30 days, it
  is wrong.
- `belowStatutoryMinimum: true` means the computed loan is under the legal
  floor. Show it as a warning, do not hide it.

### 5.3 `POST /public/pawn/uploads`

`multipart/form-data`. Field name **`file`**. Optional query `?kind=`:

| `kind` | Use |
|--------|-----|
| `item` | Item photograph |
| `id-front` | Front of ID |
| `id-back` | Back of ID |
| `selfie` | Selfie |

**Do not set `Content-Type` yourself.** Let the HTTP client add the multipart
boundary; setting it by hand produces a body the server cannot parse and the
error surfaces as an empty form, not a rejection.

Accepted: `image/jpeg`, `image/png`, `image/webp`, `image/heic`. Max **5 MB**.
The server picks the stored extension from the declared MIME type, so the
filename you send is irrelevant — send something like `photo.jpg`.

```jsonc
{ "url": "https://<project>.supabase.co/storage/v1/object/public/documents/applicant/item/<uuid>.jpg" }
```

Store the returned URL. The `?kind=` value is a hint for the reviewer's folder,
not a path you control — the server derives the real path itself.

### 5.4 `GET /public/pawn/reservations/:reference`

Look up an application. The reference **is** the capability: no token, no
account. The response deliberately **omits** the identity document URLs, so a
leaked reference does not leak someone's ID photographs.

```jsonc
{
  "reference": "RSV-ABCDE-1234",
  "status": "PENDING",          // PENDING | CONFIRMED | EXPIRED | CANCELLED | CONVERTED | DECLINED
  "expiresAt": "2026-10-01T...",
  "customerName": "Juan Dela Cruz",
  "contactNumber": "0917...",
  "address": "...",
  "itemCategory": "GOLD_JEWELRY",
  "weightGrams": 5.5,
  "purityPercent": 75,
  "appraisedValue": 17325.00,
  "recommendedLoanAmount": 12127.50,
  "termDays": 30,
  "kycStatus": "PENDING",
  "rejectionReason": null
}
```

`status` is computed on read: a lapsed `PENDING` returns `EXPIRED` even if no
job has written it down. Do not compute expiry on the device from a cached
response — ask the server.

### 5.5 `POST /public/pawn/reservations`

Takes the application. Prices it again server-side and stores the server's
arithmetic, so a rate change cannot silently rewrite what was quoted.

```jsonc
{
  "pawnshopId": "uuid",
  "branchId": 3,                          // optional
  "customerName": "Juan Dela Cruz",
  "contactNumber": "09171234567",
  "address": "1 Mabini St, Imus, Cavite",
  "itemCategory": "GOLD_JEWELRY",
  "itemDescription": "22K necklace, one small stone near the clasp",  // optional
  "weight": 5.5,
  "purityPercent": 75,                    // optional
  "photoUrls": ["https://..."],            // optional, 1-2
  "idType": "NATIONAL_ID",                 // optional
  "idNumber": "1234-5678-9012-3456",       // optional
  "idFrontUrl": "https://...",             // optional
  "idBackUrl": "https://...",              // optional
  "selfieUrl": "https://..."               // optional
}
```

`idType` is one of: `NATIONAL_ID`, `PASSPORT`, `DRIVERS_LICENSE`, `SSS_ID`,
`PHILHEALTH_ID`, `VOTERS_ID`, `POSTAL_ID`, `TIN_ID`, `OTHER`.

**There is deliberately no field for "the face matched" or "the OCR was
confident".** Do not add one, and do not send one if the API grows. A client
assertion of a check the server did not perform is how a reviewer ends up
approving on forged evidence. `kycStatus` comes back `PENDING` and only a human
moves it.

The response is the same shape as §5.4, plus `photoUrls`. Save the `reference`
**before** anything else — it is the only way back into this application.

---

## 6. State management

BLoC, consistent with the rest of the app. One bloc for the draft, one for the
track lookup.

- **Persist the draft locally** (Hive/Drift) as the user types. A pawner filling
  this in on a weak connection will get interrupted, and losing a weight and a
  photograph to a backgrounded app is a real support call.
- **Clear the draft once the reservation is created.** Keeping a submitted
  application in the draft store means a second submission on retry — and two
  references for one item.
- **Never persist identity document URLs** beyond the created reservation. They
  are personal data; `photoUrls` are not.

---

## 7. Rate limits

Server-enforced. Handle 429 as "you are going too fast", not as a crash.

| Endpoint | Limit |
|---|---|
| `GET /branches` | 30 / min |
| `POST /quote` | 20 / min |
| `POST /uploads` | 12 / hour |
| `POST /reservations` | **5 / hour** |
| `GET /reservations/:ref` | 30 / min |

The upload limit of 12/hour is the one that will bite. Debounce the camera
button and disable it while an upload is in flight, or a user retrying a failed
photo will exhaust the budget.

---

## 8. Errors

The API returns a plain `message` string. Show it. Do not replace it with
"something went wrong" — "That branch cannot accept pawns at the moment -
its regulatory documents are not on file. Please choose another branch." is
actionable and a generic message throws it away.

Cases to handle explicitly:

- **Non-compliant branch** on quote or submit → the 400 above. Go back to step 1.
- **No branches in the list at all** → say no branch can accept pawns right
  now, and show the contact numbers you do have. Do not render an empty screen.
- **413 / "larger than 5 MB"** → tell them to retake, and suggest lowering camera
  resolution.
- **Network failure on submit** → the application may or may not have been
  created. Say so and offer "check my reference" rather than a blind retry. A
  blind retry on a 5/hour endpoint burns the budget and can produce two
  references for one visit.

---

## 9. Offline

Only as far as this: **capture, don't transmit.** Queue photographs and form
fields locally and submit when the network returns, with a visible "not yet
submitted" state.

Do **not** cache a quote for offline display. It is branch-specific and expires
against a rate table; showing a pawner a number that is no longer the branch's
is worse than showing nothing. If they are offline, they cannot be told the
figure.

---

## 10. Acceptance checklist

- [ ] Five steps, reachable without a login
- [ ] Branch list comes from the API, unmodified
- [ ] Category is a closed picker of exactly four values
- [ ] Purity grades differ for gold and silver
- [ ] Every price shown came from `POST /quote`; none computed in Dart
- [ ] Continue is disabled while a quote is stale
- [ ] Loan's share of the valuation stated as a percentage, e.g. "70% of ₱17,325.00"
- [ ] Photographs uploaded with `multipart/form-data`, no manual `Content-Type`
- [ ] Identity screen states that nothing is verified automatically
- [ ] Result screen shows the reference and the expiry, and offers Track
- [ ] Track works from a cold start with only the reference typed
- [ ] No signature capture anywhere
- [ ] No screen calls itself a loan application
- [ ] Draft survives app backgrounding; cleared after submission
- [ ] 429 handled as rate limiting, not as a crash

---

## 11. Open questions for the team

1. **Push notification on status change.** `CONVERTED` and `DECLINED` happen at
   the counter. Today the pawner must open the app to find out. This needs a
   device-token table and a FCM integration — not built.
2. **Photo compression on-device.** 5 MB is generous for a phone photo of a
   ring, and most devices exceed it in portrait. Worth compressing before
   upload rather than rejecting.
3. **Branch staff notification.** A shop has no way to learn an application
   arrived except opening the queue. Needs a webhook or a poll.
4. **Offline draft → conversion.** When the reservation becomes a ticket at the
   counter, the branch POS should be able to pick it up. Not implemented on
   either side yet.
