import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { LoanService } from './loan.service';
import { PrismaService } from '../prisma.service';
import { FinanceService } from '../finance/finance.service';
import { LegalProofService } from './legal-proof.service';
import { ReceiptService } from '../receipt/receipt.service';
import { StateMachineService } from '../common/state-machine/state-machine.service';
import { NotificationService } from '../notification/notification.service';
import { TierService } from '../tier/tier.service';

/**
 * A renewal collects the interest the borrower accrued.
 *
 * `RenewLoanDto.interestAmount` used to be taken at face value and written
 * straight to the payment. That made the browser decide what a customer owed,
 * and the browser was computing `principal * 0.03` while the loan had been issued
 * at 3.5%. A renewal receipt that can be set by whoever is at the counter is not
 * an audit record, and the figure on it is the one a panel member will ask
 * about.
 *
 * The amount is now derived from the loan's own recorded rate, and a tender that
 * does not match is refused rather than quietly accepted.
 *
 * Two things the interest test could not have caught, and which this file also
 * covers because they live in the same method:
 *
 * - The ticket and the loan were fetched independently and never checked against
 *   each other, so a renewal could extend one pawn's dates while collecting
 *   another loan's interest.
 *
 * - The refusal check ran after the ticket had already been transitioned and its
 *   dates rewritten, so a renewal rejected for the wrong amount still granted the
 *   pawner 30 more days. A refusal has to leave the loan as it was found.
 */

const TICKET_ID = 501;
const LOAN_ID = 77;
const PAWNSHOP_ID = 'shop-1';

