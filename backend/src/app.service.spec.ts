import { Test } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
import { AppService } from './app.service';
import { PrismaService } from './prisma.service';
import { FinanceService } from './finance/finance.service';
import { LegalProofService } from './loan/legal-proof.service';
import { ReceiptService } from './receipt/receipt.service';
import { StateMachineService } from './common/state-machine/state-machine.service';
import { PawnTicketService } from './loan/pawn-ticket.service';

const mockPrisma = {
  profile: { findUnique: jest.fn(), findFirst: jest.fn() },
  customer: { findFirst: jest.fn(), create: jest.fn() },
  ticket: { create: jest.fn() },
};

const mockFinanceService = { createEntry: jest.fn().mockResolvedValue({ id: 'ledger-1' }) };
const mockLegalProofService = { createProof: jest.fn().mockResolvedValue({ id: 'proof-1' }) };
const mockReceiptService = { generateReceipt: jest.fn().mockResolvedValue({ id: 'rcpt-1' }) };
const mockStateMachine = { transition: jest.fn().mockResolvedValue(true) };
const mockPawnTicketService = { redeemTicket: jest.fn() };

describe('AppService', () => {
  let service: AppService;

  const profile = { id: 'user_1', fullName: 'Bidder One' };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      providers: [
        AppService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: FinanceService, useValue: mockFinanceService },
        { provide: LegalProofService, useValue: mockLegalProofService },
        { provide: ReceiptService, useValue: mockReceiptService },
        { provide: StateMachineService, useValue: mockStateMachine },
        { provide: PawnTicketService, useValue: mockPawnTicketService },
      ],
    }).compile();

    service = module.get(AppService);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockFinanceService.createEntry.mockResolvedValue({ id: 'ledger-1' });
    mockLegalProofService.createProof.mockResolvedValue({ id: 'proof-1' });
    mockReceiptService.generateReceipt.mockResolvedValue({ id: 'rcpt-1' });
    mockStateMachine.transition.mockResolvedValue(true);
  });

  describe('createMobileTicket KYC gate', () => {
    it('rejects an existing customer whose kycStatus is NOT_SUBMITTED with a 409 ConflictException', async () => {
      mockPrisma.profile.findUnique.mockResolvedValue(profile);
      mockPrisma.customer.findFirst.mockResolvedValue({ id: 'user_1', kycStatus: 'NOT_SUBMITTED' });

      await expect(service.createMobileTicket('user_1', { category: 'JEWELRY' })).rejects.toThrow(
        ConflictException,
      );
      await expect(service.createMobileTicket('user_1', { category: 'JEWELRY' })).rejects.toThrow(
        'Customer KYC must be VERIFIED',
      );
      expect(mockPrisma.ticket.create).not.toHaveBeenCalled();
    });

    it('rejects PENDING and REJECTED customers the same way', async () => {
      mockPrisma.profile.findUnique.mockResolvedValue(profile);
      for (const kycStatus of ['PENDING', 'REJECTED']) {
        mockPrisma.customer.findFirst.mockResolvedValue({ id: 'user_1', kycStatus });

        await expect(service.createMobileTicket('user_1', { category: 'JEWELRY' })).rejects.toThrow(
          ConflictException,
        );
      }
    });

    it('blocks a brand-new customer created with the default NOT_SUBMITTED status', async () => {
      mockPrisma.profile.findUnique.mockResolvedValue(profile);
      mockPrisma.customer.findFirst.mockResolvedValue(null);
      mockPrisma.customer.create.mockResolvedValue({ id: 'user_1', kycStatus: 'NOT_SUBMITTED' });

      await expect(service.createMobileTicket('user_1', { category: 'JEWELRY' })).rejects.toThrow(
        ConflictException,
      );
      expect(mockPrisma.customer.create).toHaveBeenCalled();
      expect(mockPrisma.ticket.create).not.toHaveBeenCalled();
    });

    it('allows a VERIFIED customer through to ticket creation', async () => {
      mockPrisma.profile.findUnique.mockResolvedValue(profile);
      mockPrisma.customer.findFirst.mockResolvedValue({ id: 'user_1', kycStatus: 'VERIFIED' });
      mockPrisma.ticket.create.mockResolvedValue({ id: 1, ticketNumber: 'MOB-ABC', status: 'PENDING' });

      const result = await service.createMobileTicket('user_1', { category: 'JEWELRY' });

      expect(mockPrisma.ticket.create).toHaveBeenCalled();
      expect(result).toEqual({
        success: true,
        data: { id: 1, ticketNumber: 'MOB-ABC', status: 'PENDING' },
      });
    });
  });

  describe('checkEmailAvailability forgot-password support', () => {
    it('reports an email as not existing when no account matches', async () => {
      mockPrisma.profile.findFirst.mockResolvedValue(null);

      const result = await service.checkEmailAvailability('ghost@example.com', 'OWNER');

      expect(result).toMatchObject({ exists: false, emailExists: false, role: null });
    });

    it('returns the account role when no role filter is provided', async () => {
      mockPrisma.profile.findFirst.mockResolvedValue({ id: 'u1', email: 'a@example.com', role: 'OWNER' });

      const result = await service.checkEmailAvailability('a@example.com');

      expect(result).toMatchObject({
        exists: true,
        emailExists: true,
        role: 'OWNER',
      });
    });

    it('reports a role mismatch (not an owner) for forgot-password checks', async () => {
      mockPrisma.profile.findFirst.mockResolvedValue({ id: 'u1', email: 'staff@example.com', role: 'STAFF' });

      const result = await service.checkEmailAvailability('staff@example.com', 'OWNER');

      expect(result.exists).toBe(false);
      expect(result.emailExists).toBe(true);
      expect(result.role).toBe('STAFF');
    });

    it('confirms an owner email matches the requested role', async () => {
      mockPrisma.profile.findFirst.mockResolvedValue({ id: 'u1', email: 'owner@example.com', role: 'OWNER' });

      const result = await service.checkEmailAvailability('owner@example.com', 'OWNER');

      expect(result.exists).toBe(true);
      expect(result.emailExists).toBe(true);
      expect(result.role).toBe('OWNER');
    });
  });
});
