# Phase 7 Plan Review — Permission Foundation & Schema Baseline

**Reviewer:** gsd-plan-checker (goal-backward verification)
**Date:** 2026-07-31
**Plan reviewed:** `.planning/phases/07-permission-foundation-schema-baseline/PLAN.md` (13 tasks, 5 waves)
**Artifacts cross-checked:** RESEARCH.md, ROADMAP.md Phase 7, REQUIREMENTS.md, live codebase claims (rbac.guard.ts, pawnshop.guard.ts, app.module.ts, common.module.ts, auth-user.service.ts, schema.prisma, seed.ts, 6 controllers, frontend App.tsx/StaffMatrix.tsx, jest config, migrations dir)

---

## Verdict: **REVISE** (no BLOCKERS — close to PASS; 1 MAJOR + several MINOR fixes before execution)

The plan is exceptionally detailed and, with one exception, every factual claim I checked against the live repo verified exactly. The phase goal WILL be achieved once the verify-command portability issue (MAJOR-1) and the small accuracy fixes are made.

---

## 1. SC → Task Mapping (goal-backward)

| # | Success Criterion (ROADMAP) | Delivered by | Verified by | Verdict |
|---|------------------------------|--------------|-------------|---------|
| SC1 | `@RequiresPermission` endpoints allow only when caller holds permission; else 403 | T8 (PermissionService) + T9 (guard step 7) | T7 rbac.guard.spec.ts (12-case matrix, cases a,c,e,f,g,h,l) + T13 e2e 401 chain + curl recipe | ✅ Covered |
| SC2 | Mapping data-driven — catalog edit changes enforcement, no code change | T2 (migration seed rows) + T6 (idempotent seed) + T8 (per-request DB read, no cache) | T7 catalog spec (const↔SQL↔matrix) + T13 `UPDATE role_permissions` flip → re-curl → revert | ✅ Covered |
| SC3 | staffType users evaluated by staffType perms after role normalization | T9 (guard normalization step 4 + union step 7) | T7 guard spec cases e/f/g/h (legacy + normalized + generic STAFF) + T13 curl (APPRAISER 200, CASHIER_TELLER redeem 200, STAFF appraise 403) | ✅ Covered |
| SC4 | SUPER_ADMIN full-access bypass across all guarded endpoints | T9 (bypass step 5, before permission lookup) | T7 guard spec cases c/d + T13 curl (SUPER_ADMIN → metadata 200) | ✅ Covered |
| M1 | All 63 `@Roles` sites converted to `@RequiresPermission` equivalents (one-pass) | T10 (26), T11 (25), T12 (12) | T7 permissions-catalog.spec.ts (63-site static scan) + T12 GREEN + per-task `tsc` + zero-`@Roles` grep | ✅ Covered (verify cmd issue — see MAJOR-1) |
| M2 | Single batched additive migration applies cleanly with catalog rows | T1 (schema edits) + T2 (migration SQL) + T4 (deploy) | T4 `migrate deploy`/`status` + row-count assertions + T3 human additive-only gate | ✅ Covered (counts not automated — see MINOR-2) |

**Independently verified against live code:** all 63 `@Roles(` sites exist across exactly the 6 controllers named (loan 26, platform 25, compliance+auction 12); tuple distribution 25/16/6/5/4/2/1/1/1/1/1 = 63; 37 catalog values; 101 matrix rows (1+34+8+21+2+8+11+10+2+4). I hand-checked every one of the 12 tuple→permission mappings against the matrix — **exactly one** holder-coverage exception exists (generic STAFF loses `pawn_ticket.appraise`), which matches the deliberate-change log. The three widenings (`contract.sign` on sign-staff, compliance row-52 refinement, HR/INVENTORY_CUSTODIAN/AUDITOR first access) are all documented and behavior-preserving.

## 2. Requirements Coverage

