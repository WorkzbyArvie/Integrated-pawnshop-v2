# UI Design System — Gilded Reserve

PawnGold's visual language. Authoritative for any new or reworked surface.
`AGENTS.md` holds the short version; this file is the working detail and the
skill queries that produce it.

The goal of this document is that a new dialog does not get invented ad hoc and
then sit next to four other dialogs it does not match.

---

## Verifying a design before you build

Run these with the `ui-ux-pro-max` skill. From the repo root:

```bash
# 1. Full system — use for a new page or a reworked section
python .opencode/skills/ui-ux-pro-max/scripts/search.py \
  "fintech dark gold review detail layout hierarchy" \
  --design-system -p "PawnGold" --density 7

# 2. Focused concern — one intent per query, never a checklist
python .opencode/skills/ui-ux-pro-max/scripts/search.py \
  "modal dialog approve decline destructive action confirmation" --domain ux

python .opencode/skills/ui-ux-pro-max/scripts/search.py \
  "money figure hierarchy tabular data" --domain chart

python .opencode/skills/ui-ux-pro-max/scripts/search.py \
  "keyboard focus modal" --domain ux

# 3. Stack rules — the app is React 19 + Vite + Tailwind 4 + shadcn/Radix
python .opencode/skills/ui-ux-pro-max/scripts/search.py \
  "rerender memo long list" --stack react
```

`--density 7` suits this app. A dashboard and an approval queue are dense
operational surfaces; `9`–`10` (dashboard) if a screen is mostly tables.

**Search for the outcome, not the framework.** `"error summary validation"`, not
`"tailwind form"`. A framework keyword returns a checklist, not guidance.

---

## Tokens

The app already declares these as CSS variables in `src/index.css`. Use the
variable. A hardcoded `#C9A05C` is a bug even when it matches today — it will
not follow a theme change.

### Colour

| Role | Token | Hex | Use for |
|---|---|---|---|
| Primary accent | `--gold` | `#C9A05C` | The single primary action, money figures, active tab |
| On gold | — | `#0A0A0F` | Text on a gold fill |
| Destructive | `--red` | `#D44545` | Decline, deny, delete, error |
| Caution | `--amber` | `#D4A84B` | High risk, pending, expiring |
| Positive | `--green` | `#3DA86C` | Verified, low risk, live |
| Page | `--bg-deep` | `#0A0A0F` | Behind everything |
| Surface | — | `#14141B` | Cards, dialogs, table bodies |
| Raised | — | `#1C1C26` | Inputs, wells, image frames |
| Text primary | `--text-primary` | `#F5F0E8` | Values, names, headings |
| Text secondary | `--text-secondary` | `#C8C0B4` | Body copy |
| Text muted | `--text-muted` | `#8A8279` | Labels, metadata, placeholders |
| Text dim | `--text-dim` | `#5C564E` | Disabled, decorative only |

Contrast: body text sits at 4.5:1 minimum on every surface above. Muted text is
for labels at small sizes, never for a figure a user must read.

### Typography

| Token | Family | Use |
|---|---|---|
| `--font-display` | Syne | Money figures, page headings, the primary figure in a panel |
| `--font-body` | DM Sans | Everything else |
| `--font-mono` | JetBrains Mono | Uppercase micro-labels, ticket numbers, contract numbers |

A micro-label is `text-[9px]` or `text-[10px]`, `font-black`,
`uppercase`, `tracking-widest`, `--text-muted`, `--font-mono`. It is a field
name. Never set a micro-label in the body font at body size.

### Spacing and shape

Cards and dialogs are `rounded-2xl`; buttons and inputs `rounded-[14px]`;
small ghost buttons `rounded-[12px]`. Spacing steps: `1, 2, 3, 4, 5, 6`.
Surfaces separate with `rgba(201,160,92,0.10)`–`0.20` borders, never a drop
shadow against the dark background.

---

## The rules, and why each exists

Every rule below is here because it was broken at least once. That is the point
— each one cost a real defect.

### 1. One primary action per view

