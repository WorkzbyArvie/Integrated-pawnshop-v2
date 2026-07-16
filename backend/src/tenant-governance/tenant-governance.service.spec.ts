import { ForbiddenException } from '@nestjs/common';
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
});
