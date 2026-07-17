# Codebase Structure

**Analysis Date:** 2026-07-17

## Directory Layout

```
Integrated-pawnshop-v2/
├── .agents/skills/          # Agent skill definitions
├── .claude/skills/          # Claude skill definitions
├── .planning/               # GSD planning artifacts
│   ├── codebase/            # Codebase analysis docs (this)
│   ├── debug/               # Debug state
│   └── roadmap/             # Roadmap & milestones
├── backend/                 # NestJS API server (main backend)
│   ├── src/                 # TypeScript source
│   ├── prisma/              # Schema, migrations, seed
│   ├── scripts/             # Utility scripts
│   ├── test/                # E2E test config
│   └── package.json
├── frontend/                # React dashboard SPA
│   ├── src/                 # TypeScript/JSX source
│   ├── public/              # Static assets
│   └── package.json
├── auction-frontend/        # React auction house SPA
│   ├── src/                 # TypeScript source
│   ├── public/              # Static assets
│   └── package.json
├── mobile/                  # Flutter mobile app
│   ├── lib/                 # Dart source
│   ├── assets/              # App icons, images
│   ├── android/             # Android platform
│   ├── ios/                 # iOS platform
│   ├── web/                 # Flutter web build
│   └── pubspec.yaml
├── package.json             # Root (minimal: ecc-universal, react-router-dom)
├── .env.example             # Environment template for all apps
├── AGENTS.md                # Project context for AI agents
└── README.md                # Project documentation
```

## Directory Purposes

**`backend/src/`:**
- Purpose: NestJS API server — all backend business logic
- Contains: 20+ NestJS modules, each with controller/service/module/dto pattern
- Key files:
  - `main.ts`: Bootstrap, CORS, Helmet, rate limiting, subscription freeze middleware
  - `app.module.ts`: Root module importing all feature modules + global guards/interceptors
  - `app.controller.ts`: Root auth/staff/ticket/customer endpoints (legacy, should be refactored)
  - `app.service.ts`: Root business logic (legacy, should be refactored)
  - `prisma.service.ts`: Singleton Prisma client with reconnect logic
  - `prisma.module.ts`: Prisma module definition

**`backend/src/common/`:**
- Purpose: Cross-cutting infrastructure shared by all modules
- Contains: Guards, decorators, interceptors, filters, state machine, storage
- Key files:
  - `guards/rbac.guard.ts`: Role-based access control enforcement
  - `guards/pawnshop.guard.ts`: Tenant header validation
  - `guards/rate-limit.guard.ts`: Per-endpoint rate limiting
  - `decorators/roles.decorator.ts`: `@Roles()` metadata setter
  - `decorators/public.decorator.ts`: `@Public()` auth bypass
  - `decorators/throttle.decorator.ts`: `@Throttle()` rate limit config
  - `decorators/audit-log.decorator.ts`: `@AuditLog()` marker
  - `state-machine/state-machine.service.ts`: Generic transition engine
  - `state-machine/pawn-lifecycle.ts`: Ticket, loan application, compliance transition definitions
  - `interceptors/response-transform.interceptor.ts`: Wraps responses in `{ success, data }`
  - `interceptors/audit-log.interceptor.ts`: Audit logging for sensitive ops
  - `interceptors/request-logger.interceptor.ts`: Request/response logging
  - `filters/global-exception.filter.ts`: Global error handler
  - `storage/storage.service.ts`: Supabase Storage integration
  - `auth-user.service.ts`: Token verification helper

**`backend/src/loan/`:**
- Purpose: Complete loan lifecycle management
- Contains: Loan CRUD, pawn tickets, disbursement, repayment, forfeiture, eligibility, history
- Key files:
  - `loan.controller.ts`: Loan API endpoints
  - `loan.service.ts`: Core loan business logic
  - `pawn-ticket.controller.ts`: Pawn ticket CRUD endpoints
  - `pawn-ticket.service.ts`: Pawn ticket creation with LegalProof
  - `loan-contract.service.ts`: Auto-generates loan contracts from templates
  - `legal-proof.service.ts`: Creates immutable proof records for transactions
  - `repayment.service.ts`: Repayment processing
  - `loan-forfeiture.service.ts`: Forfeiture logic
  - `penalty.service.ts`: Late penalty calculations
  - `eligibility.service.ts`: Loan eligibility checks
  - `user-loans.controller.ts`: Customer-facing loan endpoints
  - `user-loans.service.ts`: Customer loan history/data
  - `dto/`: Data transfer objects

