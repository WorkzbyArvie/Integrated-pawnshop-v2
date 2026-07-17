# Coding Conventions

**Analysis Date:** 2026-07-17

## Project Overview

This is a monorepo with four packages: `backend/` (NestJS), `frontend/` (React + Vite), `auction-frontend/` (React + Vite), and `mobile/` (Flutter). Each has distinct conventions described below.

## Backend (NestJS / TypeScript)

### Naming Patterns

**Files:**
- Feature modules use kebab-case: `analytics.service.ts`, `loan-contract.service.ts`, `pawn-charge-calculator.ts`
- DTOs use kebab-case with `.dto.ts` suffix: `create-branch.dto.ts`, `payment.dto.ts`, `renew-loan.dto.ts`
- Specs use `.spec.ts` suffix co-located with source: `analytics.service.spec.ts`
- E2E tests use `.e2e-spec.ts` in `test/` directory

**Classes:**
- PascalCase: `AnalyticsService`, `RbacGuard`, `PawnshopGuard`, `StateMachineService`
- NestJS suffixes are consistent: `*Service`, `*Controller`, `*Module`, `*Guard`, `*Interceptor`
- DTOs: `Create*Dto`, `Update*Dto`, `*Dto` suffix

**Methods:**
- camelCase: `getDashboardStats()`, `getBranchStats()`, `recordPayment()`, `clockIn()`
- Async methods use `async` keyword: `async createTicket(data: any)`

**Variables:**
- camelCase: `pawnshopId`, `ticketNumber`, `authCode`
- Constants: UPPER_SNAKE_CASE for enums and config values: `SUPER_ADMIN`, `PAWNSHOP_ID`
- Prisma snake_case column → camelCase JS field: `pawnshop_id` → `pawnshopId`, `full_name` → `fullName`

**Enums:**
- UPPER_SNAKE_CASE values in Prisma schema and TypeScript: `QueueStatus.WAITING`, `LedgerEntryType.CREDIT`
- TypeScript enums in DTOs: `PaymentMethodEnum`, `PaymentTypeEnum`

### Module Organization

Each feature follows this structure inside `src/<feature>/`:

```
src/<feature>/
├── <feature>.module.ts          # NestJS module declaration
├── <feature>.controller.ts      # Route handlers
├── <feature>.service.ts         # Business logic
├── <feature>.service.spec.ts    # Unit tests (co-located)
├── <feature>.controller.spec.ts # Controller tests (optional)
└── dto/
    ├── create-*.dto.ts          # Request DTOs with class-validator
    └── update-*.dto.ts          # Update DTOs
```

**Examples:**
- `src/analytics/analytics.module.ts`, `analytics.controller.ts`, `analytics.service.ts`
- `src/loan/loan.module.ts`, `loan.controller.ts`, `loan.service.ts`, `dto/payment.dto.ts`
- `src/queue/queue.module.ts`, `queue.controller.ts`, `queue.service.ts`
- `src/common/guards/rbac.guard.ts`, `common/decorators/public.decorator.ts`

**Module registration pattern** (`src/app.module.ts`):
- All feature modules imported in `AppModule`
- Global guards registered via `APP_GUARD` token: `PawnshopGuard`, `RbacGuard`, `RateLimitGuard`
- Global interceptor registered via `APP_INTERCEPTOR`: `AuditLogInterceptor`
- Guards are applied globally; bypass with `@Public()` decorator

### DTO Patterns

Use `class-validator` decorators for validation:

```typescript
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateBranchDto {
  @IsNotEmpty()
  @IsString()
  pawnshopId: string;

  @IsNotEmpty()
  @IsString()
  @MaxLength(120)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  managerName?: string;
}
```

**Reference files:**
- `src/tenant-governance/dto/create-branch.dto.ts`
- `src/loan/dto/payment.dto.ts`
- `src/loan/dto/create-pawn-ticket.dto.ts`
- `src/compliance/dto/verify-compliance.dto.ts`

### Controller Patterns

- Controllers use `@Controller('route-prefix')` decorator
- Methods use HTTP verb decorators: `@Get()`, `@Post()`, `@Patch()`, `@Delete()`
- Public endpoints use `@Public()` decorator to bypass auth
- Rate-limited endpoints use `@Throttle({ ttl: 60_000, limit: N })` decorator
- Role-restricted endpoints use `@Roles('ADMIN', 'MANAGER')` decorator
- Audit-logged endpoints use `@AuditLog('ACTION_NAME')` decorator
- Parameters extracted with `@Param()`, `@Body()`, `@Headers()`
- Response format is plain object (NestJS auto-serializes): `{ success: true, data: ... }`

**Reference:** `src/analytics/analytics.controller.ts`, `src/app.controller.ts`

### Error Handling

**Backend strategy:** Throw NestJS exceptions directly from services and controllers.

