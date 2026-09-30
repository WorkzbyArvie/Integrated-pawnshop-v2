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

### 9. To override a component's width, override its *breakpoint*

`DialogContent` ships `sm:max-w-lg`. Passing `max-w-2xl` does **not** widen it.

Both declarations are a single class selector, so they have equal specificity,
and Tailwind emits the responsive variant later in the stylesheet. At desktop
width the `sm:` rule wins and the dialog stays at 512px. Verified in the built
CSS: `.sm\:max-w-lg` sits at byte 104719, inside `@media(min-width:40rem)`,
while the bare `max-w-*` utilities sit near 23000 — later wins.

The failure is silent and looks like a styling mistake rather than a specificity
one, and it only shows at desktop width, so it survives a narrow-window check.

**Rule: to change a `sm:`-prefixed default, pass the same prefix.**

```tsx
<DialogContent className="sm:max-w-2xl …">   // correct
<DialogContent className="max-w-2xl …">     // silently ignored on desktop
```

This is not confined to `DialogContent`. Any component that sets a responsive
default has the same trap — grep for `sm:max-w-`, `sm:grid-cols-`, `sm:gap-`
before assuming a bare override took effect.

**A label longer than its button needs `whitespace-normal`.** The `Button` base
sets `whitespace-nowrap`, so a long uppercase label can only ever be clipped,
never wrapped. Pair it with `h-auto` and a `min-h-*` so the button grows:

```tsx
className="flex-1 min-h-11 h-auto py-2.5 whitespace-normal leading-tight"
```

Check the rendered width at **200% browser zoom** as well as at 100%. That is
where a fixed-max-width dialog with a nowrap label fails first.

### 10. Overlays open in sequence, never together

When one dialog hands off to another, the first must close before the second
opens. Set the state that opened the next surface, and clear the state of the
one being replaced.

```tsx
if (applicationId || contractId) {
  setReviewItem(null);        // the outgoing dialog
  setContractHandoff({ ... }); // the incoming one
} else {
  setReviewItem(null);        // nothing replaces it - still close
}
```

The `else` matters as much as the `if`. A redemption produces no contract, so
nothing would otherwise replace the dialog and the reviewer is left on a decided
request with live buttons.

**Each overlay owns a distinct z-index.** Two surfaces that can be open at the
same time must never share one:

| Layer | z-index | Surface |
|---|---|---|
| Base overlay | `z-50` | Dialogs, toasts, dropdowns |
| Contract | `z-[100]` | `ContractViewer` |

At equal z-index, the element mounted first paints on top — which is how
approving an appraisal appeared to do nothing at all: the contract opened
correctly, underneath a review dialog that was never told to close.

An overlay also needs `role="dialog"`, `aria-modal="true"` and an accessible
name, and every icon-only control inside it needs an `aria-label`.

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

**Show the test failing before you trust it.** A test that passes both before
and after a fix is asserting nothing. Revert the fix, run the test, confirm it
fails, then restore. This is not optional ceremony — it has caught two bugs that
were reported fixed and were not, including a dialog that stayed open because
the assertion was checking the wrong element.

A specific trap: asserting that a button is *gone* is not enough. Assert the
thing the user needs is *present* — the contract dialog opened, not merely that
the review button vanished.

---

## Printed output — contract PDFs

The web design system does not transfer to paper. A loan contract is printed,
photocopied, and submitted to a panel, so:

- **Monochrome.** No brand gold on the body. The one accent is a 1.5pt rule under
  the title, which survives a photocopier.
- **Two columns, one baseline.** Label in a fixed left gutter, value at a fixed
  x. Sizes differ (8.5pt label, 10pt value, 13pt for the amount), so the label
  is nudged down by `(valueSize - labelSize) * 0.7` to share the value's
  baseline. That factor was measured off the emitted PDF text matrices — do not
  "simplify" it away.
- **The amount leads.** `LOAN AMOUNT` sits on a shaded band at 13pt. It is the
  figure the borrower is agreeing to.
- **One signature block.** Never a blank ruled block above the signed one.

**Do not flatten template HTML.** The old renderer did
`html.replace(/<[^>]*>/g, '\n')`, turning every tag into a line break. The
templates write `<strong>Label:</strong> value<br/>` specifically to keep a
label and its value on one row, and that `<br/>` was inverted into a newline —
so every field printed as two lines. `htmlToBlocks` recovers the structure;
`contract-renderer.layout.spec.ts` pins it.

### Previewing a PDF without a running backend

```bash
cd backend
$env:TS_NODE_COMPILER_OPTIONS='{"module":"commonjs","target":"es2021","esModuleInterop":true,"experimentalDecorators":true,"emitDecoratorMetadata":true,"skipLibCheck":true}'
npx ts-node scripts/preview-contract-pdf.ts   # writes contract-{unsigned,signed}.pdf
```

To check alignment rather than eyeball it, extract text with its coordinates —
this asserts rows line up, which a screenshot cannot:

```bash
node <path>/pdf-rows.cjs scripts/contract-unsigned.pdf
```

It inflates the content streams and prints `y=<baseline> x=<x> <text>` per run.
Two runs on the same `y` are on one visual row. Gitignored output.

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
