import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { StorageService } from '../common/storage/storage.service';
import * as Handlebars from 'handlebars';
import PDFDocument from 'pdfkit';

@Injectable()
export class ContractRendererService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async renderContract(
    templateId: string,
    data: Record<string, any>,
    pawnshopId: string,
    userId: string,
    signatures?: {
      customerSignature?: string | null;
      customerSignedAt?: string | null;
      staffSignature?: string | null;
      staffSignedAt?: string | null;
    },
  ) {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(templateId);
    let template = isUuid
      ? await this.prisma.contractTemplate.findUnique({ where: { id: templateId } })
      : null;
    if (!template) {
      const normalizedType = templateId
        .replace(/-/g, '_')
        .toUpperCase();
      template = await this.prisma.contractTemplate.findFirst({
        where: { type: normalizedType as any, isActive: true },
      });
    }
    if (!template) throw new NotFoundException('Template not found');

    const compile = Handlebars.compile(template.content);
    const htmlContent = compile(data);

    const pdfBuffer = await this.generatePdf(htmlContent, data, signatures);

    const fileName = `${template.type}-${Date.now()}.pdf`;
    const storageUrl = await this.storage.uploadPdf(pdfBuffer, 'contracts', fileName);

    const contractNumber = `CTR-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

    const record = await this.prisma.loanContract.create({
      data: {
        loanId: data.loanId ? parseInt(data.loanId) : 0,
        applicationId: data.applicationId || '',
        contractNumber,
        templateVersion: template.version,
        contractData: { ...data, renderedHtml: htmlContent },
        pdfUrl: storageUrl,
        generatedAt: new Date(),
      },
    });

    await this.prisma.legalProof.create({
      data: {
        proofNumber: `PROOF-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 8)}`,
        pawnshopId,
        recordType: 'CONTRACT_PROOF',
        title: `Contract: ${contractNumber}`,
        summary: `Generated ${template.name} contract`,
        payload: { contractNumber, templateId, templateVersion: template.version },
        sourceHash: this.hashPayload({ contractNumber, templateId, data }),
        createdBy: userId,
        contractId: record.id,
      },
    });

    return { id: record.id, contractNumber, pdfUrl: storageUrl };
  }

  async renderPdfOnly(
    templateId: string,
    data: Record<string, any>,
    signatures?: {
      customerSignature?: string | null;
      customerSignedAt?: string | null;
      staffSignature?: string | null;
      staffSignedAt?: string | null;
    },
  ): Promise<{ htmlContent: string; pdfBuffer: Buffer; templateType: string; templateVersion: string }> {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(templateId);
    let template = isUuid
      ? await this.prisma.contractTemplate.findUnique({ where: { id: templateId } })
      : null;
    if (!template) {
      const normalizedType = templateId
        .replace(/-/g, '_')
        .toUpperCase();
      template = await this.prisma.contractTemplate.findFirst({
        where: { type: normalizedType as any, isActive: true },
      });
    }
    if (!template) throw new NotFoundException('Template not found');

    const compile = Handlebars.compile(template.content);
    const htmlContent = compile(data);

    const pdfBuffer = await this.generatePdf(htmlContent, data, signatures);

    return { htmlContent, pdfBuffer, templateType: template.type, templateVersion: template.version };
  }

  async getPdfUrl(contractId: string) {
    const contract = await this.prisma.loanContract.findUnique({
      where: { id: contractId },
    });
    if (!contract) throw new NotFoundException('Contract not found');
    return { pdfUrl: contract.pdfUrl, contractNumber: contract.contractNumber };
  }

  private generatePdf(html: string, data: Record<string, any>, signatures?: {
    customerSignature?: string | null;
    customerSignedAt?: string | null;
    staffSignature?: string | null;
    staffSignedAt?: string | null;
  }): Promise<Buffer> {
    return new Promise((resolve) => {
      const doc = new PDFDocument({ margin: 50, size: 'A4' });
      const buffers: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => buffers.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(buffers)));

      doc.fontSize(10).font('Helvetica');

      doc.fontSize(8).fillColor('#666').text(
        `Generated: ${new Date().toISOString()} | Document ID: ${data.contractNumber || 'N/A'}`,
        50, 30, { align: 'right' },
      );

      doc.moveDown(2);

      const lines = html.replace(/<[^>]*>/g, '\n').split('\n').filter(l => l.trim());
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (/^[A-Z\s]+$/.test(trimmed) && trimmed.length > 3) {
          doc.fontSize(14).font('Helvetica-Bold').text(trimmed, { underline: true });
          doc.moveDown(0.5);
        } else if (/^\d+\./.test(trimmed)) {
          doc.fontSize(10).font('Helvetica').text(trimmed, { indent: 10 });
          doc.moveDown(0.3);
        } else {
          doc.fontSize(10).font('Helvetica').text(trimmed);
          doc.moveDown(0.2);
        }
      }

      doc.moveDown(2);
      doc.fontSize(12).font('Helvetica-Bold').text('SIGNATURES', { underline: true });
      doc.moveDown(0.5);

      if (signatures?.customerSignature) {
        try {
          doc.image(signatures.customerSignature, 50, doc.y, { width: 200, height: 60 });
          doc.moveDown(3);
        } catch { doc.moveDown(0.5); }
      }
      doc.fontSize(10).font('Helvetica');
      const customerDate = signatures?.customerSignedAt ? new Date(signatures.customerSignedAt).toLocaleDateString('en-PH') : '_______________';
      doc.text(`Customer: _________________________  Date: ${customerDate}`);
      doc.moveDown(1);

      if (signatures?.staffSignature) {
        try {
          doc.image(signatures.staffSignature, 50, doc.y, { width: 200, height: 60 });
          doc.moveDown(3);
        } catch { doc.moveDown(0.5); }
      }
      const staffDate = signatures?.staffSignedAt ? new Date(signatures.staffSignedAt).toLocaleDateString('en-PH') : '_______________';
      doc.text(`Pawnshop Representative: _________________________  Date: ${staffDate}`);
      doc.moveDown(1);

      doc.fontSize(8).fillColor('#999').text(
        'This document was electronically generated and is legally binding.',
        50, doc.page.height - 80,
        { align: 'center' },
      );

      doc.end();
    });
  }

  private hashPayload(obj: any): string {
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(JSON.stringify(obj)).digest('hex');
  }
}
