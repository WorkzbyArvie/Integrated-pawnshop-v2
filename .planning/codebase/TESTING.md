# Testing Patterns

**Analysis Date:** 2026-07-17

## Test Frameworks by Package

### Backend: Jest

**Runner:**
- Jest 29.5.0 with ts-jest 29.1.0
- Config: inline in `backend/package.json` (lines 85-101)

**Configuration:**
```json
{
  "moduleFileExtensions": ["js", "json", "ts"],
  "rootDir": "src",
  "testRegex": ".*\\.spec\\.ts$",
  "transform": { "^.+\\.(t|j)s$": "ts-jest" },
  "collectCoverageFrom": ["**/*.(t|j)s"],
  "coverageDirectory": "../coverage",
  "testEnvironment": "node"
}
```

**E2E Config:**
- Config: `backend/test/jest-e2e.json`
- Test regex: `.e2e-spec.ts$`
- Test environment: `node`

**Run Commands:**
```bash
npm test                    # Run all unit tests
npm run test:watch          # Watch mode
npm run test:cov            # Coverage report
npm run test:e2e            # E2E tests
npm run test:debug          # Debug mode with inspector
```

### Frontend: Vitest

**Runner:**
- Vitest 3.2.4
- Config: inline in `frontend/vite.config.js` (lines 31-35)
- Environment: `jsdom`
- Globals: `true` (describe/it/expect available without imports)
- Setup file: `frontend/src/test/setup.ts`

**Setup:**
```typescript
import '@testing-library/jest-dom';
```

**Run Commands:**
```bash
npx vitest                   # Run all tests
npx vitest --run             # Single run
npx vitest --coverage        # Coverage (if configured)
```

### Auction Frontend: Vitest

**Runner:**
- Vitest 3.2.4
- Config: inline in `auction-frontend/vite.config.ts` (lines 20-24)
- Environment: `jsdom`
- Globals: `true`
- Setup file: `auction-frontend/src/test/setup.ts`

**Setup:**
```typescript
import '@testing-library/jest-dom';
```

**Run Commands:**
```bash
npm test                     # vitest run
```

### Mobile: Flutter Test

**Runner:**
- `flutter_test` SDK
- Mocking: `mocktail` 1.0.0
- BLoC testing: `bloc_test` 9.1.0

**Run Commands:**
```bash
flutter test
```

## Test File Organization

### Backend

**Location:** Co-located with source files in `src/`.

**Naming:** `*.spec.ts` suffix, same directory as the file being tested.

```
backend/src/
├── analytics/
│   ├── analytics.service.ts
│   ├── analytics.service.spec.ts
│   ├── analytics.controller.ts
│   └── analytics.controller.spec.ts
├── queue/
│   ├── queue.service.ts
│   └── queue.service.spec.ts
├── finance/
│   ├── finance.service.ts
│   ├── finance.service.spec.ts
│   └── pawn-charge-calculator.spec.ts
├── receipt/
│   ├── receipt.service.ts
│   └── receipt.service.spec.ts
├── compliance/
│   ├── compliance.service.ts
│   └── compliance.service.spec.ts
├── attendance/
│   ├── attendance.service.ts
│   └── attendance.service.spec.ts
├── payment-methods/
│   ├── payment-methods.service.ts
│   └── payment-methods.service.spec.ts
├── branding/
│   ├── branding.service.ts
│   └── branding.service.spec.ts
├── auction/
│   ├── auction.service.ts
│   ├── auction.service.spec.ts
│   └── auction-settlement.service.spec.ts
├── loan/
│   ├── loan-contract.service.spec.ts
│   ├── legal-proof.service.spec.ts
│   ├── user-loans.service.spec.ts
│   └── loan-history.service.spec.ts
├── notification/
│   ├── notification.service.ts
│   └── notification.service.spec.ts
├── kyc/
│   └── kyc-validation.spec.ts
└── test/
    └── app.e2e-spec.ts
```