- `BadRequestException` — invalid input, business rule violations
- `NotFoundException` — resource not found
- `ForbiddenException` — insufficient permissions
- `UnauthorizedException` — missing/invalid auth
- Plain `Error` — used in AppService (legacy pattern, prefer NestJS exceptions)

**Controller error wrapping pattern:**
```typescript
try {
  return await this.appService.someMethod(body);
} catch (error: any) {
  throw new HttpException(
    { success: false, error: error.message || 'Fallback message' },
    error.statusCode || HttpStatus.BAD_REQUEST,
  );
}
```

**Reference:** `src/app.controller.ts` (lines 66-78), `src/queue/queue.service.spec.ts`

### Service Patterns

- Services are `@Injectable()` and use constructor injection
- PrismaService is injected for database access
- Cross-module dependencies use NestJS module imports (see `LoanModule` importing `FinanceModule`, `ContractModule`, `ReceiptModule`)
- State machine transitions go through `StateMachineService.transition(domain, from, to, options)`
- Finance entries go through `FinanceService.createEntry(pawnshopId, dto)`
- Legal proofs go through `LegalProofService.createProof(...)`
- Receipts go through `ReceiptService.generate(...)`

**Reference:** `src/loan/loan.service.ts`, `src/loan/loan.module.ts`

### Logging

**Framework:** NestJS `Logger` class in guards/interceptors, `console.log`/`console.error` in services.

**Patterns in services:**
```typescript
console.log('✅ [ServiceName] Success message');
console.error('❌ [ServiceName] Error:', error.message);
console.warn('⚠️ [ServiceName] Warning message');
```

**Patterns in guards/interceptors:**
```typescript
private readonly logger = new Logger(RbacGuard.name);
this.logger.warn(`Rate limit exceeded for ${key}`);
```

**Reference:** `src/common/guards/rbac.guard.ts`, `src/common/interceptors/audit-log.interceptor.ts`

### Comments

- **No comments** in source code unless explicitly requested (per AGENTS.md convention)
- Exception: Guard/interceptor files have brief explanatory comments for exempt routes and complex logic
- Service files occasionally have section markers like `// --- AUTH ENDPOINTS ---`

### TypeScript Configuration

- `strict: true` but `strictNullChecks: false`, `noImplicitAny: false`
- Path alias: `@/*` maps to `./src/*`
- Decorators enabled: `emitDecoratorMetadata: true`, `experimentalDecorators: true`

**Reference:** `backend/tsconfig.json`

## Frontend (React + Vite + TypeScript)

### Naming Patterns

**Files:**
- Components: PascalCase: `SalesPos.tsx`, `ContractViewer.tsx`, `InventoryVault.tsx`, `LoanManagement.tsx`
- Pages: PascalCase: `Dashboard.jsx`, `CRM.tsx`, `LandingPage.tsx`
- One legacy `.jsx` file exists: `Dashboard.jsx` — new files should use `.tsx`
- Lib/utility files: camelCase: `supabaseClient.ts`, `backendUrl.ts`, `formatters.ts`
- Layouts: PascalCase: `MainLayout.jsx`
- Tests: `<ComponentName>.test.tsx` inside `__tests__/` directories

**Directories:**
- `components/` — reusable UI components (PascalCase filenames)
- `components/__tests__/` — co-located test files
- `pages/` — route-level page components
- `pages/loans/` — loan-specific pages
- `pages/admin/` — admin-only pages
- `lib/` — utility modules (camelCase)
- `data/` — mock data
- `layouts/` — layout wrappers
- `styles/` — CSS files
- `test/` — test setup

### Component Patterns

**Functional components with hooks:**
```tsx
import { useState, useEffect } from 'react';
import { useToast } from '../App';
import api from '../lib/apiClient';

interface SalesPosProps {
  branchId: string | null;
  activeBranchId?: number | null;
  setActiveTab: (tab: string) => void;
}

export function SalesPos({ branchId, activeBranchId, setActiveTab }: SalesPosProps) {
  const { showToast } = useToast();
  // ... component logic
}
```

**Key patterns:**
- Named exports for components (not default exports) — except `Dashboard.jsx` and pages
- Props defined with `interface` (not `type`)
- `useState` for local state
- `useEffect` for data fetching on mount
- API calls via `api` (axios wrapper) or direct `fetch`
- Toast notifications via `useToast()` hook from `App.tsx`
- Supabase client via `import { supabase } from '../lib/supabaseClient'`

**Reference:** `src/components/SalesPos.tsx`, `src/components/ContractViewer.tsx`

### Styling

