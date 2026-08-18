import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { PawnTicketService } from './pawn-ticket.service';
import { LegalProofService } from './legal-proof.service';
import { LoanContractService } from './loan-contract.service';
import { StateMachineService } from '../common/state-machine/state-machine.service';
import { ReceiptService } from '../receipt/receipt.service';
import { FinanceService } from '../finance/finance.service';
import { NotificationService } from '../notification/notification.service';
import { TierService } from '../tier/tier.service';
import { PrismaService } from '../prisma.service';

const mockPrisma = {
  ticket: {
    findUnique: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
  },
  customer: {
    update: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
  },
  loan: { update: jest.fn(), create: jest.fn() },
  loanApplication: { create: jest.fn() },
  payment: { create: jest.fn() },
  approvalRecord: { create: jest.fn(), findFirst: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
};

const mockLegalProofService = { createProof: jest.fn().mockResolvedValue({ id: 'proof-1' }) };
const mockLoanContractService = {
  getContractTemplate: jest.fn(),
  createLoanContract: jest.fn(),
  generateContractForApplication: jest.fn().mockResolvedValue({ id: 'contract_1', contractNumber: 'CT-1' }),
};
const mockStateMachine = { transition: jest.fn().mockResolvedValue(true) };
const mockReceiptService = { generateReceipt: jest.fn().mockResolvedValue({ id: 'rcpt-1' }) };
const mockFinanceService = { createEntry: jest.fn().mockResolvedValue({ id: 'ledger-1' }) };
const mockNotificationService = { sendNotification: jest.fn().mockResolvedValue({ id: 'notif-1' }) };
const mockTierService = { recomputeCustomerTier: jest.fn().mockResolvedValue(null) };

describe('PawnTicketService', () => {
  let service: PawnTicketService;

  const baseTicket = {
    id: 100,
    ticketNumber: 'TKT-100',
    pawnshopId: 'ps_1',
    customerId: 'cust_1',
    lifecycleStatus: 'RECEIVED',
    status: 'RECEIVED',
    loanAmount: 0,
    isHighRisk: false,
    category: 'JEWELRY',
    customer: { id: 'cust_1', fullName: 'John Doe', kycStatus: 'VERIFIED' },
    loans: [],
    pawnshop: { settings: {} },
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      providers: [
        PawnTicketService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: LegalProofService, useValue: mockLegalProofService },
        { provide: LoanContractService, useValue: mockLoanContractService },
        { provide: StateMachineService, useValue: mockStateMachine },
        { provide: ReceiptService, useValue: mockReceiptService },
        { provide: FinanceService, useValue: mockFinanceService },
        { provide: NotificationService, useValue: mockNotificationService },
        { provide: TierService, useValue: mockTierService },
      ],
    }).compile();

    service = module.get(PawnTicketService);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockLegalProofService.createProof.mockResolvedValue({ id: 'proof-1' });
    mockReceiptService.generateReceipt.mockResolvedValue({ id: 'rcpt-1' });
    mockFinanceService.createEntry.mockResolvedValue({ id: 'ledger-1' });
    mockNotificationService.sendNotification.mockResolvedValue({ id: 'notif-1' });
    mockStateMachine.transition.mockResolvedValue(true);
    mockPrisma.approvalRecord.findFirst.mockResolvedValue(null);
  });

  describe('appraiseTicket', () => {
    it('holds the ticket in PENDING_APPROVAL and creates an APPRAISAL approval record without finalizing loanAmount', async () => {
      mockPrisma.ticket.findUnique.mockResolvedValue(baseTicket);
      mockPrisma.ticket.update.mockResolvedValue({ ...baseTicket, lifecycleStatus: 'PENDING_APPROVAL' });
      mockPrisma.approvalRecord.create.mockResolvedValue({
        id: 'rec_1',
        pawnshopId: 'ps_1',
        targetType: 'APPRAISAL',
        targetId: '100',
        status: 'PENDING',
        amount: 25000,
      });

      const result = await service.appraiseTicket(
        100,
        {
          appraisedValue: 25000,
          riskScore: 30,
          recommendedLoanAmount: 18000,
          itemCondition: 'GOOD',
          appraisalNotes: 'ok',
        },
        'appraiser_1',
        'APPRAISER',
      );

      expect(mockStateMachine.transition).toHaveBeenCalledWith(
        'TICKET_LIFECYCLE',
        'RECEIVED',
        'PENDING_APPROVAL',
        { userRole: 'APPRAISER' },
      );
      expect(mockPrisma.ticket.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 100 },
          data: expect.objectContaining({ lifecycleStatus: 'PENDING_APPROVAL' }),
        }),
      );
      expect(mockPrisma.ticket.update.mock.calls[0][0].data.loanAmount).toBeUndefined();
      expect(mockPrisma.approvalRecord.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            pawnshopId: 'ps_1',
            targetType: 'APPRAISAL',
            targetId: '100',
            status: 'PENDING',
            amount: 25000,
            requestedById: 'appraiser_1',
            payload: expect.objectContaining({
              ticketId: 100,
              ticketNumber: 'TKT-100',
              appraisedValue: 25000,
              riskScore: 30,
              recommendedLoanAmount: 18000,
              itemCondition: 'GOOD',
              appraisalNotes: 'ok',
            }),
          }),
        }),
      );
      expect(result).toEqual(
        expect.objectContaining({ lifecycleStatus: 'PENDING_APPROVAL', recommendedLoanAmount: 18000 }),
      );
    });
  });

  describe('redeemTicket', () => {
    it('requires owner approval for every redemption, holds the ticket in REDEMPTION_PENDING_APPROVAL, and releases nothing', async () => {
      const activeTicket = {
        ...baseTicket,
        lifecycleStatus: 'ACTIVE',
        status: 'ACTIVE',
        loans: [{ id: 55, status: 'ACTIVE' }],
        pawnshop: { settings: { redemptionApprovalThreshold: 50000 } },
      };
      mockPrisma.ticket.findUnique.mockResolvedValue(activeTicket);
      mockPrisma.approvalRecord.create.mockResolvedValue({ id: 'rec_2', status: 'PENDING' });
      mockPrisma.ticket.update.mockResolvedValue({
        ...activeTicket,
        lifecycleStatus: 'REDEMPTION_PENDING_APPROVAL',
      });

      const result = await service.redeemTicket(
        100,
        { amountPaid: 40000, paymentMethod: 'CASH' },
        'teller_1',
        'CASHIER_TELLER',
      );

      expect(mockPrisma.approvalRecord.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            pawnshopId: 'ps_1',
            targetType: 'REDEMPTION',
            targetId: '100',
            status: 'PENDING',
            amount: 40000,
            requestedById: 'teller_1',
            payload: expect.objectContaining({
              ticketId: 100,
              ticketNumber: 'TKT-100',
              amountPaid: 40000,
              paymentMethod: 'CASH',
              previousLifecycleStatus: 'ACTIVE',
            }),
          }),
        }),
      );
      expect(mockStateMachine.transition).toHaveBeenCalledWith(
        'TICKET_LIFECYCLE',
        'ACTIVE',
        'REDEMPTION_PENDING_APPROVAL',
        { userRole: 'CASHIER_TELLER' },
      );
      expect(mockPrisma.ticket.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 100 },
          data: expect.objectContaining({ lifecycleStatus: 'REDEMPTION_PENDING_APPROVAL' }),
        }),
      );
      expect(mockPrisma.payment.create).not.toHaveBeenCalled();
      expect(mockPrisma.loan.update).not.toHaveBeenCalled();
      expect(result).toEqual(
        expect.objectContaining({
          approvalStatus: 'PENDING',
          lifecycleStatus: 'REDEMPTION_PENDING_APPROVAL',
          requiresApproval: true,
        }),
      );
    });

    it('throws BadRequestException when a redemption is already pending approval', async () => {
      const activeTicket = {
        ...baseTicket,
        lifecycleStatus: 'ACTIVE',
        status: 'ACTIVE',
        loans: [{ id: 55, status: 'ACTIVE' }],
        pawnshop: { settings: {} },
      };
      mockPrisma.ticket.findUnique.mockResolvedValue(activeTicket);
      mockPrisma.approvalRecord.findFirst.mockResolvedValue({ id: 'rec_2', status: 'PENDING' });

      await expect(
        service.redeemTicket(
          100,
          { amountPaid: 40000, paymentMethod: 'CASH' },
          'teller_1',
          'CASHIER_TELLER',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(mockPrisma.approvalRecord.create).not.toHaveBeenCalled();
      expect(mockPrisma.payment.create).not.toHaveBeenCalled();
    });
  });

  describe('approval orchestration', () => {
    it('applyApprovedAppraisal writes the approved loanAmount then delegates to approveWithContract for the offer flow', async () => {
      mockPrisma.ticket.findUnique.mockResolvedValue({ ...baseTicket, lifecycleStatus: 'PENDING_APPROVAL' });
      mockPrisma.ticket.update.mockResolvedValue({
        ...baseTicket,
        lifecycleStatus: 'OFFER_MADE',
        loanAmount: 18000,
      });
      mockPrisma.loanApplication.create.mockResolvedValue({ id: 'la_1' });
      mockPrisma.loan.create.mockResolvedValue({ id: 'loan_1' });

      const result = await service.applyApprovedAppraisal(
        100,
        { recommendedLoanAmount: 18000, riskScore: 30 },
        'mgr_1',
      );

      expect(mockPrisma.ticket.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 100 },
          data: expect.objectContaining({ loanAmount: 18000, isHighRisk: false }),
        }),
      );
      expect(mockStateMachine.transition).toHaveBeenCalledWith(
        'TICKET_LIFECYCLE',
        'PENDING_APPROVAL',
        'OFFER_MADE',
        { userRole: undefined },
      );
      expect(mockPrisma.loanApplication.create).toHaveBeenCalled();
      expect(mockPrisma.loan.create).toHaveBeenCalled();
      expect(mockLoanContractService.generateContractForApplication).toHaveBeenCalled();
      expect(mockLegalProofService.createProof).toHaveBeenCalledWith(
        expect.objectContaining({ recordType: 'CONTRACT_PROOF', ticketId: 100 }),
      );
      expect(result).toEqual(
        expect.objectContaining({ lifecycleStatus: 'OFFER_MADE', loanAmount: 18000 }),
      );
    });

    it('rejects the approval when the ticket is not PENDING_APPROVAL', async () => {
      mockPrisma.ticket.findUnique.mockResolvedValue({ ...baseTicket, lifecycleStatus: 'OFFER_MADE' });

      await expect(
        service.applyApprovedAppraisal(100, { recommendedLoanAmount: 18000 }, 'mgr_1'),
      ).rejects.toThrow('Must be PENDING_APPROVAL');
    });

    it('releaseApprovedRedemption routes approved redemptions through the shared release body', async () => {
      mockPrisma.ticket.findUnique.mockResolvedValue({
        ...baseTicket,
        lifecycleStatus: 'REDEMPTION_PENDING_APPROVAL',
        status: 'ACTIVE',
        loans: [{ id: 55, status: 'ACTIVE' }],
        pawnshop: { settings: {} },
      });
      mockPrisma.ticket.update.mockResolvedValue({ ...baseTicket, lifecycleStatus: 'REDEEMED', status: 'REDEEMED' });
      mockPrisma.loan.update.mockResolvedValue({ id: 55, status: 'REDEEMED' });
      mockPrisma.payment.create.mockResolvedValue({ id: 'pay_2' });

      const result = await service.releaseApprovedRedemption(
        100,
        { amountPaid: 60000, paymentMethod: 'CASH' },
        'mgr_1',
      );

      expect(mockStateMachine.transition).toHaveBeenCalledWith(
        'TICKET_LIFECYCLE',
        'REDEMPTION_PENDING_APPROVAL',
        'REDEEMED',
        { userRole: undefined },
      );
      expect(mockPrisma.payment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ amount: 60000, paymentType: 'LOAN_REPAYMENT' }),
        }),
      );
      expect(result).toEqual(expect.objectContaining({ lifecycleStatus: 'REDEEMED', amountPaid: 60000 }));
    });

    it('rejects the release when the ticket is not REDEMPTION_PENDING_APPROVAL, ACTIVE, or GRACE_PERIOD', async () => {
      mockPrisma.ticket.findUnique.mockResolvedValue({
        ...baseTicket,
        lifecycleStatus: 'RECEIVED',
        loans: [{ id: 55, status: 'RECEIVED' }],
      });

      await expect(
        service.releaseApprovedRedemption(100, { amountPaid: 60000, paymentMethod: 'CASH' }, 'mgr_1'),
      ).rejects.toThrow('Must be REDEMPTION_PENDING_APPROVAL, ACTIVE, or GRACE_PERIOD');
    });

    it('rejectAppraisal returns the ticket to RECEIVED', async () => {
      mockPrisma.ticket.findUnique.mockResolvedValue({ ...baseTicket, lifecycleStatus: 'PENDING_APPROVAL' });
      mockPrisma.ticket.update.mockResolvedValue({ ...baseTicket, lifecycleStatus: 'RECEIVED' });

      const result = await service.rejectAppraisal(100, 'MANAGER');

      expect(mockStateMachine.transition).toHaveBeenCalledWith(
        'TICKET_LIFECYCLE',
        'PENDING_APPROVAL',
        'RECEIVED',
        { userRole: 'MANAGER' },
      );
      expect(mockPrisma.ticket.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ lifecycleStatus: 'RECEIVED' }) }),
      );
      expect(result).toEqual(expect.objectContaining({ lifecycleStatus: 'RECEIVED' }));
    });

    it('rejectRedemption restores an ACTIVE ticket after a redemption request is rejected', async () => {
      mockPrisma.ticket.findUnique.mockResolvedValue({
        ...baseTicket,
        lifecycleStatus: 'REDEMPTION_PENDING_APPROVAL',
        status: 'ACTIVE',
      });
      mockPrisma.approvalRecord.findFirst.mockResolvedValue({
        id: 'rec_2',
        pawnshopId: 'ps_1',
        targetType: 'REDEMPTION',
        targetId: '100',
        status: 'PENDING',
        payload: { ticketId: 100, ticketNumber: 'TKT-100', previousLifecycleStatus: 'ACTIVE' },
      });
      mockPrisma.ticket.update.mockResolvedValue({ ...baseTicket, lifecycleStatus: 'ACTIVE' });

      const result = await service.rejectRedemption(100, 'OWNER');

      expect(mockStateMachine.transition).toHaveBeenCalledWith(
        'TICKET_LIFECYCLE',
        'REDEMPTION_PENDING_APPROVAL',
        'ACTIVE',
        { userRole: 'OWNER' },
      );
      expect(mockPrisma.ticket.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 100 },
          data: expect.objectContaining({ lifecycleStatus: 'ACTIVE' }),
        }),
      );
      expect(result).toEqual(expect.objectContaining({ lifecycleStatus: 'ACTIVE' }));
    });

    it('rejectRedemption restores a GRACE_PERIOD ticket when the request originated from grace period', async () => {
      mockPrisma.ticket.findUnique.mockResolvedValue({
        ...baseTicket,
        lifecycleStatus: 'REDEMPTION_PENDING_APPROVAL',
        status: 'GRACE_PERIOD',
      });
      mockPrisma.approvalRecord.findFirst.mockResolvedValue({
        id: 'rec_3',
        pawnshopId: 'ps_1',
        targetType: 'REDEMPTION',
        targetId: '100',
        status: 'PENDING',
        payload: { ticketId: 100, ticketNumber: 'TKT-100', previousLifecycleStatus: 'GRACE_PERIOD' },
      });
      mockPrisma.ticket.update.mockResolvedValue({ ...baseTicket, lifecycleStatus: 'GRACE_PERIOD' });

      const result = await service.rejectRedemption(100, 'OWNER');

      expect(mockStateMachine.transition).toHaveBeenCalledWith(
        'TICKET_LIFECYCLE',
        'REDEMPTION_PENDING_APPROVAL',
        'GRACE_PERIOD',
        { userRole: 'OWNER' },
      );
      expect(result).toEqual(expect.objectContaining({ lifecycleStatus: 'GRACE_PERIOD' }));
    });

    it('rejectRedemption throws when the ticket is not awaiting redemption approval', async () => {
      mockPrisma.ticket.findUnique.mockResolvedValue({
        ...baseTicket,
        lifecycleStatus: 'ACTIVE',
      });

      await expect(service.rejectRedemption(100, 'OWNER')).rejects.toThrow(
        'Must be REDEMPTION_PENDING_APPROVAL',
      );
    });
  });

  describe('createTicket without KYC enforcement', () => {
    const dto = {
      customerName: 'John Doe',
      customerContact: '09171234567',
      customerAddress: 'Dasmarinas, Cavite',
      pawnshopId: 'ps_1',
      itemCategory: 'JEWELRY',
      itemDescription: 'Gold ring',
      weight: 5,
      loanAmount: 10000,
      appraisalDeadline: '2026-12-31',
    };

    it('creates a ticket even when the customer KYC is NOT_SUBMITTED', async () => {
      mockPrisma.customer.findFirst.mockResolvedValue(null);
      mockPrisma.customer.create.mockResolvedValue({ id: 'cust_1' });
      mockPrisma.ticket.create.mockResolvedValue({
        id: 1,
        ticketNumber: 'TKT-1',
        customerId: 'cust_1',
        status: 'PENDING',
        lifecycleStatus: 'RECEIVED',
      });

      const result = await service.createTicket(dto, 'staff_1');

      expect(mockPrisma.ticket.create).toHaveBeenCalled();
      expect(result).toEqual(
        expect.objectContaining({ customerId: 'cust_1', status: 'PENDING' }),
      );
    });
  });

  describe('approveWithContract without KYC enforcement', () => {
    it('proceeds through the offer flow regardless of customer KYC status', async () => {
      mockPrisma.ticket.findUnique.mockResolvedValue({
        ...baseTicket,
        lifecycleStatus: 'APPRAISED',
        customer: { id: 'cust_1', fullName: 'John Doe', kycStatus: 'NOT_SUBMITTED' },
      });
      mockPrisma.loanApplication.create.mockResolvedValue({ id: 'la_1' });
      mockPrisma.loan.create.mockResolvedValue({ id: 'loan_1' });
      mockPrisma.ticket.update.mockResolvedValue({ ...baseTicket, lifecycleStatus: 'OFFER_MADE' });

      const result = await service.approveWithContract(100, 'mgr_1', 'MANAGER');

      expect(mockStateMachine.transition).toHaveBeenCalledWith(
        'TICKET_LIFECYCLE',
        'APPRAISED',
        'OFFER_MADE',
        { userRole: 'MANAGER' },
      );
      expect(mockLoanContractService.generateContractForApplication).toHaveBeenCalled();
      expect(result).toEqual(expect.objectContaining({ lifecycleStatus: 'OFFER_MADE' }));
    });
  });
});