### Frontend

**Location:** `__tests__/` directories inside `components/`.

```
frontend/src/components/__tests__/
├── SalesPos.test.tsx
├── InventoryVault.test.tsx
└── AuctionQueue.test.tsx
```

### Auction Frontend

**Location:** `__tests__/` directories inside `pages/`.

```
auction-frontend/src/pages/__tests__/
├── Home.test.tsx
└── ListingDetail.test.tsx
```

### Mobile

**Location:** `test/` directory mirroring `lib/` structure.

```
mobile/test/
├── widget_test.dart
└── features/
    └── auth/
        └── data/
            └── repositories/
                └── auth_repository_test.dart
```

## Backend Test Structure

### Service Test Pattern

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { SomeService } from './some.service';
import { PrismaService } from '../prisma.service';
import { NotFoundException, BadRequestException } from '@nestjs/common';

describe('SomeService', () => {
  let service: SomeService;
  let prisma: Record<string, any>;

  const PAWNSHOP_ID = '11111111-1111-1111-1111-111111111111';

  beforeEach(async () => {
    prisma = {
      someModel: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SomeService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<SomeService>(SomeService);
  });

  describe('methodName', () => {
    it('should do expected behavior', async () => {
      prisma.someModel.findFirst.mockResolvedValue(mockData);
      const result = await service.methodName(PAWNSHOP_ID, dto);
      expect(result).toEqual(expectedResult);
    });

    it('should throw NotFoundException when resource not found', async () => {
      prisma.someModel.findFirst.mockResolvedValue(null);
      await expect(service.methodName(PAWNSHOP_ID, 'bad-id'))
        .rejects.toThrow(NotFoundException);
    });
  });
});
```

**Reference files:**
- `backend/src/queue/queue.service.spec.ts` — exemplary pattern with nested `describe` blocks
- `backend/src/compliance/compliance.service.spec.ts` — state machine testing
- `backend/src/attendance/attendance.service.spec.ts` — CRUD operation testing
- `backend/src/finance/finance.service.spec.ts` — complex business logic testing

### Controller Test Pattern

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { SomeController } from './some.controller';
import { SomeService } from './some.service';

describe('SomeController', () => {
  let controller: SomeController;
  let service: jest.Mocked<SomeService>;

  beforeEach(async () => {
    const serviceMock = {
      getStats: jest.fn(),
      getBranchStats: jest.fn(),
    } as unknown as jest.Mocked<SomeService>;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SomeController],
      providers: [
        { provide: SomeService, useValue: serviceMock },
      ],
    }).compile();

    controller = module.get<SomeController>(SomeController);
    service = module.get(SomeService);
  });

  it('delegates getStats to SomeService', async () => {
    service.getStats.mockResolvedValue(result);
    await expect(controller.getStats()).resolves.toEqual(result);
    expect(service.getStats).toHaveBeenCalledWith();
  });
});
```

**Reference:** `backend/src/analytics/analytics.controller.spec.ts`

### Pure Function Test Pattern

```typescript
import { calculatePawnCharges } from './pawn-charge-calculator';

describe('calculatePawnCharges', () => {
  it('uses cent-based math for interest and service fees', () => {
    const result = calculatePawnCharges({
      principal: 1234.56,
      monthlyInterestRatePercent: 3,
      serviceFee: 50,
    });
    expect(result.principal).toBe(1234.56);
    expect(result.interest).toBe(37.04);
    expect(result.totalDue).toBe(1321.6);
  });
});
```

**Reference:** `backend/src/finance/pawn-charge-calculator.spec.ts`

### Validation Function Test Pattern

```typescript
import { normalizeAndValidatePhoneNumber, parseAndValidateDateOfBirth } from './kyc-validation';

describe('kyc-validation', () => {
  describe('normalizeAndValidatePhoneNumber', () => {
    it('normalizes local PH mobile format', () => {
      expect(normalizeAndValidatePhoneNumber('09280766440')).toBe('+639280766440');
    });

    it('rejects invalid phone formats', () => {
      expect(() => normalizeAndValidatePhoneNumber('12345')).toThrow(
        'Phone number must be a valid PH mobile number',
      );
    });
  });
});
```

**Reference:** `backend/src/kyc/kyc-validation.spec.ts`

### Simple Service Test Pattern (No NestJS Module)

```typescript
import { PaymentMethodsService } from './payment-methods.service';
import { PrismaService } from '../prisma.service';

describe('PaymentMethodsService', () => {
  const prismaMock = {
    customerPaymentMethod: {
      findMany: jest.fn(),
      create: jest.fn(),
    },
  };

  let service: PaymentMethodsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new PaymentMethodsService(prismaMock as unknown as PrismaService);
  });

  it('rejects invalid payment type', async () => {
    await expect(service.addMyPaymentMethod('user-1', { type: 'CRYPTO' }))
      .rejects.toThrow('Invalid payment type');
  });
});
```

**Reference:** `backend/src/payment-methods/payment-methods.service.spec.ts`, `backend/src/branding/branding.service.spec.ts`

### E2E Test Pattern

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });
});
```

**Reference:** `backend/test/app.e2e-spec.ts`

## Frontend Test Structure

### React Component Test Pattern

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ComponentName } from '../ComponentName';

vi.mock('../../lib/supabaseClient', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    })),
  },
}));

vi.mock('../../App', () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

describe('ComponentName', () => {
  it('renders expected content', () => {
    render(<ComponentName branchId="pawnshop-1" />);
    expect(screen.getByText('Expected Text')).toBeInTheDocument();
  });
});
```

