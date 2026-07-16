import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { CreateEligibilityCheckDto } from './dto/eligibility-check.dto';

@Injectable()
export class EligibilityService {
  constructor(private prisma: PrismaService) {}

  /**
   * Perform eligibility check for loan application
   */
  async checkEligibility(applicationId: string, checkedBy: string) {
    const application = await this.prisma.loanApplication.findUnique({
      where: { id: applicationId },
      include: {
        customer: true,
      },
    });

    if (!application) {
      throw new NotFoundException('Application not found');
    }

    // Calculate eligibility factors - get loans by customer name
    const previousLoans = await this.prisma.loan.findMany({
      where: {
        customerName: application.customer.fullName,
      },
    });
    const hasPreviousLoans = previousLoans.length > 0;
    const previousLoanCount = previousLoans.length;

    // Check for defaults (simplified logic - can be enhanced)
    const defaultHistory = previousLoans.some(
      (loan) => loan.status === 'FORFEITED',
    );

    // Calculate debt-to-income ratio if income is provided
    let debtToIncomeRatio = null;
    const monthlyIncome = 0; // This should come from customer data or application

    if (monthlyIncome > 0) {
      const totalDebt = previousLoans.reduce(
        (sum, loan) => sum + (loan.principalAmount || 0),
        0,
      );
      debtToIncomeRatio = totalDebt / (monthlyIncome * 12); // Annual debt to annual income
    }

    // Simple eligibility logic (enhance based on business rules)
    const eligible =
      !defaultHistory &&
      (debtToIncomeRatio === null || debtToIncomeRatio < 0.4) &&
      application.loanAmount <= 500000; // Max loan amount check

    const eligibilityNotes = [];
    if (defaultHistory) {
      eligibilityNotes.push('Customer has default history');
    }
    if (debtToIncomeRatio && debtToIncomeRatio >= 0.4) {
      eligibilityNotes.push(
        `High debt-to-income ratio: ${(debtToIncomeRatio * 100).toFixed(2)}%`,
      );
    }
    if (application.loanAmount > 500000) {
      eligibilityNotes.push('Loan amount exceeds standard limit');
    }
    if (eligible) {
      eligibilityNotes.push('Customer meets all eligibility criteria');
    }

    // Create eligibility check record
    const check = await this.prisma.eligibilityCheck.create({
      data: {
        applicationId,
        customerId: application.customerId,
        hasPreviousLoans,
        previousLoanCount,
        defaultHistory,
        incomeVerified: monthlyIncome > 0,
        monthlyIncome: monthlyIncome || null,
        debtToIncomeRatio,
        eligible,
        eligibilityNotes: eligibilityNotes.join('; '),
        checkedBy,
      },
    });

    // Update application status
    await this.prisma.loanApplication.update({
      where: { id: applicationId },
      data: {
        status: eligible ? 'AWAITING_APPROVAL' : 'REJECTED',
        rejectionReason: eligible ? null : 'Failed eligibility check',
        evaluatedBy: checkedBy,
        evaluatedAt: new Date(),
      },
    });

    return check;
  }

  /**
   * Get eligibility check for an application
   */
  async getEligibilityCheck(applicationId: string) {
    const check = await this.prisma.eligibilityCheck.findUnique({
      where: { applicationId },
      include: {
        application: {
          select: {
            id: true,
            loanAmount: true,
            loanType: true,
            status: true,
          },
        },
        customer: {
          select: {
            id: true,
            fullName: true,
            contactNumber: true,
          },
        },
      },
    });

    if (!check) {
      throw new NotFoundException('Eligibility check not found');
    }

    return check;
  }

  /**
   * Get customer's loan history for eligibility assessment
   */
  async getCustomerCreditHistory(customerId: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
    });

    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    // Get loans by customer name
    const loans = await this.prisma.loan.findMany({
      where: {
        customerName: customer.fullName,
      },
      include: {
        ticket: {
          select: {
            ticketNumber: true,
            status: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Get loan applications
    const loanApplications = await this.prisma.loanApplication.findMany({
      where: { customerId },
      orderBy: { submittedAt: 'desc' },
      take: 10,
    });

    // Calculate summary statistics
    const totalLoans = loans.length;
    const activeLoans = loans.filter((l) => l.status === 'ACTIVE').length;
    const completedLoans = loans.filter((l) => l.status === 'REDEEMED').length;
    const defaultedLoans = loans.filter((l) => l.status === 'FORFEITED').length;

    const totalBorrowed = loans.reduce(
      (sum, l) => sum + (l.principalAmount || 0),
      0,
    );
    const currentDebt = loans
      .filter((l) => l.status === 'ACTIVE')
      .reduce((sum, l) => sum + (l.principalAmount || 0), 0);

    return {
      customer: {
        id: customer.id,
        fullName: customer.fullName,
        contactNumber: customer.contactNumber,
      },
      summary: {
        totalLoans,
        activeLoans,
        completedLoans,
        defaultedLoans,
        totalBorrowed,
        currentDebt,
        repaymentRate: totalLoans > 0 ? (completedLoans / totalLoans) * 100 : 0,
      },
      loans: loans,
      applications: loanApplications,
    };
  }
}
