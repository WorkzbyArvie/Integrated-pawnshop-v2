import { UserLoansService } from './user-loans.service';
import { PrismaService } from '../prisma.service';
import { PaymongoService } from '../subscription/paymongo.service';
import { FinanceService } from '../finance/finance.service';

type TicketDelegateMock = {
  findMany: jest.Mock;
  findFirst: jest.Mock;
};

describe('UserLoansService', () => {
  const prismaMock: { ticket: TicketDelegateMock } = {
    ticket: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
  };
  const paymongoMock: {
    isEnabled: boolean;
    createPaymentLink: jest.Mock;
  } = {
    isEnabled: true,
    createPaymentLink: jest.fn(),
  };
  const financeMock = {
    createEntry: jest.fn(),
  };

  let service: UserLoansService;

  beforeEach(() => {
    jest.clearAllMocks();
    paymongoMock.isEnabled = true;
    service = new UserLoansService(
      prismaMock as unknown as PrismaService,
      paymongoMock as unknown as PaymongoService,
      financeMock as unknown as FinanceService,
      { createProof: jest.fn() } as any,
      { generateReceipt: jest.fn() } as any,
      { transition: jest.fn() } as any,
    );
  });

  it('maps ticket/loan data into mobile loan item format', async () => {
    const now = Date.now();
    prismaMock.ticket.findMany.mockResolvedValue([
      {
        id: 101,
        ticketNumber: 'TKT-101',
        description: 'Gold Necklace 18K',
        category: 'Gold Jewelry',
        loanAmount: 10000,
        status: 'ACTIVE',
        pawnDate: new Date(now - 5 * 86400000),
        expiryDate: new Date(now + 10 * 86400000),
        loans: [
          { principalAmount: 10000, interestAmount: 350, status: 'ACTIVE' },
        ],
      },
    ]);

    const items = await service.getMyLoanItems('user-1');

    expect(prismaMock.ticket.findMany).toHaveBeenCalledTimes(1);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      ticketId: 101,
      ticketNumber: 'TKT-101',
      itemName: 'Gold Necklace 18K',
      category: 'Gold Jewelry',
      loanAmount: 10000,
      totalDue: 10350,
      status: 'ACTIVE',
    });
    expect(typeof items[0].progress).toBe('number');
    expect(typeof items[0].daysRemaining).toBe('number');
  });

  it('falls back to ticket loan amount when no active loan row exists', async () => {
    prismaMock.ticket.findMany.mockResolvedValue([
      {
        id: 202,
        ticketNumber: 'TKT-202',
        description: null,
        category: 'Electronics',
        loanAmount: 20000,
        status: 'PENDING',
        pawnDate: new Date(),
        expiryDate: new Date(Date.now() + 20 * 86400000),
        loans: [],
      },
    ]);

    const items = await service.getMyLoanItems('user-2');

    expect(items[0].itemName).toBe('Electronics');
    expect(items[0].totalDue).toBe(Math.round(20000 * 1.035));
  });

  it('creates checkout link for owned ticket', async () => {
    prismaMock.ticket.findFirst.mockResolvedValue({
      id: 303,
      ticketNumber: 'TKT-303',
      description: 'Gold Ring',
      loanAmount: 10000,
      customer: { fullName: 'Test Bidder' },
      loans: [{ principalAmount: 10000, interestAmount: 500 }],
    });
    paymongoMock.createPaymentLink.mockResolvedValue({
      linkId: 'plink_123',
      checkoutUrl: 'https://paymongo.test/checkout/123',
    });

    const result = await service.createPayLinkForTicket('user-1', 303);

    expect(paymongoMock.createPaymentLink).toHaveBeenCalledWith(
      expect.objectContaining({
        amountCentavos: 1050000,
        description: 'PAWN_TICKET:303',
      }),
    );
    expect(result).toMatchObject({
      ticketId: 303,
      paymentLinkId: 'plink_123',
      checkoutReferenceId: 'plink_123',
      checkoutUrl: 'https://paymongo.test/checkout/123',
    });
  });

  it('throws when checkout provider is disabled', async () => {
    prismaMock.ticket.findFirst.mockResolvedValue({
      id: 404,
      ticketNumber: 'TKT-404',
      description: 'Watch',
      loanAmount: 5000,
      customer: { fullName: 'Test Bidder' },
      loans: [],
    });
    paymongoMock.isEnabled = false;

    await expect(service.createPayLinkForTicket('user-1', 404)).rejects.toThrow(
      'Checkout provider is not configured on backend',
    );
  });
});
