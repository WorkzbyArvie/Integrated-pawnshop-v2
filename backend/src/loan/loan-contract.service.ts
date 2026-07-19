import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { LegalProofService } from './legal-proof.service';
import { ContractRendererService } from '../contract/contract-renderer.service';
import { StorageService } from '../common/storage/storage.service';
import { StateMachineService } from '../common/state-machine/state-machine.service';
import { createHash, randomUUID } from 'crypto';
import PDFDocument from 'pdfkit';

@Injectable()
export class LoanContractService {
  constructor(
    private prisma: PrismaService,
    private legalProofService: LegalProofService,
    private contractRenderer: ContractRendererService,
    private storage: StorageService,
    private stateMachine: StateMachineService,
  ) {}

  async generateContractForApplication(applicationId: string, generatedBy: string) {
    const application = await this.prisma.loanApplication.findUnique({
      where: { id: applicationId },
      include: {
        customer: true,
        pawnshop: {
          include: { legalEntity: true },
        },
        loan: true,
      },
    });

    if (!application) throw new NotFoundException('Loan application not found');
    if (application.status !== 'APPROVED') throw new BadRequestException('Contract can only be generated for approved applications');
  if (!application.loan) throw new BadRequestException('Approved application must have a linked loan before contract generation');

    const existingContract = await this.prisma.loanContract.findUnique({ where: { applicationId } });
    if (existingContract) throw new BadRequestException('Contract already exists for this application');

    const contractNumber = this.generateContractNumber();
    const legalEntity = application.pawnshop?.legalEntity;

    const loan = application.loan;
    const templateData = {
      contractNumber,
      generatedDate: new Date().toLocaleDateString('en-PH'),
      pawnshopLegalName: legalEntity?.legalName || application.pawnshop?.name || '',
      registrationNumber: legalEntity?.registrationNumber || application.pawnshop?.registrationNumber || 'Pending Registration',
      customerName: application.customer.fullName,
      customerIdType: 'Valid ID',
      customerIdNumber: 'N/A',
      customerAddress: application.customer.address || 'N/A',
      loanAmount: application.loanAmount.toFixed(2),
      interestRate: application.loanType === 'PERSONAL' ? '3' : '2',
      serviceFee: (application.loanAmount * 0.02).toFixed(2),
      serviceFeeRate: '2',
      loanTerm: application.termMonths.toString(),
      loanDate: new Date().toLocaleDateString('en-PH'),
      maturityDate: new Date(Date.now() + application.termMonths * 30 * 24 * 60 * 60 * 1000).toLocaleDateString('en-PH'),
      graceDays: '30',
      latePenaltyRate: '3',
      itemDescription: this.stripPhotoUrls(application.purpose),
      itemCategory: loan?.category || application.purpose || application.loanType,
      itemWeight: loan?.weight ? `${loan.weight}g` : 'N/A',
    };

    let pdfUrl: string | null = null;
    let templateVersion = '1.0';
    try {
      const { pdfBuffer, templateVersion: tv } = await this.contractRenderer.renderPdfOnly(
        'loan-contract',
        { ...templateData, applicationId, loanId: application.loan.id.toString() },
      );
      templateVersion = tv;
      const fileName = `loan-${contractNumber}.pdf`;
      pdfUrl = await this.storage.uploadPdf(pdfBuffer, 'contracts', fileName);
    } catch (e) {
      pdfUrl = `contracts/loan/${contractNumber}.pdf`;
    }

    const contract = await this.prisma.loanContract.create({
      data: {
        applicationId,
        loanId: application.loan.id,
        contractNumber,
        templateVersion,
        contractData: templateData,
        pdfUrl,
        generatedAt: new Date(),
      },
      include: {
        application: {
          select: { id: true, customerId: true, pawnshopId: true },
        },
      },
    });

    await this.legalProofService.createProof({
      pawnshopId: application.pawnshopId,
      recordType: 'CONTRACT_PROOF',
      title: `Contract generated for application ${applicationId}`,
      summary: `Contract ${contractNumber} was generated for ₱${application.loanAmount.toFixed(2)} loan for ${application.customer.fullName}.`,
      createdBy: generatedBy,
      applicationId,
      contractId: contract.id,
      payload: {
        contractId: contract.id,
        contractNumber,
        applicationId,
        customerId: application.customerId,
        customerName: application.customer.fullName,
        loanAmount: application.loanAmount,
        loanType: application.loanType,
        termMonths: application.termMonths,
        generatedAt: contract.generatedAt.toISOString(),
      },
    });

    return contract;
  }

