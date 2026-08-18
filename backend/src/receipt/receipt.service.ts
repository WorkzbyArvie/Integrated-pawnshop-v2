import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { StorageService } from '../common/storage/storage.service';
import PDFDocument from 'pdfkit';

@Injectable()
export class ReceiptService {
  private readonly pdfCache = new Map<string, { buffer: Buffer; ts: number }>();
  private readonly CACHE_TTL_MS = 5 * 60 * 1000;
  private readonly CACHE_MAX = 100;

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
    customerId?: string;
  }) {
    const totalAmount = params.amount + (params.taxAmount || 0);
    const receiptNumber = this.buildReceiptNumber(params.pawnshopId);

    const [shop, staff] = await Promise.all([
      this.prisma.pawnshop.findUnique({ where: { id: params.pawnshopId } }),
      this.prisma.profile.findUnique({ where: { id: params.generatedBy } }),
    ]);

    const pdfBuffer = await this.generateReceiptPdf({
      receiptNumber,
      pawnshopName: shop?.name || 'PawnGold Pawnshop',
      pawnshopAddress: shop?.address || undefined,
      staffName: staff?.fullName || undefined,
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
        customerId: params.customerId ?? null,
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

  async getPdfInfo(id: string) {
    const receipt = await this.get(id);
    return { receiptId: receipt.id, receiptNumber: receipt.receiptNumber };
  }

  async getPdfBuffer(id: string): Promise<Buffer> {
    const cached = this.pdfCache.get(id);
    if (cached && Date.now() - cached.ts < this.CACHE_TTL_MS) {
      return cached.buffer;
    }

    const receipt = await this.prisma.receipt.findUnique({
      where: { id },
      include: { pawnshop: true },
    });
    if (!receipt) throw new NotFoundException('Receipt not found');

    const profile = await this.prisma.profile.findUnique({
      where: { id: receipt.generatedBy },
    });

    const buffer = await this.generateReceiptPdf({
      receiptNumber: receipt.receiptNumber,
      pawnshopName: receipt.pawnshop?.name || 'PawnGold Pawnshop',
      pawnshopAddress: receipt.pawnshop?.address || '',
      customerName: receipt.customerName,
      customerAddress: receipt.customerAddress || undefined,
      staffName: profile?.fullName || 'Unknown Staff',
      amount: receipt.amount,
      taxAmount: receipt.taxAmount,
      totalAmount: receipt.totalAmount,
      lineItems: (receipt.lineItems as any[]) || [],
      receiptType: receipt.receiptType,
    });

    if (this.pdfCache.size >= this.CACHE_MAX) {
      const oldest = this.pdfCache.keys().next().value;
      if (oldest) this.pdfCache.delete(oldest);
    }
    this.pdfCache.set(id, { buffer, ts: Date.now() });

    return buffer;
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
    pawnshopAddress?: string;
    customerName: string;
    customerAddress?: string;
    staffName?: string;
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

      const pw = doc.page.width;

      doc.fontSize(20).font('Helvetica-Bold').text(data.pawnshopName, { align: 'center' });
      if (data.pawnshopAddress) {
        doc.fontSize(9).font('Helvetica').fillColor('#555')
          .text(data.pawnshopAddress, { align: 'center' });
      }
      doc.fillColor('#000');
      doc.moveDown(0.3);

      doc.moveTo(50, doc.y).lineTo(pw - 50, doc.y).strokeColor('#C9A05C').lineWidth(1.5).stroke();
      doc.moveDown(0.7);

      doc.fontSize(16).font('Helvetica-Bold').text('OFFICIAL RECEIPT', { align: 'center' });
      doc.moveDown(0.7);

      doc.fontSize(9).font('Helvetica');
      const rightX = pw - 50;
      doc.text(`Receipt #: ${data.receiptNumber}`, 50, doc.y, { align: 'right' });
      doc.text(`Date: ${new Date().toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' })}`, { align: 'right' });
      doc.text(`Type: ${data.receiptType.replace(/_/g, ' ')}`, { align: 'right' });
      doc.moveDown(1);

      doc.moveTo(50, doc.y).lineTo(pw - 50, doc.y).strokeColor('#CCC').lineWidth(0.5).stroke();
      doc.moveDown(0.5);

      doc.fontSize(10).font('Helvetica-Bold').text('CUSTOMER DETAILS');
      doc.fontSize(9).font('Helvetica');
      doc.text(`Name: ${data.customerName}`);
      if (data.customerAddress) doc.text(`Address: ${data.customerAddress}`);
      doc.moveDown(0.3);
      if (data.staffName) {
        doc.text(`Processed By: ${data.staffName}`);
      }
      doc.moveDown(0.5);

      doc.moveTo(50, doc.y).lineTo(pw - 50, doc.y).strokeColor('#CCC').lineWidth(0.5).stroke();
      doc.moveDown(0.5);

      doc.fontSize(10).font('Helvetica-Bold').text('LINE ITEMS');
      doc.moveDown(0.2);

      if (data.lineItems.length > 0) {
        const tableTop = doc.y;
        const col1 = 50;
        const col2 = pw - 150;
        const col3 = pw - 50;

        doc.fontSize(8).font('Helvetica-Bold').fillColor('#666');
        doc.text('DESCRIPTION', col1, tableTop);
        doc.text('QTY', col2, tableTop, { width: 40, align: 'center' });
        doc.text('AMOUNT', col3, tableTop, { width: 100, align: 'right' });

        doc.moveDown(0.5);
        doc.moveTo(50, doc.y).lineTo(pw - 50, doc.y).strokeColor('#DDD').lineWidth(0.5).stroke();
        doc.moveDown(0.2);

        const startY = doc.y;
        doc.fontSize(9).font('Helvetica').fillColor('#000');
        let rowY = startY;
        for (const item of data.lineItems) {
          const qty = item.quantity || 1;
          doc.text(item.description, col1, rowY, { width: col2 - col1 - 10 });
          doc.text(String(qty), col2, rowY, { width: 40, align: 'center' });
          doc.text(`PHP ${(item.amount * qty).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, col3, rowY, { width: 100, align: 'right' });
          rowY += 18;
        }

        doc.y = rowY;
        doc.moveDown(0.3);
        doc.moveTo(50, doc.y).lineTo(pw - 50, doc.y).strokeColor('#CCC').lineWidth(0.5).stroke();
        doc.moveDown(0.5);
      }

      const fmt = (n: number) => n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const sumRow = (label: string, value: string, bold = false) => {
        const y = doc.y;
        const valX = pw - 150;
        const valW = 100;
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 12 : 10);
        doc.text(label, 50, y, { width: valX - 60 });
        doc.text(value, valX, y, { width: valW, align: 'right' });
        doc.moveDown(bold ? 0.4 : 0.2);
      };
      sumRow('Subtotal:', `PHP ${fmt(data.amount)}`);
      if (data.taxAmount > 0) {
        sumRow('Tax:', `PHP ${fmt(data.taxAmount)}`);
      }
      doc.moveDown(0.1);
      doc.moveTo(50, doc.y).lineTo(pw - 50, doc.y).strokeColor('#C9A05C').lineWidth(1).stroke();
      doc.moveDown(0.2);
      sumRow('TOTAL:', `PHP ${fmt(data.totalAmount)}`, true);

      doc.moveDown(2);
      doc.fontSize(8).fillColor('#999').font('Helvetica').text(
        'This is a computer-generated receipt. No signature required.',
        50, doc.page.height - 80,
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
