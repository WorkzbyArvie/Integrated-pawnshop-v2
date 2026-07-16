import { BrandingService } from './branding.service';

describe('BrandingService', () => {
  const prismaMock = {
    branding: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  } as any;

  let service: BrandingService;

  beforeEach(() => {
    service = new BrandingService(prismaMock);
    prismaMock.branding.findMany.mockReset();
    prismaMock.branding.findUnique.mockReset();
  });

  it('returns empty list when branding relation is missing', async () => {
    prismaMock.branding.findMany.mockRejectedValue(
      new Error('relation "brandings" does not exist'),
    );

    await expect(service.findAll()).resolves.toEqual([]);
  });

  it('returns null when branding relation is missing in findOne', async () => {
    prismaMock.branding.findUnique.mockRejectedValue(
      new Error('relation "brandings" does not exist'),
    );

    await expect(service.findOne(1)).resolves.toBeNull();
  });

  it('returns empty list for non-schema errors in findAll', async () => {
    prismaMock.branding.findMany.mockRejectedValue(new Error('connection timeout'));

    await expect(service.findAll()).resolves.toEqual([]);
  });

  it('returns null for non-schema errors in findOne', async () => {
    prismaMock.branding.findUnique.mockRejectedValue(new Error('connection timeout'));

    await expect(service.findOne(1)).resolves.toBeNull();
  });
});
