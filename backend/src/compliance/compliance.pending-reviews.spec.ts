import { ComplianceService } from './compliance.service';

/**
 * A compliance document whose shop no longer exists cannot be reviewed.
 *
 * `PawnshopDocument.pawnshopId` is nullable and the Prisma relation is
 * `Pawnshop?`, so `getPendingReviews` can return a row with `pawnshop: null`.
 * That row was passed through, and the reviewer's screen grouped pending reviews
 * by `review.pawnshop.id` inside a `reduce` — so the dereference threw during
 * render and blanked the whole compliance tab. One unreviewable row took down
 * the screen.
 */
const review = (overrides: Record<string, unknown> = {}) => ({
  id: 'doc-1',
  pawnshopId: 'shop-1',
  documentType: 'DTI_SEC',
  fileName: 'dti.pdf',
  fileUrl: 'https://cdn.test/dti.pdf',
  fileSize: 100,
  hasViewed: false,
  status: 'UPLOADED',
  denialReason: null,
  createdAt: new Date('2026-01-01'),
  pawnshop: { id: 'shop-1', name: 'Cebuana', ownerEmail: 'owner@test.ph' },
  ...overrides,
});

const build = (rows: unknown[]) => {
  const prisma = {
    pawnshopDocument: { findMany: jest.fn().mockResolvedValue(rows) },
  };
  const service = Object.create(ComplianceService.prototype) as ComplianceService;
  (service as any).prisma = prisma;
  const warn = jest.fn();
  (service as any).logger = { warn, log: jest.fn(), error: jest.fn() };
  return { service, prisma, warn };
};

describe('getPendingReviews', () => {
  it('returns ordinary reviews untouched', async () => {
    const { service } = build([review(), review({ id: 'doc-2' })]);

    const result = await service.getPendingReviews();

    expect(result).toHaveLength(2);
  });

  it('drops a review whose shop no longer exists', async () => {
    const { service } = build([
      review(),
      review({ id: 'orphan-1', pawnshopId: null, pawnshop: null }),
    ]);

    const result = await service.getPendingReviews();

    expect(result).toHaveLength(1);
    expect(result.every((row: any) => row.pawnshop !== null)).toBe(true);
  });

  it('never returns a row the reviewer would crash on', async () => {
    const { service } = build([
      review({ pawnshopId: null, pawnshop: null }),
      review({ id: 'ok', pawnshop: { id: 'shop-1', name: 'X', ownerEmail: 'y@z.ph' } }),
    ]);

    // The exact expression the reviewer's screen evaluated.
    const result = await service.getPendingReviews();
    expect(() => result.map((row: any) => row.pawnshop.id)).not.toThrow();
  });

  it('logs the orphans instead of hiding them', async () => {
    const { service, warn } = build([
      review({ id: 'orphan-1', pawnshop: null }),
      review({ id: 'orphan-2', pawnshop: null }),
    ]);

    await service.getPendingReviews();

    // Filtering keeps the screen up; the log is what makes the underlying
    // unreviewable rows findable instead of merely invisible.
    expect(warn).toHaveBeenCalled();
    const message = warn.mock.calls[0][0] as string;
    expect(message).toContain('orphan-1');
    expect(message).toContain('orphan-2');
  });

  it('stays quiet when every review has a shop', async () => {
    const { service, warn } = build([review()]);

    await service.getPendingReviews();

    expect(warn).not.toHaveBeenCalled();
  });

  it('returns an empty list rather than throwing when every row is orphaned', async () => {
    const { service } = build([review({ pawnshop: null })]);

    await expect(service.getPendingReviews()).resolves.toEqual([]);
  });
});