import { PermissionService } from './permissions.service';
import type { PrismaService } from '../../prisma.service';

describe('PermissionService', () => {
  let service: PermissionService;
  let findMany: jest.Mock;

  const prisma = {
    rolePermission: { findMany: (...args: unknown[]) => findMany(...args) },
  } as unknown as PrismaService;

  beforeEach(() => {
    findMany = jest.fn();
    service = new PermissionService(prisma);
  });

  it('queries role ∪ staffType rows and returns the union of names', async () => {
    findMany.mockResolvedValue([
      { permission: { name: 'pawn_ticket.create' } },
      { permission: { name: 'pawn_ticket.redeem' } },
      { permission: { name: 'loan.collect' } },
    ]);
    const result = await service.resolveEffectivePermissions('STAFF', 'CASHIER_TELLER');
    expect(findMany).toHaveBeenCalledWith({
      where: { role: { in: ['STAFF', 'CASHIER_TELLER'] } },
      select: { permission: { select: { name: true } } },
    });
    expect(result).toEqual(
      new Set(['pawn_ticket.create', 'pawn_ticket.redeem', 'loan.collect']),
    );
  });

  it('queries only the base role when staffType is null', async () => {
    findMany.mockResolvedValue([]);
    await service.resolveEffectivePermissions('STAFF', null);
    expect(findMany).toHaveBeenCalledWith({
      where: { role: { in: ['STAFF'] } },
      select: { permission: { select: { name: true } } },
    });
  });

  it('fails closed with an empty set for unknown roles', async () => {
    findMany.mockResolvedValue([]);
    const result = await service.resolveEffectivePermissions('MYSTERY_ROLE');
    expect(result).toEqual(new Set());
  });
});
