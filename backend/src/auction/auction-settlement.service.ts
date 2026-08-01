import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma.service';
import { AuctionStatus, ComplianceStatus } from '@prisma/client';
import { ContractTemplateService } from '../contract/contract-template.service';
import { LegalProofService } from '../loan/legal-proof.service';
import { ReceiptService } from '../receipt/receipt.service';
import { randomUUID } from 'crypto';

@Injectable()
export class AuctionSettlementService {
  private readonly logger = new Logger(AuctionSettlementService.name);

  constructor(
    private prisma: PrismaService,
    private contractTemplateService: ContractTemplateService,
    private legalProofService: LegalProofService,
    private receiptService: ReceiptService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async settleEndedAuctions(): Promise<void> {
    if (!(await this.prisma.ensureConnected('auction settlement cron'))) {
      return;
    }

    try {
      const now = new Date();

      const endedAuctions = await this.prisma.auctionListing.findMany({
        where: {
          status: AuctionStatus.LIVE,
          endAt: {
            lte: now,
          },
        },
        include: {
          bids: {
            orderBy: {
              amount: 'desc',
            },
            take: 1,
          },
          ticket: true,
          pawnshop: true,
        },
      });

      if (endedAuctions.length === 0) {
        return;
      }

      this.logger.log(`Found ${endedAuctions.length} auctions to settle`);

      for (const auction of endedAuctions) {
        await this.settleAuction(auction);
      }
    } catch (error: any) {
      this.logger.error(
        `Failed to settle ended auctions: ${error.message}`,
        error.stack,
      );
    }
  }

  private async settleAuction(auction: any): Promise<void> {
    try {
      const hasWinner =
        auction.bids.length > 0 &&
        auction.bids[0].amount >= (auction.reservePrice || 0);

      if (hasWinner) {
        const winningBid = auction.bids[0];

        await this.prisma.auctionListing.update({
          where: { id: auction.id },
          data: { status: AuctionStatus.ENDED },
        });

        const winnerProfile = await this.prisma.profile.findUnique({
          where: { id: winningBid.bidderId },
          include: {
            kyc: true,
          },
        });

        const complianceDeadline = new Date();
        complianceDeadline.setHours(complianceDeadline.getHours() + 48);

        await this.prisma.auctionWinnerCompliance.create({
          data: {
            listingId: auction.id,
            winnerId: winningBid.bidderId,
            pawnshopId: auction.pawnshopId,
            winningBid: winningBid.amount,
            complianceDeadline,
            winnerFullName:
              winnerProfile?.kyc?.fullName ||
              winnerProfile?.fullName ||
              'Unknown',
            winnerEmail: winnerProfile?.email,
            winnerPhone: winnerProfile?.kyc?.phoneNumber || '',
            winnerAddress: winnerProfile?.kyc?.address,
            consentAcceptedAt: new Date(),
          },
        });

        await this.generateWonAuctionContract(
          auction,
          winningBid,
          winnerProfile,
        );

        if (auction.pawnshopId) {
          try {
            await this.receiptService.generateReceipt({
              pawnshopId: auction.pawnshopId,
              receiptType: 'AUCTION_SALE',
              referenceType: 'AUCTION',
              referenceId: String(auction.id),
              amount: winningBid.amount,
              customerName: winnerProfile?.kyc?.fullName || winnerProfile?.fullName || 'Winner',
              lineItems: [
                { description: `Auction Sale — ${auction.title}`, amount: winningBid.amount },
              ],
              generatedBy: 'system',
            });
          } catch (receiptErr) {
            this.logger.warn(`Failed to generate seller receipt for auction ${auction.id}: ${(receiptErr as Error).message}`);
          }

          try {
            await this.legalProofService.createProof({
              pawnshopId: auction.pawnshopId,
              recordType: 'AUCTION_SELLER_PROOF',
              title: `Auction sold: ${auction.title}`,
              summary: `Auction ${auction.id} won by ${winnerProfile?.kyc?.fullName || 'bidder'} for ₱${winningBid.amount.toFixed(2)}.`,
              createdBy: winningBid.bidderId,
              auctionListingId: auction.id,
              ticketId: auction.ticketId,
              payload: {
                auctionId: auction.id,
                ticketId: auction.ticketId,
                winnerId: winningBid.bidderId,
                winningBid: winningBid.amount,
                listingTitle: auction.title,
                reservePrice: auction.reservePrice,
              },
            });
          } catch (proofErr) {
            this.logger.warn(`Failed to generate seller proof for auction ${auction.id}: ${(proofErr as Error).message}`);
          }
        }

        this.logger.log(
          `Auction ${auction.id} settled - Winner: ${winningBid.bidderId}, Amount: ${winningBid.amount}`,
        );
      } else {
        await this.prisma.auctionListing.update({
          where: { id: auction.id },
          data: {
            status: AuctionStatus.ENDED,
          },
        });

        await this.prisma.ticket.update({
          where: { id: auction.ticketId },
          data: {
            status: 'FORFEITED',
          },
        });

        if (auction.pawnshopId) {
          try {
            await this.legalProofService.createProof({
              pawnshopId: auction.pawnshopId,
              recordType: 'AUCTION_UNSOLD_PROOF',
              title: `Auction unsold: ${auction.title}`,
              summary: `Auction ${auction.id} ended without a qualifying bid. Reserve price: ₱${(auction.reservePrice || 0).toFixed(2)}.`,
              createdBy: 'system',
              auctionListingId: auction.id,
              ticketId: auction.ticketId,
              payload: {
                auctionId: auction.id,
                ticketId: auction.ticketId,
                listingTitle: auction.title,
                reservePrice: auction.reservePrice,
                highestBid: auction.bids.length > 0 ? auction.bids[0].amount : 0,
                totalBids: auction.bids.length,
              },
            });
          } catch (proofErr) {
            this.logger.warn(`Failed to create auction unsold proof for auction ${auction.id}: ${(proofErr as Error).message}`);
          }

          try {
            await this.receiptService.generateReceipt({
              pawnshopId: auction.pawnshopId,
              receiptType: 'AUCTION_UNSOLD' as any,
              referenceType: 'AUCTION',
              referenceId: String(auction.id),
              amount: 0,
              customerName: 'N/A',
              lineItems: [
                { description: `Auction Unsold — ${auction.title}`, amount: 0 },
                { description: `Reserve Price Not Met`, amount: auction.reservePrice || 0 },
              ],
              generatedBy: 'system',
            });
          } catch (receiptErr) {
            this.logger.warn(`Failed to create auction unsold receipt for auction ${auction.id}: ${(receiptErr as Error).message}`);
          }
        }

        this.logger.log(
          `Auction ${auction.id} ended without winner - Ticket returned to queue`,
        );
      }
    } catch (error: any) {
      this.logger.error(
        `Failed to settle auction ${auction.id}: ${error.message}`,
        error.stack,
      );
    }
  }

  private async generateWonAuctionContract(auction: any, winningBid: any, winnerProfile: any) {
    try {
      const templates = await this.contractTemplateService.listTemplates('AUCTION_BIDDER_AGREEMENT');
      const template = templates[0];

      if (!template) {
        this.logger.warn(`No AUCTION_BIDDER_AGREEMENT template found for auction ${auction.id}`);
        return;
      }

      const contractData = {
        contractNumber: `WON-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`,
        auctionId: auction.id,
        ticketId: auction.ticketId,
        winnerName: winnerProfile?.kyc?.fullName || winnerProfile?.fullName || 'Unknown',
        winnerEmail: winnerProfile?.email || '',
        amount: winningBid.amount,
        listingTitle: auction.title,
        pawnshopName: auction.pawnshop?.name || '',
        wonAt: new Date().toISOString(),
      };

      await this.legalProofService.createProof({
        pawnshopId: auction.pawnshopId,
        recordType: 'BIDDER_AGREEMENT_PROOF',
        title: `Won Auction Contract - ${auction.title}`,
        summary: `Contract for won auction ${auction.id} - Winner: ${winningBid.bidderId}, Amount: ${winningBid.amount}`,
        createdBy: winningBid.bidderId,
        auctionListingId: auction.id,
        payload: contractData,
      });

      this.logger.log(`Won-auction contract generated for auction ${auction.id}`);
    } catch (error: any) {
      this.logger.error(`Failed to generate won-auction contract for ${auction.id}: ${error.message}`);
    }
  }

  @Cron(CronExpression.EVERY_HOUR)
  async checkExpiredCompliances(): Promise<void> {
    if (!(await this.prisma.ensureConnected('expired compliance cron'))) {
      return;
    }

    try {
      const now = new Date();

      const expiredCompliances =
        await this.prisma.auctionWinnerCompliance.findMany({
          where: {
            status: ComplianceStatus.PENDING_COMPLIANCE,
            complianceDeadline: {
              lt: now,
            },
          },
          include: {
            listing: {
              include: {
                ticket: true,
                bids: {
                  orderBy: { amount: 'desc' },
                  take: 2,
                },
              },
            },
          },
        });

      if (expiredCompliances.length === 0) {
        return;
      }

      this.logger.log(`Found ${expiredCompliances.length} expired compliances`);

      for (const compliance of expiredCompliances) {
        const rankedBidders = this.getUniqueRankedBidders(compliance.listing.bids);
        const attemptedWinners = this.getAttemptedWinnerIds(compliance);
        const nextBidder = rankedBidders.find(
          (bid) => !attemptedWinners.has(bid.bidderId),
        );

        if (!nextBidder) {
          await this.prisma.auctionWinnerCompliance.update({
            where: { id: compliance.id },
            data: {
              status: ComplianceStatus.EXPIRED,
              expiredAt: now,
              expiryAction: 'REQUEUE',
              accessLog: [
                ...((Array.isArray(compliance.accessLog)
                  ? compliance.accessLog
                  : []) as any[]),
                {
                  accessType: 'AUTO_REQUEUE_NO_BIDDER',
                  timestamp: now.toISOString(),
                  previousWinnerId: compliance.winnerId,
                },
              ],
            },
          });

          await this.prisma.ticket.update({
            where: { id: compliance.listing.ticketId },
            data: {
              status: 'FORFEITED',
            },
          });

          this.logger.log(
            `Compliance ${compliance.id} expired - no fallback bidder, ticket ${compliance.listing.ticketId} requeued`,
          );
          continue;
        }

        const winnerProfile = await this.prisma.profile.findUnique({
          where: { id: nextBidder.bidderId },
          include: { kyc: true },
        });

        const nextDeadline = new Date(now.getTime() + 48 * 60 * 60 * 1000);
        const accessLog = [
          ...((Array.isArray(compliance.accessLog)
            ? compliance.accessLog
            : []) as any[]),
          {
            accessType: 'AUTO_NEXT_BIDDER_ON_EXPIRY',
            timestamp: now.toISOString(),
            previousWinnerId: compliance.winnerId,
            newWinnerId: nextBidder.bidderId,
          },
        ];

        await this.prisma.auctionWinnerCompliance.update({
          where: { id: compliance.id },
          data: {
            winnerId: nextBidder.bidderId,
            winningBid: nextBidder.amount,
            status: ComplianceStatus.PENDING_COMPLIANCE,
            complianceDeadline: nextDeadline,
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
        });

        this.logger.log(
          `Compliance ${compliance.id} moved automatically from ${compliance.winnerId} to next bidder ${nextBidder.bidderId}`,
        );
      }
    } catch (error: any) {
      this.logger.error(
        `Failed to check expired compliances: ${error.message}`,
        error.stack,
      );
    }
  }

  private getUniqueRankedBidders(
    bids: Array<{ bidderId: string; amount: number; createdAt: Date }>,
  ) {
    const seen = new Set<string>();
    const unique: Array<{ bidderId: string; amount: number; createdAt: Date }> = [];

    for (const bid of bids) {
      if (seen.has(bid.bidderId)) continue;
      seen.add(bid.bidderId);
      unique.push(bid);
    }

    return unique;
  }

  private getAttemptedWinnerIds(compliance: any): Set<string> {
    const attempted = new Set<string>([compliance.winnerId]);
    const accessLog = Array.isArray(compliance.accessLog)
      ? compliance.accessLog
      : [];

    for (const entry of accessLog) {
      if (!entry || typeof entry !== 'object') continue;
      const prev = (entry as any).previousWinnerId;
      const next = (entry as any).newWinnerId;
      if (typeof prev === 'string' && prev) attempted.add(prev);
      if (typeof next === 'string' && next) attempted.add(next);
    }

    return attempted;
  }

  async manualSettle(
    auctionId: number,
    winnerId: string,
    finalAmount: number,
  ): Promise<any> {
    try {
      const auction = await this.prisma.auctionListing.findUnique({
        where: { id: auctionId },
        include: {
          ticket: true,
          pawnshop: true,
        },
      });

      if (!auction) {
        throw new Error('Auction not found');
      }

      await this.prisma.auctionListing.update({
        where: { id: auctionId },
        data: { status: AuctionStatus.ENDED },
      });

      const winnerProfile = await this.prisma.profile.findUnique({
        where: { id: winnerId },
        include: { kyc: true },
      });

      const complianceDeadline = new Date();
      complianceDeadline.setHours(complianceDeadline.getHours() + 48);

      const compliance = await this.prisma.auctionWinnerCompliance.create({
        data: {
          listingId: auctionId,
          winnerId,
          pawnshopId: auction.pawnshopId,
          winningBid: finalAmount,
          complianceDeadline,
          winnerFullName:
            winnerProfile?.kyc?.fullName ||
            winnerProfile?.fullName ||
            'Unknown',
          winnerEmail: winnerProfile?.email,
          winnerPhone: winnerProfile?.kyc?.phoneNumber || '',
          winnerAddress: winnerProfile?.kyc?.address,
          consentAcceptedAt: new Date(),
        },
      });

      if (auction.pawnshopId) {
        try {
          await this.receiptService.generateReceipt({
            pawnshopId: auction.pawnshopId,
            receiptType: 'AUCTION_SALE',
            referenceType: 'AUCTION',
            referenceId: String(auction.id),
            amount: finalAmount,
            customerName: winnerProfile?.kyc?.fullName || winnerProfile?.fullName || 'Winner',
            lineItems: [
              { description: `Auction Sale — ${auction.title}`, amount: finalAmount },
            ],
            generatedBy: 'system',
          });
        } catch (receiptErr) {
          this.logger.warn(`Failed to generate manual settlement receipt: ${(receiptErr as Error).message}`);
        }
      }

      this.logger.log(
        `Manual settlement of auction ${auctionId} - Winner: ${winnerId}, Amount: ${finalAmount}`,
      );

      return compliance;
    } catch (error: any) {
      this.logger.error(
        `Failed manual settlement: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }
}
