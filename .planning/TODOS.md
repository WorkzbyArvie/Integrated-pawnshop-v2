# TODOS.md — Outstanding Issues

## 1. Agreement Template Missing
**Priority:** HIGH  
**Status:** ✅ FIXED  
**Description:** "No agreement content available" when viewing terms.  
**Resolution:** Added auto-seeding in `ContractTemplateService.onModuleInit()` — seeds 3 contract templates (Loan, Auction Bidder, TOS) + 5 default clauses on first startup when table is empty.

---

## 2. Pawnshop-ID Header Missing
**Priority:** HIGH  
**Status:** ✅ FIXED  
**Description:** Missing pawnshop-id header for tenant operational access when clicking "I agree to the terms".  
**Resolution:** Added `/auction/bidders` and `/auction/settlements` to PawnshopGuard exempt list. Added `isBidderAuctionRoute()` check in main.ts subscription freeze middleware to bypass pawnshop-id requirement for bidder endpoints.

---

## 3. KYC Verification Weakness
**Priority:** HIGH  
**Status:** ✅ FIXED  
**Description:** KYC process could be bypassed with fake information.  
**Resolution:**
- Removed auto-approval: submissions now require admin review or OCR auto-verify
- Added client-side OCR (Tesseract.js) to scan ID photos and extract names
- Name matching: compares OCR-extracted name against user-entered full name
- Auto-approve if OCR confidence ≥ 70% AND name matches → VERIFIED
- Otherwise → PENDING for manual admin review
- Added `assertNameNotSuspicious()` to reject obviously fake names
- Files changed: `idOcr.ts` (new), `KycVerification.tsx`, `app.service.ts`, `kyc-validation.ts`