**`backend/src/contract/`:**
- Purpose: Contract template management and rendering
- Contains: Template storage, renderer, TOS generation
- Key files:
  - `contract.controller.ts`: Contract API endpoints
  - `contract-template.service.ts`: Template CRUD
  - `contract-renderer.service.ts`: Renders contracts from templates (supports UUID and type-based lookup)
  - `tos.service.ts`: Terms of service generation

**`backend/src/receipt/`:**
- Purpose: Receipt generation for all financial events
- Key files:
  - `receipt.controller.ts`: Receipt retrieval endpoints
  - `receipt.service.ts`: Receipt generation and storage

**`backend/src/finance/`:**
- Purpose: Financial ledger, reporting, pawn charge math
- Key files:
  - `finance.controller.ts`: Finance API endpoints
  - `finance.service.ts`: Ledger entry CRUD, financial summaries
  - `pawn-charge-calculator.ts`: Deterministic integer-cents charge calculation (pure function)
  - `dto/`: Finance-related DTOs

**`backend/src/auction/`:**
- Purpose: Auction listing management, bidding, payments, settlement
- Key files:
  - `auction.controller.ts`: Auction API endpoints (including public listing read)
  - `auction.service.ts`: Listing CRUD, bid processing, status management
  - `auction-payment.service.ts`: PayMongo integration for auction payments
  - `auction-settlement.service.ts`: Post-auction settlement logic
  - `auction-auth.service.ts`: Bidder authentication for auction endpoints
  - `dto/`: Auction DTOs

**`backend/src/queue/`:**
- Purpose: Customer queue ticketing system
- Key files:
  - `queue.controller.ts`: Queue API endpoints
  - `queue.service.ts`: Queue ticket CRUD, serving, cancellation

**`backend/src/compliance/`:**
- Purpose: Compliance tracking with state machine transitions
- Key files:
  - `compliance.controller.ts`: Compliance endpoints
  - `compliance.service.ts`: Compliance lifecycle management

**`backend/src/attendance/`:**
- Purpose: Staff clock-in/clock-out tracking
- Key files:
  - `attendance.controller.ts`: Attendance endpoints
  - `attendance.service.ts`: Clock-in/out logic, staff list

**`backend/src/payroll/`:**
- Purpose: Payslip generation and payroll management
- Key files:
  - `payroll.controller.ts`: Payroll endpoints
  - `payroll.service.ts`: Payslip generation

**`backend/src/notification/`:**
- Purpose: In-app notification system
- Key files:
  - `notification.controller.ts`: Notification CRUD endpoints
  - `notification.service.ts`: Notification creation and delivery

**`backend/src/subscription/`:**
- Purpose: SaaS subscription management with PayMongo
- Key files:
  - `subscription.controller.ts`: Subscription endpoints
  - `subscription.service.ts`: Tier management, trial logic
  - `paymongo.service.ts`: PayMongo payment link and webhook integration

**`backend/src/tenant-governance/`:**
- Purpose: Multi-branch tenant management, owner registration, support access
- Key files:
  - `tenant-governance.controller.ts`: Governance endpoints
  - `tenant-governance.service.ts`: Branch management, client registration, branding

**`backend/src/profile/`:**
- Purpose: User profile management
- Key files:
  - `profile.controller.ts`: Profile endpoints
  - `profile.service.ts`: Profile CRUD

**`backend/src/security/`:**
- Purpose: Security-related endpoints (password management, etc.)
- Key files:
  - `security.controller.ts`: Security endpoints
  - `security.service.ts`: Security operations

**`backend/src/branding/`:**
- Purpose: White-label branding per tenant
- Key files:
  - `branding.controller.ts`: Branding endpoints
  - `branding.service.ts`: Logo/color management

**`backend/src/analytics/`:**
- Purpose: Dashboard analytics and reporting
- Key files:
  - `analytics.controller.ts`: Analytics endpoints
  - `analytics.service.ts`: Statistical queries and aggregation

**`backend/src/payment-methods/`:**
- Purpose: Payment method configuration per tenant
- Key files:
  - `payment-methods.controller.ts`: Payment method endpoints
  - `payment-methods.service.ts`: Payment method CRUD

**`backend/src/kyc/`:**
- Purpose: KYC validation utilities (no module — pure functions)
- Key files:
  - `kyc-validation.ts`: Input normalization and validation functions
  - `kyc-validation.spec.ts`: Unit tests

