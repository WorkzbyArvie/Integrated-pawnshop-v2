import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { TenantGovernanceService, REQUIRED_ONBOARDING_DOC_TYPES } from './tenant-governance.service';

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

  describe('markRegistrationDocumentViewed / reviewRegistrationDocument hasViewed (ONB-02)', () => {
    const REQ_ID = '44444444-4444-4444-4444-444444444444';
    const DOC_ID = '55555555-5555-5555-5555-555555555555';

    beforeEach(() => {
      prisma.profile.findUnique.mockResolvedValue({
        id: ACTOR_ID,
        role: 'SUPER_ADMIN',
        pawnshopId: null,
        email: 'admin@test.com',
      });
    });

    it('persists viewed state for a SUPER_ADMIN and returns success', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([{ id: DOC_ID }])
        .mockResolvedValueOnce(undefined);

      const result = await service.markRegistrationDocumentViewed(ACTOR_ID, REQ_ID, DOC_ID);

      expect(result).toEqual({ success: true, hasViewed: true });
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
    });

    it('is idempotent - re-viewing an already-viewed document still runs the UPDATE', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([{ id: DOC_ID }])
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce([{ id: DOC_ID }])
        .mockResolvedValueOnce(undefined);

      await service.markRegistrationDocumentViewed(ACTOR_ID, REQ_ID, DOC_ID);
      await service.markRegistrationDocumentViewed(ACTOR_ID, REQ_ID, DOC_ID);

      expect(prisma.$queryRaw).toHaveBeenCalledTimes(4);
    });

    it('rejects non-SUPER_ADMIN with BadRequestException and never queries', async () => {
      prisma.profile.findUnique.mockResolvedValue({
        id: ACTOR_ID,
        role: 'OWNER',
        pawnshopId: PAWNSHOP_ID,
        email: 'owner@test.com',
      });

      await expect(
        service.markRegistrationDocumentViewed(ACTOR_ID, REQ_ID, DOC_ID),
      ).rejects.toThrow(BadRequestException);

      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('throws NotFoundException for an unknown document', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([]);

      await expect(
        service.markRegistrationDocumentViewed(ACTOR_ID, REQ_ID, DOC_ID),
      ).rejects.toThrow(NotFoundException);
    });

    it('blocks APPROVED when the document has not been viewed', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([
        { id: DOC_ID, status: 'UPLOADED', has_viewed: false },
      ]);

      const error = await service
        .reviewRegistrationDocument(ACTOR_ID, REQ_ID, DOC_ID, { decision: 'APPROVED' })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as Error).message).toContain('must be viewed');
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    });

    it('allows APPROVED after the document has been viewed', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([{ id: DOC_ID, status: 'UPLOADED', has_viewed: true }])
        .mockResolvedValueOnce(undefined);

      const result = await service.reviewRegistrationDocument(ACTOR_ID, REQ_ID, DOC_ID, {
        decision: 'APPROVED',
      });

      expect(result).toEqual({ success: true, status: 'VERIFIED' });
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
    });

    it('allows REJECTED without viewing', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([{ id: DOC_ID, status: 'UPLOADED', has_viewed: false }])
        .mockResolvedValueOnce(undefined);

      const result = await service.reviewRegistrationDocument(ACTOR_ID, REQ_ID, DOC_ID, {
        decision: 'REJECTED',
      });

      expect(result).toEqual({ success: true, status: 'REJECTED' });
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
    });

    it('preserves the finalized-status lock even when the document was viewed', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([
        { id: DOC_ID, status: 'VERIFIED', has_viewed: true },
      ]);

      const error = await service
        .reviewRegistrationDocument(ACTOR_ID, REQ_ID, DOC_ID, { decision: 'APPROVED' })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as Error).message).toContain('already been verified');
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    });
  });

  describe('getMyRegistrationStatus (ONB-03)', () => {
    const REQ_ID = '66666666-6666-6666-6666-666666666666';
    const requiredTypes = REQUIRED_ONBOARDING_DOC_TYPES.map((t) => t.toUpperCase());

    beforeEach(() => {
      prisma.profile.findUnique.mockResolvedValue({
        id: ACTOR_ID,
        role: 'OWNER',
        pawnshopId: PAWNSHOP_ID,
        email: 'owner@example.com',
      });
    });

    it('maps any REJECTED document to ACTION_REQUIRED and passes rejection_reason through', async () => {
      const docs = requiredTypes.map((t, i) => ({
        document_type: t,
        status: i === 0 ? 'REJECTED' : 'VERIFIED',
        rejection_reason: i === 0 ? 'blurry photo' : null,
      }));
      prisma.$queryRaw
        .mockResolvedValueOnce([{ id: REQ_ID, status: 'PENDING' }])
        .mockResolvedValueOnce(docs);

      const result = (await service.getMyRegistrationStatus(ACTOR_ID)) as any;

      expect(result.overall).toBe('ACTION_REQUIRED');
      expect(result.submissionStatus).toBe('PENDING');
      const rejectedDoc = result.documents.find(
        (d: any) => d.status === 'REJECTED',
      );
      expect(rejectedDoc.document_type).toBe(requiredTypes[0]);
      expect(rejectedDoc.rejection_reason).toBe('blurry photo');
    });

    it('reports INCOMPLETE when a required document type is missing', async () => {
      const docs = requiredTypes.slice(0, 6).map((t) => ({
        document_type: t,
        status: 'VERIFIED',
        rejection_reason: null,
      }));
      prisma.$queryRaw
        .mockResolvedValueOnce([{ id: REQ_ID, status: 'PENDING' }])
        .mockResolvedValueOnce(docs);

      const result = (await service.getMyRegistrationStatus(ACTOR_ID)) as any;

      expect(result.overall).toBe('INCOMPLETE');
      expect(result.documents).toHaveLength(6);
    });

    it('reports APPROVED when all 7 required types are VERIFIED', async () => {
      const docs = requiredTypes.map((t) => ({
        document_type: t,
        status: 'VERIFIED',
        rejection_reason: null,
      }));
      prisma.$queryRaw
        .mockResolvedValueOnce([{ id: REQ_ID, status: 'PENDING' }])
        .mockResolvedValueOnce(docs);

      const result = (await service.getMyRegistrationStatus(ACTOR_ID)) as any;

      expect(result.overall).toBe('APPROVED');
      expect(result.documents).toHaveLength(7);
    });

    it('reports PENDING_REVIEW when all types are present but some are not VERIFIED', async () => {
      const docs = requiredTypes.map((t, i) => ({
        document_type: t,
        status: i < 3 ? 'VERIFIED' : 'UPLOADED',
        rejection_reason: null,
      }));
      prisma.$queryRaw
        .mockResolvedValueOnce([{ id: REQ_ID, status: 'PENDING' }])
        .mockResolvedValueOnce(docs);

      const result = (await service.getMyRegistrationStatus(ACTOR_ID)) as any;

      expect(result.overall).toBe('PENDING_REVIEW');
      expect(result.submissionStatus).toBe('PENDING');
    });

    it('returns INCOMPLETE/NONE shape when the owner has no registration requests', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([]);

      const result = (await service.getMyRegistrationStatus(ACTOR_ID)) as any;

      expect(result).toEqual({
        overall: 'INCOMPLETE',
        documents: [],
        submissionStatus: 'NONE',
      });
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    });

    it('skips CANCELLED requests and aggregates the most-recent non-cancelled one', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([
          { id: 'req-c', status: 'CANCELLED', created_at: new Date('2026-08-02') },
          { id: REQ_ID, status: 'CONTACTED', created_at: new Date('2026-08-01') },
        ])
        .mockResolvedValueOnce(
          requiredTypes.map((t) => ({
            document_type: t,
            status: 'VERIFIED',
            rejection_reason: null,
          })),
        );

      const result = (await service.getMyRegistrationStatus(ACTOR_ID)) as any;

      expect(result.submissionStatus).toBe('CONTACTED');
      expect(result.overall).toBe('APPROVED');
    });

    it('includes DRAFT requests so missing docs surface as INCOMPLETE', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([{ id: REQ_ID, status: 'DRAFT' }])
        .mockResolvedValueOnce([]);

      const result = (await service.getMyRegistrationStatus(ACTOR_ID)) as any;

      expect(result.submissionStatus).toBe('DRAFT');
      expect(result.overall).toBe('INCOMPLETE');
    });

    it('rejects with 400 when the profile email is missing and never queries', async () => {
      prisma.profile.findUnique.mockResolvedValue({
        id: ACTOR_ID,
        role: 'OWNER',
        pawnshopId: PAWNSHOP_ID,
        email: null,
      });

      await expect(service.getMyRegistrationStatus(ACTOR_ID)).rejects.toThrow(
        BadRequestException,
      );

      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });
  });
});