| Requirement | Mechanism delivered | Gaps |
|-------------|--------------------|------|
| **RBAC-01** (catalog + `@RequiresPermission` + data-driven mapping + one-pass refactor of all 63 sites) | T1/T2/T4 (tables + 37/101 rows), T5 (typed const + decorator), T6 (seed), T8 (service), T9 (guard), T10-T12 (63/63), T7 (machine-asserted equivalence) | None. One-pass mandate fully delivered — no v1/stub/partial language anywhere. |
| **RBAC-02** (staffType-aware guard after role normalization) | T9 (legacy-role normalization helper + staffType union resolution), T7 cases e/f/g/h, T13 curl | None. Both profile shapes (legacy `role='CASHIER_TELLER'` and normalized `role='STAFF'+staff_type`) covered. |

Frontmatter `requirements: [RBAC-01, RBAC-02]` matches ROADMAP Phase 7. PROJECT.md milestone goal is consistent (no dropped requirements).

## 3. Ordering / Safety (checked)

- ✅ Schema migration first (Wave 1), guard rewrite (Wave 3) before endpoint migration (Wave 4), e2e + full gate last (Wave 5).
- ✅ Dual-mode guard keeps `@Roles` fail-closed fallback during conversion — no decorator-less window (each conversion replaces in the same edit).
- ✅ Seed idempotent by construction (`ON CONFLICT DO NOTHING` in migration; upsert + `skipDuplicates` in script).
- ✅ T3 blocking human gate before live apply; reject DROP/ALTER/TYPE changes or anything touching `profiles`.
- ✅ T1 preflight (validate/migrate status/full test baseline) before any edit; connectivity checkpoint.
- ✅ `migrate deploy` only — never `migrate dev`/`db push`/`migrate reset`; destructive `seed.ts` untouched (verified: deleteMany on 10 tables at seed.ts:14-23).
- ⚠️ Transient window (T9→T12): because normalization precedes the `@Roles` fallback, *legacy* `role='CASHIER_TELLER'`-style profiles get 403 on still-unconverted endpoints until their domain is converted. Resolves at T12; not documented in the plan (MINOR-8).

## 4. Testability (checked)

- ✅ Every auto task has `<automated>` verify + measurable `<done>`; guard spec written RED (T7) before implementation (T8/T9) — Nyquist compliant; per-wave sampling ≥2/3 with automated verify.
- ✅ Test infra claims verified: jest ^29.5.0 + ts-jest inline config (rootDir src, testRegex `.*\.spec\.ts$`), `test/jest-e2e.json`, supertest, 21 existing spec files, `scripts/prisma-generate-safe.js` in build.
- ✅ 401 e2e tests genuinely need no Supabase mocking — verified `AuthUserService.getUserIdFromAuthHeader` throws on missing header before any Supabase call; both chosen paths (`/pawn-tickets/pending-approval` @ pawnshop.guard.ts:45, `/compliance` @ :31) are PawnshopGuard-exempt.
- ✅ Frontend no-change claim holds — `StaffMatrix.tsx:90-101` writes `{role:'STAFF', staff_type}`; App.tsx resolves display roles from staff_type; and the frontend never calls `/pawn-tickets/:id/appraise` (grep: zero call sites), so the STAFF tightening has no UI regression.
- ❌ `rg` is **not installed** on this machine (verified: not on PATH, no scoop/choco shims) — T2/T10/T11/T12 automated verifies reference it (MAJOR-1).

## 5. Scope Discipline (checked)

- ✅ No leakage into Phases 8-12: ApprovalRecord/CustomerKyc/CustomerTierHistory and all columns are schema-only (T1); zero runtime logic; `approval.*`/`kyc.*`/`onboarding.*`/`contract.upload_signature`/`customer.manage_tier` exist only as catalog rows for later phases.
- ✅ Out-of-Scope section is explicit and correct (Phase 8-12 runtime, service-level role checks, dead `enum Role`, per-tenant overrides, caching, any frontend change).
- ✅ No scope reduction of Phase 7's own mandate — no "v1/static/stub/not wired" language anywhere; DN-1 is a properly flagged DECISION-NEEDED with default, not a silent simplification.
- ⚠️ REQUIREMENTS.md "Out of Scope" still lists "Complete permission refactor of every endpoint in one pass" — contradicts the plan's M1 one-pass mandate (user directive per plan A2/A4). Artifact inconsistency (MINOR-6). Note: no CONTEXT.md exists on disk to cross-check the cited user directives.

## 6. Research Pitfall Mitigation (checked)