**Reference:** `frontend/src/components/__tests__/SalesPos.test.tsx`

### React Component with API Interaction Test

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ComponentName } from '../ComponentName';

const query = {
  select: vi.fn().mockReturnThis(),
  order: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  then: (resolve: any) => resolve({
    data: [/* mock data */],
    error: null,
  }),
};

vi.mock('../../lib/supabaseClient', () => ({
  supabase: {
    from: vi.fn(() => ({ ...query })),
  },
}));

describe('ComponentName', () => {
  it('performs action on user interaction', async () => {
    render(<ComponentName branchId="pawnshop-1" />);
    await waitFor(() => {
      expect(screen.getByText('Expected Text')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('Action Button'));
    await waitFor(() => {
      expect(/* assertion */).toHaveBeenCalled();
    });
  });
});
```

**Reference:** `frontend/src/components/__tests__/InventoryVault.test.tsx`

### React with Router Test

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import Component from '../Component';

describe('Component', () => {
  it('renders with route params', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockData,
    }));

    render(
      <MemoryRouter initialEntries={['/path/123']}>
        <Component />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('Expected Text')).toBeInTheDocument();
    });
  });
});
```

**Reference:** `auction-frontend/src/pages/__tests__/ListingDetail.test.tsx`, `auction-frontend/src/pages/__tests__/Home.test.tsx`

## Mobile Test Structure

### Flutter Repository Test Pattern

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:pawn_shop/core/exceptions/app_exception.dart';
import 'package:pawn_shop/core/services/secure_storage.dart';
import 'package:pawn_shop/features/auth/data/datasources/auth_remote_datasource.dart';
import 'package:pawn_shop/features/auth/data/repositories/auth_repository.dart';

class _MockAuthRemoteDataSource extends Mock implements AuthRemoteDataSource {}
class _MockSecureStorageService extends Mock implements SecureStorageService {}

void main() {
  late AuthRepositoryImpl repository;
  late _MockAuthRemoteDataSource remoteDataSource;
  late _MockSecureStorageService secureStorage;

  setUp(() {
    remoteDataSource = _MockAuthRemoteDataSource();
    secureStorage = _MockSecureStorageService();
    repository = AuthRepositoryImpl(
      remoteDataSource: remoteDataSource,
      secureStorage: secureStorage,
    );
  });

  group('AuthRepositoryImpl.logout', () {
    test('clears only auth data after successful remote logout', () async {
      when(() => remoteDataSource.logout()).thenAnswer((_) async {});
      when(() => secureStorage.clearAuthData()).thenAnswer((_) async {});

      await repository.logout();

      verify(() => remoteDataSource.logout()).called(1);
      verify(() => secureStorage.clearAuthData()).called(1);
      verifyNever(() => secureStorage.clearAll());
    });

    test('rethrows exception and does not clear storage on remote failure', () async {
      when(() => remoteDataSource.logout()).thenThrow(
        AuthException(message: 'logout failed', code: 'LOGOUT_ERROR'),
      );

      await expectLater(
        repository.logout(),
        throwsA(isA<AuthException>()),
      );

      verifyNever(() => secureStorage.clearAuthData());
    });
  });
}
```

**Reference:** `mobile/test/features/auth/data/repositories/auth_repository_test.dart`

## Mocking Patterns

### Backend: Prisma Mock

All backend tests mock `PrismaService` by providing a manual mock object with jest.fn() methods on model delegates:

```typescript
let prisma: Record<string, any>;

beforeEach(async () => {
  prisma = {
    ticket: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
      aggregate: jest.fn(),
    },
    customer: {
      findFirst: jest.fn(),
      count: jest.fn(),
    },
  };

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      SomeService,
      { provide: PrismaService, useValue: prisma },
    ],
  }).compile();

  service = module.get<SomeService>(SomeService);
});
```

**Reference:** `backend/src/analytics/analytics.service.spec.ts` (lines 6-32), `backend/src/queue/queue.service.spec.ts` (lines 14-36)

### Backend: Service Mock for Controller Tests

```typescript
const analyticsServiceMock = {
  getDashboardStats: jest.fn(),
  getBranchStats: jest.fn(),
} as unknown as jest.Mocked<AnalyticsService>;

