import { Test, TestingModule } from '@nestjs/testing';
import { ReceiptService } from './receipt.service';
import { PrismaService } from '../prisma.service';
import { StorageService } from '../common/storage/storage.service';

describe('ReceiptService', () => {
  let service: ReceiptService;
  let prisma: Record<string, any>;

  beforeEach(async () => {
    prisma = {
      receipt: {
        create: jest.fn().mockResolvedValue({ id: 'receipt-1' }),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        count: jest.fn(),
        update: jest.fn(),
      },
      legalProof: {
        create: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReceiptService,
        { provide: PrismaService, useValue: prisma },
        { provide: StorageService, useValue: { uploadPdf: jest.fn().mockResolvedValue('receipts/test.pdf'), getDownloadUrl: jest.fn() } },
      ],
    }).compile();

    service = module.get<ReceiptService>(ReceiptService);
  });

  it('builds a non-empty pdf buffer for receipt output', async () => {
    const pdfBuffer = await (service as any).generateReceiptPdf({
      receiptNumber: 'RCP-TEST-001',
      pawnshopName: 'Pawnshop One',
      customerName: 'Test Customer',
      customerAddress: 'Test Address',
      amount: 1000,
      taxAmount: 100,
      totalAmount: 1100,
      lineItems: [{ description: 'Loan Repayment', amount: 1000, quantity: 1 }],
      receiptType: 'PAYMENT',
    });

    expect(Buffer.isBuffer(pdfBuffer)).toBe(true);
    expect(pdfBuffer.length).toBeGreaterThan(0);
  });
});