  /**
   * Get contract by application ID
   */
  async getContractByApplicationId(applicationId: string) {
    const contract = await this.prisma.loanContract.findUnique({
      where: { applicationId },
      include: {
        application: {
          select: {
            id: true,
            customerId: true,
            pawnshopId: true,
            status: true,
          },
        },
        loan: {
          select: {
            id: true,
            status: true,
          },
        },
      },
    });

    if (!contract) {
      throw new NotFoundException('Contract not found for this application');
    }

    return contract;
  }

  /**
   * Get contract by ID
   */
  async getContractById(contractId: string) {
    const contract = await this.prisma.loanContract.findUnique({
      where: { id: contractId },
      include: {
        application: true,
        loan: true,
      },
    });

    if (!contract) {
      throw new NotFoundException('Contract not found');
    }

    return contract;
  }

  async signByCustomer(applicationId: string, customerSignature: string) {
    const contract = await this.prisma.loanContract.findUnique({
      where: { applicationId },
      include: { application: { select: { pawnshopId: true, customerId: true, loan: { include: { ticket: true } } } } },
    });
    if (!contract) throw new NotFoundException('Contract not found for this application');
    if (contract.signedByCustomer) {
      throw new BadRequestException('Contract already signed by customer');
    }

    const updated = await this.prisma.loanContract.update({
      where: { id: contract.id },
      data: { customerSignature, customerSignedAt: new Date(), signedByCustomer: true },
    });

    await this.legalProofService.createProof({
      pawnshopId: contract.application.pawnshopId,
      recordType: 'CONTRACT_PROOF',
      title: `Contract signed by customer for application ${applicationId}`,
      summary: `Contract ${contract.contractNumber} was signed by customer.`,
      createdBy: contract.application.customerId,
      applicationId,
      contractId: contract.id,
      payload: { contractId: contract.id, contractNumber: contract.contractNumber, customerSignedAt: updated.customerSignedAt?.toISOString() },
    });

    return updated;
  }

  async signByStaff(applicationId: string, staffId: string, staffSignature: string, userRole?: string) {
    const contract = await this.prisma.loanContract.findUnique({
      where: { applicationId },
      include: { application: { select: { pawnshopId: true, loan: { include: { ticket: true } } } } },
    });
    if (!contract) throw new NotFoundException('Contract not found for this application');
    if (!contract.signedByCustomer) {
      throw new BadRequestException('Contract must be signed by customer before staff signing');
    }
    if (contract.signedByStaff) {
      throw new BadRequestException('Contract already signed by staff');
    }
    if (!contract.application.loan?.ticket) {
      throw new BadRequestException('Ticket not found for this contract');
    }

    await this.stateMachine.transition(
      'TICKET_LIFECYCLE',
      contract.application.loan.ticket.lifecycleStatus,
      'CONTRACT_SIGNED',
      { userRole },
    );

    const updated = await this.prisma.loanContract.update({
      where: { id: contract.id },
      data: { staffSignature, staffSignedAt: new Date(), signedByStaff: true, staffId },
    });

    await this.prisma.ticket.update({
      where: { id: contract.application.loan.ticket.id },
      data: {
        lifecycleStatus: 'CONTRACT_SIGNED',
        contractId: contract.id,
      },
    });

    await this.legalProofService.createProof({
      pawnshopId: contract.application.pawnshopId,
      recordType: 'CONTRACT_PROOF',
      title: `Contract signed by staff for application ${applicationId}`,
      summary: `Contract ${contract.contractNumber} was signed by staff.`,
      createdBy: staffId,
      applicationId,
      contractId: contract.id,
      payload: { contractId: contract.id, contractNumber: contract.contractNumber, staffSignedAt: updated.staffSignedAt?.toISOString() },
    });

    return updated;
  }

  async getContractsByPawnshop(pawnshopId: string, limit = 50, offset = 0) {
    const contracts = await this.prisma.loanContract.findMany({
      where: { application: { pawnshopId } },
      take: limit,
      skip: offset,
      orderBy: { generatedAt: 'desc' },
      include: { application: { select: { id: true, customerId: true, pawnshopId: true, status: true } } },
    });
    return contracts;
  }

  async downloadContractPdf(contractId: string): Promise<{ buffer: Buffer; contractNumber: string }> {
    const contract = await this.prisma.loanContract.findUnique({ where: { id: contractId } });
    if (!contract) throw new NotFoundException('Contract not found');

    const { pdfBuffer } = await this.contractRenderer.renderPdfOnly(
      'loan-contract',
      contract.contractData as Record<string, any>,
      {
        customerSignature: contract.customerSignature,
        customerSignedAt: contract.customerSignedAt?.toISOString() || null,
        staffSignature: contract.staffSignature,
        staffSignedAt: contract.staffSignedAt?.toISOString() || null,
      },
    );

    return { buffer: pdfBuffer, contractNumber: contract.contractNumber };
  }

