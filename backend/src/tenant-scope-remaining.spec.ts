import { PawnTicketController } from './loan/pawn-ticket.controller';
import { LoanApplicationService } from './loan/loan-application.service';
import { TenantGovernanceController } from './tenant-governance/tenant-governance.controller';
import { TenantGovernanceService } from './tenant-governance/tenant-governance.service';
import { ProfileService } from './profile/profile.service';
import { PERMISSIONS_KEY } from './common/decorators/requires-permission.decorator';
import { PERMISSIONS } from './common/permissions/permissions.const';

const OWNER = { id: 'u-1', role: 'OWNER', pawnshopId: 'shop-a' };
const MANAGER = { id: 'u-2', role: 'MANAGER', pawnshopId: 'shop-a' };
const SUPER = { id: 'u-3', role: 'SUPER_ADMIN', pawnshopId: null };

describe('GET /pawn-tickets/pending-approval — tenant precedence', () => {
  let controller: PawnTicketController;
  let service: { getPendingApprovalTickets: jest.Mock };

  beforeEach(() => {
    service = { getPendingApprovalTickets: jest.fn().mockResolvedValue([]) };
    controller = Object.create(PawnTicketController.prototype) as PawnTicketController;
    (controller as any).pawnTicketService = service;
  });

  const call = (actor: any, pawnshopId?: string) =>
    controller.getPendingApproval({ user: actor } as any, pawnshopId, undefined);

  it('uses the caller tenant when no shop is named', async () => {
    await call(OWNER);

    expect(service.getPendingApprovalTickets).toHaveBeenCalledWith('shop-a', undefined);
  });

  // The defect: the query param took precedence, so any account holding
  // `pawn_ticket.approve` could read another shop's pending tickets.
  it('ignores a query param naming another tenant', async () => {
    await call(OWNER, 'shop-b');

    expect(service.getPendingApprovalTickets).toHaveBeenCalledWith('shop-a', undefined);
  });

  it('ignores a cross-tenant param for a manager too', async () => {
    await call(MANAGER, 'shop-b');

    expect(service.getPendingApprovalTickets).toHaveBeenCalledWith('shop-a', undefined);
  });

  it('lets the platform operator name a tenant explicitly', async () => {
    await call(SUPER, 'shop-b');

    expect(service.getPendingApprovalTickets).toHaveBeenCalledWith('shop-b', undefined);
  });

  // The handler is synchronous, so the guard throws rather than rejecting.
  it('refuses rather than reading platform-wide when no tenant can be resolved', () => {
    expect(() => call(SUPER)).toThrow(/tenant must be identified/i);
    expect(service.getPendingApprovalTickets).not.toHaveBeenCalled();
  });

  it('fails closed for a tenantless shop account', () => {
    expect(() => call({ role: 'STAFF', pawnshopId: null })).toThrow(
      /tenant must be identified/i,
    );
    expect(service.getPendingApprovalTickets).not.toHaveBeenCalled();
  });

  it('still guards the route with pawn_ticket.approve', () => {
    const required = Reflect.getMetadata(
      PERMISSIONS_KEY,
      PawnTicketController.prototype.getPendingApproval,
    );
    expect(required).toContain(PERMISSIONS['pawn_ticket.approve']);
  });
});

