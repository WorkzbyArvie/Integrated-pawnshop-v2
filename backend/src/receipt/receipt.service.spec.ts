import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
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

  describe('tenant access', () => {
    const receipt = { id: 'receipt-1', pawnshopId: 'shop-a' };

    it('allows the shop that owns the receipt', () => {
      expect(() =>
        service.assertTenantAccess(receipt, { pawnshopId: 'shop-a', role: 'OWNER' }),
      ).not.toThrow();
    });

    it('refuses a read of another shop receipt', () => {
      expect(() =>
        service.assertTenantAccess(receipt, { pawnshopId: 'shop-b', role: 'OWNER' }),
      ).toThrow(ForbiddenException);
    });

    it('refuses an account with no tenant rather than allowing the read', () => {
      expect(() =>
        service.assertTenantAccess(receipt, { pawnshopId: null, role: 'STAFF' }),
      ).toThrow(ForbiddenException);
    });

    it('exempts the platform operator', () => {
      expect(() =>
        service.assertTenantAccess(receipt, { pawnshopId: null, role: 'SUPER_ADMIN' }),
      ).not.toThrow();
    });
  });

  describe('signed pdf links', () => {
    // Regression: the download route was `@Public()` with no check at all, so
    // holding a receipt id was enough to read a document containing the
    // customer's name, address, amounts and line items. Clients cannot attach a
    // bearer token to the URL they open, so the link is signed and expires.
    it('accepts a freshly minted link', () => {
      const { path } = service.createSignedPdfPath('receipt-1');
      const url = new URL(path, 'http://localhost');
      expect(() =>
        service.verifySignedPdfLink('receipt-1', url.searchParams.get('expires')!, url.searchParams.get('sig')!),
      ).not.toThrow();
    });

    it('rejects a missing signature', () => {
      expect(() => service.verifySignedPdfLink('receipt-1', undefined, undefined)).toThrow(
        UnauthorizedException,
      );
    });

    it('rejects a malformed expiry', () => {
      expect(() => service.verifySignedPdfLink('receipt-1', 'not-a-number', 'abc')).toThrow(
        UnauthorizedException,
      );
    });

    it('rejects an expired link', () => {
      const past = Math.floor(Date.now() / 1000) - 10;
      const { path } = service.createSignedPdfPath('receipt-1');
      const sig = new URL(path, 'http://localhost').searchParams.get('sig')!;
      expect(() => service.verifySignedPdfLink('receipt-1', String(past), sig)).toThrow(
        /expired/i,
      );
    });

    it('rejects a signature minted for a different receipt', () => {
      const { path } = service.createSignedPdfPath('receipt-1');
      const url = new URL(path, 'http://localhost');
      expect(() =>
        service.verifySignedPdfLink(
          'receipt-2',
          url.searchParams.get('expires')!,
          url.searchParams.get('sig')!,
        ),
      ).toThrow(UnauthorizedException);
    });

    it('rejects a tampered signature', () => {
      const { path } = service.createSignedPdfPath('receipt-1');
      const url = new URL(path, 'http://localhost');
      const sig = url.searchParams.get('sig')!;
      const tampered = sig.slice(0, -1) + (sig.endsWith('a') ? 'b' : 'a');
      expect(() =>
        service.verifySignedPdfLink('receipt-1', url.searchParams.get('expires')!, tampered),
      ).toThrow(UnauthorizedException);
    });

    it('binds the link to a short expiry', () => {
      const { expiresAt } = service.createSignedPdfPath('receipt-1');
      const seconds = (Date.parse(expiresAt) - Date.now()) / 1000;
      expect(seconds).toBeGreaterThan(0);
      expect(seconds).toBeLessThanOrEqual(300);
    });
  });
});
