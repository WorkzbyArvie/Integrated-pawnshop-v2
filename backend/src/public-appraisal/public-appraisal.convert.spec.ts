import { PublicAppraisalService } from './public-appraisal.service';

/**
 * Converting an online application into a real pawn ticket.
 *
 * This is the step that made the flow mean anything. Before it existed an
 * application was a dead end — the customer applied, nothing happened — so the
 * properties below are the difference between a feature and a collection form.
 *
 * The load-bearing one: the appraiser's figures are authoritative. The snapshot
 * was priced from a self-reported weight and an unverified purity mark, so
 * reusing it would turn a five-step process into a rubber stamp.
 */
const stored = (overrides: Record<string, unknown> = {}) => ({
  id: 'res-1',
  reference: 'RSV-ABCDE-1234',
  status: 'PENDING',
  pawnshopId: 'shop-1',
  branchId: null,
  expiresAt: new Date(Date.now() + 60_000),
  customerName: 'Juan Dela Cruz',
  contactNumber: '09171234567',
  address: '1 Mabini St, Imus',
  itemCategory: 'GOLD_JEWELRY',
  itemDescription: '22K necklace',
  weightGrams: 5.5,
  purityPercent: 75,
  photoUrls: ['https://cdn.test/item.jpg'],
  appraisedValue: 17325,
  recommendedLoanAmount: 12127.5,
  riskScore: 40,
  convertedTicketId: null,
  ...overrides,
});

/**
 * The appraisal confirmed the online estimate.
 *
 * Deliberately identical to the stored figures, because that is the *common*
 * case and it should not trip the revision guard. `revised()` is the other one.
 */
const inspected = (overrides: Record<string, unknown> = {}) => ({
  weight: 5.5,
  appraisedValue: 17325,
  loanAmount: 12127.5,
  ...overrides,
});

/** The inspection found something different — needs a stated reason. */
const revised = (overrides: Record<string, unknown> = {}) => ({
  weight: 5.4,
  appraisedValue: 17000,
  loanAmount: 11900,
  revisionReason: 'Hallmark reads 18K, not 22K',
  ...overrides,
});

const build = (reservationOverrides: Record<string, unknown> = {}) => {
  const updates: any[] = [];
  const createTicket = jest.fn().mockResolvedValue({ id: 77, ticketNumber: 'TKT-1' });

  const prisma = {
    pawnReservation: {
      findUnique: jest.fn().mockResolvedValue(stored(reservationOverrides)),
      update: jest.fn().mockImplementation(({ data }: any) => {
        updates.push(data);
        return Promise.resolve({ ...stored(reservationOverrides), ...data });
      }),
    },
  };

  const service = Object.create(PublicAppraisalService.prototype) as PublicAppraisalService;
  (service as any).prisma = prisma;
  (service as any).storage = { uploadImage: jest.fn() };
  (service as any).pawnTickets = { createTicket };
  (service as any).logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };

  return { service, createTicket, updates, prisma };
};

