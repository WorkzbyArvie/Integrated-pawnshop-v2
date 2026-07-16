import { Test, TestingModule } from '@nestjs/testing';
import { LegalProofService } from './legal-proof.service';
import { PrismaService } from '../prisma.service';

describe('LegalProofService', () => {
  let service: LegalProofService;
  let prisma: Record<string, any>;

  beforeEach(async () => {
    prisma = {
      legalProof: {
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'proof-1', ...data })),
        findMany: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [LegalProofService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<LegalProofService>(LegalProofService);
  });

  it('produces a stable hash for semantically identical payloads', async () => {
    const first = await service.createProof({
      pawnshopId: '11111111-1111-1111-1111-111111111111',
      recordType: 'PAYMENT_PROOF' as any,
      title: 'Payment proof',
      summary: 'Payment recorded',
      createdBy: '22222222-2222-2222-2222-222222222222',
      paymentId: '33333333-3333-3333-3333-333333333333',
      payload: { b: 2, a: 1 },
    });

    const second = await service.createProof({
      pawnshopId: '11111111-1111-1111-1111-111111111111',
      recordType: 'PAYMENT_PROOF' as any,
      title: 'Payment proof 2',
      summary: 'Payment recorded',
      createdBy: '22222222-2222-2222-2222-222222222222',
      paymentId: '44444444-4444-4444-4444-444444444444',
      payload: { a: 1, b: 2 },
    });

    expect(first.sourceHash).toBe(second.sourceHash);
    expect(prisma.legalProof.create).toHaveBeenCalledTimes(2);
  });
});