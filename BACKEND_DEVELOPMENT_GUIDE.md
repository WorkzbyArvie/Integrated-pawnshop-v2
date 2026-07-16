# 🏗️ Backend Architecture & Development Guide

## System Overview

### Modules Structure

```
backend/src/
├── app.module.ts              # Root module (imports all sub-modules)
├── app.controller.ts          # Global routes
├── main.ts                    # Bootstrap with RLS validation
│
├── security/                  # Security validation & monitoring
│   ├── security.module.ts
│   ├── rls-security-validator.ts    # RLS enforcement checks
│   └── rls-security-validator.spec.ts
│
├── health/                    # Health & diagnostics endpoints
│   ├── health.module.ts
│   └── health.controller.ts   # /health, /health/security, /health/diagnostics
│
├── payroll/                   # Payroll management
│   ├── payroll.module.ts
│   ├── payroll.controller.ts  # CRUD endpoints
│   ├── payroll.service.ts     # Business logic
│   ├── payroll.service.spec.ts # Comprehensive tests
│   └── dto/
│       └── payroll.dto.ts     # DTOs with validation
│
├── auction/                   # Auction management
├── analytics/                 # Analytics & reporting
├── loan/                      # Loan management
│
└── prisma.service.ts          # Database abstraction
```

---

## Security Architecture

### RLS (Row Level Security) Enforcement

All database access is controlled by Supabase RLS policies. At startup:

```typescript
// main.ts - Validates RLS on boot
const securityHealth = await rlsValidator.healthCheck();
if (!securityHealth.healthy) {
  process.exit(1); // Fail fast if security is compromised
}
```

**Access Control**:
- **SUPER_ADMIN/OWNER**: See all data across all pawnshops
- **MANAGER/ADMIN**: See only their assigned pawnshop's data
- **STAFF**: See only branch/personal data
- **ANONYMOUS**: See only LIVE auction listings

### Health Check Endpoints

```bash
# Basic health
curl http://localhost:3000/health

# Security status
curl http://localhost:3000/health/security

# RLS table status
curl http://localhost:3000/health/security/rls

# Full diagnostics
curl http://localhost:3000/health/diagnostics
```

---

## Development Workflow

### 1. Setup

```bash
cd backend

# Install dependencies
npm install

# Create .env file
cp .env.example .env

# Set required variables:
# - DATABASE_URL (Supabase PostgreSQL)
# - VITE_SUPABASE_URL
# - SUPABASE_SERVICE_ROLE_KEY

# Run migrations
npx prisma migrate dev

# Seed database (optional)
npm run seed
```

### 2. Start Development Server

```bash
# With hot reload
npm run start:dev

# With debugging
npm run start:debug

# Check logs
tail -f logs/app.log
```

The server validates RLS on startup:
```
🔐 Validating database security (RLS policies)...
✓ Security validation passed
✓ RLS enabled on 17/17 critical tables
🚀 Backend running on http://localhost:3000
📝 Security check: http://localhost:3000/health/security
```

### 3. Testing

#### Run All Tests
```bash
npm test
```

#### Test Specific Module
```bash
# Payroll tests
npm test -- payroll

# Security validator tests
npm test -- security

# Coverage
npm test -- --coverage
```

#### Test Payroll Logic
```bash
npm test -- payroll.service.spec.ts
```

Running tests:
- Validates deduction calculations (SSS, PhilHealth, Pag-IBIG, Tax)
- Tests payroll period lifecycle
- Verifies attendance tracking
- Confirms payslip generation
- Tests pawnshop isolation

### 4. Build for Production

```bash
npm run build

# Output goes to: dist/
# Ready to deploy to Docker/Cloud
```

---

## Payroll Module Deep Dive

### Service Methods (payroll.service.ts)

#### Payroll Periods
```typescript
// Create period
await payrollService.createPayrollPeriod({
  pawnshopId: 'ps-001',
  periodName: 'January 2026',
  startDate: '2026-01-01',
  endDate: '2026-01-31',
  cutoffDate: '2026-01-25',
  createdBy: 'admin@email.com'
});

// Get periods
const periods = await payrollService.getPayrollPeriods('ps-001');

// Update period
await payrollService.updatePayrollPeriod(periodId, { status: 'PROCESSING' });
```

