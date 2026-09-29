import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ComplianceService } from './compliance.service';
import { PrismaService } from '../prisma.service';
import { NotificationService } from '../notification/notification.service';

/**
 * A compliance document has to carry a usable expiry date.
 *
 * The scoring guard reads a `notExpired` band, so a document with no expiry was
 * worth full marks forever. For a legality argument that is the failure mode
 * that matters: a permit nobody is obliged to renew is a permit that quietly
 * stops being enforced while the shop keeps trading on it. Requiring the date
 * at upload makes the shop state a dated, explicit claim about validity, and
 * makes it the party that has to come back before the date passes.
 *
 * A past date is refused as well. It would satisfy "an expiry exists" while
 * contributing nothing to the score, reopening the same gap through the front
 * door - a shop could clear the requirement with a permit that lapsed last
 * month.
 */

const OWNER = { id: 'user-1', pawnshopId: 'shop-1', role: 'OWNER' } as never;

describe('ComplianceService document expiry', () => {
  let service: ComplianceService;
  let prisma: { pawnshopDocument: Record<string, jest.Mock> };

  const baseDto = {
    documentType: 'BIR_COR' as never,
    fileUrl: 'https://example.test/doc.pdf',
    fileName: 'bir.pdf',
  };

  const futureDate = () => {
    const d = new Date();
    d.setUTCFullYear(d.getUTCFullYear() + 1);
    return d.toISOString();
  };

  const pastDate = () => {
    const d = new Date();
    d.setUTCFullYear(d.getUTCFullYear() - 1);
    return d.toISOString();
  };

  beforeEach(async () => {
    prisma = {
      pawnshopDocument: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn(),
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'doc-1', ...data })),
        update: jest.fn().mockResolvedValue({}),
      },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ComplianceService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationService, useValue: { create: jest.fn() } },
      ],
    }).compile();

    service = moduleRef.get(ComplianceService);
    jest.spyOn(service as never, 'getProfileOrThrow').mockResolvedValue(OWNER);
  });

  describe('uploadDocument', () => {
    // Each case asserts the specific reason, not just BadRequestException.
    //
    // Asserting only the type let a mutation survive: removing the
    // `if (!expiryDate)` guard still threw, because `new Date(undefined)` is
    // NaN and the *next* guard caught it. The suite passed with a guard removed,
    // which is worse than no test - it reports coverage that is not there. Each
    // reason is now pinned so deleting any one guard fails the suite.
    it('rejects a document with no expiry date, and says so', async () => {
      await expect(
        service.uploadDocument('user-1', { ...baseDto, expiryDate: undefined } as never),
      ).rejects.toThrow(/expiry date is required/i);
      expect(prisma.pawnshopDocument.create).not.toHaveBeenCalled();
    });

    it('rejects an expiry date already in the past, and says so', async () => {
      await expect(
        service.uploadDocument('user-1', { ...baseDto, expiryDate: pastDate() } as never),
      ).rejects.toThrow(/in the past/i);
      expect(prisma.pawnshopDocument.create).not.toHaveBeenCalled();
    });

    it('rejects an unparseable expiry date, and says so', async () => {
      await expect(
        service.uploadDocument('user-1', { ...baseDto, expiryDate: 'not-a-date' } as never),
      ).rejects.toThrow(/not a valid date/i);
      expect(prisma.pawnshopDocument.create).not.toHaveBeenCalled();
    });

    it('accepts a future expiry and stores it as a timestamp', async () => {
      const expiry = futureDate();
      await service.uploadDocument('user-1', { ...baseDto, expiryDate: expiry } as never);

      expect(prisma.pawnshopDocument.create).toHaveBeenCalledTimes(1);
      const created = prisma.pawnshopDocument.create.mock.calls[0][0].data;
      expect(created.expiryDate).toBeInstanceOf(Date);
      expect(created.expiryDate.toISOString().slice(0, 10)).toBe(expiry.slice(0, 10));
    });

    it('accepts a date that is today, so a day-granularity boundary does not lock a shop out', async () => {
      const today = new Date().toISOString().slice(0, 10);
      await expect(
        service.uploadDocument('user-1', { ...baseDto, expiryDate: today } as never),
      ).resolves.toBeDefined();
    });
  });

  describe('renewDocument', () => {
    beforeEach(() => {
      prisma.pawnshopDocument.findUnique.mockResolvedValue({
        id: 'doc-1',
        pawnshopId: 'shop-1',
        documentType: 'BIR_COR',
      });
    });

    it('refuses to renew onto a lapsed date, and says so', async () => {
      await expect(
        service.renewDocument('user-1', 'doc-1', {
          ...baseDto,
          expiryDate: pastDate(),
        } as never),
      ).rejects.toThrow(/in the past/i);
      // The old row must not be flipped to EXPIRED before the new one is
      // accepted, or a rejected renewal would leave the shop with nothing valid.
      expect(prisma.pawnshopDocument.update).not.toHaveBeenCalled();
      expect(prisma.pawnshopDocument.create).not.toHaveBeenCalled();
    });

    it('refuses to renew with no expiry at all, and says so', async () => {
      await expect(
        service.renewDocument('user-1', 'doc-1', { ...baseDto } as never),
      ).rejects.toThrow(/expiry date is required/i);
      expect(prisma.pawnshopDocument.create).not.toHaveBeenCalled();
    });

    it('accepts a renewal with a future expiry', async () => {
      await expect(
        service.renewDocument('user-1', 'doc-1', {
          ...baseDto,
          expiryDate: futureDate(),
        } as never),
      ).resolves.toBeDefined();
    });
  });
});
