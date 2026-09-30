import { PublicAppraisalController } from './public-appraisal.controller';
import { PublicAppraisalService } from './public-appraisal.service';

/**
 * Tenant scoping on the shop-side queue.
 *
 * An online application holds the applicant's name, phone number, address, item
 * description and identity document URLs. This route is not `@Public()` — it
 * requires `pawn_ticket.create` — so a permission alone is not a boundary; a
 * caller could otherwise pass `?pawnshopId=` for a shop they do not belong to
 * and read another branch's applicants. That is the same defect that was found
 * in `pawn-ticket.controller.getPendingApproval`, where the query param used to
 * take precedence over the caller's own tenant.
 */
const build = () => {
  const service = {
    listBranches: jest.fn().mockResolvedValue([]),
    quote: jest.fn().mockResolvedValue({}),
    create: jest.fn().mockResolvedValue({}),
    findByReference: jest.fn().mockResolvedValue({}),
    storeApplicantUpload: jest.fn().mockResolvedValue({ url: 'https://cdn.test/x.jpg' }),
    listForShop: jest.fn().mockResolvedValue([]),
  };

  const controller = new PublicAppraisalController(
    service as unknown as PublicAppraisalService,
  );
  return { controller, service };
};

const asRequest = (user?: { role?: string; pawnshopId?: string }) =>
  ({ user }) as never;

describe('listForShop — tenant scoping', () => {
  it('reads the caller’s own shop, ignoring a query param naming another', () => {
    const { controller, service } = build();

    controller.listForShop(
      asRequest({ role: 'OWNER', pawnshopId: 'shop-1' }),
      'shop-2',
    );

    // A `?pawnshopId=` that took precedence would let any account holding
    // `pawn_ticket.create` read another shop's applicants.
    expect(service.listForShop).toHaveBeenCalledWith('shop-1', undefined);
  });

  it('lets the platform operator narrow to a named shop', () => {
    const { controller, service } = build();

    controller.listForShop(asRequest({ role: 'SUPER_ADMIN' }), 'shop-2');

    expect(service.listForShop).toHaveBeenCalledWith('shop-2', undefined);
  });

  it('passes a status filter through', () => {
    const { controller, service } = build();

    controller.listForShop(asRequest({ role: 'MANAGER', pawnshopId: 'shop-1' }), undefined, 'PENDING');

    expect(service.listForShop).toHaveBeenCalledWith('shop-1', 'PENDING');
  });

  it('refuses a caller with no shop rather than reading everything', () => {
    const { controller, service } = build();

    expect(() => controller.listForShop(asRequest({ role: 'STAFF' }), 'shop-2')).toThrow(
      /no pawnshop is associated/i,
    );
    expect(service.listForShop).not.toHaveBeenCalled();
  });

  it('refuses when the request carries no user at all', () => {
    const { controller, service } = build();

    expect(() => controller.listForShop(asRequest(undefined), 'shop-1')).toThrow();
    expect(service.listForShop).not.toHaveBeenCalled();
  });
});

describe('applicant routes stay public', () => {
  it('does not require a session to price or apply', () => {
    const { controller, service } = build();

    // These are the routes a prospective pawner uses, and the whole reason the
    // controller exists is that they have no account. Scoping them to a tenant
    // would strand every applicant.
    expect(() =>
      controller.quote({ pawnshopId: 'shop-1', itemCategory: 'GOLD_JEWELRY', weight: 5 }),
    ).not.toThrow();
    expect(service.quote).toHaveBeenCalled();
    expect(() => controller.listBranches()).not.toThrow();
    expect(() => controller.findOne('RSV-ABCDE-1234')).not.toThrow();
    expect(service.findByReference).toHaveBeenCalledWith('RSV-ABCDE-1234');
  });
});