describe('GET /loan/applications — tenant scoping', () => {
  let service: LoanApplicationService;
  let loanApplication: { findMany: jest.Mock };

  beforeEach(() => {
    loanApplication = { findMany: jest.fn().mockResolvedValue([]) };
    service = Object.create(LoanApplicationService.prototype) as LoanApplicationService;
    (service as any).prisma = { loanApplication };
  });

  it('hard-filters to the caller tenant', async () => {
    await service.getApplications({}, 'shop-a');

    expect(loanApplication.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { pawnshopId: 'shop-a' } }),
    );
  });

  // The defect: an omitted tenant produced an empty `where`, returning every
  // tenant's applications to any authenticated caller.
  it('refuses when no tenant can be resolved', async () => {
    await expect(service.getApplications({}, undefined)).rejects.toThrow(
      /not attached to a shop/i,
    );
    expect(loanApplication.findMany).not.toHaveBeenCalled();
  });

  it('refuses a filter naming another tenant', async () => {
    await expect(
      service.getApplications({ pawnshopId: 'shop-b' }, 'shop-a'),
    ).rejects.toThrow(/another shop/i);
    expect(loanApplication.findMany).not.toHaveBeenCalled();
  });

  it('accepts a filter matching the caller tenant', async () => {
    await service.getApplications({ pawnshopId: 'shop-a' }, 'shop-a');

    expect(loanApplication.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { pawnshopId: 'shop-a' } }),
    );
  });

  it('still applies customer and status filters alongside the tenant', async () => {
    await service.getApplications({ customerId: 'c-1', status: 'PENDING' }, 'shop-a');

    expect(loanApplication.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { pawnshopId: 'shop-a', customerId: 'c-1', status: 'PENDING' },
      }),
    );
  });

  it('takes the tenant from the principal, not the query string', async () => {
    const appService = { getApplications: jest.fn().mockResolvedValue([]) };
    const controller = Object.create(
      require('./loan/loan.controller').LoanController.prototype,
    );
    (controller as any).loanApplicationService = appService;

    await controller.getApplications(
      { user: OWNER } as any,
      undefined,
      'PENDING',
      undefined,
      undefined,
    );

    expect(appService.getApplications).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'PENDING' }),
      'shop-a',
    );
  });
});

describe('GET /tenant-governance/staff — own-shop roster', () => {
  let service: TenantGovernanceService;
  let profile: { findMany: jest.Mock; findUnique: jest.Mock };
  let branch: { findFirst: jest.Mock };

  const withActor = (actor: { role: string; pawnshopId: string | null }) => {
    profile.findUnique.mockResolvedValue({ id: 'u-1', ...actor });
  };

  beforeEach(() => {
    profile = {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn(),
    };
    branch = { findFirst: jest.fn().mockResolvedValue({ id: 3 }) };
    service = Object.create(TenantGovernanceService.prototype) as TenantGovernanceService;
    (service as any).prisma = { profile, branch };
  });

  // The defect: the browser read `profiles` with `select('*')` and applied the
  // pawnshop filter only when a shop was selected, so an unset filter returned
  // every profile on the platform - emails included.
  it('scopes the roster to the caller own shop', async () => {
    withActor({ role: 'OWNER', pawnshopId: 'shop-a' });

    await service.listOwnShopStaff('u-1');

    expect(profile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { pawnshopId: 'shop-a' } }),
    );
  });

  it('returns an explicit field list rather than every column', async () => {
    withActor({ role: 'OWNER', pawnshopId: 'shop-a' });

    await service.listOwnShopStaff('u-1');

    const [args] = profile.findMany.mock.calls[0];
    expect(Object.keys(args.select).sort()).toEqual(
      ['branchId', 'createdAt', 'email', 'fullName', 'id', 'isOnline', 'lastSeenAt', 'role', 'staffType'].sort(),
    );
  });

  it('fails closed for an account with no shop', async () => {
    withActor({ role: 'STAFF', pawnshopId: null });

    await expect(service.listOwnShopStaff('u-1')).rejects.toThrow(/not attached to a shop/i);
    expect(profile.findMany).not.toHaveBeenCalled();
  });

  it('sends the platform operator to the explicit cross-tenant endpoint', async () => {
    withActor({ role: 'SUPER_ADMIN', pawnshopId: null });

    await expect(service.listOwnShopStaff('u-1')).rejects.toThrow(/platform staff endpoint/i);
    expect(profile.findMany).not.toHaveBeenCalled();
  });

  it('rejects a non-numeric branch id before querying', async () => {
    withActor({ role: 'OWNER', pawnshopId: 'shop-a' });

    await expect(service.listOwnShopStaff('u-1', 'abc')).rejects.toThrow(/invalid branch id/i);
    expect(branch.findFirst).not.toHaveBeenCalled();
  });

  it('verifies a named branch belongs to the caller shop', async () => {
    withActor({ role: 'OWNER', pawnshopId: 'shop-a' });
    branch.findFirst.mockResolvedValue({ id: 3 });

    await service.listOwnShopStaff('u-1', '3');

    expect(branch.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 3, pawnshopId: 'shop-a' } }),
    );
    expect(profile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { pawnshopId: 'shop-a', branchId: 3 } }),
    );
  });

  it('refuses a branch from another tenant', async () => {
    withActor({ role: 'OWNER', pawnshopId: 'shop-a' });
    branch.findFirst.mockResolvedValue(null);

    await expect(service.listOwnShopStaff('u-1', '3')).rejects.toThrow(
      /not found in this shop/i,
    );
    expect(profile.findMany).not.toHaveBeenCalled();
  });

  it('is guarded by user.manage_staff', () => {
    const required = Reflect.getMetadata(
      PERMISSIONS_KEY,
      TenantGovernanceController.prototype.listOwnShopStaff,
    );
    expect(required).toContain(PERMISSIONS['user.manage_staff']);
  });
});

