import { Test, TestingModule } from '@nestjs/testing';
import { LoanService } from './loan.service';
import { PrismaService } from '../prisma.service';
import { FinanceService } from '../finance/finance.service';
import { LegalProofService } from './legal-proof.service';
import { StateMachineService } from '../common/state-machine/state-machine.service';
import { ReceiptService } from '../receipt/receipt.service';
import { NotFoundException } from '@nestjs/common';

describe('LoanService - History Endpoints', () => {
  let service: LoanService;
  let prismaService: PrismaService;
  let legalProofService: LegalProofService;

  const mockLoan = {
    id: 1,
    customerId: 'customer-123',
    pawnshopId: 'pawnshop-1',
    principalAmount: 10000,
    status: 'ACTIVE',
    createdAt: new Date('2026-01-01'),
    ticket: { lifecycleStatus: 'ACTIVE', updatedAt: new Date('2026-01-16') },
    application: {
      id: 'app-1',
      contract: {
        id: 'contract-1',
        contractNumber: 'CONT-2026-001',
        signedByCustomer: true,
        signedByStaff: true,
        customerSignedAt: new Date('2026-01-15'),
        staffSignedAt: new Date('2026-01-16'),
      },
    },
  };

  const mockPayments = [
    {
      id: 'payment-1',
      loanId: 1,
      customerId: 'customer-123',
      amount: 2000,
      paymentMethod: 'CASH',
      processedAt: new Date('2026-02-01'),
      schedule: { installmentNumber: 1, dueDate: new Date('2026-02-01') },
    },
    {
      id: 'payment-2',
      loanId: 1,
      customerId: 'customer-123',
      amount: 1500,
      paymentMethod: 'BANK_TRANSFER',
      processedAt: new Date('2026-03-01'),
      schedule: { installmentNumber: 2, dueDate: new Date('2026-03-01') },
    },
  ];

  const mockProofs = [
    {
      id: 'proof-1',
      proofNumber: 'PROOF-2026-001',
      loanId: 1,
      recordType: 'PAYMENT_PROOF',
      createdAt: new Date('2026-02-01'),
    },
    {
      id: 'proof-2',
      proofNumber: 'PROOF-2026-002',
      loanId: 1,
      recordType: 'CONTRACT_PROOF',
      createdAt: new Date('2026-01-16'),
    },
  ];

  beforeEach(async () => {
    const mockPrismaService = {
      loan: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
      },
      payment: {
        findMany: jest.fn(),
      },
      legalProof: {
        findMany: jest.fn(),
      },
      loanDisbursement: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      penalty: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      receipt: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    const mockLegalProofService = {
      listByLoan: jest.fn(),
      listByContract: jest.fn(),
      listByPayment: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LoanService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: LegalProofService,
          useValue: mockLegalProofService,
        },
        {
          provide: FinanceService,
          useValue: {},
        },
        {
          provide: ReceiptService,
          useValue: {},
        },
        {
          provide: StateMachineService,
          useValue: { transition: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<LoanService>(LoanService);
    prismaService = module.get<PrismaService>(PrismaService);
    legalProofService = module.get<LegalProofService>(LegalProofService);
  });

  describe('getLoanFullHistory', () => {
    function mockPaymentFindMany() {
      jest
        .spyOn(prismaService.payment, 'findMany' as any)
        .mockImplementation((args?: any) => {
          if (args?.select?.id !== undefined) {
            return Promise.resolve(mockPayments.map((p) => ({ id: p.id })));
          }
          return Promise.resolve(mockPayments as any);
        });
    }

    it('returns full history for a loan including payments, contract, and proofs', async () => {
      jest
        .spyOn(prismaService.loan, 'findUnique')
        .mockResolvedValue(mockLoan as any);
      mockPaymentFindMany();
      jest
        .spyOn(legalProofService, 'listByContract')
        .mockResolvedValue(mockProofs.slice(1) as any);
      jest
        .spyOn(legalProofService, 'listByLoan')
        .mockResolvedValue(mockProofs as any);

      const result = await service.getLoanFullHistory(1);

      expect(result).toHaveProperty('loanId', 1);
      expect(result).toHaveProperty('loan');
      expect(result).toHaveProperty('contract');
      expect(result).toHaveProperty('payments');
      expect(result).toHaveProperty('proofs');
      expect(result).toHaveProperty('timeline');

      expect(result.payments.records).toHaveLength(2);
      expect(result.payments.summary.totalPaid).toBe(3500);
      expect(result.payments.summary.paymentCount).toBe(2);
    });

    it('builds chronological timeline in descending order (newest first)', async () => {
      jest
        .spyOn(prismaService.loan, 'findUnique')
        .mockResolvedValue(mockLoan as any);
      mockPaymentFindMany();
      jest
        .spyOn(legalProofService, 'listByContract')
        .mockResolvedValue(mockProofs.slice(1) as any);
      jest
        .spyOn(legalProofService, 'listByLoan')
        .mockResolvedValue(mockProofs as any);

      const result = await service.getLoanFullHistory(1);

      expect(result.timeline).toBeDefined();
      expect(result.timeline.length).toBeGreaterThan(0);

      const timestamps = result.timeline.map((e) => e.timestamp);
      for (let i = 1; i < timestamps.length; i++) {
        expect(timestamps[i].getTime()).toBeLessThanOrEqual(
          timestamps[i - 1].getTime(),
        );
      }
    });

    it('throws NotFoundException when loan does not exist', async () => {
      jest.spyOn(prismaService.loan, 'findUnique').mockResolvedValue(null);

      await expect(service.getLoanFullHistory(999)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('includes contract details when available', async () => {
      jest
        .spyOn(prismaService.loan, 'findUnique')
        .mockResolvedValue(mockLoan as any);
      mockPaymentFindMany();
      jest.spyOn(legalProofService, 'listByContract').mockResolvedValue([]);
      jest.spyOn(legalProofService, 'listByLoan').mockResolvedValue([]);

      const result = await service.getLoanFullHistory(1);

      expect(result.contract).toBeDefined();
      expect(result.contract.contractNumber).toBe('CONT-2026-001');
      expect(result.contract.signedByCustomer).toBe(true);
      expect(result.contract.signedByStaff).toBe(true);
    });
  });

  describe('getCustomerFullHistory', () => {
    const mockLoans = [
      { ...mockLoan },
      {
        id: 2,
        customerId: 'customer-123',
        pawnshopId: 'pawnshop-1',
        principalAmount: 5000,
        status: 'PAID',
        createdAt: new Date('2025-12-01'),
        ticket: {
          lifecycleStatus: 'REDEEMED',
          updatedAt: new Date('2026-01-10'),
        },
        application: {
          id: 'app-2',
          contract: {
            id: 'contract-2',
            contractNumber: 'CONT-2025-001',
            signedByCustomer: true,
            signedByStaff: true,
          },
        },
      },
    ];

    const mockCustomerPayments = [
      ...mockPayments,
      {
        id: 'payment-3',
        loanId: 2,
        customerId: 'customer-123',
        amount: 5000,
        paymentMethod: 'CASH',
        processedAt: new Date('2026-01-10'),
        schedule: { installmentNumber: 1, dueDate: new Date('2026-01-10') },
      },
    ];

    const mockCustomerProofs = [
      ...mockProofs,
      {
        id: 'proof-3',
        proofNumber: 'PROOF-2026-003',
        loanId: 2,
        recordType: 'PAYMENT_PROOF',
        createdAt: new Date('2026-01-10'),
      },
    ];

    it('returns aggregated history across all customer loans', async () => {
      jest
        .spyOn(prismaService.loan, 'findMany')
        .mockResolvedValue(mockLoans as any);
      jest
        .spyOn(prismaService.payment, 'findMany')
        .mockResolvedValue(mockCustomerPayments as any);
      jest
        .spyOn(prismaService.legalProof, 'findMany')
        .mockResolvedValue(mockCustomerProofs as any);

      const result = await service.getCustomerFullHistory('customer-123');

      expect(result).toHaveProperty('customerId', 'customer-123');
      expect(result).toHaveProperty('summary');
      expect(result).toHaveProperty('loansWithHistory');
      expect(result).toHaveProperty('payments');
      expect(result).toHaveProperty('proofs');
      expect(result).toHaveProperty('timeline');

      expect(result.summary.totalLoans).toBe(2);
      expect(result.summary.totalPaid).toBe(8500);
      expect(result.summary.paymentCount).toBe(3);
    });

    it('aggregates loans with correct payment and proof counts', async () => {
      jest
        .spyOn(prismaService.loan, 'findMany')
        .mockResolvedValue(mockLoans as any);
      jest
        .spyOn(prismaService.payment, 'findMany')
        .mockResolvedValue(mockCustomerPayments as any);
      jest
        .spyOn(prismaService.legalProof, 'findMany')
        .mockResolvedValue(mockCustomerProofs as any);

      const result = await service.getCustomerFullHistory('customer-123');

      expect(result.loansWithHistory).toHaveLength(2);

      const loanDetails = result.loansWithHistory.find((l) => l.loanId === 1);
      expect(loanDetails?.paymentCount).toBe(2);
      expect(loanDetails?.totalPaid).toBe(3500);

      const loan2Details = result.loansWithHistory.find((l) => l.loanId === 2);
      expect(loan2Details?.paymentCount).toBe(1);
      expect(loan2Details?.totalPaid).toBe(5000);
    });

    it('builds master timeline combining all events across loans', async () => {
      jest
        .spyOn(prismaService.loan, 'findMany')
        .mockResolvedValue(mockLoans as any);
      jest
        .spyOn(prismaService.payment, 'findMany')
        .mockResolvedValue(mockCustomerPayments as any);
      jest
        .spyOn(prismaService.legalProof, 'findMany')
        .mockResolvedValue(mockCustomerProofs as any);

      const result = await service.getCustomerFullHistory('customer-123');

      expect(result.timeline).toBeDefined();
      expect(result.timeline.length).toBeGreaterThan(0);

      const eventTypes = result.timeline.map((e) => e.eventType);
      expect(eventTypes).toContain('PAYMENT');
      expect(eventTypes).toContain('LOAN_CREATED');
      expect(eventTypes).toContain('PROOF_RECORD');
    });

    it('maintains descending chronological order in master timeline', async () => {
      jest
        .spyOn(prismaService.loan, 'findMany')
        .mockResolvedValue(mockLoans as any);
      jest
        .spyOn(prismaService.payment, 'findMany')
        .mockResolvedValue(mockCustomerPayments as any);
      jest
        .spyOn(prismaService.legalProof, 'findMany')
        .mockResolvedValue(mockCustomerProofs as any);

      const result = await service.getCustomerFullHistory('customer-123');

      const timestamps = result.timeline.map((e) => e.timestamp);
      for (let i = 1; i < timestamps.length; i++) {
        expect(timestamps[i].getTime()).toBeLessThanOrEqual(
          timestamps[i - 1].getTime(),
        );
      }
    });
  });
});