#### Staff Compensation
```typescript
// Upsert compensation
await payrollService.upsertCompensation({
  staffId: 'staff-001',
  basicSalary: 25000,
  dailyRate: 1250,
  hourlyRate: 156.25,
  sssNumber: '12-3456789-0',
  philhealthNumber: '12-123456789-00',
  pagibigNumber: '1234-5678-9',
  tinNumber: '123-456-789-000'
});
```

#### Attendance
```typescript
// Record attendance
await payrollService.recordAttendance({
  staffId: 'staff-001',
  date: '2026-02-01',
  timeIn: '2026-02-01T08:00:00',
  timeOut: '2026-02-01T17:00:00',
  hoursWorked: 8,
  overtime: 0,
  isAbsent: false,
  isLate: false
});

// Get attendance range
const records = await payrollService.getAttendance(
  'staff-001',
  '2026-02-01',
  '2026-02-28'
);
```

#### Payroll Computation
```typescript
// Run payroll (creates payslips with deductions)
const result = await payrollService.runPayroll(
  payrollPeriodId,
  pawnshopId
);
// Returns: { period, payslips[], totalStaffProcessed }

// Get payslips
const payslips = await payrollService.getPayslipsByPeriod(periodId);

// Approve payslip
await payrollService.approvePayslip(payslipId, 'manager@email.com');

// Mark paid
await payrollService.markPayslipPaid(payslipId);

// Complete period (all must be paid)
await payrollService.completePayrollPeriod(periodId);
```

### Deduction Calculations

**Automatic deductions** (Philippine statutory):
- **SSS**: ~4.5% up to ₱30,000 cap
- **PhilHealth**: 2.5% up to ₱100,000 cap
- **Pag-IBIG**: 2% max ₱200/month
- **Withholding Tax**: Progressive brackets (2023 TRAIN law)

Example for ₱30,000 salary:
```
Basic Pay:        ₱30,000
├─ SSS:           ₱1,350
├─ PhilHealth:    ₱750
├─ Pag-IBIG:      ₱200
└─ Tax:           ₱1,750
─────────────────────────
Net Pay:          ₱25,950
```

---

## API Endpoints

### Payroll Routes

```
POST   /payroll/periods              Create payroll period
GET    /payroll/periods              Get periods for pawnshop
GET    /payroll/periods/:id          Get period details
PUT    /payroll/periods/:id          Update period
DELETE /payroll/periods/:id          Delete period
POST   /payroll/periods/:id/complete Complete period

POST   /payroll/compensation         Upsert staff compensation
GET    /payroll/compensation/:staffId Get compensation

POST   /payroll/attendance          Record attendance
GET    /payroll/attendance/:staffId Get attendance range
GET    /payroll/attendance/period/:periodId Get period attendance

POST   /payroll/run                 Run payroll (create payslips)
GET    /payroll/payslips/period/:periodId Get payslips for period
GET    /payroll/payslips/:id        Get specific payslip
GET    /payroll/payslips/staff/:staffId Get staff's payslips
POST   /payroll/payslips/:id/approve Approve payslip
POST   /payroll/payslips/:id/paid   Mark as paid

GET    /payroll/summary/:pawnshopId Get dashboard summary
```

### Health Routes

```
GET    /health                      Service status
GET    /health/security             Security status
GET    /health/security/rls         RLS table status
GET    /health/diagnostics          Full diagnostics
```

---

## Error Handling

### Standard HTTP Responses

```typescript
// Success (200)
{ data: {...} }

// Validation Error (400)
{
  statusCode: 400,
  message: "Invalid input",
  error: "Bad Request"
}

// Not Found (404)
{
  statusCode: 404,
  message: "Payroll period #123 not found",
  error: "Not Found"
}

// Unauthorized (401)
{
  statusCode: 401,
  message: "Missing authorization header",
  error: "Unauthorized"
}

// Forbidden (403)
{
  statusCode: 403,
  message: "Insufficient permissions",
  error: "Forbidden"
}

// Server Error (500)
{
  statusCode: 500,
  message: "Internal server error",
  error: "Internal Server Error"
}
```