| Pitfall | Mitigated by | Status |
|---------|-------------|--------|
| P1 Endpoint opens up during conversion | Dual-mode guard + one-pass in-wave + static equivalence scan asserting zero `@Roles`-only endpoints | ✅ |
| P2 Permission-name drift | Single typed const; decorator accepts only `keyof typeof PERMISSIONS`; catalog spec asserts const↔SQL↔matrix sync | ✅ |
| P3 staffType mixed-state inconsistency | Guard normalization helper (one authoritative spot, mirrors app.service.ts:493-502 — verified) + spec cases e/f/g/h | ✅ |
| P4 Cross-tenant leakage | `pawnshopId` on every new model; zero service reads in Phase 7; EXEMPT list unchanged | ✅ |
| P5 RLS bypass / service-role | Documented app-layer authority; no new Supabase policies; Phase 9 owns KYC RLS | ✅ |
| P6 Migration/seed ordering on Supabase | `migrate deploy` only; DDL via `migrate diff --from-schema-datasource` (no shadow DB); T3 gate; ON CONFLICT idempotency | ✅ |

**New risks the planner missed/under-weighted:**
- (a) Live-DB ↔ schema.prisma drift could make `migrate diff` emit unintended SQL — mitigated only by the T3 human review; plan should instruct diff output inspection as part of T2's done, not just T3's gate (folded into MINOR-3/MINOR-4).
- (b) SC2/SC3/SC4 end-to-end proofs (curl recipe with real JWTs, `UPDATE role_permissions` on dev DB) depend on tokens + write access that are not confirmed available — T1 preflight covers connectivity only (MINOR-9).
- (c) The T2 example migration name `20260801_v2_schema_baseline` doesn't match the repo's 14-digit pattern (`20260117154838_*`) — Prisma validates migration-name timestamps (MINOR-5).

## 7. Findings

### MAJOR (fix before execution)

**MAJOR-1 — `rg` (ripgrep) not installed; automated verify commands unexecutable as written**
- Plan: PLAN.md, T2 `<verify>`, T10/T11/T12 `<verify>` (also referenced in Verification Loop)
- Detail: Verified on this machine — `Get-Command rg` returns nothing; no scoop/chocolatey shims. T10/T11/T12 gate the one-pass completeness on `rg "@Roles\(" src/<domain>` returning zero matches, and T2 counts INSERTs with `rg -c`. On this machine the commands error out (`rg is not recognized`), and since the failing binary also can't distinguish "0 matches" from "command not found", an executor could silently treat the gate as passed.
- Fix: replace with PowerShell `Select-String -SimpleMatch -Path <files>` (exit semantics via `$?`), `findstr /S /M /C:"@Roles("`, or a tiny node script. The T7 jest scan (permissions-catalog.spec.ts) remains the primary machine proof of M1 — the rg checks are the per-task gate, so they must be runnable.

### MINOR (should fix)

**MINOR-2 — T4 catalog row-count assertions not in `<automated>`**
- The 37/101 counts are only in `<done>`/`<action>`; the automated gate runs `migrate deploy; generate; status` only. Add the `prisma db execute` count checks to `<automated>` so M2's row-count proof is machine-asserted.

**MINOR-3 — T7 catalog-spec exception prose is garbled**
- "…(STAFF may lack appraise; STAFF may lack loan.collect on createApplication is inverse — actually: assert tuple-holder coverage allows the documented tightenings exactly…)" — as written, an executor could encode the wrong exception set. The correct rule (verified by hand against the matrix): **exactly one** holder-coverage exception — the appraise endpoint (generic STAFF in the old tuple lacks `pawn_ticket.appraise`). Rewrite this sentence.

**MINOR-4 — "11 additive columns" is a miscount (actually 12)**
- Verified: Customer.tier, Customer.kycStatus, Receipt.customerId, PawnshopDocument.hasViewed/viewedAt/viewedBy, LoanContract 6 signature columns = **12** additive columns (plus 4 relation back-refs on existing models). Appears in T1 `<done>`, must_haves truth 6, and the Delivery Inventory ("+11"). Fix the count so the verifier doesn't flag a missing column.

