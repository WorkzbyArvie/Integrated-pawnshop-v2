import { Test } from '@nestjs/testing';
import { BadRequestException, ForbiddenException } from '@nestjs/common';

import { ApprovalService } from './approval.service';
import { PrismaService } from '../prisma.service';
import { PawnTicketService } from '../loan/pawn-ticket.service';
import { NotificationService } from '../notification/notification.service';
import { LegalProofService } from '../loan/legal-proof.service';
import { LoanContractService } from '../loan/loan-contract.service';
import { StateMachineService } from '../common/state-machine/state-machine.service';
import { ReceiptService } from '../receipt/receipt.service';
import { FinanceService } from '../finance/finance.service';

describe('ApprovalService (RBAC-05 / RBAC-06)', () => {
  let service: ApprovalService;
  let prisma: {
    approvalRecord: {
      create: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
    ticket: { findMany: jest.Mock; findUnique: jest.Mock };
  };
  let pawnTicketService: {
    applyApprovedAppraisal: jest.Mock;
    releaseApprovedRedemption: jest.Mock;
    rejectAppraisal: jest.Mock;
  };
  let notificationService: { sendNotification: jest.Mock };

  const pendingRecord = {
    id: 1,
    pawnshopId: 'ps_1',
    targetType: 'APPRAISAL',
    targetId: 100,
    status: 'PENDING',
    amount: 15000,
    requestedById: 'appraiser_1',
    decidedById: null,
    decidedAt: null,
    decisionComment: null,
    payload: { ticketId: 100, ticketNumber: 'TKT-100' },
  };

  const caller = { id: 'mgr_1', pawnshopId: 'ps_1', role: 'MANAGER' };

  beforeEach(async () => {
    prisma = {
      approvalRecord: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      ticket: { findMany: jest.fn(), findUnique: jest.fn() },
    };
    pawnTicketService = {
      applyApprovedAppraisal: jest.fn(),
      releaseApprovedRedemption: jest.fn(),
      rejectAppraisal: jest.fn(),
    };
    notificationService = { sendNotification: jest.fn() };

    const module = await Test.createTestingModule({
      providers: [
        ApprovalService,
        { provide: PrismaService, useValue: prisma },
        { provide: PawnTicketService, useValue: pawnTicketService },
        { provide: NotificationService, useValue: notificationService },
      ],
    }).compile();

    service = module.get(ApprovalService);
  });

  describe('getQueue', () => {
    it('lists pending appraisal and redemption approvals for the caller pawnshop', async () => {
      prisma.approvalRecord.findMany.mockResolvedValue([pendingRecord]);
      const result = await service.getQueue('ps_1', {});

      expect(prisma.approvalRecord.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ pawnshopId: 'ps_1', status: 'PENDING' }),
        }),
      );
      expect(result.records).toHaveLength(1);
      expect(result.total).toBe(1);
    });

    it('filters the queue by targetType', async () => {
      prisma.approvalRecord.findMany.mockResolvedValue([]);
      await service.getQueue('ps_1', { targetType: 'REDEMPTION' });

      expect(prisma.approvalRecord.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ targetType: 'REDEMPTION' }),
        }),
      );
    });

    it('maps a DECIDED filter to the decided statuses for audit views', async () => {
      prisma.approvalRecord.findMany.mockResolvedValue([]);
      await service.getQueue('ps_1', { status: 'DECIDED' });

      expect(prisma.approvalRecord.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: { in: ['APPROVED', 'REJECTED', 'CANCELLED'] },
          }),
        }),
      );
    });
  });

  describe('decide', () => {
    it('approves an appraisal record and dispatches applyApprovedAppraisal', async () => {
      prisma.approvalRecord.findUnique.mockResolvedValue(pendingRecord);
      prisma.approvalRecord.update.mockResolvedValue({
        ...pendingRecord,
        status: 'APPROVED',
      });

      await service.decide(1, { approve: true, decisionComment: 'looks good' }, caller);

      expect(prisma.approvalRecord.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 1 },
          data: expect.objectContaining({
            status: 'APPROVED',
            decidedById: 'mgr_1',
            decidedAt: expect.any(Date),
            decisionComment: 'looks good',
          }),
        }),
      );
      expect(pawnTicketService.applyApprovedAppraisal).toHaveBeenCalled();
      expect(pawnTicketService.releaseApprovedRedemption).not.toHaveBeenCalled();
    });

    it('approves a redemption record and dispatches releaseApprovedRedemption', async () => {
      const redemptionRecord = {
        ...pendingRecord,
        id: 2,
        targetType: 'REDEMPTION',
        targetId: 200,
      };
      prisma.approvalRecord.findUnique.mockResolvedValue(redemptionRecord);
      prisma.approvalRecord.update.mockResolvedValue({
        ...redemptionRecord,
        status: 'APPROVED',
      });

      await service.decide(2, { approve: true, decisionComment: 'ok' }, caller);

      expect(pawnTicketService.releaseApprovedRedemption).toHaveBeenCalled();
      expect(pawnTicketService.applyApprovedAppraisal).not.toHaveBeenCalled();
    });

    it('rejects an appraisal with a comment and dispatches rejectAppraisal', async () => {
      prisma.approvalRecord.findUnique.mockResolvedValue(pendingRecord);
      prisma.approvalRecord.update.mockResolvedValue({
        ...pendingRecord,
        status: 'REJECTED',
      });

      await service.decide(
        1,
        { approve: false, decisionComment: 'reappraise at lower value' },
        caller,
      );

      expect(prisma.approvalRecord.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'REJECTED' }),
        }),
      );
      expect(pawnTicketService.rejectAppraisal).toHaveBeenCalled();
    });

    it('requires a decision comment when rejecting', async () => {
      prisma.approvalRecord.findUnique.mockResolvedValue(pendingRecord);

      await expect(
        service.decide(1, { approve: false, decisionComment: '' }, caller),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects decisions on non-pending records', async () => {
      prisma.approvalRecord.findUnique.mockResolvedValue({
        ...pendingRecord,
        status: 'APPROVED',
      });

      await expect(service.decide(1, { approve: true }, caller)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('forbids deciding on your own request', async () => {
      prisma.approvalRecord.findUnique.mockResolvedValue({
        ...pendingRecord,
        requestedById: 'mgr_1',
      });

      await expect(service.decide(1, { approve: true }, caller)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('forbids deciding on another pawnshop approval', async () => {
      prisma.approvalRecord.findUnique.mockResolvedValue({
        ...pendingRecord,
        pawnshopId: 'ps_2',
      });
      const otherCaller = { id: 'mgr_2', pawnshopId: 'ps_2', role: 'MANAGER' };

      await expect(service.decide(1, { approve: true }, otherCaller)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });
});

describe('PawnTicketService approval chokepoints (RBAC-03 / RBAC-04)', () => {
  let service: PawnTicketService;
  let prisma: {
    ticket: { findUnique: jest.Mock; findMany: jest.Mock; update: jest.Mock };
    loan: { update: jest.Mock };
    payment: { create: jest.Mock };
    approvalRecord: {
      create: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
    pawnshop: { findUnique: jest.Mock };
    profile: { update: jest.Mock };
  };

  const receivedTicket = {
    id: 100,
    ticketNumber: 'TKT-100',
    pawnshopId: 'ps_1',
    lifecycleStatus: 'RECEIVED',
    status: 'RECEIVED',
    loanAmount: 10000,
    category: 'JEWELRY',
    customer: { id: 'cust_1', fullName: 'Test Customer' },
  };

  const activeTicket = {
    id: 900,
    ticketNumber: 'TKT-900',
    pawnshopId: 'ps_1',
    lifecycleStatus: 'ACTIVE',
    status: 'ACTIVE',
    customerId: 'cust_1',
    customer: { id: 'cust_1', fullName: 'Test Customer' },
    loans: [{ id: 950, status: 'ACTIVE', ticketId: 900 }],
  };

  beforeEach(async () => {
    prisma = {
      ticket: { findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn() },
      loan: { update: jest.fn() },
      payment: { create: jest.fn() },
      approvalRecord: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      pawnshop: { findUnique: jest.fn() },
      profile: { update: jest.fn() },
    };

    const module = await Test.createTestingModule({
      providers: [
        PawnTicketService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: LegalProofService,
          useValue: { createProof: jest.fn().mockResolvedValue({ id: 'proof_1' }) },
        },
        {
          provide: LoanContractService,
          useValue: { generateContract: jest.fn().mockResolvedValue({ id: 'contract_1' }) },
        },
        {
          provide: StateMachineService,
          useValue: { transition: jest.fn().mockResolvedValue(undefined) },
        },
        {
          provide: ReceiptService,
          useValue: { generateReceipt: jest.fn().mockResolvedValue({ id: 'receipt_1' }) },
        },
        {
          provide: FinanceService,
          useValue: { createEntry: jest.fn().mockResolvedValue({ id: 'entry_1' }) },
        },
        {
          provide: NotificationService,
          useValue: { sendNotification: jest.fn().mockResolvedValue({ id: 'notif_1' }) },
        },
      ],
    }).compile();

    service = module.get(PawnTicketService);
  });

  describe('appraiseTicket', () => {
    it('creates a PENDING APPRAISAL approval record instead of finalizing the ticket', async () => {
      prisma.ticket.findUnique.mockResolvedValue(receivedTicket);
      prisma.ticket.update.mockResolvedValue({
        ...receivedTicket,
        lifecycleStatus: 'PENDING_APPROVAL',
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

      expect(prisma.approvalRecord.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            pawnshopId: 'ps_1',
            targetType: 'TICKET',
            targetId: 100,
            recordType: 'APPRAISAL',
            status: 'PENDING',
            payload: expect.objectContaining({
              ticketId: 100,
              appraisedValue: 25000,
            }),
          }),
        }),
      );
      expect(result.lifecycleStatus).toBe('PENDING_APPROVAL');
    });
  });

  describe('redeemTicket', () => {
    it('routes an above-threshold redemption into a PENDING REDEMPTION approval record', async () => {
      prisma.ticket.findUnique.mockResolvedValue(activeTicket);
      prisma.pawnshop.findUnique.mockResolvedValue({
        id: 'ps_1',
        settings: { redemptionApprovalThreshold: 50000 },
      });

      const result = await service.redeemTicket(
        900,
        { amountPaid: 60000, paymentMethod: 'CASH' },
        'cashier_1',
        'CASHIER_TELLER',
      );

      expect(prisma.approvalRecord.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            pawnshopId: 'ps_1',
            targetType: 'TICKET',
            targetId: 900,
            recordType: 'REDEMPTION',
            status: 'PENDING',
            payload: expect.objectContaining({ amountPaid: 60000 }),
          }),
        }),
      );
      expect(prisma.payment.create).not.toHaveBeenCalled();
      expect(result.requiresApproval).toBe(true);
    });

    it('runs the direct release for an at-or-below-threshold redemption', async () => {
      prisma.ticket.findUnique.mockResolvedValue(activeTicket);
      prisma.pawnshop.findUnique.mockResolvedValue({
        id: 'ps_1',
        settings: { redemptionApprovalThreshold: 50000 },
      });
      prisma.payment.create.mockResolvedValue({ id: 'pay_1' });

      const result = await service.redeemTicket(
        900,
        { amountPaid: 40000, paymentMethod: 'CASH' },
        'cashier_1',
        'CASHIER_TELLER',
      );

      expect(prisma.payment.create).toHaveBeenCalled();
      expect(result.lifecycleStatus).toBe('REDEEMED');
    });
  });
});