**`backend/prisma/`:**
- Purpose: Database schema, migrations, seed data
- Key files:
  - `schema.prisma`: 23 models + 23 enums mapping to Supabase PostgreSQL `public` schema
  - `schema_extensions.prisma`: Additional schema extensions
  - `seed.ts`: Initial data seeding
  - `migrations/`: Prisma migration history
  - `backups/`: Schema backup files

**`frontend/src/`:**
- Purpose: Full admin/staff React dashboard
- Contains: Components, pages, lib utilities, styles

**`frontend/src/components/`:**
- Purpose: All UI components (flat structure, not feature-organized)
- Contains: 39 component files + ui/ library + Auth/ + modal/ + __tests__/
- Key files:
  - `Sidebar.tsx`: Navigation sidebar with role-based filtering
  - `Dashboard.tsx`: Main dashboard view
  - `SalesPos.tsx`: New appraisal entry (calls backend API)
  - `AppraisalApproval.tsx`: Appraisal workflow with contract signing
  - `ContractViewer.tsx`: Contract display + digital signature canvas
  - `ReceiptViewer.tsx`: Receipt display and print
  - `LoanHistoryTimeline.tsx`: Loan timeline visualization
  - `LoanStatusProgress.tsx`: Status progress bar with valid transitions
  - `CustomerHistory.tsx`: Customer aggregate statistics
  - `CrmTable.tsx`: Customer relationship management
  - `InventoryVault.tsx`: Inventory tracking
  - `Redemption.tsx`: Redemption processing
  - `AuctionQueue.tsx`: Auction queue management
  - `AuctionMarketplace.tsx`: Auction marketplace view
  - `FinanceTreasury.tsx`: Financial overview
  - `FinanceLedger.tsx`: Ledger entries
  - `StaffMatrix.tsx`: Employee management
  - `AttendanceTracker.tsx`: Attendance management
  - `PayrollManagement.tsx`: Payroll management
  - `ComplianceDashboard.tsx`: Compliance tracking
  - `QueueManagement.tsx`: Queue management
  - `DecisionSupport.tsx`: AI-powered analytics
  - `NotificationCenter.tsx`: In-app notifications
  - `SubscriptionManager.tsx`: Subscription management
  - `BranchManagement.tsx`: Branch management
  - `MultiBranchManagement.tsx`: Multi-branch operations
  - `SupportChat.tsx`: Support communication
  - `AuditHistory.tsx`: Audit trail viewer
  - `PendingAccessDashboard.tsx`: Owner pending approval
  - `Auth/Login.tsx`: Login page
  - `Auth/ResetPassword.tsx`: Password reset
  - `ui/`: 47 shadcn/Radix UI primitive components

**`frontend/src/pages/`:**
- Purpose: Page-level components and route targets
- Key files:
  - `admin/SuperAdminDashboard.tsx`: Super admin platform dashboard
  - `admin/SystemSettings.tsx`: System-wide settings
  - `admin/PlatformControl.tsx`: Platform control panel
  - `admin/TrialRequestsPanel.tsx`: Trial request management
  - `loans/LoanManagement.tsx`: Loan management page
  - `loans/LoanHistoryPage.tsx`: Loan history with timeline
  - `loans/LoanApplicationForm.tsx`: Loan application form
  - `loans/ApplicationsList.tsx`: Applications list view
  - `loans/ApplicationDetail.tsx`: Application detail view
  - `loans/ApprovalWorkflow.tsx`: Approval workflow
  - `loans/DocumentUpload.tsx`: Document upload
  - `loans/RepaymentSchedule.tsx`: Repayment schedule view
  - `LandingPage.tsx`: Public landing page
  - `CRM.tsx`: CRM page wrapper

**`frontend/src/lib/`:**
- Purpose: Shared utilities and API configuration
- Key files:
  - `apiClient.ts`: Centralized HTTP client with auth headers, token refresh, error handling
  - `supabaseClient.ts`: Supabase JS client initialization
  - `backendUrl.ts`: Backend URL resolution from env
  - `formatters.ts`: Date/number formatting utilities
  - `types.ts`: Shared TypeScript types
  - `toast.ts`: Toast notification helper
  - `useApi.ts`: React hook for API calls

**`frontend/src/layouts/`:**
- Purpose: Layout wrappers
- Key files:
  - `MainLayout.jsx`: Main layout wrapper (minimal)

**`frontend/src/styles/`:**
- Purpose: Global CSS and design tokens

**`frontend/src/data/`:**
- Purpose: Static data files

**`frontend/src/guidelines/`:**
- Purpose: UI/UX guidelines documentation

