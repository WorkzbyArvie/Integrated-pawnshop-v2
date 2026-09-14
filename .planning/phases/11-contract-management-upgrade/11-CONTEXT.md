# Phase 11: Contract Management Upgrade - Context

**Gathered:** 2026-09-14
**Status:** Ready for planning
**Mode:** Smart discuss (autonomous, batch-accepted proposals)

<domain>
## Phase Boundary

Contract signing supports digital signature image upload alongside the existing
canvas-drawn and typed-name paths, generated loan contracts carry item-specific
redemption terms (redemption date, redemption amount, appraisal value, forfeiture
date), and the active LOAN_CONTRACT template includes pawnshop responsibilities &
liability clauses.

Existing infrastructure (already implemented pre-phase):
- Schema baseline (Phase 7) added `SignatureType` enum (`CANVAS | TYPED | UPLOADED`),
  `LoanContract.customerSignatureType`, `staffSignatureType`,
  `customerSignatureImageUrl`, `customerSignatureImageMime` — see
  `backend/prisma/schema.prisma:858-874`, enum at :1895.
- `ContractViewer.tsx` already has a file-upload input (mime check, FileReader →
  data URL) alongside canvas-draw + typed fallback paths (`frontend/src/components/ContractViewer.tsx:120-137`).
- `LoanContractService.signByCustomer/signByStaff` persist `customerSignature`
  (data URL) and emit LegalProof (`backend/src/loan/loan-contract.service.ts:223-300`).
- Contract generation injects `templateData` and auto-appends custom sections via
  `getCustomContractSections` (reads `pawnshop.settings.contractTermsAndConditions`
  and `contractPawnshopResponsibilities`) + `applyExtraSections`
  (`backend/src/contract/contract-renderer.service.ts:125-148`).
- Ticket model has `forfeitureDate` (:288); redemption/maturity/amount data
  derivable from loan application (termMonths, loanAmount) and finance math.

This phase delivers:
- CTR-01: upload signature image during signing (validated mime/size, persisted),
  with `customerSignatureType=UPLOADED` recorded.
- CTR-02: loan contract template injects item-specific redemption terms at
  generation time.
- CTR-03: active LOAN_CONTRACT template includes pawnshop responsibilities &
  liability clauses (custody/duty of care, loss/damage liability).

Out of scope: auction-bidder contract signing parity; mobile parity; typed-name
signature migration; customer-facing self-service signature upload.

</domain>

<decisions>
## Implementation Decisions

### Signature Upload Validation (CTR-01)
- **D-01:** Max uploaded signature image size = 2 MB. Reject with 400 if exceeded.
- **D-02:** Allowed MIME types = `image/png`, `image/jpeg`, `image/webp`. Reject
  others with 400. Image data itself is base64 data-URL (existing field shape).
- **D-03:** Uploaded image is persisted as base64 data URL in the existing
  `customerSignature` / `staffSignature` column; the sign endpoint also records
  `signatureType` (`UPLOADED` vs `CANVAS` vs `TYPED`) and fills
  `customerSignatureImageUrl`/`customerSignatureImageMime` metadata. No new
  storage bucket.
- **D-04:** Validation happens on the client (mime/size pre-check + toast error)
  AND on the server (defense in depth) — DTO validates mime prefix + decoded byte
  length ≤ 2 MB.
- **D-05:** Sign endpoints accept an optional `signatureType` field; when the
  payload signature is a data URL beginning with one of the allowed image MIME
  prefixes, type defaults to UPLOADED. Legacy canvas/typed path stores type
  accordingly.

### Item-Specific Redemption Terms (CTR-02)
- **D-06:** `LoanContractService.generateContractForApplication` computes and
  injects into `templateData`: `redemptionDate`, `redemptionAmount`,
  `appraisalValue`, `forfeitureDate`. Values computed from the loan application
  geometry (principal + accrued interest at term end = redemption amount; maturity
  date + grace period = redemption date; forfeiture = maturity + grace + late
  window).
- **D-07:** Template placement = new Handlebars section "ITEM-SPECIFIC REDEMPTION
  TERMS" between the COLLATERAL and TERMS AND CONDITIONS sections.
- **D-08:** Formatting = Philippine peso (`₱X,XXX.XX`) for amounts; `MM/DD/YYYY`
  en-PH locale for dates.
- **D-09:** The LOAN_CONTRACT template content (seeded default template) gains the
  `{{redemptionDate}}`, `{{redemptionAmount}}`, `{{appraisalValue}}`,
  `{{forfeitureDate}}` mustache variables; template field list updated to include
  the new keys (see migration seed list at
  `backend/prisma/migrations/20260705_add_legality_backbone/migration.sql:174`).

### Pawnshop Responsibilities & Liability Clauses (CTR-03)
- **D-10:** Default clause text is seeded directly into the LOAN_CONTRACT template
  content (always present): (a) custody & duty of care of collateral; (b) loss /
  damage liability of the pawnshop. Standard Philippine pawnshop regulation
  language.
- **D-11:** `pawnshop.settings.contractPawnshopResponsibilities` (already read by
  `getCustomContractSections`) remains an optional per-shop override — if set, it
  replaces the default responsibilities section text.
- **D-12:** Placement = a new section "PAWNSHOP RESPONSIBILITIES AND LIABILITY"
  after TERMS AND CONDITIONS and before SIGNATURES.

### the agent's Discretion
- Exact DTO shape for `signatureType` (optional field on existing sign DTOs).
- Exact wording of the seeded clause text and the item-specific terms section HTML.
- Whether redemption math reuses an existing finance helper or computes inline.
- Spec coverage: which methods get mocked-Prisma specs.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- Schema: `LoanContract.customerSignatureType/staffSignatureType` +
  `customerSignatureImageUrl`/`customerSignatureImageMime` + `SignatureType` enum
  already migrated (Phase 7).
- `ContractViewer.tsx` — upload input + canvas + typed UI already exists; must be
  tightened (size limit) and wired to send `signatureType`.
- `ContractRendererService.applyExtraSections` — inserts sections before
  SIGNATURES anchor; reusable for the new REDEMPTION TERMS / RESPONSIBILITIES
  sections.
- `LoanContractService.getCustomContractSections` — reads per-shop settings;
  extend or mirror for responsibilities override.
- Existing sign DTOs: `frontend` calls `PATCH /loan/contracts/:id/sign-customer`
  and `sign-staff`.

### Established Patterns
- Backend-first; DTO validation with class-validator; mocked-Prisma specs
  (see `loan-contract.service.spec.ts`).
- LegalProof emitted at every contract event (generation, customer sign, staff sign).
- Gilded Reserve dark theme (gold `#C9A05C` on near-black) in frontend.

### Integration Points
- `LoanContractService.generateContractForApplication` — template data assembly.
- `loan-contract.service.ts` sign methods + their controller DTOs.
- `contract-renderer.service.ts` — template compile + section injection.
- LOAN_CONTRACT seed template content + template field list (migration seed).

</code_context>

<specifics>
## Specific Ideas

No specific references beyond the accepted grey areas. Follow existing
contract/loan service conventions and Gilded Reserve theme.
</specifics>

<deferred>
## Deferred Ideas

- Auction-bidder contract signature image upload (Phase 6 parity).
- Mobile app contract signing parity.
- Migrating legacy typed/canvas signatures stored in `customerSignature` to
  typed `signatureType` values.
</deferred>

---

*Phase: 11-Contract Management Upgrade*
*Context gathered: 2026-09-14*