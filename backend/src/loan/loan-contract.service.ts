import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { LegalProofService } from './legal-proof.service';
import { ContractRendererService } from '../contract/contract-renderer.service';
import { StorageService } from '../common/storage/storage.service';
import { StateMachineService } from '../common/state-machine/state-machine.service';
import {
  GRACE_PERIOD_DAYS,
  PAWN_TERM_DAYS,
  maturityDateFrom,
  toTermDays,
  toTermMonths,
} from './loan-terms';
import { calculateLoanBreakdown, resolveRates } from '../finance/interest';
import { createHash, randomUUID } from 'crypto';
import PDFDocument from 'pdfkit';

@Injectable()
export class LoanContractService {
  private readonly logger = new Logger(LoanContractService.name);

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

    // Read the issuing shop's configured rates and derive every money figure on
    // the contract from them. A contract whose interest rate disagrees with the
    // loan it describes is the single worst document this system can print.
    const pawnshopSettings = await this.prisma.pawnshop.findUnique({
      where: { id: application.pawnshopId },
      select: { settings: true },
    });
    const rates = resolveRates(pawnshopSettings?.settings);
    const breakdown = calculateLoanBreakdown(application.loanAmount, rates);

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
      interestRate: (rates.monthlyInterestRate * 100).toFixed(2),
      // The contract is the document the pawnshop is held to, so its figures
      // come from the same calculation as the loan record rather than from
      // literals. These were `loanAmount * 0.02` and a hardcoded '2'/'3', and
      // they did not match what the redemption screen quoted.
      serviceFee: breakdown.serviceFee.toFixed(2),
      serviceFeeRate: (rates.serviceFeeRate * 100).toFixed(2),
      // The contract, the ticket and the renewal all read the term from
      // loan-terms.ts. This used to be `termMonths * 30 * 24 * 60 * 60 * 1000`,
      // which drifts from a real calendar month and let a contract state a
      // maturity date the ticket disagreed with.
      loanTerm: `${toTermDays(application.termMonths)} days`,
      loanDate: new Date().toLocaleDateString('en-PH'),
      maturityDate: maturityDateFrom(toTermDays(application.termMonths)).toLocaleDateString('en-PH'),
      graceDays: String(GRACE_PERIOD_DAYS),
      latePenaltyRate: '3',
      itemDescription: this.stripPhotoUrls(application.purpose),
      itemCategory: loan?.category || application.purpose || application.loanType,
      itemWeight: loan?.weight ? `${loan.weight}g` : 'N/A',
    };

    let pdfUrl: string | null = null;
    let templateVersion = '1.0';
    let renderedHtml: string | null = null;
    try {
      const extraSections = await this.getCustomContractSections(application.pawnshopId);
      const { pdfBuffer, htmlContent, templateVersion: tv } = await this.contractRenderer.renderPdfOnly(
        'loan-contract',
        { ...templateData, applicationId, loanId: application.loan.id.toString() },
        undefined,
        extraSections,
      );
      renderedHtml = htmlContent;
      templateVersion = tv;
      const fileName = `loan-${contractNumber}.pdf`;
      pdfUrl = await this.storage.uploadPdf(pdfBuffer, 'contracts', fileName);
    } catch (e) {
      console.error(`Failed to generate/upload loan contract PDF for ${contractNumber}:`, e);
      pdfUrl = `contracts/loan/${contractNumber}.pdf`;
    }

    const contract = await this.prisma.loanContract.create({
      data: {
        applicationId,
        loanId: application.loan.id,
        contractNumber,
        templateVersion,
        contractData: renderedHtml ? { ...templateData, renderedHtml } : templateData,
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
        // Provenance in days, so an auditor reading the proof record is not
        // left converting a month count themselves.
        termDays: toTermDays(application.termMonths),
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

    return this.withRenderedHtml(contract);
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

    return this.withRenderedHtml(contract);
  }

  private async withRenderedHtml(contract: any): Promise<any> {
    const contractData = contract?.contractData as Record<string, unknown> | null;
    if (contract && contractData && typeof contractData === 'object' && !contractData.renderedHtml) {
      try {
        const pawnshopId = contract?.application?.pawnshopId as string | undefined;
        const extraSections = pawnshopId ? await this.getCustomContractSections(pawnshopId) : [];
        const { htmlContent } = await this.contractRenderer.renderPdfOnly('loan-contract', contractData, undefined, extraSections);
        return { ...contract, contractData: { ...contractData, renderedHtml: htmlContent } };
      } catch {
        return contract;
      }
    }
    return contract;
  }

  private async getCustomContractSections(pawnshopId: string): Promise<{ heading: string; html: string }[]> {
    try {
      const pawnshop = await this.prisma.pawnshop.findUnique({
        where: { id: pawnshopId },
        select: { settings: true },
      });
      const settings = (pawnshop?.settings ?? {}) as Record<string, unknown>;
      const sections: { heading: string; html: string }[] = [];
      const terms = settings.contractTermsAndConditions;
      if (typeof terms === 'string' && terms.trim()) {
        sections.push({ heading: 'TERMS AND CONDITIONS', html: this.textToHtml(terms) });
      }
      const responsibilities = settings.contractPawnshopResponsibilities;
      if (typeof responsibilities === 'string' && responsibilities.trim()) {
        sections.push({ heading: 'PAWNSHOP RESPONSIBILITIES', html: this.textToHtml(responsibilities) });
      }
      return sections;
    } catch {
      return [];
    }
  }

  private textToHtml(text: string): string {
    return text
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => `<p>${line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>`)
      .join('\n');
  }

  async signByCustomer(applicationId: string, customerSignature: string) {
    const contract = await this.prisma.loanContract.findUnique({
      where: { applicationId },
      include: {
        application: {
          select: {
            pawnshopId: true,
            customerId: true,
            customer: { select: { fullName: true } },
            loan: { include: { ticket: true } },
          },
        },
      },
    });
    if (!contract) throw new NotFoundException('Contract not found for this application');
    if (contract.signedByCustomer) {
      throw new BadRequestException('Contract already signed by customer');
    }

    const updated = await this.prisma.loanContract.update({
      where: { id: contract.id },
      data: {
        customerSignature,
        customerSignedAt: new Date(),
        signedByCustomer: true,
        // The printed name is snapshotted here rather than looked up when the
        // PDF is rendered, so the contract names the person who actually signed
        // even if the customer record is renamed or removed later.
        customerSignerName: contract.application.customer?.fullName ?? null,
      },
    });

    await this.legalProofService.createProof({
      pawnshopId: contract.application.pawnshopId,
      recordType: 'CONTRACT_PROOF',
      title: `Contract signed by customer for application ${applicationId}`,
      summary: `Contract ${contract.contractNumber} was signed by ${contract.application.customer?.fullName || 'the customer'}.`,
      createdBy: contract.application.customerId,
      applicationId,
      contractId: contract.id,
      payload: {
        contractId: contract.id,
        contractNumber: contract.contractNumber,
        customerSignedAt: updated.customerSignedAt?.toISOString(),
        customerSignerName: updated.customerSignerName,
      },
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

    // Resolved before the write so the contract names the person who signed it.
    // A missing profile is not fatal - the signature still stands, it just
    // prints without a name - so a deleted account cannot block a signing that
    // has already legally happened.
    //
    // `profiles`, not `staff`. `staffId` here is the authenticated user id that
    // `RbacGuard` puts on the request, which is the Supabase auth id and so the
    // `profiles.id` primary key. The `staff` table has its own generated uuid
    // and no relation to the profile, so looking the id up there returns null
    // every time and the name would never print.
    const signer = await this.prisma.profile.findUnique({
      where: { id: staffId },
      select: { fullName: true },
    });
    if (!signer) {
      this.logger.warn(
        `No profile for ${staffId}; contract ${contract.contractNumber} will sign without a printed name.`,
      );
    }

    await this.stateMachine.transition(
      'TICKET_LIFECYCLE',
      contract.application.loan.ticket.lifecycleStatus,
      'CONTRACT_SIGNED',
      { userRole },
    );

    const updated = await this.prisma.loanContract.update({
      where: { id: contract.id },
      data: {
        staffSignature,
        staffSignedAt: new Date(),
        signedByStaff: true,
        staffId,
        staffSignerName: signer?.fullName ?? null,
      },
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
      summary: `Contract ${contract.contractNumber} was signed by ${signer?.fullName || 'staff'}.`,
      createdBy: staffId,
      applicationId,
      contractId: contract.id,
      payload: {
        contractId: contract.id,
        contractNumber: contract.contractNumber,
        staffSignedAt: updated.staffSignedAt?.toISOString(),
        staffSignerName: updated.staffSignerName,
      },
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

  async downloadContractPdf(
    contractId: string,
    callerPawnshopId?: string | null,
    callerRole?: string,
  ): Promise<{ buffer: Buffer; contractNumber: string }> {
    const contract = await this.prisma.loanContract.findUnique({
      where: { id: contractId },
      include: { application: { select: { pawnshopId: true } } },
    });
    if (!contract) throw new NotFoundException('Contract not found');

    // A permission answers "may this role read a contract"; it does not answer
    // "whose". Without this the lookup above is a bare primary-key read, so any
    // manager of any shop could render another shop's signed contract by id.
    // Scoped here, in the same shape as `AnalyticsService.resolveTenant`.
    if (callerRole !== 'SUPER_ADMIN') {
      const ownerShop = contract.application?.pawnshopId ?? null;
      if (!callerPawnshopId || ownerShop !== callerPawnshopId) {
        throw new NotFoundException('Contract not found');
      }
    }

    const extraSections = contract.application?.pawnshopId
      ? await this.getCustomContractSections(contract.application.pawnshopId)
      : [];

    const contractData = contract.contractData as Record<string, any>;

    // Fall back to the recorded `staffId` for a contract signed before the
    // snapshot existed. The customer already had a fallback - the borrower name
    // is in `contract_data` - but the staff name had none, so every
    // already-signed contract printed a signature with no name against it. The
    // `staff_id` on the row is the evidence of who signed, so it is the right
    // thing to reconstruct from. This is a fallback for the past only: new
    // signatures snapshot the name and never reach it.
    //
    // `profiles`, not `staff`: `staff_id` holds the authenticated user id, which
    // is the Supabase auth id and therefore `profiles.id`. The `staff` table has
    // an unrelated generated uuid.
    let staffName = contract.staffSignerName ?? null;
    if (!staffName && contract.staffId) {
      const profile = await this.prisma.profile.findUnique({
        where: { id: contract.staffId },
        select: { fullName: true },
      });
      staffName = profile?.fullName ?? null;
    }

    const { pdfBuffer } = await this.contractRenderer.renderPdfOnly(
      'loan-contract',
      contractData,
      {
        customerSignature: contract.customerSignature,
        customerSignedAt: contract.customerSignedAt?.toISOString() || null,
        staffSignature: contract.staffSignature,
        staffSignedAt: contract.staffSignedAt?.toISOString() || null,
        // Snapshotted at signing. A contract signed before this existed has no
        // snapshot, so the borrower falls back to the name already in
        // `contract_data` - the name the contract was issued to, which is the
        // best available evidence for an already-signed document.
        customerName:
          contract.customerSignerName ?? contractData?.customerName ?? null,
        staffName,
      },
      extraSections,
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