const module: TestingModule = await Test.createTestingModule({
  controllers: [AnalyticsController],
  providers: [
    { provide: AnalyticsService, useValue: analyticsServiceMock },
  ],
}).compile();
```

**Reference:** `backend/src/analytics/analytics.controller.spec.ts` (lines 10-20)

### Backend: Dependency Service Mock

```typescript
let legalProofService: Record<string, any>;

legalProofService = {
  createProof: jest.fn(),
  listByContract: jest.fn(),
};

const module: TestingModule = await Test.createTestingModule({
  providers: [
    LoanContractService,
    { provide: PrismaService, useValue: prisma },
    { provide: LegalProofService, useValue: legalProofService },
    { provide: StateMachineService, useValue: { transition: jest.fn() } },
  ],
}).compile();
```

**Reference:** `backend/src/loan/loan-contract.service.spec.ts` (lines 31-43)

### Frontend: Supabase Client Mock

```typescript
vi.mock('../../lib/supabaseClient', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      update: vi.fn().mockResolvedValue({ data: null, error: null }),
      insert: vi.fn().mockResolvedValue({ data: null, error: null }),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
    })),
  },
}));
```

**Reference:** `frontend/src/components/__tests__/SalesPos.test.tsx` (lines 5-16)

### Frontend: Toast Mock

```typescript
vi.mock('../../App', () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));
```

**Reference:** `frontend/src/components/__tests__/SalesPos.test.tsx` (lines 18-20)

### Frontend: Global Fetch Mock

```typescript
vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
  ok: true,
  json: async () => listingResponse,
}));
```

**Reference:** `auction-frontend/src/pages/__tests__/Home.test.tsx` (lines 35-38)

### Mobile: Mocktail Mocks

```dart
class _MockAuthRemoteDataSource extends Mock implements AuthRemoteDataSource {}
class _MockSecureStorageService extends Mock implements SecureStorageService {}