- Tailwind CSS v4 with `@tailwindcss/vite` plugin
- Class names use Tailwind utility classes directly
- Dark mode theme: "Gilded Reserve" — gold accent (#C9A05C), dark backgrounds
- `tailwind-merge` for class merging
- `class-variance-authority` for component variants

### Import Organization

1. React/framework imports: `import { useState, useEffect } from 'react'`
2. Third-party UI: `import { lucide-react icons }`
3. Local lib/utilities: `import { useToast } from '../App'`, `import api from '../lib/apiClient'`
4. Local components: `import { SalesPos } from '../components/SalesPos'`

### Path Aliases

- `@/*` maps to `./src/*` in both frontend and auction-frontend
- Configured in `tsconfig.json` and `vite.config.js`/`vite.config.ts`

**Reference:** `frontend/tsconfig.json`, `frontend/vite.config.js`

### Error Handling in Frontend

- API errors caught with `.catch(err => console.error(...))` or try/catch
- User-facing errors shown via `showToast()` from SweetAlert2 wrapper
- Loading states managed with `useState<boolean>` booleans

## Auction Frontend (React + Vite + TypeScript)

### Naming Patterns

- Same conventions as main frontend
- Pages in `src/pages/`: `Home.tsx`, `ListingDetail.tsx`, `MyBids.tsx`
- Services in `src/services/`: `auctionApi.ts`, `brandingApi.ts`
- Contexts in `src/context/`: `AuthContext.tsx`, `BrandingContext.tsx`
- Lib utilities in `src/lib/`: `supabaseClient.ts`, `backendUrl.ts`, `watchlist.ts`
- Types in `src/types.ts`

### Routing Pattern

```tsx
<AuthProvider>
  <Routes>
    <Route path="/" element={<Home />} />
    <Route path="/listing/:id" element={<ListingDetail />} />
  </Routes>
</AuthProvider>
```

**Reference:** `auction-frontend/src/App.tsx`

### API Pattern

- Services use axios via `src/services/auctionApi.ts` and `src/services/brandingApi.ts`
- Backend URL resolved via `src/lib/backendUrl.ts`
- Supabase client in `src/lib/supabaseClient.ts`

## Mobile (Flutter / Dart)

### Naming Patterns

**Files:**
- snake_case for Dart files: `auth_repository.dart`, `supabase_service.dart`, `auth_bloc.dart`
- Test files: `*_test.dart` — `auth_repository_test.dart`, `widget_test.dart`

**Directories:**
- `lib/features/` — feature-based organization (Clean Architecture)
- `lib/features/auth/data/datasources/` — remote data sources
- `lib/features/auth/data/repositories/` — repository implementations
- `lib/features/auth/domain/usecases/` — use cases
- `lib/features/auth/presentation/bloc/` — BLoC state management
- `lib/features/auth/presentation/pages/` — screen widgets
- `lib/core/services/` — shared services (`SupabaseService`, `BackendApiService`, `SecureStorageService`)
- `lib/core/exceptions/` — custom exceptions (`AppException`)

**Reference:** `mobile/lib/features/auth/`

### Architecture Pattern

Clean Architecture with BLoC:
```
features/<feature>/
├── data/
│   ├── datasources/    # Remote data sources (API calls)
│   └── repositories/   # Repository implementations
├── domain/
│   └── usecases/       # Business logic use cases
└── presentation/
    ├── bloc/           # BLoC (Business Logic Component) state management
    └── pages/          # Screen widgets
```

### State Management

- BLoC pattern: `AuthBloc` extends `Bloc<AuthEvent, AuthState>`
- Events: `CheckAuthStatusEvent`, `LoginEvent`, `SignupEvent`, `LogoutEvent`
- States: `AuthAuthenticated`, `AuthUnauthenticated`, `AuthError`, `AuthLoading`

**Reference:** `mobile/lib/features/auth/presentation/bloc/`

### Dart Conventions

- `const` constructors for widgets
- `super.key` in constructor parameters (modern Dart style)
- `late` keyword for deferred initialization
- Private state classes with underscore prefix: `_MainNavigationScreenState`
- `mounted` check before `setState` calls
- `// ignore_for_file: deprecated_member_use` for known Flutter deprecations

### Linting

- Uses `flutter_lints` package: `include: package:flutter_lints/flutter.yaml`
- No custom lint rules configured

**Reference:** `mobile/analysis_options.yaml`

## Cross-Cutting Patterns

### API Response Format

Backend returns consistent envelope:
```json
{
  "success": true,
  "data": { ... }
}
```

Error responses:
```json
{
  "success": false,
  "message": "Error description",
  "error": "Error details"
}
```

### Authentication Flow

- Supabase Auth for user management (JWT tokens)
- Backend validates JWT via `SUPABASE_SERVICE_ROLE_KEY`
- Custom OTP flow: `requestAuthCode` → `verifyAuthCode` → register/login
- Auth header: `Authorization: Bearer <token>`
- Pawnshop scope: `pawnshop-id` header on requests

### Database Conventions (Prisma)

- snake_case for database columns in Prisma schema
- camelCase for generated JavaScript/TypeScript fields
- UUIDs for primary IDs (string type in application code)
- Auto-increment integers for some entities: `ticket.id` (number)
- Timestamps: `createdAt`, `updatedAt`
- Soft status tracking: `status`, `lifecycleStatus` enums

---

*Convention analysis: 2026-07-17*