describe('GET /tenant-governance/system-config — own-shop settings', () => {
  let service: TenantGovernanceService;
  let profile: { findUnique: jest.Mock };
  let pawnshop: { findUnique: jest.Mock };

  beforeEach(() => {
    profile = { findUnique: jest.fn() };
    pawnshop = { findUnique: jest.fn() };
    service = Object.create(TenantGovernanceService.prototype) as TenantGovernanceService;
    (service as any).prisma = { profile, pawnshop };
  });

  // The defect: the browser read `pawnshops.settings` with `.limit(1)` and no
  // filter, so a user whose shop was not yet resolved received an arbitrary
  // tenant's feature configuration.
  it('reads the shop from the caller own profile', async () => {
    profile.findUnique.mockResolvedValue({ id: 'u-1', role: 'OWNER', pawnshopId: 'shop-a' });
    pawnshop.findUnique.mockResolvedValue({ settings: {} });

    await service.getOwnShopSystemConfig('u-1');

    expect(pawnshop.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'shop-a' } }),
    );
  });

  it('fails closed for an account with no shop', async () => {
    profile.findUnique.mockResolvedValue({ id: 'u-1', role: 'STAFF', pawnshopId: null });

    await expect(service.getOwnShopSystemConfig('u-1')).rejects.toThrow(
      /not attached to a shop/i,
    );
    expect(pawnshop.findUnique).not.toHaveBeenCalled();
  });

  it('separates global overrides from the local feature flags', async () => {
    profile.findUnique.mockResolvedValue({ id: 'u-1', role: 'OWNER', pawnshopId: 'shop-a' });
    pawnshop.findUnique.mockResolvedValue({
      settings: { crm_enabled: true, global_overrides: { audit_enabled: false } },
    });

    const result = await service.getOwnShopSystemConfig('u-1');

    expect(result.settings).toEqual({ crm_enabled: true });
    expect(result.globalOverrides).toEqual({ audit_enabled: false });
  });

  it('returns empty blocks when settings is null rather than throwing', async () => {
    profile.findUnique.mockResolvedValue({ id: 'u-1', role: 'OWNER', pawnshopId: 'shop-a' });
    pawnshop.findUnique.mockResolvedValue({ settings: null });

    const result = await service.getOwnShopSystemConfig('u-1');

    expect(result.settings).toEqual({});
    expect(result.globalOverrides).toEqual({});
  });

  it('is guarded by pawn_ticket.view', () => {
    const required = Reflect.getMetadata(
      PERMISSIONS_KEY,
      TenantGovernanceController.prototype.getSystemConfig,
    );
    expect(required).toContain(PERMISSIONS['pawn_ticket.view']);
  });
});