**`frontend/src/test/`:**
- Purpose: Test setup and configuration

**`auction-frontend/src/`:**
- Purpose: Public auction house website

**`auction-frontend/src/pages/`:**
- Purpose: Auction page components
- Key files:
  - `Home.tsx`: Auction listing browse/search
  - `ListingDetail.tsx`: Individual listing view + bidding
  - `MyBids.tsx`: User's active bids
  - `MyWinnings.tsx`: Won auction items
  - `KycVerification.tsx`: Bidder KYC verification
  - `Terms.tsx`: Terms and conditions
  - `Profile.tsx`: User profile

**`auction-frontend/src/services/`:**
- Purpose: API service layer
- Key files:
  - `auctionApi.ts`: Auction-specific API calls
  - `brandingApi.ts`: Branding/theme API calls

**`auction-frontend/src/context/`:**
- Purpose: React context providers
- Key files:
  - `AuthContext.tsx`: Authentication state management
  - `BrandingContext.tsx`: White-label branding state

**`mobile/lib/`:**
- Purpose: Flutter mobile application source

**`mobile/lib/main.dart`:**
- Purpose: App entry point, dependency injection, KYC gate, main navigation
- Contains: `PawnShopApp`, `AppHome`, `KycGate`, `MainNavigationScreen`, `HomeScreen` (map + sheet), `LoansScreen`, `AuctionScreen`, `AccountScreen`

**`mobile/lib/features/auth/`:**
- Purpose: Authentication feature (Clean Architecture)
- Structure:
  - `data/datasources/auth_remote_datasource.dart`: Supabase + backend API calls
  - `data/models/`: Auth data models
  - `data/repositories/auth_repository.dart`: Auth repository implementation
  - `domain/usecases/`: Login, Signup, Logout, CheckAuthStatus, GetCurrentUser
  - `presentation/bloc/`: AuthBloc, AuthEvent, AuthState
  - `presentation/pages/`: LoginPage, KycVerificationPage

**`mobile/lib/core/`:**
- Purpose: Core services and utilities
- Key files:
  - `services/supabase_service.dart`: Supabase client wrapper
  - `services/backend_api_service.dart`: Dio HTTP client with retry logic
  - `services/secure_storage.dart`: Encrypted credential storage
  - `services/logger.dart`: Logging utility
  - `extensions/`: Dart extensions
  - `exceptions/`: Custom exception types
  - `web_compat/`: Web platform compatibility

**`mobile/lib/config/`:**
- Purpose: App configuration constants
- Key files:
  - `app_constants.dart`: Timeouts, retry config, UI constants
  - `supabase_config.dart`: Supabase URL/key config

**`mobile/lib/shared/`:**
- Purpose: Shared widgets used across features
- Key files:
  - `widgets/`: Reusable UI widgets

## Key File Locations

**Entry Points:**
- `backend/src/main.ts`: Backend API bootstrap
- `frontend/src/main.jsx`: Frontend SPA entry
- `frontend/src/App.tsx`: Frontend routing, auth, sidebar, page rendering
- `auction-frontend/src/main.tsx`: Auction frontend entry
- `auction-frontend/src/App.tsx`: Auction frontend routing
- `mobile/lib/main.dart`: Mobile app entry

**Configuration:**
- `backend/prisma/schema.prisma`: Database schema (23 models)
- `backend/src/app.module.ts`: Backend module registration + global guards
- `backend/package.json`: Backend dependencies and scripts
- `frontend/vite.config.js`: Frontend build config with path aliases (`@` → `./src`)
- `frontend/tailwind.config.js`: TailwindCSS config
- `frontend/package.json`: Frontend dependencies and scripts
- `auction-frontend/vite.config.ts`: Auction frontend build config
- `auction-frontend/package.json`: Auction frontend dependencies
- `mobile/pubspec.yaml`: Flutter dependencies
- `.env.example`: Environment variable template for all apps

**Core Logic:**
- `backend/src/common/state-machine/pawn-lifecycle.ts`: State transition definitions
- `backend/src/finance/pawn-charge-calculator.ts`: Deterministic charge math
- `backend/src/common/guards/rbac.guard.ts`: RBAC enforcement
- `backend/src/common/guards/pawnshop.guard.ts`: Tenant header validation
- `backend/src/loan/loan-contract.service.ts`: Contract auto-generation
- `backend/src/loan/legal-proof.service.ts`: Immutable proof records
- `backend/src/receipt/receipt.service.ts`: Receipt generation
- `frontend/src/lib/apiClient.ts`: Frontend HTTP client
- `mobile/lib/core/services/backend_api_service.dart`: Mobile HTTP client

