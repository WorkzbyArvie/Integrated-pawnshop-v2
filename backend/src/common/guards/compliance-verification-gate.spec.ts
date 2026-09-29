import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ComplianceGuard } from './compliance.guard';
import { PrismaService } from '../../prisma.service';
import { AuthUserService } from '../auth-user.service';
import { COMPLIANCE_KEY } from '../decorators/requires-compliance.decorator';

/**
 * A shop may only operate on verified, unexpired documents.
 *
 * Uploading a file is not the same act as holding a valid licence - anyone can
 * put a file in a bucket - but the score treated the two as comparable. Seven
 * mandatory documents uploaded and none of them approved scored 70 out of 100
 * and cleared the 40 threshold, so a shop could open a pawn ticket, disburse a
 * loan and bid in an auction on documents no Super Admin had ever looked at.
 *
 * That defeats the point of the gate. The score stays for display and partial
 * progress; it no longer decides whether the shop may transact.
 */

const SHOP = 'shop-1';

type Doc = {
  documentType: string;
  status: string;
  expiryDate: Date | null;
  createdAt: Date;
};

const days = (n: number) => new Date(Date.now() + n * 86_400_000);
const ago = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000);

const ALL_REQUIRED = [
  'DTI_REGISTRATION',
  'MAYORS_PERMIT',
  'BIR_COR',
  'BSP_LICENSE',
  'AMLC_REGISTRATION',
  'GOVERNMENT_ID',
  'PROOF_OF_ADDRESS',
];

/** All seven approved and current. */
const compliant = (): Doc[] =>
  ALL_REQUIRED.map((documentType) => ({
    documentType,
    status: 'VERIFIED',
    expiryDate: days(365),
    createdAt: ago(1),
  }));

describe('ComplianceGuard verification gate', () => {
  let guard: ComplianceGuard;
  let documents: Doc[];

  beforeEach(async () => {
    documents = compliant();

    const prisma = {
      profile: {
        findUnique: jest.fn().mockResolvedValue({ role: 'OWNER', pawnshopId: SHOP }),
      },
      pawnshopDocument: {
        findMany: jest.fn(async () => documents),
      },
      subscription: {
        findFirst: jest.fn().mockResolvedValue({ id: 'sub-1', status: 'ACTIVE' }),
      },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ComplianceGuard,
        { provide: PrismaService, useValue: prisma },
        { provide: AuthUserService, useValue: { getUserIdFromAuthHeader: async () => 'user-1' } },
        {
          provide: Reflector,
          useValue: { getAllAndOverride: (key: unknown) => (key === COMPLIANCE_KEY ? 40 : undefined) },
        },
      ],
    }).compile();

    guard = moduleRef.get(ComplianceGuard);
  });

  it('admits a shop whose mandatory documents are all verified and current', async () => {
    await expect(guard.canActivate(makeContext())).resolves.toBe(true);
  });

  it('blocks a shop that has uploaded everything but had nothing approved', async () => {
    // The exact case the score used to wave through: 7 uploaded, 0 verified.
    documents = ALL_REQUIRED.map((documentType) => ({
      documentType,
      status: 'UPLOADED',
      expiryDate: days(365),
      createdAt: ago(1),
    }));

    await expect(guard.canActivate(makeContext())).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('names the documents that are blocking, not just "not compliant"', async () => {
    documents = ALL_REQUIRED.map((documentType) => ({
      documentType,
      status: documentType === 'BIR_COR' ? 'UPLOADED' : 'VERIFIED',
      expiryDate: days(365),
      createdAt: ago(1),
    }));

    await expect(guard.canActivate(makeContext())).rejects.toThrow(/BIR Certificate of Registration/);
  });

  it('blocks when a verified document has lapsed', async () => {
    documents = ALL_REQUIRED.map((documentType) => ({
      documentType,
      status: 'VERIFIED',
      expiryDate: documentType === 'MAYORS_PERMIT' ? ago(2) : days(365),
      createdAt: ago(1),
    }));

    await expect(guard.canActivate(makeContext())).rejects.toThrow(/Mayor's Permit/);
  });

  it('blocks on a rejected document', async () => {
    documents = ALL_REQUIRED.map((documentType) => ({
      documentType,
      status: documentType === 'BSP_LICENSE' ? 'REJECTED' : 'VERIFIED',
      expiryDate: days(365),
      createdAt: ago(1),
    }));

    await expect(guard.canActivate(makeContext())).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('blocks when a mandatory document was never uploaded', async () => {
    documents = compliant().filter((d) => d.documentType !== 'AMLC_REGISTRATION');

    await expect(guard.canActivate(makeContext())).rejects.toThrow(/AMLC Registration/);
  });

  it('judges the newest submission, so a rejected retry does not revive a stale approval', async () => {
    const older: Doc = {
      documentType: 'BIR_COR',
      status: 'VERIFIED',
      expiryDate: days(365),
      createdAt: ago(30),
    };
    const newer: Doc = {
      documentType: 'BIR_COR',
      status: 'REJECTED',
      expiryDate: days(365),
      createdAt: ago(1),
    };
    documents = [...compliant().filter((d) => d.documentType !== 'BIR_COR'), older, newer];

    await expect(guard.canActivate(makeContext())).rejects.toThrow(/BIR Certificate of Registration/);
  });

  it('reports the machine-readable code and the blocking list, not the bare score', async () => {
    documents = [];

    await expect(guard.canActivate(makeContext())).rejects.toMatchObject({
      response: expect.objectContaining({
        error: 'COMPLIANCE_VERIFICATION_REQUIRED',
        data: { documents: expect.arrayContaining(['BIR_COR']) },
      }),
    });
  });

  it('names the documents even when nothing at all has been uploaded', async () => {
    documents = [];

    // A shop that has uploaded nothing used to get "10% is below the required
    // 40%", which is true and tells the owner nothing about what to do. The
    // denial has to name the work.
    await expect(guard.canActivate(makeContext())).rejects.toThrow(
      /DTI\/SEC Registration/,
    );
  });
});

function makeContext() {
  return {
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({
      getRequest: () => ({ headers: { authorization: 'Bearer token' } }),
    }),
  } as never;
}
