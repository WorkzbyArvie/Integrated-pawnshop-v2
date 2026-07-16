import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { LegalProofService } from './legal-proof.service';
import { LoanContractService } from './loan-contract.service';
import { StateMachineService } from '../common/state-machine/state-machine.service';
import {
  CreateLoanApplicationDto,
  UpdateApplicationStatusDto,
} from './dto/create-loan-application.dto';

@Injectable()
export class LoanApplicationService {
  constructor(
    private prisma: PrismaService,
    private legalProofService: LegalProofService,
    private loanContractService: LoanContractService,
    private stateMachine: StateMachineService,
  ) {}

  /**
   * Submit a new loan application
   */
  async createApplication(dto: CreateLoanApplicationDto) {
    // Verify customer exists
    const customer = await this.prisma.customer.findUnique({
      where: { id: dto.customerId },
    });

    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    // Verify pawnshop exists
    const pawnshop = await this.prisma.pawnshop.findUnique({
      where: { id: dto.pawnshopId },
    });

    if (!pawnshop) {
      throw new NotFoundException('Pawnshop not found');
    }

    // Create application
    const application = await this.prisma.loanApplication.create({
      data: {
        customerId: dto.customerId,
        pawnshopId: dto.pawnshopId,
        loanAmount: dto.loanAmount,
        loanType: dto.loanType,
        termMonths: dto.termMonths,
        purpose: dto.purpose,
        status: 'PENDING',
      },
      include: {
        customer: {
          select: {
            id: true,
            fullName: true,
            contactNumber: true,
          },
        },
        pawnshop: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    await this.legalProofService.createProof({
      pawnshopId: dto.pawnshopId,
      recordType: 'APPLICATION_SUBMITTED',
      title: `Loan application submitted for ${application.customer.fullName}`,
      summary: `Application ${application.id} submitted for ₱${application.loanAmount.toFixed(2)} under ${application.loanType}.`,
      createdBy: dto.submittedBy || dto.customerId,
      applicationId: application.id,
      payload: {
        applicationId: application.id,
        customerId: dto.customerId,
        pawnshopId: dto.pawnshopId,
        loanAmount: application.loanAmount,
        loanType: application.loanType,
        termMonths: application.termMonths,
        purpose: application.purpose,
        status: application.status,
      },
    });

    return application;
  }

  /**
   * Get all loan applications with optional filters
   */
  async getApplications(filters?: {
    pawnshopId?: string;
    customerId?: string;
    status?: string;
    limit?: number;
    offset?: number;
  }) {
    const where: any = {};

    if (filters?.pawnshopId) {
      where.pawnshopId = filters.pawnshopId;
    }

    if (filters?.customerId) {
      where.customerId = filters.customerId;
    }

    if (filters?.status) {
      where.status = filters.status;
    }

    const applications = await this.prisma.loanApplication.findMany({
      where,
      take: filters?.limit || 50,
      skip: filters?.offset || 0,
      orderBy: { submittedAt: 'desc' },
      include: {
        customer: {
          select: {
            id: true,
            fullName: true,
            contactNumber: true,
          },
        },
        pawnshop: {
          select: {
            id: true,
            name: true,
          },
        },
        eligibilityCheck: true,
        _count: {
          select: {
            documents: true,
            approvals: true,
          },
        },
      },
    });

    return applications;
  }

  /**
   * Get single application by ID
   */
  async getApplicationById(id: string) {
    const application = await this.prisma.loanApplication.findUnique({
      where: { id },
      include: {
        customer: true,
        pawnshop: true,
        documents: {
          orderBy: { uploadedAt: 'desc' },
        },
        approvals: {
          orderBy: { approvedAt: 'desc' },
          include: {
            approver: {
              select: {
                id: true,
                email: true,
                fullName: true,
                role: true,
              },
            },
          },
        },
        eligibilityCheck: true,
        loan: true,
        contract: true,
      },
    });

    if (!application) {
      throw new NotFoundException('Application not found');
    }

    return application;
  }

  /**
   * Update application status
   */
  async updateStatus(id: string, dto: UpdateApplicationStatusDto) {
    const application = await this.prisma.loanApplication.findUnique({
      where: { id },
    });

    if (!application) {
      throw new NotFoundException('Application not found');
    }

    await this.stateMachine.transition(
      'LOAN_APPLICATION_LIFECYCLE',
      application.status,
      dto.status,
      { userRole: dto.userRole },
    );

    const updateData: any = {
      status: dto.status,
      updatedAt: new Date(),
    };

    if (dto.evaluatedBy) {
      updateData.evaluatedBy = dto.evaluatedBy;
      updateData.evaluatedAt = new Date();
    }

    if (dto.status === 'APPROVED' && dto.evaluatedBy) {
      updateData.approvedBy = dto.evaluatedBy;
      updateData.approvedAt = new Date();
    }

    if (dto.status === 'REJECTED' && dto.rejectionReason) {
      updateData.rejectionReason = dto.rejectionReason;
    }

    const updated = await this.prisma.loanApplication.update({
      where: { id },
      data: updateData,
      include: {
        customer: true,
        pawnshop: true,
      },
    });

    if (dto.status === 'APPROVED') {
      // Generate contract for the approved application
      try {
        await this.loanContractService.generateContractForApplication(
          updated.id,
          dto.evaluatedBy || updated.approvedBy || updated.evaluatedBy || updated.customerId,
        );
      } catch (error) {
        console.error('Failed to generate contract:', (error as Error).message);
      }

      await this.legalProofService.createProof({
        pawnshopId: updated.pawnshopId,
        recordType: 'CONTRACT_PROOF',
        title: `Loan contract proof for application ${updated.id}`,
        summary: `Application ${updated.id} was approved by ${dto.evaluatedBy || 'system'} and is ready for contract generation.`,
        createdBy: dto.evaluatedBy || updated.approvedBy || updated.evaluatedBy || updated.customerId,
        applicationId: updated.id,
        payload: {
          applicationId: updated.id,
          status: updated.status,
          approvedBy: updated.approvedBy,
          approvedAt: updated.approvedAt,
          evaluatedBy: updated.evaluatedBy,
          evaluatedAt: updated.evaluatedAt,
          rejectionReason: updated.rejectionReason,
        },
      });
    }

    return updated;
  }

  async getProofsForApplication(applicationId: string) {
    return this.legalProofService.listByApplication(applicationId);
  }

  /**
   * Get applications pending approval for a specific role
   */
  async getPendingApprovals(role: string, pawnshopId?: string) {
    const statusMap: Record<string, string[]> = {
      STAFF: ['PENDING', 'DOCUMENTS_REVIEW', 'ELIGIBILITY_CHECK'],
      MANAGER: ['AWAITING_APPROVAL', 'MANAGER_REVIEW'],
      OWNER: ['OWNER_APPROVAL'],
    };

    const statuses = statusMap[role.toUpperCase()] || [];

    const where: any = {
      status: { in: statuses },
    };

    if (pawnshopId) {
      where.pawnshopId = pawnshopId;
    }

    const applications = await this.prisma.loanApplication.findMany({
      where,
      orderBy: { submittedAt: 'asc' },
      include: {
        customer: {
          select: {
            id: true,
            fullName: true,
            contactNumber: true,
          },
        },
        eligibilityCheck: true,
        _count: {
          select: {
            documents: true,
            approvals: true,
          },
        },
      },
    });

    return applications;
  }

  /**
   * Delete application (only if not yet approved)
   */
  async deleteApplication(id: string) {
    const application = await this.prisma.loanApplication.findUnique({
      where: { id },
    });

    if (!application) {
      throw new NotFoundException('Application not found');
    }

    if (['APPROVED', 'DISBURSED'].includes(application.status)) {
      throw new BadRequestException(
        'Cannot delete approved or disbursed applications',
      );
    }

    await this.prisma.loanApplication.delete({
      where: { id },
    });

    return { message: 'Application deleted successfully' };
  }
}
