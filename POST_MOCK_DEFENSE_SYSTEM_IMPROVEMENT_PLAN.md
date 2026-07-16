# Post-Mock Defense System Improvement Plan (Implemented Foundation)

## Platform Positioning
- Product type: Multi-tenant pawnshop SaaS platform.
- Design objective: Strong tenant privacy, controlled support access, modular operations, and secure onboarding.

## Implemented in Code (This Update)

### 1. Tenant Privacy and Controlled Support Access
- Added backend module: `backend/src/tenant-governance/`.
- New endpoints:
  - `GET /tenant-governance/pawnshops/metadata`
    - SUPER_ADMIN can only see tenant metadata (name, status, subscription state).
  - `POST /tenant-governance/support-access/request`
    - SUPER_ADMIN submits temporary access request.
  - `POST /tenant-governance/support-access/:requestId/approve`
    - OWNER/ADMIN approves request with time-boxed expiry.
  - `POST /tenant-governance/support-access/:grantId/revoke`
    - Revoke temporary access.
  - `GET /tenant-governance/support-access/audit`
    - Immutable tenant audit trail for support access actions.

### 2. One-Time Free Trial Policy
- Updated `backend/src/subscription/subscription.service.ts` from 14 to 15 days.
- Trial remains one-time by checking prior `trialEndDate` usage before creating a new trial.

### 3. Modular Onboarding and Role Planning
- Added endpoint:
  - `POST /tenant-governance/onboarding/configure`
- Captures selected modules, staff count, and role assignment distribution per pawnshop tenant.

### 4. Subscription-Aware Branding
- Added endpoint:
  - `PATCH /tenant-governance/branding`
- Enforces:
  - If `custom_branding` feature is false: display defaults to pawnshop name.
  - If `custom_branding` feature is true: allows logo and color customization.

### 5. Audit and Governance Data Model
- Added SQL migration file: `TENANT_GOVERNANCE_MIGRATION.sql` with new tables:
  - `support_access_requests`
  - `support_access_grants`
  - `tenant_audit_logs`
  - `tenant_module_configs`
  - `tenant_branding_profiles`

### 6. Hard RLS Enforcement (Implemented)
- Added: `RLS_SUPER_ADMIN_SUPPORT_ACCESS_ENFORCEMENT.sql`
- Added: `RLS_SUPPORT_ACCESS_ENFORCEMENT_TESTS.sql`
- Enforcement behavior:
  - SUPER_ADMIN cannot read operational tenant data by default.
  - SUPER_ADMIN can read operational rows only with active, unexpired support grant.
  - SUPER_ADMIN remains read-only for operational rows (no write policy).
  - Non-super-admin users remain tenant-scoped by pawnshop.

### 7. Landing Page and Public Client Registration (Implemented)
- Added landing page UI with:
  - System overview
  - Subscription plan cards (includes one-time 15-day trial messaging)
  - Public client registration form
  - Contact/support section
  - Reviews/testimonials section
- Added public backend endpoint:
  - `POST /tenant-governance/public/client-registration`
- Added persistence table:
  - `client_registration_requests` (in `TENANT_GOVERNANCE_MIGRATION.sql`)
- Added RLS policies for registration request intake and SUPER_ADMIN processing.

### 8. Multi-Branch Management (Implemented)
- Added tenant-governance endpoints:
  - `GET /tenant-governance/branches`
  - `POST /tenant-governance/branches`
  - `PATCH /tenant-governance/branches/:branchId`
- Added branch governance behavior:
  - Branch list with active/inactive state and staff counts.
  - Branch create/update with OWNER/ADMIN/BRANCH_ADMIN role gating.
  - Subscription-aware branch limit checks (`max_branches`) before branch activation/creation.
  - Branch governance actions logged to `tenant_audit_logs`.
- Extended migration and security scripts:
  - `TENANT_GOVERNANCE_MIGRATION.sql` now extends `public.branch` with governance metadata columns.
  - `RLS_SUPER_ADMIN_SUPPORT_ACCESS_ENFORCEMENT.sql` now includes `public.branch` tenant/support policies.
- Added frontend tenant UI:
  - New operational page: `MultiBranchManagement`.
  - New navigation tab for Branch Admin/Owner users.

## Security and RBAC Design (Defense Talking Points)

### Least Privilege
- SUPER_ADMIN is restricted to metadata operations by API design.
- Operational data access remains tenant-scoped and must pass explicit approval workflow.

### Separation of Duties
- SUPER_ADMIN cannot self-grant support access.
- OWNER/ADMIN approval is required for temporary access grants.

### Time-Bound and Auditable Access
- Access grants have explicit expiry.
- All support actions are written to `tenant_audit_logs`.

## Remaining Workstream (Next Sprints)

### Sprint A: Hard Enforcement via DB Policies
- Add Supabase RLS policies tied to support access grant table and tenant scope.
- Explicitly deny SUPER_ADMIN direct reads on loan/transaction/ticket tables without active approved grant.

### Sprint B: Full RBAC Matrix
- Introduce permission table model (role-to-capability matrix).
- Expand roles: owner, admin, cashier, appraiser, inventory, HR, auditor, support.

### Sprint C: Client Communication
- Build in-system support tickets/chat module for platform-to-tenant communication.
- Add event notifications for request approval/revocation and billing events.

### Sprint D: Landing and Subscription UX
- Add plan cards and trial rules on landing page.
- Add one-time trial messaging and transparent feature list.

### Sprint E: PayMongo UX Optimization
- Implement QR/scan-first payment journey and payment status auto-sync hooks.

## Backend Files Added/Changed
- Added: `backend/src/tenant-governance/tenant-governance.module.ts`
- Added: `backend/src/tenant-governance/tenant-governance.controller.ts`
- Added: `backend/src/tenant-governance/tenant-governance.service.ts`
- Added DTOs under: `backend/src/tenant-governance/dto/`
- Updated: `backend/src/app.module.ts`
- Updated: `backend/src/subscription/subscription.service.ts`
- Added SQL migration: `TENANT_GOVERNANCE_MIGRATION.sql`

## Frontend Files Added/Changed
- Added: `frontend/src/components/MultiBranchManagement.tsx`
- Updated: `frontend/src/App.tsx`

## How to Roll Out
1. Execute `TENANT_GOVERNANCE_MIGRATION.sql` in Supabase SQL Editor.
2. Execute `RLS_SUPER_ADMIN_SUPPORT_ACCESS_ENFORCEMENT.sql` in Supabase SQL Editor.
3. Execute `RLS_SUPPORT_ACCESS_ENFORCEMENT_TESTS.sql` and verify policy coverage.
4. Deploy backend with new `tenant-governance` module.
5. Validate API behavior with OWNER/ADMIN and SUPER_ADMIN test accounts.
6. Open frontend `/` route to verify landing page and submit a client registration request.