Two equally-weighted gold buttons means there is no primary action. Primary is
`variant="default"`, secondary `variant="outline"`, destructive
`variant="destructive"`. In a decision pair (approve / decline), approve is the
filled primary and decline is the outlined red.

### 2. Money gets hierarchy

A figure the user must act on is `text-4xl font-black` in `--font-display` at
`--gold`, with the basis beneath it in muted body text.

Never three equal-weight rows of figures. This is not a style preference: when an
appraisal's valuation and its recommended loan happen to be equal, three equal
rows render the same number twice and the reviewer cannot tell which is which.
Name every figure.

Where two figures relate, state the relationship — `55% of the ₱800.00 appraised
value` — so the primary number is interpretable without arithmetic.

### 3. The action is visible without scrolling

In a dialog, the primary action goes in a pinned footer, not at the end of the
scroll area. The dialog is `max-h-[90vh] overflow-hidden flex flex-col`, with the
body `flex-1 overflow-y-auto` and the footer `shrink-0`.

### 4. No emoji as structural icons

Lucide only, one family, consistent stroke weight. Emoji are font-dependent and
cannot be themed. `ApprovalQueue` uses `CheckCircle2`, `XCircle`, `Loader2`,
`FileText`, `Search`, `RefreshCw`, `ChevronLeft/Right`, `AlertTriangle`.

### 5. Every interactive element is reachable and visible

Visible `focus-visible` ring, `cursor-pointer`, hover transition in 150–300ms.
Press feedback must not change layout bounds — use `active:scale-[0.97]`, not a
margin or size change.

The `Button` component in `src/components/ui/button.tsx` already does all of
this. Use it rather than a bare `<button>`; the exception is an icon-only
carousel control, which needs its own `aria-label` and focus ring.

### 6. A destructive action is never one click

Decline opens `DeclineReasonPicker`, and Confirm stays disabled until a reason
exists. For "other" the typed explanation is required too. A decline with no
reason is a decision the system cannot later explain to a panel.

### 7. Labels are associated with their inputs

Every `<label>` gets a matching `htmlFor` and the control a matching `id`. A
placeholder is not a label — it disappears on focus and is not announced.

### 8. A disabled control explains itself

A greyed-out button with no stated reason reads as broken. Pair the disabled
state with muted helper text: `Select a reason to decline.`

---

## jsdom caveats

These produce tests that pass without exercising anything, or fail with a
confusing message. All three have already cost time.

| Component | Does NOT respond to | Use instead |
|---|---|---|
| Radix `Select` | `fireEvent.pointerDown` / `mouseDown` on the trigger | `fireEvent.keyDown(trigger, { key: 'ArrowDown' })` |
| Radix `Tabs` | `fireEvent.click` on a `TabsTrigger` | `fireEvent.mouseDown(trigger)` |
| A `<button type="submit">` inside a form with `required` fields | `fireEvent.click` | `fireEvent.submit(form)` |

Radix `Select` additionally calls `hasPointerCapture`, which jsdom does not
implement. `src/test/setup.ts` stubs it. **A bare `pointerdown` still leaves the
listbox shut** — the `ArrowDown` path is the reliable one, and it is also what a
keyboard user actually hits.

**Assert invariants, not expected numbers.** A fixture asserting a plausible
wrong value is worse than no test. `interestRate: 3` in a column storing `0.035`
made a 100× error look correct for months. Assert the property instead: "this
figure does not move when a loan is split in two."

---

## Visual harness

`frontend/harness/` renders a component against fixture data with no auth and no
API, so a design can be checked without a live backend.

```bash
cd frontend
npx vite dev
# open http://127.0.0.1:5173/harness/index.html
```

- `harness/index.html` — page shell with the Gilded Reserve CSS variables
- `harness/main.tsx` — entry
- `harness/ApprovalQueueHarness.tsx` — fixture data per state

Dev-only. It must never be imported from `src/`, and the production build must
not reference it. Add a harness file when reworking a surface; delete it once
the change is verified in the real app.
