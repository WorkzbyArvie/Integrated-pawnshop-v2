import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PERMISSIONS_KEY } from './common/decorators/requires-permission.decorator';
import { PERMISSIONS } from './common/permissions/permissions.const';

type Actor = { id: string; role: string; pawnshopId: string | null };

const OWNER: Actor = { id: 'u-owner', role: 'OWNER', pawnshopId: 'shop-a' };
const OTHER_OWNER: Actor = { id: 'u-other', role: 'OWNER', pawnshopId: 'shop-b' };
const SUPER: Actor = { id: 'u-super', role: 'SUPER_ADMIN', pawnshopId: null };
const TENANTLESS: Actor = { id: 'u-none', role: 'STAFF', pawnshopId: null };

const CUSTOMER_SELECT = {
  id: true,
  fullName: true,
  contactNumber: true,
  address: true,
  loyaltyTier: true,
  kycStatus: true,
  createdAt: true,
  _count: { select: { tickets: true } },
};

describe('customer ledger tenant scoping', () => {
  let service: AppService;
  let customer: { findMany: jest.Mock; findFirst: jest.Mock };
  let branch: { findFirst: jest.Mock };
  let ticket: { findMany: jest.Mock };

  // The service is exercised directly against a mocked Prisma, so these tests
  // assert the real query shapes rather than a re-implementation of them.
  beforeEach(() => {
    customer = { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn().mockResolvedValue(null) };
    branch = { findFirst: jest.fn().mockResolvedValue({ id: 'b-1' }) };
    ticket = { findMany: jest.fn().mockResolvedValue([]) };

    service = Object.create(AppService.prototype) as AppService;
    (service as any).prisma = { customer, branch, ticket };
  });

  describe('GET /customers — the cross-tenant read that was live', () => {
    it('hard-filters the ledger to the caller tenant', async () => {
      await service.getAllCustomers(OWNER);

      expect(customer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { pawnshopId: 'shop-a' } }),
      );
    });

    it('refuses a request naming a different tenant', async () => {
      await expect(service.getAllCustomers(OWNER, { pawnshopId: 'shop-b' })).rejects.toThrow(
        /another shop/i,
      );
      expect(customer.findMany).not.toHaveBeenCalled();
    });

    it('fails closed for an identity with no tenant', async () => {
      await expect(service.getAllCustomers(TENANTLESS)).rejects.toThrow(/not attached to a shop/i);
      expect(customer.findMany).not.toHaveBeenCalled();
    });

    it('requires a super admin to name a tenant instead of returning every shop', async () => {
      await expect(service.getAllCustomers(SUPER)).rejects.toThrow(/tenant must be identified/i);
      expect(customer.findMany).not.toHaveBeenCalled();
    });

    it('lets a super admin read one named tenant', async () => {
      await service.getAllCustomers(SUPER, { pawnshopId: 'shop-b' });

      expect(customer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { pawnshopId: 'shop-b' } }),
      );
    });

    it('bounds the result set', async () => {
      await service.getAllCustomers(OWNER, { limit: 25, offset: 50 });

      expect(customer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 25, skip: 50 }),
      );
    });

    it('returns an explicit field list, not the whole row', async () => {
      await service.getAllCustomers(OWNER);

      const [args] = customer.findMany.mock.calls[0];
      expect(args.select).toEqual(CUSTOMER_SELECT);
      expect(args.include).toBeUndefined();
    });

    it('scopes a search term without escaping the tenant filter', async () => {
      await service.getAllCustomers(OWNER, { search: 'dela' });

      expect(customer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ pawnshopId: 'shop-a' }),
        }),
      );
    });
  });

  describe('GET /customers — branch scope selector', () => {
    it('rejects a branch belonging to another tenant', async () => {
      branch.findFirst.mockResolvedValue(null);

      await expect(service.getAllCustomers(OWNER, { branchId: 999 })).rejects.toThrow(
        /not found in this shop/i,
      );
      expect(ticket.findMany).not.toHaveBeenCalled();
      expect(customer.findMany).not.toHaveBeenCalled();
    });

    it('verifies the branch against the caller tenant', async () => {
      branch.findFirst.mockResolvedValue({ id: 1 });
      ticket.findMany.mockResolvedValue([{ customerId: 'c-1' }]);

      await service.getAllCustomers(OWNER, { branchId: 1 });

      expect(branch.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 1, pawnshopId: 'shop-a' } }),
      );
    });

    it('scopes the ticket lookup to the caller tenant', async () => {
      branch.findFirst.mockResolvedValue({ id: 1 });
      ticket.findMany.mockResolvedValue([{ customerId: 'c-1' }]);

      await service.getAllCustomers(OWNER, { branchId: 1 });

      expect(ticket.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { branchId: 1, pawnshopId: 'shop-a' } }),
      );
    });
  });

  describe('GET /customers/:id — IDOR', () => {
    it('looks the customer up by id AND tenant', async () => {
      customer.findFirst.mockResolvedValue({ id: 'c-1' });

      await service.getCustomerById('c-1', OWNER);

      expect(customer.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'c-1', pawnshopId: 'shop-a' } }),
      );
    });

    it('returns 404 rather than another tenant customer', async () => {
      customer.findFirst.mockResolvedValue(null);

      await expect(service.getCustomerById('c-1', OTHER_OWNER)).rejects.toThrow(/not found/i);
      expect(customer.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'c-1', pawnshopId: 'shop-b' } }),
      );
    });

    it('scopes the joined tickets to the caller tenant', async () => {
      customer.findFirst.mockResolvedValue({ id: 'c-1' });

      await service.getCustomerById('c-1', OWNER);

      expect(ticket.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { customerId: 'c-1', pawnshopId: 'shop-a' } }),
      );
    });
  });

  describe('GET /tickets — the ticket vault', () => {
    it('hard-filters tickets to the caller tenant', async () => {
      await service.getAllTickets(OWNER);

      expect(ticket.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { pawnshopId: 'shop-a' } }),
      );
    });

    it('refuses a ticket read naming a different tenant', async () => {
      await expect(service.getAllTickets(OWNER, { pawnshopId: 'shop-b' })).rejects.toThrow(
        /another shop/i,
      );
      expect(ticket.findMany).not.toHaveBeenCalled();
    });

    it('never returns the full customer row', async () => {
      await service.getAllTickets(OWNER);

      const [args] = ticket.findMany.mock.calls[0];
      // `include: { customer: true }` handed out address/contact/KYC status for
      // every customer on the platform. The join must stay a narrow select.
      expect(args.include).toBeUndefined();
      expect(args.select.customer).toEqual({
        select: { id: true, fullName: true, loyaltyTier: true },
      });
    });

    it('returns a narrow branch projection rather than the whole row', async () => {
      await service.getAllTickets(OWNER);

      const [args] = ticket.findMany.mock.calls[0];
      expect(args.select.branch).toEqual({ select: { id: true, name: true } });
    });

    it('bounds the result set', async () => {
      await service.getAllTickets(OWNER, { limit: 20, offset: 40 });

      expect(ticket.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 20, skip: 40 }),
      );
    });

    it('rejects a branch belonging to another tenant', async () => {
      branch.findFirst.mockResolvedValue(null);

      await expect(service.getAllTickets(OWNER, { branchId: 999 })).rejects.toThrow(
        /not found in this shop/i,
      );
      expect(ticket.findMany).not.toHaveBeenCalled();
    });

    it('applies a branch filter only after verifying the tenant', async () => {
      branch.findFirst.mockResolvedValue({ id: 7 });

      await service.getAllTickets(OWNER, { branchId: 7 });

      expect(ticket.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { pawnshopId: 'shop-a', branchId: 7 } }),
      );
    });

    it('fails closed for an identity with no tenant', async () => {
      await expect(service.getAllTickets(TENANTLESS)).rejects.toThrow(/not attached to a shop/i);
      expect(ticket.findMany).not.toHaveBeenCalled();
    });

    it('is guarded by the pawn_ticket.view permission', () => {
      const required = Reflect.getMetadata(
        PERMISSIONS_KEY,
        AppController.prototype.findAllTickets,
      );
      expect(required).toContain(PERMISSIONS['pawn_ticket.view']);
    });

    it('reads the ticket tenant from the principal, not the query', async () => {
      const appService = { getAllTickets: jest.fn().mockResolvedValue([]) };
      const controller = Object.create(AppController.prototype) as AppController;
      (controller as any).appService = appService;

      await controller.findAllTickets({ branchId: 7 } as any, { user: OWNER } as any);

      expect(appService.getAllTickets).toHaveBeenCalledWith(OWNER, { branchId: 7 });
    });
  });

  describe('PATCH /tickets/:id/description — the cross-tenant write', () => {
    beforeEach(() => {
      (ticket as any).updateMany = jest.fn().mockResolvedValue({ count: 1 });
    });

    it('scopes the write to the caller tenant', async () => {
      await service.updateTicketDescription('42', 'photo urls', OWNER);

      expect((ticket as any).updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 42, pawnshopId: 'shop-a' } }),
      );
    });

    it('reports not-found rather than writing to another tenant ticket', async () => {
      (ticket as any).updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.updateTicketDescription('42', 'photo urls', OTHER_OWNER),
      ).rejects.toThrow(/not found/i);
    });

    it('rejects a non-numeric ticket id before touching the database', async () => {
      await expect(service.updateTicketDescription('abc', 'x', OWNER)).rejects.toThrow(
        /invalid ticket id/i,
      );
      expect((ticket as any).updateMany).not.toHaveBeenCalled();
    });

    it('fails closed for an identity with no tenant', async () => {
      await expect(service.updateTicketDescription('42', 'x', TENANTLESS)).rejects.toThrow(
        /not attached to a shop/i,
      );
      expect((ticket as any).updateMany).not.toHaveBeenCalled();
    });

    it('is guarded by the inventory.manage permission', () => {
      const required = Reflect.getMetadata(
        PERMISSIONS_KEY,
        AppController.prototype.updateTicketDescription,
      );
      expect(required).toContain(PERMISSIONS['inventory.manage']);
    });
  });

  describe('route guards', () => {
    it('guards the list read with customer.view_history', () => {
      const required = Reflect.getMetadata(
        PERMISSIONS_KEY,
        AppController.prototype.findAllCustomers,
      );
      expect(required).toContain(PERMISSIONS['customer.view_history']);
    });

    it('guards the single read with customer.view_history', () => {
      const required = Reflect.getMetadata(
        PERMISSIONS_KEY,
        AppController.prototype.findOneCustomer,
      );
      expect(required).toContain(PERMISSIONS['customer.view_history']);
    });

    it('reads the tenant from the request principal, not the query string', async () => {
      const appService = { getAllCustomers: jest.fn().mockResolvedValue([]) };
      const controller = Object.create(AppController.prototype) as AppController;
      (controller as any).appService = appService;

      await controller.findAllCustomers({ branchId: 1 } as any, { user: OWNER } as any);

      expect(appService.getAllCustomers).toHaveBeenCalledWith(OWNER, { branchId: 1 });
    });

    it('passes the principal to the single-customer read too', async () => {
      const appService = { getCustomerById: jest.fn().mockResolvedValue({}) };
      const controller = Object.create(AppController.prototype) as AppController;
      (controller as any).appService = appService;

      await controller.findOneCustomer('c-1', { user: OTHER_OWNER } as any);

      expect(appService.getCustomerById).toHaveBeenCalledWith('c-1', OTHER_OWNER);
    });
  });
});
