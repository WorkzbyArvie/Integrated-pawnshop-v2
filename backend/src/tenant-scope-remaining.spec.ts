import { PawnTicketController } from './loan/pawn-ticket.controller';
import { LoanApplicationService } from './loan/loan-application.service';
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
