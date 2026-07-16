import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { VerifyComplianceDto } from './dto/verify-compliance.dto';
import { ReleaseItemDto } from './dto/release-item.dto';
import { ComplianceStatus } from '@prisma/client';

@Injectable()
export class ComplianceService {
  private readonly logger = new Logger(ComplianceService.name);

  constructor(private prisma: PrismaService) {}

  private normalizeBranchId(branchId?: number | string | null): number | undefined {
    if (branchId === undefined || branchId === null || branchId === '') {
      return undefined;
    }

    const parsed = typeof branchId === 'string' ? Number(branchId) : branchId;
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new BadRequestException('Invalid branchId');
    }

    return parsed;
  }

  /**
   * Get all compliances for a pawnshop
   */
  async findAll(
    pawnshopId: string,
    status?: ComplianceStatus,
    branchId?: number | string,
  ): Promise<any> {
    try {
      const normalizedBranchId = this.normalizeBranchId(branchId);
      const where: any = { pawnshopId };
      if (status) where.status = status;
      if (normalizedBranchId !== undefined) {
        where.listing = { ticket: { branchId: normalizedBranchId } };
      }

      const compliances = await this.prisma.auctionWinnerCompliance.findMany({
        where,
        include: {
          listing: {
            include: {
              ticket: true,
              images: true,
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      return compliances;
    } catch (error: any) {
      this.logger.error(
        `Failed to fetch compliances: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Get a single compliance by ID
   */
  async findOne(pawnshopId: string, id: string): Promise<any> {
    const compliance = await this.prisma.auctionWinnerCompliance.findFirst({
      where: {
        id,
        pawnshopId,
      },
      include: {
        listing: {
          include: {
            ticket: true,
            images: true,
            bids: {
              orderBy: { amount: 'desc' },
              take: 1,
            },
          },
        },
      },
    });

    if (!compliance) {
      throw new NotFoundException('Compliance record not found');
    }

    return compliance;
  }

  /**
   * Get winner's compliance records
   */
  async findByWinner(winnerId: string): Promise<any> {
    const compliances = await this.prisma.auctionWinnerCompliance.findMany({
      where: { winnerId },
      include: {
        listing: {
          include: {
            ticket: true,
            images: true,
          },
        },
        pawnshop: {
          select: {
            id: true,
            name: true,
            address: true,
            contactPhone: true,
            contactEmail: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return compliances;
  }

  /**
   * Winner confirms compliance (payment made)
   */
  async submitCompliance(
    winnerId: string,
    complianceId: string,
    dto: VerifyComplianceDto,
  ): Promise<any> {
    try {
      const compliance = await this.prisma.auctionWinnerCompliance.findUnique({
        where: { id: complianceId },
      });

      if (!compliance) {
        throw new NotFoundException('Compliance record not found');
      }

      if (compliance.winnerId !== winnerId) {
        throw new ForbiddenException(
          'Not authorized to update this compliance',
        );
      }

      if (compliance.status !== ComplianceStatus.PENDING_COMPLIANCE) {
        throw new BadRequestException(
          `Cannot submit compliance in status: ${compliance.status}`,
        );
      }

      const updated = await this.prisma.auctionWinnerCompliance.update({
        where: { id: complianceId },
        data: {
          status: ComplianceStatus.COMPLIED,
          compliedAt: new Date(),
          paymentProofUrl: dto.paymentProofUrl,
          paymentReference: dto.paymentReference,
        },
        include: {
          listing: true,
        },
      });

      this.logger.log(
        `Compliance ${complianceId} submitted by winner ${winnerId}`,
      );

      return updated;
    } catch (error: any) {
      this.logger.error(
        `Failed to submit compliance: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Pawnshop staff verifies compliance
   */
  async verifyCompliance(
    pawnshopId: string,
    complianceId: string,
    verifiedBy: string,
  ): Promise<any> {
    try {
      const compliance = await this.findOne(pawnshopId, complianceId);

      if (compliance.status !== ComplianceStatus.COMPLIED) {
        throw new BadRequestException(
          'Can only verify compliances in COMPLIED status',
        );
      }

      const updated = await this.prisma.auctionWinnerCompliance.update({
        where: { id: complianceId },
        data: {
          status: ComplianceStatus.READY_FOR_RELEASE,
          verifiedBy,
          verifiedAt: new Date(),
        },
      });

      this.logger.log(
        `Compliance ${complianceId} verified by staff ${verifiedBy}`,
      );

      return updated;
    } catch (error: any) {
      this.logger.error(
        `Failed to verify compliance: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Release item to winner
   */
  async releaseItem(
    pawnshopId: string,
    complianceId: string,
    dto: ReleaseItemDto,
  ): Promise<any> {
    try {
      const compliance = await this.findOne(pawnshopId, complianceId);

      if (compliance.status !== ComplianceStatus.READY_FOR_RELEASE) {
        throw new BadRequestException(
          'Item can only be released when status is READY_FOR_RELEASE',
        );
      }

      const updated = await this.prisma.auctionWinnerCompliance.update({
        where: { id: complianceId },
        data: {
          status: ComplianceStatus.RELEASED,
          releasedAt: new Date(),
          releasedBy: dto.releasedBy,
          releaseNotes: dto.releaseNotes,
        },
      });

      // Update ticket status to SOLD
      await this.prisma.ticket.update({
        where: { id: compliance.listing.ticketId },
        data: {
          status: 'SOLD',
        },
      });

      this.logger.log(
        `Item released to winner for compliance ${complianceId} by ${dto.releasedBy}`,
      );

      return updated;
    } catch (error: any) {
      this.logger.error(
        `Failed to release item: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Extend compliance deadline
   */
  async extendDeadline(
    pawnshopId: string,
    complianceId: string,
    additionalHours: number,
  ): Promise<any> {
    try {
      const compliance = await this.findOne(pawnshopId, complianceId);

      if (
        ![
          ComplianceStatus.PENDING_COMPLIANCE,
          ComplianceStatus.REMINDER_SENT,
        ].includes(compliance.status)
      ) {
        throw new BadRequestException(
          'Can only extend deadline for pending compliances',
        );
      }

      const newDeadline = new Date(compliance.complianceDeadline);
      newDeadline.setHours(newDeadline.getHours() + additionalHours);

      const updated = await this.prisma.auctionWinnerCompliance.update({
        where: { id: complianceId },
        data: {
          complianceDeadline: newDeadline,
        },
      });

      this.logger.log(
        `Compliance ${complianceId} deadline extended by ${additionalHours} hours`,
      );

      return updated;
    } catch (error: any) {
      this.logger.error(
        `Failed to extend deadline: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Offer to the next highest bidder when current winner did not comply.
   */
  async offerToNextBidder(
    pawnshopId: string,
    complianceId: string,
    promotedBy?: string,
  ): Promise<any> {
    try {
      const compliance = await this.findOne(pawnshopId, complianceId);

      if (
        ![
          ComplianceStatus.PENDING_COMPLIANCE,
          ComplianceStatus.REMINDER_SENT,
          ComplianceStatus.EXPIRED,
        ].includes(compliance.status)
      ) {
        throw new BadRequestException(
          `Cannot offer to next bidder from status: ${compliance.status}`,
        );
      }

      const bids = await this.prisma.auctionBid.findMany({
        where: {
          listingId: compliance.listingId,
        },
        orderBy: [{ amount: 'desc' }, { createdAt: 'desc' }],
      });

      const seen = new Set<string>();
      const uniqueRanked = bids.filter((bid) => {
        if (seen.has(bid.bidderId)) return false;
        seen.add(bid.bidderId);
        return true;
      });

      const attemptedWinners = new Set<string>([compliance.winnerId]);
      const existingAccessLog = Array.isArray(compliance.accessLog)
        ? compliance.accessLog
        : [];

      for (const entry of existingAccessLog) {
        if (!entry || typeof entry !== 'object') continue;
        const prev = (entry as any).previousWinnerId;
        const next = (entry as any).newWinnerId;
        if (typeof prev === 'string' && prev) attemptedWinners.add(prev);
        if (typeof next === 'string' && next) attemptedWinners.add(next);
      }

      const nextBidder = uniqueRanked.find(
        (bid) => !attemptedWinners.has(bid.bidderId),
      );

      if (!nextBidder) {
        throw new BadRequestException(
          'No next eligible bidder found for this listing',
        );
      }

      const winnerProfile = await this.prisma.profile.findUnique({
        where: { id: nextBidder.bidderId },
        include: { kyc: true },
      });

      const now = new Date();
      const newDeadline = new Date(now.getTime() + 48 * 60 * 60 * 1000);
      const prevWinnerId = compliance.winnerId;

      const accessLog = Array.isArray(compliance.accessLog)
        ? [...compliance.accessLog]
        : [];

      accessLog.push({
        accessType: 'OFFER_NEXT_BIDDER',
        timestamp: now.toISOString(),
        accessedBy: promotedBy || 'system',
        previousWinnerId: prevWinnerId,
        newWinnerId: nextBidder.bidderId,
      });

      const updated = await this.prisma.auctionWinnerCompliance.update({
        where: { id: complianceId },
        data: {
          winnerId: nextBidder.bidderId,
          winningBid: nextBidder.amount,
          status: ComplianceStatus.PENDING_COMPLIANCE,
          complianceDeadline: newDeadline,
          reminderSentAt: null,
          lastReminderAt: null,
          reminderCount: 0,
          compliedAt: null,
          paymentProofUrl: null,
          paymentReference: null,
          verifiedBy: null,
          verifiedAt: null,
          releasedAt: null,
          releasedBy: null,
          releaseNotes: null,
          expiredAt: null,
          expiryAction: 'NEXT_BIDDER',
          winnerFullName:
            winnerProfile?.kyc?.fullName ||
            winnerProfile?.fullName ||
            winnerProfile?.email ||
            'Unknown',
          winnerEmail: winnerProfile?.email,
          winnerPhone: winnerProfile?.kyc?.phoneNumber || '',
          winnerAddress: winnerProfile?.kyc?.address,
          consentAcceptedAt: now,
          accessLog,
        },
        include: {
          listing: {
            include: {
              ticket: true,
              images: true,
            },
          },
        },
      });

      this.logger.log(
        `Compliance ${complianceId} moved to next bidder ${nextBidder.bidderId} (prev winner ${prevWinnerId})`,
      );

      return updated;
    } catch (error: any) {
      this.logger.error(
        `Failed to offer next bidder: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Log access to winner information (privacy/audit)
   */
  async logAccess(
    complianceId: string,
    accessedBy: string,
    accessType: string,
  ): Promise<void> {
    try {
      const compliance = await this.prisma.auctionWinnerCompliance.findUnique({
        where: { id: complianceId },
      });

      if (!compliance) return;

      const accessLog = compliance.accessLog as any[];
      accessLog.push({
        accessedBy,
        accessType,
        timestamp: new Date().toISOString(),
      });

      await this.prisma.auctionWinnerCompliance.update({
        where: { id: complianceId },
        data: { accessLog },
      });

      this.logger.log(
        `Winner info accessed for compliance ${complianceId} by ${accessedBy}`,
      );
    } catch (error: any) {
      this.logger.error(`Failed to log access: ${error.message}`, error.stack);
    }
  }

  /**
   * Get compliance statistics
   */
  async getStatistics(
    pawnshopId: string,
    branchId?: number | string,
  ): Promise<any> {
    try {
      const normalizedBranchId = this.normalizeBranchId(branchId);
      const baseWhere: any = { pawnshopId };
      if (normalizedBranchId !== undefined) {
        baseWhere.listing = { ticket: { branchId: normalizedBranchId } };
      }

      const [
        pending,
        complied,
        readyForRelease,
        released,
        expired,
        compliedRecords,
      ] = await Promise.all([
        this.prisma.auctionWinnerCompliance.count({
          where: {
            ...baseWhere,
            status: ComplianceStatus.PENDING_COMPLIANCE,
          },
        }),
        this.prisma.auctionWinnerCompliance.count({
          where: {
            ...baseWhere,
            status: ComplianceStatus.COMPLIED,
          },
        }),
        this.prisma.auctionWinnerCompliance.count({
          where: {
            ...baseWhere,
            status: ComplianceStatus.READY_FOR_RELEASE,
          },
        }),
        this.prisma.auctionWinnerCompliance.count({
          where: {
            ...baseWhere,
            status: ComplianceStatus.RELEASED,
          },
        }),
        this.prisma.auctionWinnerCompliance.count({
          where: {
            ...baseWhere,
            status: ComplianceStatus.EXPIRED,
          },
        }),
        this.prisma.auctionWinnerCompliance.findMany({
          where: {
            ...baseWhere,
            compliedAt: { not: null },
          },
          select: {
            createdAt: true,
            compliedAt: true,
          },
        }),
      ]);

      const avgComplianceHours = compliedRecords.length
        ? Math.round(
            compliedRecords.reduce((sum, record) => {
              if (!record.compliedAt) return sum;
              return sum + (record.compliedAt.getTime() - record.createdAt.getTime());
            }, 0) /
              compliedRecords.length /
              (1000 * 60 * 60),
          )
        : 0;

      return {
        pending,
        complied,
        readyForRelease,
        released,
        expired,
        total: pending + complied + readyForRelease + released + expired,
        avgComplianceHours,
      };
    } catch (error: any) {
      this.logger.error(
        `Failed to get statistics: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }
}
