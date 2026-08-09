import { Test } from '@nestjs/testing';
import { ConflictException, NotFoundException, BadRequestException } from '@nestjs/common';
import { LoanService } from './loan.service';
import { FinanceService } from '../finance/finance.service';
import { LegalProofService } from './legal-proof.service';
import { ReceiptService } from '../receipt/receipt.service';
import { StateMachineService } from '../common/state-machine/state-machine.service';
import { NotificationService } from '../notification/notification.service';
import { PrismaService } from '../prisma.service';

const mockPrisma = {
  loan: { findUnique: jest.fn(), update: jest.fn(), create: jest.fn() },
  ticket: { update: jest.fn() },
  approvalRecord: { findFirst: jest.fn(), update: jest.fn() },
};

const mockFinanceService = { createEntry: jest.fn().mockResolvedValue({ id: 'ledger-1' }) };
const mockLegalProofService = { createProof: jest.fn().mockResolvedValue({ id: 'proof-1' }) };
const mockReceiptService = { generateReceipt: jest.fn().mockResolvedValue({ id: 'rcpt-1' }) };
const mockStateMachine = { transition: jest.fn().mockResolvedValue(true) };
const mockNotificationService = { sendNotification: jest.fn().mockResolvedValue({ id: 'notif-1' }) };

describe('LoanService', () => {
  let service: LoanService;

  const baseLoan = {
    id: 1,
    principalAmount: 10000,
    interestAmount: 350,
    status: 'RECEIVED',
    customerName: 'John Doe',
    ticket: {
      id: 100,
      ticketNumber: 'TKT-100',
      customerId: 'cust_1',
      pawnshopId: 'ps_1',
      lifecycleStatus: 'OFFER_MADE',
      customer: { id: 'cust_1', fullName: 'John Doe', kycStatus: 'VERIFIED' },
    },
    application: { pawnshopId: 'ps_1' },
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      providers: [
        LoanService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: FinanceService, useValue: mockFinanceService },
        { provide: LegalProofService, useValue: mockLegalProofService },
        { provide: ReceiptService, useValue: mockReceiptService },
        { provide: StateMachineService, useValue: mockStateMachine },
        { provide: NotificationService, useValue: mockNotificationService },
      ],
    }).compile();

    service = module.get(LoanService);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockFinanceService.createEntry.mockResolvedValue({ id: 'ledger-1' });
    mockLegalProofService.createProof.mockResolvedValue({ id: 'proof-1' });
    mockReceiptService.generateReceipt.mockResolvedValue({ id: 'rcpt-1' });
    mockStateMachine.transition.mockResolvedValue(true);
    mockNotificationService.sendNotification.mockResolvedValue({ id: 'notif-1' });
    mockPrisma.approvalRecord.findFirst.mockResolvedValue(null);
  });

  describe('disburseLoan KYC gate', () => {
    it('rejects a loan whose customer is not VERIFIED with a 409 ConflictException and never transitions', async () => {
      mockPrisma.loan.findUnique.mockResolvedValue({
        ...baseLoan,
        ticket: {
          ...baseLoan.ticket,
          customer: { id: 'cust_1', fullName: 'John Doe', kycStatus: 'PENDING' },
        },
      });

      await expect(service.disburseLoan(1, 'teller_1')).rejects.toThrow(ConflictException);
      await expect(service.disburseLoan(1, 'teller_1')).rejects.toThrow(
        'Customer KYC must be VERIFIED',
      );
      expect(mockStateMachine.transition).not.toHaveBeenCalled();
      expect(mockPrisma.ticket.update).not.toHaveBeenCalled();
      expect(mockPrisma.loan.update).not.toHaveBeenCalled();
    });

    it('blocks NOT_SUBMITTED and REJECTED customers the same way', async () => {
      for (const kycStatus of ['NOT_SUBMITTED', 'REJECTED']) {
        mockPrisma.loan.findUnique.mockResolvedValue({
          ...baseLoan,
          ticket: {
            ...baseLoan.ticket,
            customer: { id: 'cust_1', fullName: 'John Doe', kycStatus },
          },
        });

        await expect(service.disburseLoan(1, 'teller_1')).rejects.toThrow(ConflictException);
      }
    });

    it('disburses a VERIFIED customer through the full activation flow', async () => {
      mockPrisma.loan.findUnique.mockResolvedValue(baseLoan);
      mockPrisma.ticket.update.mockResolvedValue({ ...baseLoan.ticket, lifecycleStatus: 'ACTIVE' });
      mockPrisma.loan.update.mockResolvedValue({ ...baseLoan, status: 'ACTIVE' });

      const result = await service.disburseLoan(1, 'teller_1', 'CASHIER_TELLER');

      expect(mockStateMachine.transition).toHaveBeenCalledWith(
        'TICKET_LIFECYCLE',
        'OFFER_MADE',
        'DISBURSED',
        { userRole: 'CASHIER_TELLER' },
      );
      expect(mockStateMachine.transition).toHaveBeenCalledWith(
        'TICKET_LIFECYCLE',
        'DISBURSED',
        'ACTIVE',
      );
      expect(mockPrisma.loan.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { status: 'ACTIVE' },
      });
      expect(mockLegalProofService.createProof).toHaveBeenCalledWith(
        expect.objectContaining({ recordType: 'CONTRACT_PROOF', loanId: 1, ticketId: 100 }),
      );
      expect(mockReceiptService.generateReceipt).toHaveBeenCalledWith(
        expect.objectContaining({ receiptType: 'DISBURSEMENT', referenceId: '1' }),
      );
      expect(result).toEqual(
        expect.objectContaining({ loanId: 1, status: 'ACTIVE' }),
      );
    });

    it('still fires the not-found guard before the KYC gate', async () => {
      mockPrisma.loan.findUnique.mockResolvedValue(null);

      await expect(service.disburseLoan(1, 'teller_1')).rejects.toThrow(NotFoundException);
      expect(mockStateMachine.transition).not.toHaveBeenCalled();
    });

    it('still fires the no-ticket guard before the KYC gate', async () => {
      mockPrisma.loan.findUnique.mockResolvedValue({ ...baseLoan, ticket: null });

      await expect(service.disburseLoan(1, 'teller_1')).rejects.toThrow(BadRequestException);
      await expect(service.disburseLoan(1, 'teller_1')).rejects.toThrow(
        'Loan has no linked ticket',
      );
      expect(mockStateMachine.transition).not.toHaveBeenCalled();
    });
  });
});