describe('convertToTicket — the appraiser decides', () => {
  it('puts the inspected valuation on the ticket, not the online estimate', async () => {
    const { service, createTicket } = build();

    await service.convertToTicket('RSV-ABCDE-1234', revised() as never, 'staff-1', 'shop-1');

    const dto = createTicket.mock.calls[0][0];
    expect(dto.appraisedValue).toBe(17000);
  });

  it('puts the inspected loan on the ticket, not the online estimate', async () => {
    const { service, createTicket } = build();

    await service.convertToTicket('RSV-ABCDE-1234', revised() as never, 'staff-1', 'shop-1');

    expect(createTicket.mock.calls[0][0].loanAmount).toBe(11900);
    // The applicant's own 12127.50 must not survive into the contract.
    expect(createTicket.mock.calls[0][0].loanAmount).not.toBe(12127.5);
  });

  it('puts the weighed weight on the ticket, not the self-reported one', async () => {
    const { service, createTicket } = build();

    await service.convertToTicket('RSV-ABCDE-1234', revised() as never, 'staff-1', 'shop-1');

    expect(createTicket.mock.calls[0][0].weight).toBe(5.4);
  });

  it('delegates to the one ticket-creation path', async () => {
    const { service, createTicket } = build();

    await service.convertToTicket('RSV-ABCDE-1234', inspected() as never, 'staff-1', 'shop-1');

    // Not a parallel implementation. The state machine, interest arithmetic and
    // audit trail must behave identically whichever door the pawn came through.
    expect(createTicket).toHaveBeenCalledTimes(1);
    expect(createTicket.mock.calls[0][1]).toBe('staff-1');
  });

  it('carries the applicant and item details across', async () => {
    const { service, createTicket } = build();

    await service.convertToTicket('RSV-ABCDE-1234', inspected() as never, 'staff-1', 'shop-1');
    const dto = createTicket.mock.calls[0][0];

    expect(dto.customerName).toBe('Juan Dela Cruz');
    expect(dto.customerContact).toBe('09171234567');
    expect(dto.customerAddress).toBe('1 Mabini St, Imus');
    expect(dto.itemCategory).toBe('GOLD_JEWELRY');
    expect(dto.photoUrls).toEqual(['https://cdn.test/item.jpg']);
    expect(dto.pawnshopId).toBe('shop-1');
  });

  it('accepts a corrected category', async () => {
    const { service, createTicket } = build();

    await service.convertToTicket(
      'RSV-ABCDE-1234',
      inspected({ itemCategory: 'GOLD_COINS' }) as never,
      'staff-1',
      'shop-1',
    );

    expect(createTicket.mock.calls[0][0].itemCategory).toBe('GOLD_COINS');
  });
});

describe('convertToTicket — a revision must be explained', () => {
  it('refuses a revised figure with no reason given', async () => {
    const { service, createTicket } = build();

    // The pawner was told 12127.50 and would sign a contract for 11900. That gap
    // is exactly what a panel asks about, so it cannot be recorded silently.
    await expect(
      service.convertToTicket(
        'RSV-ABCDE-1234',
        { weight: 5.4, appraisedValue: 17000, loanAmount: 11900 } as never,
        'staff-1',
        'shop-1',
      ),
    ).rejects.toThrow(/record a reason for the revision/i);

    expect(createTicket).not.toHaveBeenCalled();
  });

  it('accepts a revised figure once a reason is recorded', async () => {
    const { service, createTicket } = build();

    await service.convertToTicket('RSV-ABCDE-1234', revised() as never, 'staff-1', 'shop-1');

    expect(createTicket).toHaveBeenCalled();
  });

  it('treats a blank reason as no reason', async () => {
    const { service, createTicket } = build();

    await expect(
      service.convertToTicket(
        'RSV-ABCDE-1234',
        revised({ revisionReason: '   ' }) as never,
        'staff-1',
        'shop-1',
      ),
    ).rejects.toThrow(/record a reason/i);
    expect(createTicket).not.toHaveBeenCalled();
  });

  it('writes the reason and the old figure onto the ticket', async () => {
    const { service, createTicket } = build();

    await service.convertToTicket('RSV-ABCDE-1234', revised() as never, 'staff-1', 'shop-1');

    const description = createTicket.mock.calls[0][0].itemDescription;
    expect(description).toMatch(/Hallmark reads 18K/);
    expect(description).toMatch(/12127\.50/);
  });

  it('needs no reason when the figures match the estimate', async () => {
    const { service, createTicket } = build();

    await service.convertToTicket('RSV-ABCDE-1234', inspected() as never, 'staff-1', 'shop-1');

    expect(createTicket).toHaveBeenCalled();
  });

  it('reports the revision so the shop can see what changed', async () => {
    const { service } = build();

    const result = await service.convertToTicket(
      'RSV-ABCDE-1234',
      revised({ revisionReason: 'Weight short by 0.1g' }) as never,
      'staff-1',
      'shop-1',
    );

    expect(result.revision).toEqual({
      onlineLoanAmount: 12127.5,
      onlineAppraisedValue: 17325,
      reason: 'Weight short by 0.1g',
    });
  });

  it('reports no revision when the figures agree', async () => {
    const { service } = build();

    const result = await service.convertToTicket(
      'RSV-ABCDE-1234',
      inspected() as never,
      'staff-1',
      'shop-1',
    );

    expect(result.revision).toBeNull();
  });

  it('treats a one-centavo difference as a revision', async () => {
    const { service, createTicket } = build();

    await expect(
      service.convertToTicket(
        'RSV-ABCDE-1234',
        { weight: 5.5, appraisedValue: 17325, loanAmount: 12127.51 } as never,
        'staff-1',
        'shop-1',
      ),
    ).rejects.toThrow(/record a reason/i);
    expect(createTicket).not.toHaveBeenCalled();
  });
});