describe('GET /tenant-governance/pawnshops/:id/settings — platform settings', () => {
  let service: TenantGovernanceService;
  let profile: { findUnique: jest.Mock };
  let pawnshop: { findUnique: jest.Mock };

  beforeEach(() => {
    profile = { findUnique: jest.fn() };
    pawnshop = { findUnique: jest.fn() };
    service = Object.create(TenantGovernanceService.prototype) as TenantGovernanceService;
    (service as any).prisma = { profile, pawnshop };
  });

  const asSuperAdmin = () =>
    profile.findUnique.mockResolvedValue({ id: 'u-1', role: 'SUPER_ADMIN', pawnshopId: null });

  const asOwner = () =>
    profile.findUnique.mockResolvedValue({ id: 'u-1', role: 'OWNER', pawnshopId: 'shop-a' });

  it('requires the platform operator role', async () => {
    asOwner();

    await expect(service.getPawnshopSettings('u-1', 'shop-b')).rejects.toThrow();
    expect(pawnshop.findUnique).not.toHaveBeenCalled();
  });

  it('reads the named shop for a super admin', async () => {
    asSuperAdmin();
    pawnshop.findUnique.mockResolvedValue({ settings: {}, name: 'Shop B' });

    const result = await service.getPawnshopSettings('u-1', 'shop-b');

    expect(pawnshop.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'shop-b' } }),
    );
    expect(result.name).toBe('Shop B');
  });

  it('returns only the columns the settings page renders', async () => {
    asSuperAdmin();
    pawnshop.findUnique.mockResolvedValue({ settings: {} });

    await service.getPawnshopSettings('u-1', 'shop-b');

    const [args] = pawnshop.findUnique.mock.calls[0];
    expect(Object.keys(args.select).sort()).toEqual(
      ['address', 'latitude', 'longitude', 'name', 'settings'].sort(),
    );
  });

  it('splits global overrides out for the merge-on-write branch save', async () => {
    asSuperAdmin();
    pawnshop.findUnique.mockResolvedValue({
      settings: { crm_enabled: true, global_overrides: { audit_enabled: true } },
    });

    const result = await service.getPawnshopSettings('u-1', 'shop-b');

    expect(result.settings).toEqual({ crm_enabled: true });
    expect(result.globalOverrides).toEqual({ audit_enabled: true });
  });

  it('is guarded by platform.manage', () => {
    const required = Reflect.getMetadata(
      PERMISSIONS_KEY,
      TenantGovernanceController.prototype.getPawnshopSettings,
    );
    expect(required).toContain(PERMISSIONS['platform.manage']);
  });
});

describe('GET /profile/session-context — the login role lookup', () => {
  let service: ProfileService;
  let profile: { findUnique: jest.Mock };

  beforeEach(() => {
    profile = { findUnique: jest.fn().mockResolvedValue(null) };
    service = Object.create(ProfileService.prototype) as ProfileService;
    (service as any).prisma = { profile };
  });

  // The defect: the browser read `profiles` by id and then retried with
  // `.eq('email', email)`, letting any signed-in caller ask for an arbitrary
  // address's role and shop.
  it('looks the profile up by authenticated id only', async () => {
    await service.getSessionContext('u-1');

    expect(profile.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'u-1' } }),
    );
  });

  it('never queries by email', async () => {
    await service.getSessionContext('u-1');

    const [args] = profile.findUnique.mock.calls[0];
    expect(args.where).not.toHaveProperty('email');
  });

  it('returns only the four session fields', async () => {
    await service.getSessionContext('u-1');

    const [args] = profile.findUnique.mock.calls[0];
    expect(Object.keys(args.select).sort()).toEqual(
      ['branchId', 'pawnshopId', 'role', 'staffType'].sort(),
    );
  });

  it('returns null for an account with no profile rather than throwing', async () => {
    profile.findUnique.mockResolvedValue(null);

    await expect(service.getSessionContext('u-1')).resolves.toBeNull();
  });
});
