import { Test } from '@nestjs/testing';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { AppService } from './app.service';
import { SupabaseAdminService } from './common/supabase-admin.service';
import { PasswordPolicyService } from './security/password-policy.service';
import {
  CREDENTIAL_STATE_REASONS,
  CredentialStateService,
  CredentialStateUnavailableError,
} from './security/credential-state.service';
import { PrismaService } from './prisma.service';
import { FinanceService } from './finance/finance.service';
import { LegalProofService } from './loan/legal-proof.service';
import { ReceiptService } from './receipt/receipt.service';
import { StateMachineService } from './common/state-machine/state-machine.service';
import { PawnTicketService } from './loan/pawn-ticket.service';

const mockPrisma = {
  profile: { findUnique: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
  customer: { findFirst: jest.fn(), create: jest.fn() },
  ticket: { create: jest.fn() },
  securityLog: { create: jest.fn(), update: jest.fn() },
};

const mockFinanceService = { createEntry: jest.fn().mockResolvedValue({ id: 'ledger-1' }) };
const mockLegalProofService = { createProof: jest.fn().mockResolvedValue({ id: 'proof-1' }) };
const mockReceiptService = { generateReceipt: jest.fn().mockResolvedValue({ id: 'rcpt-1' }) };
const mockStateMachine = { transition: jest.fn().mockResolvedValue(true) };
const mockPawnTicketService = { redeemTicket: jest.fn() };
const mockSupabaseAdmin = {
  client: {
    auth: {
      signInWithPassword: jest.fn(),
      admin: { updateUserById: jest.fn() },
    },
  },
};
const mockPasswordPolicy = { assert: jest.fn(), evaluate: jest.fn() };
const mockCredentialState = {
  initializeSelfSelected: jest.fn(),
  initializeProvisioned: jest.fn(),
  getForUser: jest.fn(),
  reserveForcedChange: jest.fn(),
  confirmForcedChange: jest.fn(),
  recordForcedChangeFailure: jest.fn(),
};

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
        { provide: SupabaseAdminService, useValue: mockSupabaseAdmin },
        { provide: PasswordPolicyService, useValue: mockPasswordPolicy },
        { provide: CredentialStateService, useValue: mockCredentialState },
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
    mockPrisma.securityLog.create.mockResolvedValue({ id: 'audit-1' });
    mockPrisma.securityLog.update.mockResolvedValue({ id: 'audit-1' });
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

  describe('native login credential authority', () => {
    const authProfile = {
      id: 'user_1',
      email: 'owner@example.com',
      fullName: 'Owner One',
      role: 'OWNER',
      pawnshopId: 'shop_1',
    };

    beforeEach(() => {
      mockSupabaseAdmin.client.auth.signInWithPassword.mockResolvedValue({
        data: { user: { id: authProfile.id } },
        error: null,
      });
      mockPrisma.profile.findUnique.mockResolvedValue(authProfile);
    });

    it('authenticates through Supabase without reading or writing a legacy mirror', async () => {
      const result = await service.loginNative({
        email: ' OWNER@example.com ',
        password: 'ValidPassword1!',
      });

      expect(mockSupabaseAdmin.client.auth.signInWithPassword).toHaveBeenCalledWith({
        email: 'owner@example.com',
        password: 'ValidPassword1!',
      });
      expect(mockPrisma.profile.findUnique).toHaveBeenCalledWith({
        where: { id: authProfile.id },
      });
      expect(mockPrisma.profile.findFirst).not.toHaveBeenCalled();
      expect(mockPrisma.profile.update).not.toHaveBeenCalled();
      expect(result.user.id).toBe(authProfile.id);
      expect(JSON.stringify(result)).not.toMatch(/passwordHash|password_hash/i);
    });

    it('does not query a profile when Supabase rejects the credentials', async () => {
      mockSupabaseAdmin.client.auth.signInWithPassword.mockResolvedValueOnce({
        data: null,
        error: { message: 'Invalid login credentials' },
      });

      await expect(
        service.loginNative({
          email: 'owner@example.com',
          password: 'WrongPassword1!',
        }),
      ).rejects.toThrow('Invalid email or password');
      expect(mockPrisma.profile.findUnique).not.toHaveBeenCalled();
      expect(mockPrisma.profile.update).not.toHaveBeenCalled();
    });
  });

  describe('administrative staff reset and forced state ordering', () => {
    const TEMP_PASSWORD = 'Temporary#Pass1';
    const ACTOR_ID = 'actor-owner-1';
    const TARGET_ID = 'target-staff-1';
    const SHOP = 'shop_1';

    const actorProfile = (overrides: Record<string, unknown> = {}) => ({
      id: ACTOR_ID,
      role: 'OWNER',
      pawnshopId: SHOP,
      ...overrides,
    });

    const targetProfile = (overrides: Record<string, unknown> = {}) => ({
      id: TARGET_ID,
      role: 'STAFF',
      pawnshopId: SHOP,
      ...overrides,
    });

    const resolveActorAndTarget = (
      actor: Record<string, unknown>,
      target: Record<string, unknown>,
    ) => {
      mockPrisma.profile.findUnique
        .mockResolvedValueOnce(actor as never)
        .mockResolvedValueOnce(target as never);
    };

    const noCredentialStateWriteClearsTheForcedFlag = () => {
      const calls = [
        ...mockCredentialState.reserveForcedChange.mock.calls,
        ...mockCredentialState.confirmForcedChange.mock.calls,
        ...mockCredentialState.recordForcedChangeFailure.mock.calls,
      ];
      expect(JSON.stringify(calls)).not.toContain('false');
    };

    beforeEach(() => {
      mockPrisma.profile.findUnique.mockReset();
      mockPasswordPolicy.assert.mockImplementation(() => undefined);
      mockCredentialState.reserveForcedChange.mockResolvedValue({
        profileId: TARGET_ID,
        mustChangePassword: true,
        reason: CREDENTIAL_STATE_REASONS.ADMIN_RESET_PENDING,
      });
      mockCredentialState.confirmForcedChange.mockResolvedValue({
        profileId: TARGET_ID,
        mustChangePassword: true,
        reason: CREDENTIAL_STATE_REASONS.ADMIN_RESET,
      });
      mockCredentialState.recordForcedChangeFailure.mockResolvedValue({
        profileId: TARGET_ID,
        mustChangePassword: true,
        reason: CREDENTIAL_STATE_REASONS.ADMIN_RESET_FAILED,
      });
      mockSupabaseAdmin.client.auth.admin.updateUserById.mockResolvedValue({
        data: { user: { id: TARGET_ID } },
        error: null,
      });
    });

    describe('tenant scope and shared policy', () => {
      it('reserves the forced state before the Supabase write and confirms afterwards', async () => {
        resolveActorAndTarget(actorProfile(), targetProfile());

        const result = await service.changeStaffPassword(ACTOR_ID, TARGET_ID, TEMP_PASSWORD);

        expect(mockCredentialState.reserveForcedChange).toHaveBeenCalledWith(
          TARGET_ID,
          CREDENTIAL_STATE_REASONS.ADMIN_RESET_PENDING,
        );
        expect(mockCredentialState.confirmForcedChange).toHaveBeenCalledWith(
          TARGET_ID,
          CREDENTIAL_STATE_REASONS.ADMIN_RESET,
        );
        expect(result).toEqual({ changed: true, mustChangePassword: true });
        expect(JSON.stringify(result)).not.toContain(TEMP_PASSWORD);
        noCredentialStateWriteClearsTheForcedFlag();
      });

      it('orders the reservation strictly before the Supabase password change', async () => {
        const order: string[] = [];
        mockCredentialState.reserveForcedChange.mockImplementation(async () => {
          order.push('reserve');
          return { profileId: TARGET_ID, mustChangePassword: true };
        });
        mockSupabaseAdmin.client.auth.admin.updateUserById.mockImplementation(
          async () => {
            order.push('supabase');
            return { data: { user: { id: TARGET_ID } }, error: null };
          },
        );
        mockCredentialState.confirmForcedChange.mockImplementation(async () => {
          order.push('confirm');
          return { profileId: TARGET_ID, mustChangePassword: true };
        });
        resolveActorAndTarget(actorProfile(), targetProfile());

        await service.changeStaffPassword(ACTOR_ID, TARGET_ID, TEMP_PASSWORD);

        expect(order).toEqual(['reserve', 'supabase', 'confirm']);
      });

      it('rejects a weak temporary password before any state or Supabase write', async () => {
        mockPasswordPolicy.assert.mockImplementation(() => {
          throw new BadRequestException({
            success: false,
            error: 'PASSWORD_POLICY_FAILED',
            message: 'Password does not meet the required policy.',
            data: { failed: ['symbol'] },
          });
        });
        resolveActorAndTarget(actorProfile(), targetProfile());

        await expect(
          service.changeStaffPassword(ACTOR_ID, TARGET_ID, 'weak'),
        ).rejects.toMatchObject({
          response: expect.objectContaining({ error: 'PASSWORD_POLICY_FAILED' }),
        });

        expect(mockCredentialState.reserveForcedChange).not.toHaveBeenCalled();
        expect(mockSupabaseAdmin.client.auth.admin.updateUserById).not.toHaveBeenCalled();
      });

      it('refuses a cross-tenant target with no state or Supabase write', async () => {
        resolveActorAndTarget(actorProfile(), targetProfile({ pawnshopId: 'shop_2' }));

        await expect(
          service.changeStaffPassword(ACTOR_ID, TARGET_ID, TEMP_PASSWORD),
        ).rejects.toThrow(/another pawnshop/i);

        expect(mockCredentialState.reserveForcedChange).not.toHaveBeenCalled();
        expect(mockSupabaseAdmin.client.auth.admin.updateUserById).not.toHaveBeenCalled();
        expect(mockPrisma.securityLog.create).not.toHaveBeenCalled();
      });

      it('refuses a super admin target for a non-super-admin actor', async () => {
        resolveActorAndTarget(
          actorProfile({ role: 'MANAGER' }),
          targetProfile({ role: 'SUPER_ADMIN', pawnshopId: SHOP }),
        );

        await expect(
          service.changeStaffPassword(ACTOR_ID, TARGET_ID, TEMP_PASSWORD),
        ).rejects.toThrow(/super admin account/i);

        expect(mockSupabaseAdmin.client.auth.admin.updateUserById).not.toHaveBeenCalled();
        expect(mockCredentialState.reserveForcedChange).not.toHaveBeenCalled();
      });

      it('refuses an actor without administrative access', async () => {
        resolveActorAndTarget(
          actorProfile({ role: 'STAFF' }),
          targetProfile(),
        );

        await expect(
          service.changeStaffPassword(ACTOR_ID, TARGET_ID, TEMP_PASSWORD),
        ).rejects.toThrow(/admin access required/i);

        expect(mockSupabaseAdmin.client.auth.admin.updateUserById).not.toHaveBeenCalled();
      });

      it('preserves the super admin cross-tenant governance path', async () => {
        resolveActorAndTarget(
          actorProfile({ role: 'SUPER_ADMIN', pawnshopId: null }),
          targetProfile({ pawnshopId: 'shop_9' }),
        );

        await expect(
          service.changeStaffPassword(ACTOR_ID, TARGET_ID, TEMP_PASSWORD),
        ).resolves.toEqual({ changed: true, mustChangePassword: true });

        expect(mockCredentialState.reserveForcedChange).toHaveBeenCalledWith(
          TARGET_ID,
          CREDENTIAL_STATE_REASONS.ADMIN_RESET_PENDING,
        );
      });

      it('refuses a blank target id before touching the database', async () => {
        await expect(
          service.changeStaffPassword(ACTOR_ID, '   ', TEMP_PASSWORD),
        ).rejects.toMatchObject({
          response: expect.objectContaining({ message: 'A staff target is required' }),
        });

        expect(mockPrisma.profile.findUnique).not.toHaveBeenCalled();
        expect(mockSupabaseAdmin.client.auth.admin.updateUserById).not.toHaveBeenCalled();
      });
    });

    describe('audit evidence for an administrative reset', () => {
      it('opens a failure-first row with actor, target, tenant, and safe metadata', async () => {
        resolveActorAndTarget(actorProfile(), targetProfile());

        await service.changeStaffPassword(ACTOR_ID, TARGET_ID, TEMP_PASSWORD);

        const [createArgs] = mockPrisma.securityLog.create.mock.calls[0];
        expect(createArgs.data).toMatchObject({
          profileId: TARGET_ID,
          actorProfileId: ACTOR_ID,
          targetProfileId: TARGET_ID,
          pawnshopId: SHOP,
          action: 'ADMIN_PASSWORD_RESET',
          success: false,
          metadata: { targetRole: 'STAFF' },
        });
        expect(mockPrisma.securityLog.update).toHaveBeenCalledWith({
          where: { id: 'audit-1' },
          data: { success: true },
        });
        expect(JSON.stringify(mockPrisma.securityLog.create.mock.calls)).not.toContain(
          TEMP_PASSWORD,
        );
      });

      it('omits the tenant column when the target has no pawnshop', async () => {
        resolveActorAndTarget(
          actorProfile({ pawnshopId: null }),
          targetProfile({ pawnshopId: null }),
        );

        await service.changeStaffPassword(ACTOR_ID, TARGET_ID, TEMP_PASSWORD);

        const [createArgs] = mockPrisma.securityLog.create.mock.calls[0];
        expect(createArgs.data).not.toHaveProperty('pawnshopId');
      });

      it('still completes the reset when the audit sink is unavailable', async () => {
        mockPrisma.securityLog.create.mockRejectedValue(new Error('audit down'));
        mockPrisma.securityLog.update.mockRejectedValue(new Error('audit down'));
        resolveActorAndTarget(actorProfile(), targetProfile());
        const consoleError = jest
          .spyOn(console, 'error')
          .mockImplementation(() => undefined);

        await expect(
          service.changeStaffPassword(ACTOR_ID, TARGET_ID, TEMP_PASSWORD),
        ).resolves.toEqual({ changed: true, mustChangePassword: true });

        consoleError.mockRestore();
        expect(
          JSON.stringify(consoleError.mock.calls.flat(Infinity)),
        ).not.toContain(TEMP_PASSWORD);
      });
    });

    describe('injected forced-state and Supabase failure', () => {
      it('never calls Supabase when the forced-state reservation fails', async () => {
        mockCredentialState.reserveForcedChange.mockRejectedValue(
          new CredentialStateUnavailableError('dependency', new Error('prisma down')),
        );
        resolveActorAndTarget(actorProfile(), targetProfile());

        await expect(
          service.changeStaffPassword(ACTOR_ID, TARGET_ID, TEMP_PASSWORD),
        ).rejects.toMatchObject({
          response: expect.objectContaining({
            error: 'CREDENTIAL_STATE_UNAVAILABLE',
          }),
        });

        expect(mockSupabaseAdmin.client.auth.admin.updateUserById).not.toHaveBeenCalled();
        expect(mockCredentialState.confirmForcedChange).not.toHaveBeenCalled();
        expect(mockPrisma.securityLog.update).toHaveBeenCalledWith({
          where: { id: 'audit-1' },
          data: { success: false, metadata: { failureStage: 'forced_state_reservation' } },
        });
      });

      it('leaves the forced state true after a Supabase failure and never compensates to false', async () => {
        mockSupabaseAdmin.client.auth.admin.updateUserById.mockResolvedValue({
          data: null,
          error: { message: `Supabase rejected ${TEMP_PASSWORD}` },
        });
        resolveActorAndTarget(actorProfile(), targetProfile());

        await expect(
          service.changeStaffPassword(ACTOR_ID, TARGET_ID, TEMP_PASSWORD),
        ).rejects.toMatchObject({
          response: expect.objectContaining({ error: 'ADMIN_PASSWORD_RESET_FAILED' }),
        });

        expect(mockCredentialState.reserveForcedChange).toHaveBeenCalledWith(
          TARGET_ID,
          CREDENTIAL_STATE_REASONS.ADMIN_RESET_PENDING,
        );
        expect(mockCredentialState.recordForcedChangeFailure).toHaveBeenCalledWith(
          TARGET_ID,
          CREDENTIAL_STATE_REASONS.ADMIN_RESET_FAILED,
        );
        noCredentialStateWriteClearsTheForcedFlag();
        expect(mockPrisma.securityLog.update).toHaveBeenCalledWith({
          where: { id: 'audit-1' },
          data: { success: false, metadata: { failureStage: 'supabase_update' } },
        });
      });

      it('never repeats the temporary password in the failure response or logs', async () => {
        const consoleError = jest
          .spyOn(console, 'error')
          .mockImplementation(() => undefined);
        mockSupabaseAdmin.client.auth.admin.updateUserById.mockResolvedValue({
          data: null,
          error: { message: `Supabase rejected ${TEMP_PASSWORD}` },
        });
        resolveActorAndTarget(actorProfile(), targetProfile());

        let failure: { getResponse?: () => unknown; message: string } = null;
        await service
          .changeStaffPassword(ACTOR_ID, TARGET_ID, TEMP_PASSWORD)
          .catch((error: unknown) => {
            failure = error as { getResponse?: () => unknown; message: string };
          });

        expect(failure).not.toBeNull();
        expect(JSON.stringify(failure?.getResponse?.())).not.toContain(TEMP_PASSWORD);
        expect(failure?.message).not.toContain(TEMP_PASSWORD);
        expect(JSON.stringify(consoleError.mock.calls.flat(Infinity))).not.toContain(
          TEMP_PASSWORD,
        );
        consoleError.mockRestore();
      });

      it('keeps the forced state true when the failure marker write itself fails', async () => {
        const consoleError = jest
          .spyOn(console, 'error')
          .mockImplementation(() => undefined);
        mockSupabaseAdmin.client.auth.admin.updateUserById.mockResolvedValue({
          data: null,
          error: { message: 'Supabase unavailable' },
        });
        mockCredentialState.recordForcedChangeFailure.mockRejectedValue(
          new CredentialStateUnavailableError('dependency', new Error('prisma down')),
        );
        resolveActorAndTarget(actorProfile(), targetProfile());

        await expect(
          service.changeStaffPassword(ACTOR_ID, TARGET_ID, TEMP_PASSWORD),
        ).rejects.toMatchObject({
          response: expect.objectContaining({ error: 'ADMIN_PASSWORD_RESET_FAILED' }),
        });

        noCredentialStateWriteClearsTheForcedFlag();
        expect(mockPrisma.securityLog.update).toHaveBeenCalledWith({
          where: { id: 'audit-1' },
          data: { success: false, metadata: { failureStage: 'supabase_update' } },
        });
        consoleError.mockRestore();
      });
    });
  });
});