describe('renewLoan interest', () => {
  let service: LoanService;
  let prisma: Record<string, Record<string, jest.Mock>>;
  let stateMachine: { transition: jest.Mock };

  const baseTicket = {
    id: TICKET_ID,
    ticketNumber: 'TKT-9001',
    pawnshopId: PAWNSHOP_ID,
    customerId: 'cust-1',
    lifecycleStatus: 'ACTIVE',
    status: 'ACTIVE',
    expiryDate: new Date('2026-10-01T00:00:00.000Z'),
    customer: { fullName: 'Juan Dela Cruz' },
  };

  const makeLoan = (interestRate: number, principal = 10000) => ({
    id: LOAN_ID,
    principalAmount: principal,
    interestRate,
    // The ticket now arrives through the loan rather than as a second
    // independent lookup. `renewLoan` reads them as one record, because a
    // renewal that trusted two unrelated ids could extend one pawn's dates
    // while collecting another loan's interest.
    ticket: baseTicket,
  });

  const build = async (loan: ReturnType<typeof makeLoan>) => {
    prisma = {
      ticket: {
        update: jest.fn().mockResolvedValue(baseTicket),
      },
      loan: {
        findUnique: jest.fn().mockResolvedValue(loan),
        update: jest.fn().mockResolvedValue({}),
      },
      payment: { create: jest.fn().mockResolvedValue({ id: 'pay-1' }) },
      pawnshop: { findUnique: jest.fn().mockResolvedValue({ settings: {} }) },
    };
    stateMachine = { transition: jest.fn().mockResolvedValue(undefined) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        LoanService,
        { provide: PrismaService, useValue: prisma },
        { provide: FinanceService, useValue: { createEntry: jest.fn().mockResolvedValue({ id: 'led-1' }) } },
        { provide: LegalProofService, useValue: { createProof: jest.fn().mockResolvedValue({ id: 'proof-1' }) } },
        { provide: ReceiptService, useValue: { generateReceipt: jest.fn().mockResolvedValue({}) } },
        { provide: StateMachineService, useValue: stateMachine },
        { provide: NotificationService, useValue: { sendNotification: jest.fn().mockResolvedValue({}) } },
        { provide: TierService, useValue: { getTierForCustomer: jest.fn().mockResolvedValue({ tier: 'GOLD' }) } },
      ],
    }).compile();

    service = moduleRef.get(LoanService);
  };

  const renew = (interestAmount: number) =>
    service.renewLoan({
      ticketId: TICKET_ID,
      loanId: LOAN_ID,
      interestAmount,
      paymentMethod: 'CASH' as never,
      processedBy: 'staff-1',
    });

  it('collects the interest implied by the rate recorded on the loan', async () => {
    await build(makeLoan(0.035));
    await renew(350);

    const payment = prisma.payment.create.mock.calls[0][0].data;
    expect(payment.amount).toBe(350);
  });

  it('records the derived figure even when the counter tendered more', async () => {
    // The distinguishing case. A guard that only rejects an underpayment leaves
    // the write path unconstrained: swapping `expectedInterest` back for
    // `dto.interestAmount` survives every other test in this file, because they
    // all tender the exact figure. A customer who overpays a renewal is normal,
    // and what gets recorded must be the interest owed, not the cash in the
    // drawer.
    await build(makeLoan(0.035));
    await renew(500);

    expect(prisma.payment.create.mock.calls[0][0].data.amount).toBe(350);
  });

  it('records the derived figure for a shop that overpays at its own rate', async () => {
    await build(makeLoan(0.04));
    await renew(450);

    expect(prisma.payment.create.mock.calls[0][0].data.amount).toBe(400);
  });

  it('refuses a tender below the accrued interest', async () => {
    await build(makeLoan(0.035));
    // The exact figure the old redemption screen would have offered.
    await expect(renew(300)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.payment.create).not.toHaveBeenCalled();
  });

  it('names the figure it expected, so the counter is not left guessing', async () => {
    await build(makeLoan(0.035));
    await expect(renew(300)).rejects.toThrow(/350\.00/);
  });

  it('refuses a tender that is a centavo short', async () => {
    await build(makeLoan(0.035));
    await expect(renew(349.99)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('accepts a tender that covers the interest', async () => {
    await build(makeLoan(0.035));
    await expect(renew(400)).resolves.toBeDefined();
  });

  it('honours a shop that issued at its own configured rate', async () => {
    // The multi-tenant case: this shop issues at 4%, so 4% is what a renewal
    // collects. Hardcoding the platform default would undercharge this shop.
    await build(makeLoan(0.04));
    await expect(renew(350)).rejects.toBeInstanceOf(BadRequestException);
    await expect(renew(400)).resolves.toBeDefined();
  });

  it('falls back to the platform default for a loan with no usable rate', async () => {
    // A pre-migration row: `interestrate` did not exist, so the column default
    // applies. Better than charging nothing or refusing every renewal.
    await build(makeLoan(0));
    await expect(renew(350)).resolves.toBeDefined();
  });

  it('records the derived interest, not the cash tendered, on a shop-specific rate', async () => {
    // Guards the multi-tenant read specifically. Swapping `loan.interestRate`
    // for the platform default inside renewLoan leaves every other test here
    // passing - they all issue at 3.5% - and quietly undercharges every shop
    // that configured its own pricing. Only a loan at a non-default rate can
    // observe it.
    await build(makeLoan(0.04));
    await renew(400);

    expect(prisma.payment.create.mock.calls[0][0].data.amount).toBe(400);
  });

  it('refuses a renewal priced at the platform default on a 4% loan', async () => {
    // The same defect from the other direction: if the recorded rate were
    // ignored, 3.5% of 10,000 (350) would be accepted on a loan that owes 400.
    await build(makeLoan(0.04));
    await expect(renew(350)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.payment.create).not.toHaveBeenCalled();
  });

  it('extends the maturity date by the standard renewal window', async () => {
    await build(makeLoan(0.035));
    await renew(350);

    const update = prisma.ticket.update.mock.calls[0][0].data;
    // Measured from the moment of renewal, not from the previous maturity date.
    //
    // The service used to do `newExpiry.setDate(getDate() + 30)` on a fresh
    // `now`, and this test first compared it against the ticket's old expiry -
    // which is two days away in this fixture, so it read 28. The assertion is on
    // the behaviour that matters: a renewal buys 30 days from today, and the
    // previous maturity is not what the borrower is charged for.
    const now = new Date();
    const extended = new Date(update.expiryDate);
    const daysFromNow = Math.round(
      (Date.UTC(extended.getFullYear(), extended.getMonth(), extended.getDate()) -
        Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) /
        86_400_000,
    );
    expect(daysFromNow).toBe(30);
  });

  it('places the statutory grace period and forfeiture after the extended maturity', async () => {
    await build(makeLoan(0.035));
    await renew(350);

    const update = prisma.ticket.update.mock.calls[0][0].data;
    const grace = new Date(update.gracePeriodEnd);
    const forfeiture = new Date(update.forfeitureDate);
    const graceDays = Math.round((grace.getTime() - new Date(update.expiryDate).getTime()) / 86_400_000);
    const forfeitDays = Math.round((forfeiture.getTime() - grace.getTime()) / 86_400_000);

    // 90 days is P.D. 114 Section 13. A renewal inherits the statutory window:
    // extending the term must not shorten the redemption right, and a borrower
    // who renews a day before forfeiture should be returned the full 90 days
    // rather than inheriting whatever remained.
    expect(graceDays).toBe(90);
    expect(forfeitDays).toBe(15);
  });

  it('refuses a loan that belongs to a different ticket', async () => {
    // The endpoint took a ticketId and a loanId and trusted both. Nothing
    // checked they were related, so a renewal could extend one pawn's dates
    // while collecting another loan's interest - leaving a payment pointing at
    // one loan and a proof and receipt pointing at the other.
    await build(makeLoan(0.035));
    await expect(
      service.renewLoan({
        ticketId: TICKET_ID + 1,
        loanId: LOAN_ID,
        interestAmount: 350,
        paymentMethod: 'CASH' as never,
        processedBy: 'staff-1',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.ticket.update).not.toHaveBeenCalled();
  });

  it('refuses a loan with no ticket attached', async () => {
    await build({ ...makeLoan(0.035), ticket: null });
    await expect(renew(350)).rejects.toThrow(/not attached to a pawn ticket/i);
    expect(prisma.ticket.update).not.toHaveBeenCalled();
  });

  it('leaves the loan untouched when the tender is refused', async () => {
    // The ordering bug. Validation used to run AFTER the ticket had been
    // transitioned to ACTIVE with its expiry, grace and forfeiture dates
    // rewritten, so a renewal rejected for the wrong amount still handed the
    // pawner another 30 days - and buried the mismatch in the database with no
    // payment, no receipt and no proof to show for it.
    await build(makeLoan(0.035));
    await expect(renew(10)).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.ticket.update).not.toHaveBeenCalled();
    expect(prisma.loan.update).not.toHaveBeenCalled();
    expect(stateMachine.transition).not.toHaveBeenCalled();
    expect(prisma.payment.create).not.toHaveBeenCalled();
  });

  it('leaves a grace-period loan in grace when the tender is refused', async () => {
    // The state machine transition is the most damaging write of the three: an
    // OVERDUE or GRACE_PERIOD ticket that a refused renewal had already pulled
    // back to ACTIVE would stop counting toward forfeiture.
    prisma = undefined as never;
    await build({
      ...makeLoan(0.035),
      ticket: { ...baseTicket, lifecycleStatus: 'GRACE_PERIOD' },
    });
    await expect(renew(1)).rejects.toBeInstanceOf(BadRequestException);
    expect(stateMachine.transition).not.toHaveBeenCalled();
    expect(prisma.ticket.update).not.toHaveBeenCalled();
  });
});

describe('quoteRenewal', () => {
  let service: LoanService;
  let prisma: Record<string, Record<string, jest.Mock>>;

  const TICKET_ID = 500;
  const LOAN_ID = 900;
  const PAWNSHOP_ID = 'shop-1';

  const ticket = {
    id: TICKET_ID,
    ticketNumber: 'TKT-9001',
    pawnshopId: PAWNSHOP_ID,
    customerId: 'cust-1',
    lifecycleStatus: 'ACTIVE',
    status: 'ACTIVE',
    expiryDate: new Date('2026-10-01T00:00:00.000Z'),
    gracePeriodEnd: new Date('2026-12-30T00:00:00.000Z'),
    forfeitureDate: new Date('2027-01-14T00:00:00.000Z'),
    customer: { fullName: 'Juan Dela Cruz' },
  };

  const build = async (interestRate: number | null, principal = 10000) => {
    prisma = {
      ticket: { update: jest.fn().mockResolvedValue(ticket) },
      loan: {
        findUnique: jest.fn().mockResolvedValue({
          id: LOAN_ID,
          principalAmount: principal,
          interestRate,
          ticket,
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      payment: { create: jest.fn().mockResolvedValue({ id: 'pay-1' }) },
      pawnshop: { findUnique: jest.fn().mockResolvedValue({ settings: {} }) },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        LoanService,
        { provide: PrismaService, useValue: prisma },
        { provide: FinanceService, useValue: { createEntry: jest.fn() } },
        { provide: LegalProofService, useValue: { createProof: jest.fn() } },
        { provide: ReceiptService, useValue: { generateReceipt: jest.fn() } },
        { provide: StateMachineService, useValue: { transition: jest.fn() } },
        { provide: NotificationService, useValue: { sendNotification: jest.fn() } },
        { provide: TierService, useValue: { getTierForCustomer: jest.fn() } },
      ],
    }).compile();

    service = moduleRef.get(LoanService);
  };

  /**
   * The quote exists because `renewLoan` refuses a tender that does not settle
   * the accrued interest. Without it the only way for the screen to learn the
   * figure was to guess, take a 400, and read the number out of the error
   * message - which is exactly the state in which a teller is reading money
   * off an exception rather than off the system.
   */
  it('quotes the same figure the renewal will demand', async () => {
    await build(0.035);
    const quote = await service.quoteRenewal(LOAN_ID);
    expect(quote.interestDue).toBe(350);

    // And a tender of that figure is accepted.
    await build(0.035);
    await expect(
      service.renewLoan({
        ticketId: TICKET_ID,
        loanId: LOAN_ID,
        interestAmount: quote.interestDue,
        paymentMethod: 'CASH' as never,
        processedBy: 'staff-1',
      }),
    ).resolves.toMatchObject({ interestPaid: 350 });
  });

  it('quotes at the rate recorded on the loan, not the platform default', async () => {
    await build(0.04);
    expect((await service.quoteRenewal(LOAN_ID)).interestDue).toBe(400);
  });

  it('falls back to the default for a loan with no usable rate', async () => {
    await build(null);
    expect((await service.quoteRenewal(LOAN_ID)).interestDue).toBe(350);
  });

  it('states the dates the renewal would produce, so the customer is told', async () => {
    await build(0.035);
    const quote = await service.quoteRenewal(LOAN_ID);

    expect(quote.extensionDays).toBe(30);
    const days = (a: Date, b: Date) =>
      Math.round((a.getTime() - b.getTime()) / 86_400_000);
    expect(days(new Date(quote.newGracePeriodEnd), new Date(quote.newExpiry))).toBe(90);
    expect(days(new Date(quote.newForfeitureDate), new Date(quote.newGracePeriodEnd))).toBe(15);
  });

  it('writes nothing', async () => {
    await build(0.035);
    await service.quoteRenewal(LOAN_ID);
    expect(prisma.loan.update).not.toHaveBeenCalled();
    expect(prisma.ticket.update).not.toHaveBeenCalled();
    expect(prisma.payment.create).not.toHaveBeenCalled();
  });

  it('refuses to quote a ticket that cannot be renewed', async () => {
    await build(0.035);
    prisma.loan.findUnique.mockResolvedValue({
      id: LOAN_ID,
      principalAmount: 10000,
      interestRate: 0.035,
      ticket: { ...ticket, lifecycleStatus: 'REDEEMED' },
    });
    await expect(service.quoteRenewal(LOAN_ID)).rejects.toThrow(/cannot be renewed/i);
  });
});