**MINOR-5 — Migration directory name example doesn't match repo pattern**
- Repo uses 14-digit timestamps (`20260117154838_add_roles_and_branches`); the plan's example `20260801_v2_schema_baseline` is 8 digits. Since T2 writes the folder manually (diff output redirected to file), use `YYYYMMDDHHMMSS_v2_schema_baseline` to avoid Prisma migration-name validation failures at `migrate deploy`.

**MINOR-6 — REQUIREMENTS.md contradicts the one-pass mandate**
- REQUIREMENTS.md "Out of Scope" says "Complete permission refactor of every endpoint in one pass". The plan executes exactly that (M1, per user directive). The user's current instruction confirms one-pass is intended — update REQUIREMENTS.md so the artifact trail agrees. (Also note: no CONTEXT.md exists on disk recording the "user constraint"/"user scope directive" cited in A2/A4 resolutions.)

**MINOR-7 — RESEARCH.md `## Open Questions` not marked resolved**
- Q1-Q4 all have resolutions in PLAN.md (A4 migration-shipped catalog; ADMIN kept narrow; per-tenant overrides deferred; no caching). Mark the section `## Open Questions (RESOLVED)` with pointers, per the research-resolution gate.

**MINOR-8 — Document the T9→T12 transient 403 window for legacy-role profiles**
- After T9, normalization precedes the `@Roles` fallback, so *legacy* `role='CASHIER_TELLER'`-type rows (the ones the 03-24 migration skipped) get 403 on still-unconverted endpoints until T10-T12 land. Same-session window, but it is a real behavior change mid-phase and should be stated in the plan (one line in the Execution Strategy).

**MINOR-9 — Manual SC2/SC3/SC4 proofs depend on unverified token/write access**
- The curl recipe needs real Supabase JWTs per actor and the SC2 proof needs `UPDATE` rights on the dev DB. T1 preflight covers connectivity only. Add a T13 pre-step confirming a set of actor tokens (or a seeding script) is available before the manual checklist.

### NIT (optional)

- **NIT-1** — No `*-VALIDATION.md` file in the phase dir; Nyquist gate 8e formally expects one. The Validation Architecture section is fully embedded in RESEARCH.md (framework, commands, req→test map, sampling) — substance present; either create the file or record acceptance of the embedded form.
- **NIT-2** — 13 tasks in a single PLAN.md exceeds the 2-3 tasks/plan target. The internal 5-wave structure, per-task commits, and independent verifies mitigate this; if time allows, split into 3 plan files (schema+seed; guard rewrite; endpoint migration+e2e) for cleaner parallelization. Not a blocker as structured.
- **NIT-3** — T2's `env("DATABASE_URL")` should be quoted for PowerShell argument-mode parsing: `--from-schema-datasource "env(\"DATABASE_URL\")"`.
- **NIT-4** — Phase plan file is `PLAN.md` while the SUMMARY target is `07-01-SUMMARY.md`; cosmetic naming asymmetry.

## 8. Recommended Changes (before execution)

1. Replace all `rg` invocations in T2/T10/T11/T12 verify blocks with PowerShell `Select-String` / `findstr` equivalents (**MAJOR-1**).
2. Move T4's 37/101 row-count assertions into `<automated>` (**MINOR-2**).
3. Rewrite T7's exception-set sentence to the single-appraise-exception rule (**MINOR-3**).
4. Fix "11" → "12" additive columns in T1 `<done>`, must_haves truth 6, Delivery Inventory (**MINOR-4**).
5. Adopt a 14-digit migration folder timestamp (**MINOR-5**).
6. Update REQUIREMENTS.md out-of-scope line; mark RESEARCH.md Open Questions resolved (**MINOR-6/7**).
7. Add the transient-403 note and token-availability pre-step to the plan text (**MINOR-8/9**).

---

**Bottom line:** Goal-backward mapping is complete and machine-assertable, ordering is safe, scope is disciplined, and every factual claim spot-checked against the repo verified (63 sites, 12 tuples, 37/101 catalog, guard ctor deps, guard-registration order, exempt prefixes, frontend staffType writes, jest config). With MAJOR-1 and the MINOR list addressed, this plan delivers all 4 success criteria plus the one-pass and single-migration mandates.
