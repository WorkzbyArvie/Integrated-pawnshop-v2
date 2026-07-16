import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { StorageService } from '../common/storage/storage.service';
import PDFDocument from 'pdfkit';

@Injectable()
export class ReceiptService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async generateReceipt(params: {
    pawnshopId: string;
    receiptType: string;
    referenceType: string;
    referenceId: string;
    amount: number;
    taxAmount?: number;
    customerName: string;
    customerAddress?: string;
    lineItems?: Array<{
      description: string;
      amount: number;
      quantity?: number;
    }>;
    generatedBy: string;
  }) {
    const totalAmount = params.amount + (params.taxAmount || 0);
    const receiptNumber = this.buildReceiptNumber(params.pawnshopId);
    const pdfBuffer = await this.generateReceiptPdf({
      receiptNumber,
      pawnshopName: params.pawnshopId,
      customerName: params.customerName,
      customerAddress: params.customerAddress,
      amount: params.amount,
      taxAmount: params.taxAmount || 0,
      totalAmount,
      lineItems: params.lineItems || [],
      receiptType: params.receiptType,
    });

    const fileName = `${receiptNumber}.pdf`;
    const storageUrl = await this.storage.uploadPdf(
      pdfBuffer,
      'receipts',
      fileName,
    );

    const receipt = await this.prisma.receipt.create({
      data: {
        receiptNumber,
        pawnshopId: params.pawnshopId,
        receiptType: params.receiptType as any,
        referenceType: params.referenceType,
        referenceId: params.referenceId,
        amount: params.amount,
        taxAmount: params.taxAmount || 0,
        totalAmount,
        customerName: params.customerName,
        customerAddress: params.customerAddress,
        lineItems: params.lineItems,
        pdfUrl: storageUrl,
        generatedBy: params.generatedBy,
      },
    });

    await this.prisma.legalProof.create({
      data: {
        proofNumber: `PROOF-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 8)}`,
        pawnshopId: params.pawnshopId,
        recordType: 'RECEIPT_PROOF',
        title: `Receipt: ${receiptNumber}`,
        summary: `${params.receiptType} receipt for ${params.customerName}`,
        payload: {
          receiptNumber,
          referenceType: params.referenceType,
          referenceId: params.referenceId,
          amount: params.amount,
        },
        sourceHash: this.hashPayload({ receiptNumber, params }),
        createdBy: params.generatedBy,
        receiptId: receipt.id,
      },
    });

    return receipt;
  }

  async list(pawnshopId: string, type?: string, limit = 20, offset = 0) {
    const where: any = { pawnshopId };
    if (type) where.receiptType = type;
    const [data, total] = await Promise.all([
      this.prisma.receipt.findMany({
        where,
        orderBy: { generatedAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.receipt.count({ where }),
    ]);
    return { data, total, limit, offset };
  }

  async get(id: string) {
    const receipt = await this.prisma.receipt.findUnique({ where: { id } });
    if (!receipt) throw new NotFoundException('Receipt not found');
    return receipt;
  }

  async getPdf(id: string) {
    const receipt = await this.get(id);
    const pdfUrl = await this.storage.getDownloadUrl(receipt.pdfUrl);
    return { pdfUrl, receiptNumber: receipt.receiptNumber };
  }

  async findByReference(referenceType: string, referenceId: string) {
    return this.prisma.receipt.findMany({
      where: { referenceType, referenceId },
      orderBy: { generatedAt: 'desc' },
    });
  }

  async void(id: string, reason: string, voidedBy: string) {
    const receipt = await this.get(id);
    return this.prisma.receipt.update({
      where: { id },
      data: { isVoid: true, voidReason: reason },
    });
  }

  private buildReceiptNumber(pawnshopId: string): string {
    const ts = Date.now().toString(36).toUpperCase();
    const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
    return `RCP-${ts}-${rand}`;
  }

  private generateReceiptPdf(data: {
    receiptNumber: string;
    pawnshopName: string;
    customerName: string;
    customerAddress?: string;
    amount: number;
    taxAmount: number;
    totalAmount: number;
    lineItems: Array<{
      description: string;
      amount: number;
      quantity?: number;
    }>;
    receiptType: string;
  }): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 50, size: 'A4' });
      const buffers: Buffer[] = [];

      doc.on('data', (chunk: Buffer) => buffers.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(buffers)));
      doc.on('error', reject);

      doc
        .fontSize(18)
        .font('Helvetica-Bold')
        .text('OFFICIAL RECEIPT', { align: 'center' });
      doc.moveDown(0.5);
      doc
        .fontSize(10)
        .font('Helvetica')
        .text(`Receipt #: ${data.receiptNumber}`, { align: 'right' });
      doc.text(`Date: ${new Date().toLocaleDateString('en-PH')}`, {
        align: 'right',
      });
      doc.text(`Type: ${data.receiptType}`, { align: 'right' });
      doc.moveDown(1);

      doc.fontSize(11).font('Helvetica-Bold').text('Customer:');
      doc.fontSize(10).font('Helvetica').text(data.customerName);
      if (data.customerAddress) doc.text(data.customerAddress);
      doc.moveDown(1);

      doc
        .fontSize(11)
        .font('Helvetica-Bold')
        .text('Items:', { underline: true });
      doc.moveDown(0.3);

      if (data.lineItems.length > 0) {
        for (const item of data.lineItems) {
          const qty = item.quantity || 1;
          doc
            .fontSize(10)
            .font('Helvetica')
            .text(`${item.description} x${qty}`, { continued: true });
          doc.text(`PHP ${(item.amount * qty).toFixed(2)}`, { align: 'right' });
        }
        doc.moveDown(0.3);
      }

      doc.moveDown(0.5);
      doc
        .fontSize(10)
        .font('Helvetica')
        .text(`Subtotal: PHP ${data.amount.toFixed(2)}`, { align: 'right' });
      if (data.taxAmount > 0) {
        doc.text(`Tax: PHP ${data.taxAmount.toFixed(2)}`, { align: 'right' });
      }
      doc
        .fontSize(12)
        .font('Helvetica-Bold')
        .text(`Total: PHP ${data.totalAmount.toFixed(2)}`, { align: 'right' });

      doc.moveDown(2);
      doc
        .fontSize(8)
        .fillColor('#999')
        .font('Helvetica')
        .text(
          'This is a computer-generated receipt. No signature required.',
          50,
          doc.page.height - 80,
          { align: 'center' },
        );

      doc.end();
    });
  }

  private hashPayload(obj: any): string {
    const crypto = require('crypto');
    return crypto
      .createHash('sha256')
      .update(JSON.stringify(obj))
      .digest('hex');
  }
}