**Testing:**
- `backend/test/app.e2e-spec.ts`: Backend E2E test setup
- `backend/test/jest-e2e.json`: Jest E2E config
- `backend/src/**/*.spec.ts`: Backend unit tests (co-located)
- `frontend/src/test/`: Frontend test setup
- `frontend/src/components/__tests__/`: Frontend component tests
- `auction-frontend/src/pages/__tests__/`: Auction frontend page tests
- `mobile/test/`: Flutter widget tests

## Naming Conventions

**Files (Backend):**
- Controllers: `{domain}.controller.ts` (e.g., `loan.controller.ts`)
- Services: `{domain}.service.ts` (e.g., `loan.service.ts`)
- Modules: `{domain}.module.ts` (e.g., `loan.module.ts`)
- DTOs: Directory `dto/` within each module
- Tests: `{file}.spec.ts` (co-located)
- Cross-cutting: `{purpose}.service.ts` (e.g., `state-machine.service.ts`)

**Files (Frontend):**
- Components: PascalCase `.tsx` (e.g., `LoanHistoryTimeline.tsx`)
- Lib/utilities: camelCase `.ts` (e.g., `apiClient.ts`, `supabaseClient.ts`)
- Pages: PascalCase `.tsx` (e.g., `LoanManagement.tsx`)
- Styles: camelCase `.css` (e.g., `index.css`)

**Files (Mobile):**
- Dart files: snake_case `.dart` (e.g., `backend_api_service.dart`)
- Feature structure: `features/{feature}/data|domain|presentation/`

**Directories:**
- Backend modules: lowercase, hyphen-separated (e.g., `tenant-governance/`, `payment-methods/`)
- Frontend components: PascalCase (e.g., `Auth/`, `modal/`)
- UI primitives: kebab-case (e.g., `ui/button.tsx`)

## Where to Add New Code

**New Backend Module:**
- Create `backend/src/{module-name}/` with: `{module-name}.controller.ts`, `{module-name}.service.ts`, `{module-name}.module.ts`, `dto/`
- Register in `backend/src/app.module.ts` imports array
- Add Prisma models to `backend/prisma/schema.prisma` if needed
- Example: Follow pattern in `backend/src/queue/` (controller + service + module + dto)

**New Frontend Page:**
- Create page component in `frontend/src/pages/{section}/` or `frontend/src/components/` if simple
- Add route to `TAB_TO_PATH` map and `allNavItems` array in `frontend/src/App.tsx`
- Use existing `api` client from `frontend/src/lib/apiClient.ts` for backend calls
- Use existing shadcn/ui components from `frontend/src/components/ui/`

**New Backend Endpoint (in existing module):**
- Add controller method with `@Get()`, `@Post()`, `@Patch()`, `@Delete()` decorator
- Add `@Roles('ROLE')` decorator for RBAC
- Add `@Public()` for unauthenticated endpoints
- Add `@Throttle()` for rate limiting
- Create DTO in `dto/` directory with `class-validator` decorators
- Add business logic in service method

**New Mobile Feature:**
- Create `mobile/lib/features/{feature}/` following Clean Architecture:
  - `data/datasources/`, `data/models/`, `data/repositories/`
  - `domain/usecases/`
  - `presentation/bloc/`, `presentation/pages/`
- Register BLoC in `main.dart` or feature-specific provider

**Utilities:**
- Backend shared utilities: `backend/src/common/`
- Frontend shared helpers: `frontend/src/lib/`
- Mobile shared: `mobile/lib/core/` or `mobile/lib/shared/widgets/`

## Special Directories

**`backend/prisma/migrations/`:**
- Purpose: Database migration history
- Generated: Yes (by Prisma CLI)
- Committed: Yes

**`backend/dist/`:**
- Purpose: Compiled JavaScript output
- Generated: Yes (by `nest build`)
- Committed: No

**`frontend/node_modules/`:**
- Purpose: npm dependencies
- Generated: Yes (by `npm install`)
- Committed: No

**`.planning/`:**
- Purpose: GSD workflow planning artifacts
- Generated: Yes (by GSD commands)
- Committed: Yes

**`mobile/.env`:**
- Purpose: Flutter app environment variables
- Generated: No (manually created)
- Committed: No (in .gitignore)

**`backend/prisma/backups/`:**
- Purpose: Schema backup files
- Generated: Manually
- Committed: Yes

---

*Structure analysis: 2026-07-17*