### Exception Types

```typescript
import { NotFoundException, BadRequestException, UnauthorizedException } from '@nestjs/common';

throw new NotFoundException(`Payroll period #${id} not found`);
throw new BadRequestException('Payroll can only be run on DRAFT periods');
throw new UnauthorizedException('Missing authorization header');
```

---

## Testing Best Practices

### Unit Tests (Service Logic)

```typescript
// payroll.service.spec.ts
describe('PayrollService', () => {
  describe('Payroll Computation', () => {
    it('should run payroll and create payslips', async () => {
      // Setup: mock Prisma calls
      // Execute: call service method
      // Assert: verify payslips created
    });
  });
});
```

Run:
```bash
npm test -- payroll.service.spec.ts
```

### Integration Tests (Controller + Service)

```typescript
// payroll.controller.spec.ts (create if needed)
describe('PayrollController', () => {
  it('should POST /payroll/periods', async () => {
    const response = await request(app.getHttpServer())
      .post('/payroll/periods')
      .send(createPeriodDto)
      .expect(201);
  });
});
```

### E2E Tests (Full API)

```typescript
// test/payroll.e2e-spec.ts (create if needed)
describe('Payroll (e2e)', () => {
  it('/payroll/periods POST', () => {
    return request(app.getHttpServer())
      .post('/payroll/periods')
      .send(dto)
      .expect(201)
      .expect((res) => {
        expect(res.body).toHaveProperty('id');
      });
  });
});
```

Run:
```bash
npm run test:e2e
```

---

## Debugging

### Enable Debug Logging

```bash
# Verbose logging
DEBUG=* npm run start:dev

# Database queries
DEBUG=prisma* npm run start:dev

# Single module
DEBUG=payroll* npm run start:dev
```

### Check RLS Policies at Runtime

```bash
curl http://localhost:3000/health/security/rls

# Response:
{
  "status": "secure",
  "timestamp": "2026-02-25T00:00:00Z",
  "totalCriticalTables": 17,
  "tablesWithRlsEnabled": 17,
  "tablesWithRlsDisabled": 0,
  "isAllSecure": true,
  "tables": [
    { "name": "profiles", "rlsEnabled": true },
    { "name": "customer", "rlsEnabled": true },
    ...
  ]
}
```

### Database Query Profiling

```sql
-- In Supabase SQL Editor
EXPLAIN ANALYZE
SELECT * FROM customer 
WHERE pawnshop_id = 'ps-001';
```

---

## Deployment Checklist

- [ ] All tests pass: `npm test`
- [ ] Build succeeds: `npm run build`
- [ ] No lint errors: `npm run lint`
- [ ] Coverage > 80%: `npm test -- --coverage`
- [ ] Security check passes: `curl http://localhost:3000/health/security`
- [ ] RLS policies enabled: `curl http://localhost:3000/health/security/rls`
- [ ] Environment variables set correctly
- [ ] Database migrations run: `npx prisma migrate deploy`
- [ ] Seed data loaded (if needed): `npm run seed`
- [ ] Documentation updated
- [ ] Performance tested (under load)

---

## Production Monitoring

### Metrics to Track

1. **RLS Enforcement**
   - Check `/health/security` daily
   - Alert if any table shows `rlsEnabled: false`

2. **Payroll Accuracy**
   - Validate deduction calculations monthly
   - Audit payslip generation logs

3. **Performance**
   - Monitor query times for large periods
   - Track database connection pool usage

4. **Errors**
   - Log all `BadRequestException` errors
   - Alert on database permission errors

---

## References

- [NestJS Documentation](https://docs.nestjs.com)
- [Prisma ORM](https://www.prisma.io/docs)
- [Supabase RLS](https://supabase.com/docs/guides/auth/row-level-security)
- [Jest Testing](https://jestjs.io)
- [TypeScript](https://www.typescriptlang.org/docs)

---

## Support

For issues or questions:
1. Check logs: `npm run logs`
2. Check health endpoint: `curl http://localhost:3000/health`
3. Review error messages and documentation
4. Check test coverage: `npm test -- --coverage`

**Last Updated**: February 25, 2026
**Version**: 1.0.0
**Team**: Full Stack Engineering