// Usage with setup/verify pattern:
when(() => remoteDataSource.logout()).thenAnswer((_) async {});
await repository.logout();
verify(() => remoteDataSource.logout()).called(1);
verifyNever(() => secureStorage.clearAll());
```

**Reference:** `mobile/test/features/auth/data/repositories/auth_repository_test.dart`

## Test Data Patterns

### Backend: Fixed UUID Constants

Tests use consistent UUID constants for pawnshop IDs:

```typescript
const PAWNSHOP_ID = '11111111-1111-1111-1111-111111111111';
```

**Reference:** `backend/src/queue/queue.service.spec.ts`, `backend/src/compliance/compliance.service.spec.ts`, `backend/src/finance/finance.service.spec.ts`

### Backend: Mock Data in Mock Resolved Values

```typescript
prisma.customer.count.mockResolvedValue(10);
prisma.ticket.count.mockResolvedValue(3);
prisma.ticket.aggregate.mockResolvedValue({
  _sum: { loanAmount: 1000 },
});
```

**Reference:** `backend/src/analytics/analytics.service.spec.ts` (lines 38-42)

### Frontend: Inline Mock Data Fixtures

```typescript
const listingResponse = {
  items: [
    {
      id: 101,
      title: 'Rolex Daytona 18K',
      description: 'Gold chronograph',
      startingPrice: 45000,
      currentBid: 52000,
      bidCount: 3,
      status: 'LIVE',
      // ... more fields
    },
  ],
  nextCursor: null,
};
```

**Reference:** `auction-frontend/src/pages/__tests__/Home.test.tsx` (lines 6-26)

## Test Coverage

**Requirements:** No enforced coverage threshold detected.

**View Coverage:**
```bash
cd backend && npm run test:cov    # Backend coverage report
```

## Common Test Patterns

### Async Testing (Backend)

```typescript
it('should create a queue ticket with generated number', async () => {
  prisma.queueTicket.findFirst.mockResolvedValue(null);
  prisma.queueTicket.count.mockResolvedValueOnce(2).mockResolvedValueOnce(5);
  prisma.queueTicket.create.mockResolvedValue({ id: 'ticket-1', queueNumber: 'P003' });

  const result = await service.create(PAWNSHOP_ID, dto);

  expect(result.queueNumber).toBe('P003');
});
```

### Async Testing (Frontend)

```typescript
it('marks active items for auction', async () => {
  render(<InventoryVault branchId="pawnshop-1" />);

  await waitFor(() => {
    expect(screen.getByText('Gold Necklace')).toBeInTheDocument();
  });

  fireEvent.click(screen.getByText('Mark for Auction'));

  await waitFor(() => {
    expect(updateMock).toHaveBeenCalledWith({ status: 'AUCTION' });
  });
});
```

### Error Testing (Backend)

```typescript
it('should throw ForbiddenException when customer not in pawnshop', async () => {
  prisma.customer.findFirst.mockResolvedValue(null);
  await expect(service.create(PAWNSHOP_ID, dto)).rejects.toThrow(ForbiddenException);
});

it('should throw BadRequestException when customer has active ticket', async () => {
  prisma.customer.findFirst.mockResolvedValue({ id: 'cust-1' });
  prisma.queueTicket.findFirst.mockResolvedValue({ id: 'existing-ticket' });
  await expect(service.create(PAWNSHOP_ID, dto)).rejects.toThrow(BadRequestException);
});
```

### Error Testing (Frontend with expect.rejects)

```typescript
await expectLater(
  repository.logout(),
  throwsA(isA<AuthException>()),
);
```

### Spy/Verify Pattern (Mobile)

```dart
await repository.logout();
verify(() => remoteDataSource.logout()).called(1);
verify(() => secureStorage.clearAuthData()).called(1);
verifyNever(() => secureStorage.clearAll());
```

---

*Testing analysis: 2026-07-17*
