import { AnalyticsService } from './analytics.service';
import { AnalyticsActor } from './analytics.service';

/**
 * The dashboard header names the branch it is showing. That name used to be read
 * in the browser from rows filtered by a `pawnshop_id` taken out of the URL, so
 * it was cross-tenant capable and was removed. Nothing replaced it, and the
 * component fell back to its own "Loading..." placeholder - which is a non-empty
 * string, so the `||` that was meant to catch the unresolved case never fired.
 * The header sat on the word "Loading..." forever next to fully loaded figures.
 *
 * These tests pin the two halves of that fix: the name arrives from the server,
 * and it arrives from inside the tenant the request was already scoped to.
 */
const actor = (overrides: Partial<AnalyticsActor> = {}): AnalyticsActor => ({
  id: 'user-1',
  role: 'OWNER',
  pawnshopId: 'shop-1',
  ...overrides,
});

const prismaFor = (names: { branch?: string | null; pawnshop?: string | null }) => ({
  ticket: { findMany: jest.fn().mockResolvedValue([]) },
  customer: { count: jest.fn().mockResolvedValue(0) },
  branch: {
    findFirst: jest.fn().mockImplementation(({ where }: { where: { id: number } }) =>
      Promise.resolve(
        where.id === 7 && names.branch != null
          ? { id: 7, name: names.branch }
          : where.id === 7
            ? null
            : { id: where.id, name: names.branch },
      ),
    ),
  },
  pawnshop: {
    findFirst: jest.fn().mockResolvedValue(
      names.pawnshop == null ? null : { name: names.pawnshop },
    ),
  },
});

describe('getBranchActivity display name', () => {
  it('names the shop when no branch is scoped', async () => {
    const prisma = prismaFor({ pawnshop: 'Cebuana Main' });
    const service = new AnalyticsService(prisma as never);

    const result = await service.getBranchActivity(actor());

    expect(result.displayName).toBe('Cebuana Main');
  });

  it('prefers the branch name when a branch is scoped', async () => {
    const prisma = prismaFor({ branch: 'Dasmarinas Branch', pawnshop: 'Cebuana Main' });
    const service = new AnalyticsService(prisma as never);

    const result = await service.getBranchActivity(actor(), '7');

    expect(result.displayName).toBe('Dasmarinas Branch');
  });

  it('reads the shop from the resolved tenant, never from a request parameter', async () => {
    const prisma = prismaFor({ pawnshop: 'Cebuana Main' });
    const service = new AnalyticsService(prisma as never);

    await service.getBranchActivity(actor());

    // The whole reason this moved server-side. A name keyed off a client-supplied
    // id is a cross-tenant read wearing a label.
    expect(prisma.pawnshop.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'shop-1' } }),
    );
  });

  it('scopes the branch lookup to the tenant as well', async () => {
    const prisma = prismaFor({ branch: 'Dasmarinas Branch' });
    const service = new AnalyticsService(prisma as never);

    await service.getBranchActivity(actor(), '7');

    expect(prisma.branch.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 7, pawnshopId: 'shop-1' } }),
    );
  });

  it('reports null rather than a placeholder when the shop row is missing', async () => {
    const prisma = prismaFor({ pawnshop: null });
    const service = new AnalyticsService(prisma as never);

    const result = await service.getBranchActivity(actor());

    // Not "Loading...". The client distinguishes "not yet known" from a real
    // name by checking for null, so a placeholder here would reintroduce the
    // exact bug this replaced.
    expect(result.displayName).toBeNull();
  });
});