  async getContractProofs(contractId: string) {
    const contract = await this.prisma.loanContract.findUnique({ where: { id: contractId } });
    if (!contract) throw new NotFoundException('Contract not found');
    return this.legalProofService.listByContract(contractId);
  }

  private stripPhotoUrls(text?: string | null): string {
    if (!text) return 'Collateral item';
    return text
      .replace(/\n?\s*\[PHOTO_URL\]\s+https?:\/\/\S+/gi, '')
      .replace(/\n?\s*\[PHOTO_URLS\]\s+\[[\s\S]*?\]/gi, '')
      .replace(/https?:\/\/\S+/gi, '')
      .replace(/\s{2,}/g, ' ')
      .trim() || 'Collateral item';
  }

  private generateContractNumber(): string {
    const timestamp = Date.now().toString(36).toUpperCase();
    const uuid = randomUUID().split('-')[0].toUpperCase();
    return `CTR-${timestamp}-${uuid}`;
  }

  private generateSimplePdf(contractNumber: string, data: Record<string, any>): Buffer {
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const buffers: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => buffers.push(chunk));
    doc.on('end', () => {});

    doc.fontSize(16).font('Helvetica-Bold').text('PAWN LOAN AGREEMENT', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(9).font('Helvetica').text(`Contract No: ${contractNumber}`, { align: 'right' });
    doc.text(`Date: ${data.generatedDate || new Date().toLocaleDateString('en-PH')}`, { align: 'right' });
    doc.moveDown(1);

    doc.fontSize(11).font('Helvetica-Bold').text('PARTIES');
    doc.fontSize(10).font('Helvetica');
    doc.text(`Pawnshop: ${data.pawnshopLegalName || 'N/A'}`);
    doc.text(`Customer: ${data.customerName || 'N/A'}`);
    doc.text(`Address: ${data.customerAddress || 'N/A'}`);
    doc.moveDown(0.5);

    doc.fontSize(11).font('Helvetica-Bold').text('LOAN DETAILS');
    doc.fontSize(10).font('Helvetica');
    doc.text(`Loan Amount: PHP ${data.loanAmount || '0.00'}`);
    doc.text(`Interest Rate: ${data.interestRate || '0'}% per month`);
    doc.text(`Term: ${data.loanTerm || '0'} days`);
    doc.text(`Maturity Date: ${data.maturityDate || 'N/A'}`);
    doc.text(`Grace Period: ${data.graceDays || '0'} days`);
    doc.moveDown(0.5);

    doc.fontSize(11).font('Helvetica-Bold').text('COLLATERAL');
    doc.fontSize(10).font('Helvetica');
    doc.text(`Item: ${data.itemDescription || 'N/A'}`);
    doc.text(`Category: ${data.itemCategory || 'N/A'}`);
    doc.moveDown(0.5);

    doc.fontSize(11).font('Helvetica-Bold').text('TERMS AND CONDITIONS');
    doc.fontSize(9).font('Helvetica');
    doc.text('1. The Customer acknowledges receipt of the loan amount as stated above.');
    doc.text('2. Interest accrues monthly at the stated rate. Unpaid interest does not compound.');
    doc.text('3. A grace period of 30 days is granted after the maturity date.');
    doc.text('4. After the grace period, late penalties apply at 3% per month of the principal.');
    doc.text('5. If unpaid after the grace period, the collateral shall be deemed FORFEITED.');
    doc.text('6. Forfeited items may be sold through public auction without further notice.');
    doc.text('7. The Customer may redeem the collateral at any time before forfeiture.');
    doc.text('8. This agreement is governed by Philippine laws, particularly the Pawnshop Regulation Act.');
    doc.moveDown(1);

    doc.fontSize(11).font('Helvetica-Bold').text('SIGNATURES');
    doc.moveDown(0.5);
    doc.fontSize(10).font('Helvetica');
    doc.text('Customer: _________________________  Date: ___________');
    doc.moveDown(0.3);
    doc.text('Pawnshop Rep: _________________________  Date: ___________');

    doc.fontSize(7).fillColor('#999').font('Helvetica').text(
      'This document was electronically generated. Printing or downloading constitutes acceptance.',
      50, doc.page.height - 50, { align: 'center', width: doc.page.width - 100 },
    );

    doc.end();
    return Buffer.concat(buffers);
  }
}
