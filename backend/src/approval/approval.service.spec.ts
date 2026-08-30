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
import { TierService } from '../tier/tier.service';

describe('ApprovalService (RBAC-05 / RBAC-06)', () => {
  let service: ApprovalService;
  let prisma: {
    approvalRecord: {
      create: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      findFirst: jest.Mock;
      update: jest.Mock;
    };
    ticket: { findMany: jest.Mock; findUnique: jest.Mock };
    auctionListing: { findMany: jest.Mock; findUnique: jest.Mock; update: jest.Mock };
  };
  let pawnTicketService: {
    applyApprovedAppraisal: jest.Mock;
    releaseApprovedRedemption: jest.Mock;
    rejectAppraisal: jest.Mock;
    rejectRedemption: jest.Mock;
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

  beforeEach(async () => {
    prisma = {
      approvalRecord: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      ticket: { findMany: jest.fn(), findUnique: jest.fn() },
      auctionListing: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };
    pawnTicketService = {
      applyApprovedAppraisal: jest.fn(),
      releaseApprovedRedemption: jest.fn(),
      rejectAppraisal: jest.fn(),
      rejectRedemption: jest.fn(),
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

  describe('getQueue(query, callerPawnshopId)', () => {
    it('returns PENDING records across both target types scoped to the caller pawnshop', async () => {
      prisma.approvalRecord.findMany.mockResolvedValue([pendingRecord]);
      const result = await service.getQueue({}, 'ps_1');

      expect(prisma.approvalRecord.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ pawnshopId: 'ps_1', status: 'PENDING' }),
        }),
      );
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ targetType: 'APPRAISAL', status: 'PENDING' });
    });

    it('filters the queue by targetType when provided', async () => {
      prisma.approvalRecord.findMany.mockResolvedValue([]);
      await service.getQueue({ targetType: 'REDEMPTION' }, 'ps_1');

      expect(prisma.approvalRecord.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ targetType: 'REDEMPTION' }),
        }),
      );
    });

    it('honors the type alias used by the frontend contract', async () => {
      prisma.approvalRecord.findMany.mockResolvedValue([]);
      await service.getQueue({ type: 'REDEMPTION' }, 'ps_1');

      expect(prisma.approvalRecord.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ targetType: 'REDEMPTION' }),
        }),
      );
    });

    it('maps a DECIDED filter to the decided statuses for the audit view', async () => {
      prisma.approvalRecord.findMany.mockResolvedValue([]);
      await service.getQueue({ status: 'DECIDED' }, 'ps_1');

      expect(prisma.approvalRecord.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: { in: ['APPROVED', 'REJECTED', 'CANCELLED'] },
          }),
        }),
      );
    });

    it('enriches LISTING_EDIT records with the listing and its ticket', async () => {
      const listingEditRecord = {
        ...pendingRecord,
        id: 3,
        targetType: 'LISTING_EDIT',
        targetId: 300,
        payload: {
          itemCondition: 'Excellent',
          previous: { itemCondition: 'Pre-owned' },
        },
      };
      prisma.approvalRecord.findMany.mockResolvedValue([listingEditRecord]);
      prisma.auctionListing.findMany.mockResolvedValue([
        {
          id: 300,
          title: 'Gold Necklace',
          ticketId: 900,
          ticket: {
            ticketNumber: 'TKT-900',
            description: 'A gold necklace',
            category: 'Jewelry',
            customer: { fullName: 'Juan', contactNumber: '0917', loyaltyTier: 'GOLD' },
          },
        },
      ]);

      const result = await service.getQueue({}, 'ps_1');

      expect(prisma.auctionListing.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: { in: [300] } }),
        }),
      );
      expect(result[0]).toMatchObject({
        targetType: 'LISTING_EDIT',
        listingId: 300,
        listingTitle: 'Gold Necklace',
        ticketNumber: 'TKT-900',
        itemName: 'A gold necklace',
        category: 'Jewelry',
        customer: expect.objectContaining({ fullName: 'Juan' }),
        listingEdit: expect.objectContaining({
          itemCondition: 'Excellent',
          previous: expect.objectContaining({ itemCondition: 'Pre-owned' }),
        }),
      });
    });
  });

  describe('decideApproval(id, dto, decidedBy, userRole, approve, callerPawnshopId)', () => {
    it('approves an appraisal record and dispatches applyApprovedAppraisal', async () => {
      prisma.approvalRecord.findUnique.mockResolvedValue(pendingRecord);
      prisma.approvalRecord.update.mockResolvedValue({
        ...pendingRecord,
        status: 'APPROVED',
      });

      await service.decideApproval(
        '1',
        { decisionComment: 'looks good' },
        'mgr_1',
        'MANAGER',
        true,
        'ps_1',
      );

      expect(prisma.approvalRecord.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: expect.any(String) }),
          data: expect.objectContaining({
            status: 'PENDING',
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

      await service.decideApproval(
        '2',
        { decisionComment: 'ok' },
        'mgr_1',
        'MANAGER',
        true,
        'ps_1',
      );

      expect(pawnTicketService.releaseApprovedRedemption).toHaveBeenCalled();
      expect(pawnTicketService.applyApprovedAppraisal).not.toHaveBeenCalled();
    });

    it('approves a LISTING_EDIT record and applies the changes to the listing', async () => {
      const listingEditRecord = {
        ...pendingRecord,
        id: 3,
        targetType: 'LISTING_EDIT',
        targetId: 300,
        requestedById: 'teller_1',
        payload: {
          itemCondition: 'Excellent',
          itemSpecifications: '18k, 20g',
          provenanceDetails: 'Estate lot',
          disclosureNotes: 'Minor clasp wear',
          previous: { itemCondition: 'Pre-owned' },
        },
      };
      prisma.approvalRecord.findUnique.mockResolvedValue(listingEditRecord);
      prisma.approvalRecord.update.mockResolvedValue({
        ...listingEditRecord,
        status: 'APPROVED',
      });
      prisma.auctionListing.findUnique.mockResolvedValue({
        id: 300,
        pawnshopId: 'ps_1',
      });
      prisma.auctionListing.update.mockResolvedValue({ id: 300 });

      await service.decideApproval(
        '3',
        { decisionComment: 'looks accurate' },
        'owner_1',
        'OWNER',
        true,
        'ps_1',
      );

      expect(prisma.auctionListing.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 300 }),
          data: expect.objectContaining({
            itemCondition: 'Excellent',
            itemSpecifications: '18k, 20g',
            provenanceDetails: 'Estate lot',
            disclosureNotes: 'Minor clasp wear',
          }),
        }),
      );
      expect(prisma.approvalRecord.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'APPROVED' }),
        }),
      );
      expect(pawnTicketService.applyApprovedAppraisal).not.toHaveBeenCalled();
      expect(pawnTicketService.releaseApprovedRedemption).not.toHaveBeenCalled();
    });

    it('rejects an appraisal with a comment and dispatches rejectAppraisal', async () => {
      prisma.approvalRecord.findUnique.mockResolvedValue(pendingRecord);
      prisma.approvalRecord.update.mockResolvedValue({
        ...pendingRecord,
        status: 'REJECTED',
      });

      await service.decideApproval(
        '1',
        { decisionComment: 'reappraise at lower value' },
        'mgr_1',
        'MANAGER',
        false,
        'ps_1',
      );

      expect(prisma.approvalRecord.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'REJECTED' }),
        }),
      );
      expect(pawnTicketService.rejectAppraisal).toHaveBeenCalled();
    });

    it('rejects a redemption record and dispatches rejectRedemption to restore the ticket', async () => {
      const redemptionRecord = {
        ...pendingRecord,
        id: 2,
        targetType: 'REDEMPTION',
        targetId: 200,
        amount: 40000,
        requestedById: 'teller_1',
        payload: { ticketId: 200, ticketNumber: 'TKT-200', amountPaid: 40000 },
      };
      prisma.approvalRecord.findUnique.mockResolvedValue(redemptionRecord);
      prisma.approvalRecord.update.mockResolvedValue({
        ...redemptionRecord,
        status: 'REJECTED',
      });

      await service.decideApproval(
        '2',
        { decisionComment: 'customer did not present the ticket' },
        'owner_1',
        'OWNER',
        false,
        'ps_1',
      );

      expect(prisma.approvalRecord.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'REJECTED' }),
        }),
      );
      expect(pawnTicketService.rejectRedemption).toHaveBeenCalledWith(200, 'OWNER');
    });

    it('requires a non-empty decision comment when rejecting', async () => {
      prisma.approvalRecord.findUnique.mockResolvedValue(pendingRecord);

      await expect(
        service.decideApproval('1', { decisionComment: '' }, 'mgr_1', 'MANAGER', false, 'ps_1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects decisions on records whose status is not PENDING (TOCTOU)', async () => {
      prisma.approvalRecord.findUnique.mockResolvedValue({
        ...pendingRecord,
        status: 'APPROVED',
      });

      await expect(
        service.decideApproval('1', {}, 'mgr_1', 'MANAGER', true, 'ps_1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('forbids self-approval (requestedById === decidedBy)', async () => {
      prisma.approvalRecord.findUnique.mockResolvedValue({
        ...pendingRecord,
        requestedById: 'mgr_1',
      });

      await expect(
        service.decideApproval('1', {}, 'mgr_1', 'MANAGER', true, 'ps_1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('forbids deciding on another pawnshop approval (cross-tenant)', async () => {
      prisma.approvalRecord.findUnique.mockResolvedValue({
        ...pendingRecord,
        pawnshopId: 'ps_2',
      });

      await expect(
        service.decideApproval('1', {}, 'mgr_1', 'MANAGER', true, 'ps_1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
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
      findFirst: jest.Mock;
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
        findFirst: jest.fn(),
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
        {
          provide: TierService,
          useValue: { recomputeCustomerTier: jest.fn().mockResolvedValue(null) },
        },
      ],
    }).compile();

    service = module.get(PawnTicketService);
  });

  describe('appraiseTicket chokepoint', () => {
    it('creates a PENDING APPRAISAL record with full payload and keeps the ticket in PENDING_APPROVAL without writing loanAmount', async () => {
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
            targetType: 'APPRAISAL',
            targetId: '100',
            status: 'PENDING',
            payload: expect.objectContaining({
              ticketId: 100,
              appraisedValue: 25000,
              riskScore: 30,
              recommendedLoanAmount: 18000,
              itemCondition: 'GOOD',
              appraisalNotes: 'ok',
            }),
          }),
        }),
      );
      expect(prisma.ticket.update).not.toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ loanAmount: expect.any(Number) }),
        }),
      );
      expect(result.lifecycleStatus).toBe('PENDING_APPROVAL');
    });
  });

  describe('redeemTicket chokepoint', () => {
    it('routes a redemption into a PENDING REDEMPTION record and returns early without releasing', async () => {
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
            targetType: 'REDEMPTION',
            targetId: '900',
            status: 'PENDING',
            payload: expect.objectContaining({ amountPaid: 60000 }),
          }),
        }),
      );
      expect(prisma.payment.create).not.toHaveBeenCalled();
      expect(result.requiresApproval).toBe(true);
    });

    it('requires owner approval for redemptions of any amount and does not release', async () => {
      prisma.ticket.findUnique.mockResolvedValue(activeTicket);
      prisma.payment.create.mockResolvedValue({ id: 'pay_1' });

      const result = await service.redeemTicket(
        900,
        { amountPaid: 40000, paymentMethod: 'CASH' },
        'cashier_1',
        'CASHIER_TELLER',
      );

      expect(prisma.approvalRecord.create).toHaveBeenCalled();
      expect(prisma.payment.create).not.toHaveBeenCalled();
      expect(result.requiresApproval).toBe(true);
      expect(result.lifecycleStatus).toBe('REDEMPTION_PENDING_APPROVAL');
    });
  });
});
