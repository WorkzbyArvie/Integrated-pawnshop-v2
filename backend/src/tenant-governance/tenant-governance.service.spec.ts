import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { TenantGovernanceService } from './tenant-governance.service';

describe('TenantGovernanceService', () => {
  const ACTOR_ID = '11111111-1111-1111-1111-111111111111';
  const PAWNSHOP_ID = '22222222-2222-2222-2222-222222222222';

  let prisma: Record<string, any>;
  let service: TenantGovernanceService;

  beforeEach(() => {
    prisma = {
      profile: {
        findUnique: jest.fn(),
      },
      pawnshop: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
      },
      adminInvite: {
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      subscription: {
        findFirst: jest.fn(),
        create: jest.fn(),
      },
      $queryRaw: jest.fn(),
      $executeRaw: jest.fn(),
    };

    service = new TenantGovernanceService(prisma as any);
    jest.spyOn(service as any, 'logAudit').mockResolvedValue(undefined);
  });

  it('rejects branding updates when plan does not include custom branding', async () => {
    prisma.profile.findUnique.mockResolvedValue({
      id: ACTOR_ID,
      role: 'OWNER',
      pawnshopId: PAWNSHOP_ID,
      email: 'owner@test.com',
    });
    prisma.pawnshop.findUnique.mockResolvedValue({
      id: PAWNSHOP_ID,
      name: 'Pawnshop Gold',
    });
    prisma.$queryRaw.mockResolvedValue([{ features: { custom_branding: false } }]);

    await expect(
      service.updateBranding(ACTOR_ID, {
        pawnshopId: PAWNSHOP_ID,
        displayName: 'Custom Gold',
        logoUrl: 'https://cdn.test/logo.png',
        primaryColor: '#111111',
        secondaryColor: '#222222',
      }),
    ).rejects.toThrow(ForbiddenException);

    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('persists branding when custom branding entitlement is enabled', async () => {
    prisma.profile.findUnique.mockResolvedValue({
      id: ACTOR_ID,
      role: 'OWNER',
      pawnshopId: PAWNSHOP_ID,
      email: 'owner@test.com',
    });
    prisma.pawnshop.findUnique.mockResolvedValue({
      id: PAWNSHOP_ID,
      name: 'Pawnshop Gold',
    });
    prisma.$queryRaw.mockResolvedValue([{ features: { custom_branding: true } }]);
    prisma.$executeRaw.mockResolvedValue(1);

    const result = await service.updateBranding(ACTOR_ID, {
      pawnshopId: PAWNSHOP_ID,
      displayName: 'Custom Gold',
      logoUrl: 'https://cdn.test/logo.png',
      primaryColor: '#111111',
      secondaryColor: '#222222',
    });

    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(true);
    expect((result as any).branding).toMatchObject({
      pawnshopId: PAWNSHOP_ID,
      displayName: 'Custom Gold',
      logoUrl: 'https://cdn.test/logo.png',
      primaryColor: '#111111',
      secondaryColor: '#222222',
      customBrandingEnabled: true,
    });
  });

  describe('reviewClientRegistrationRequest ONB-01 gate', () => {
    const REQ_ID = '33333333-3333-3333-3333-333333333333';

    const requestRow = {
      id: REQ_ID,
      pawnshop_name: 'Gold Pawn',
      owner_name: 'O',
      owner_email: 'owner@test.com',
      contact_number: null,
      selected_modules: null,
      staff_count: 2,
      notes: null,
      status: 'PENDING',
    };

    beforeEach(() => {
      prisma.profile.findUnique.mockResolvedValue({
        id: ACTOR_ID,
        role: 'SUPER_ADMIN',
        pawnshopId: null,
        email: 'admin@test.com',
      });
      prisma.pawnshop.findFirst.mockResolvedValue({
        id: PAWNSHOP_ID,
        name: 'Gold Pawn',
        ownerEmail: 'owner@test.com',
        status: 'ACTIVE',
      });
      prisma.adminInvite.findFirst.mockResolvedValue({ id: 'invite_1' });
      prisma.adminInvite.update.mockResolvedValue({ id: 'invite_1', role: 'OWNER' });
      prisma.subscription.findFirst.mockResolvedValue(null);
      prisma.subscription.create.mockResolvedValue({ id: 'sub_1' });
      prisma.$executeRaw.mockResolvedValue(1);
      jest.spyOn(service as any, 'ensureRegistrationChatTables').mockResolvedValue(undefined);
      jest.spyOn(service as any, 'ensureTenantModuleConfigTable').mockResolvedValue(undefined);
    });

    it('blocks APPROVED when a required document type is missing, with zero side effects', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([requestRow])
        .mockResolvedValueOnce([{ doc_type: 'BIR_COR' }]);

      const error = await service
        .reviewClientRegistrationRequest(ACTOR_ID, REQ_ID, { decision: 'APPROVED' })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as Error).message).toContain('BIR_COR');
      expect(prisma.pawnshop.findFirst).not.toHaveBeenCalled();
      expect(prisma.$executeRaw).not.toHaveBeenCalled();
      expect((service as any).ensureTenantModuleConfigTable).not.toHaveBeenCalled();
    });

    it('blocks APPROVED when a required document is REJECTED or EXPIRED', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([requestRow])
        .mockResolvedValueOnce([{ doc_type: 'BSP_LICENSE' }]);

      const error = await service
        .reviewClientRegistrationRequest(ACTOR_ID, REQ_ID, { decision: 'APPROVED' })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as Error).message).toContain('BSP_LICENSE');
      expect(prisma.$executeRaw).not.toHaveBeenCalled();
      expect((service as any).ensureTenantModuleConfigTable).not.toHaveBeenCalled();
    });

    it('approves when all 7 required document types are acceptable', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([requestRow])
        .mockResolvedValueOnce([]);

      const result = await service.reviewClientRegistrationRequest(ACTOR_ID, REQ_ID, {
        decision: 'APPROVED',
      });

      expect(result).toMatchObject({ success: true, decision: 'APPROVED' });
      expect((service as any).ensureTenantModuleConfigTable).toHaveBeenCalled();
      expect(prisma.pawnshop.findFirst).toHaveBeenCalled();
      expect(prisma.$executeRaw).toHaveBeenCalled();
    });

    it('skips the gate for CONTACTED decisions', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([requestRow]);

      const result = await service.reviewClientRegistrationRequest(ACTOR_ID, REQ_ID, {
        decision: 'CONTACTED',
      });

      expect(result).toMatchObject({ success: true, decision: 'CONTACTED' });
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
      expect(prisma.pawnshop.findFirst).not.toHaveBeenCalled();
      expect((service as any).ensureTenantModuleConfigTable).not.toHaveBeenCalled();
    });

    it('skips the gate for REJECTED decisions', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([requestRow]);

      const result = await service.reviewClientRegistrationRequest(ACTOR_ID, REQ_ID, {
        decision: 'REJECTED',
      });

      expect(result).toMatchObject({ success: true, decision: 'REJECTED' });
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
      expect(prisma.pawnshop.findFirst).not.toHaveBeenCalled();
      expect((service as any).ensureTenantModuleConfigTable).not.toHaveBeenCalled();
    });
  });
});