describe('convertToTicket — the application cannot be reused', () => {
  it('refuses one that has already been converted', async () => {
    const { service, createTicket } = build({ convertedTicketId: 77 });

    await expect(
      service.convertToTicket('RSV-ABCDE-1234', inspected() as never, 'staff-1', 'shop-1'),
    ).rejects.toThrow(/already been converted/i);
    expect(createTicket).not.toHaveBeenCalled();
  });

  it('refuses one whose window has passed', async () => {
    const { service, createTicket } = build({
      expiresAt: new Date(Date.now() - 1000),
    });

    await expect(
      service.convertToTicket('RSV-ABCDE-1234', inspected() as never, 'staff-1', 'shop-1'),
    ).rejects.toThrow(/24-hour window on this application has passed/i);
    expect(createTicket).not.toHaveBeenCalled();
  });

  it('refuses one that was cancelled or declined', async () => {
    for (const status of ['CANCELLED', 'DECLINED']) {
      const { service, createTicket } = build({ status });
      await expect(
        service.convertToTicket('RSV-ABCDE-1234', inspected() as never, 'staff-1', 'shop-1'),
      ).rejects.toThrow(new RegExp(status.toLowerCase()));
      expect(createTicket).not.toHaveBeenCalled();
    }
  });

  it('reports an unknown reference as not found', async () => {
    const { service } = build();
    (service as any).prisma.pawnReservation.findUnique.mockResolvedValue(null);

    await expect(
      service.convertToTicket('RSV-NOPE-0000', inspected() as never, 'staff-1', 'shop-1'),
    ).rejects.toThrow(/no application matches/i);
  });
});

describe('convertToTicket — tenant scoping', () => {
  it('refuses a shop converting another shop’s application', async () => {
    const { service, createTicket } = build();

    // Otherwise any account holding `pawn_ticket.create` could create a ticket
    // against a customer who never walked into that branch.
    await expect(
      service.convertToTicket('RSV-ABCDE-1234', inspected() as never, 'staff-2', 'shop-2'),
    ).rejects.toThrow(/no application matches/i);
    expect(createTicket).not.toHaveBeenCalled();
  });

  it('answers 404 rather than 403, so a reference is not confirmed', async () => {
    const { service } = build();

    // A 403 would tell a competing shop that this reference exists.
    await expect(
      service.convertToTicket('RSV-ABCDE-1234', inspected() as never, 'staff-2', 'shop-2'),
    ).rejects.toThrow(/no application matches/i);
  });

  it('lets the platform operator convert any application', async () => {
    const { service, createTicket } = build();

    await service.convertToTicket(
      'RSV-ABCDE-1234',
      inspected() as never,
      'root-1',
      null,
    );

    expect(createTicket).toHaveBeenCalled();
  });
});

describe('convertToTicket — the record afterwards', () => {
  it('marks the application CONVERTED and links the ticket', async () => {
    const { service, updates } = build();

    await service.convertToTicket('RSV-ABCDE-1234', inspected() as never, 'staff-1', 'shop-1');

    expect(updates[0]).toMatchObject({ status: 'CONVERTED', convertedTicketId: 77 });
  });

  it('stamps who adjudicated the identity documents', async () => {
    const { service, updates } = build();

    await service.convertToTicket('RSV-ABCDE-1234', inspected() as never, 'staff-1', 'shop-1');

    // The applicant submitted ID documents; converting means a person judged
    // them, and that is worth recording. It is the difference between "we hold
    // documents" and "we checked them".
    expect(updates[0]).toMatchObject({ reviewedBy: 'staff-1' });
    expect(updates[0].reviewedAt).toBeInstanceOf(Date);
  });
});