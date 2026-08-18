import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { PaymongoService } from '../subscription/paymongo.service';
import { FinanceService } from '../finance/finance.service';
import { ReceiptService } from '../receipt/receipt.service';
import { LegalProofService } from '../loan/legal-proof.service';
import { TierService } from '../tier/tier.service';

@Injectable()
export class AuctionPaymentService {
  private readonly logger = new Logger(AuctionPaymentService.name);

  constructor(
    private prisma: PrismaService,
    private paymongo: PaymongoService,
    private finance: FinanceService,
    private receipt: ReceiptService,
    private legalProofService: LegalProofService,
    private tierService: TierService,
  ) {}

  async createCheckout(complianceId: string, winnerId: string, returnUrl?: string) {
    const compliance = await this.prisma.auctionWinnerCompliance.findUnique({
      where: { id: complianceId },
      include: {
        listing: { include: { ticket: true } },
        pawnshop: true,
      },
    });

    if (!compliance) throw new NotFoundException('Compliance record not found');
    if (compliance.winnerId !== winnerId) {
      throw new BadRequestException('Not authorized to pay this compliance');
    }
    if (compliance.status !== 'PENDING_COMPLIANCE') {
      throw new BadRequestException(`Cannot pay compliance in status: ${compliance.status}`);
    }

    const amountCentavos = Math.round(compliance.winningBid * 100);
    const description = `Auction payment — ${compliance.listing?.title || 'Item'} — ${compliance.winnerFullName}`;

    const { linkId, checkoutUrl } = await this.paymongo.createPaymentLink({
      amountCentavos,
      description,
      remarks: `Auction compliance ${complianceId}`,
      metadata: {
        complianceId,
        auctionListingId: String(compliance.listingId),
        winnerId,
        type: 'auction_payment',
      },
    });

    const payment = await this.prisma.payment.create({
      data: {
        customerId: winnerId,
        auctionListingId: compliance.listingId,
        amount: compliance.winningBid,
        paymentMethod: 'E_WALLET',
        paymentType: 'AUCTION_PAYMENT',
        referenceNumber: linkId,
        status: 'PENDING',
        processedBy: winnerId,
        notes: `PayMongo link: ${linkId}`,
      },
    });

    this.logger.log(`Checkout created for compliance ${complianceId}: ${checkoutUrl}`);

    return {
      checkoutUrl,
      linkId,
      paymentId: payment.id,
      amount: compliance.winningBid,
    };
  }

  async confirmPayment(complianceId: string, transactionId: string, paymentMethod: string) {
    const compliance = await this.prisma.auctionWinnerCompliance.findUnique({
      where: { id: complianceId },
      include: {
        listing: { include: { ticket: true } },
        pawnshop: true,
      },
    });

    if (!compliance) throw new NotFoundException('Compliance record not found');
    if (compliance.status !== 'PENDING_COMPLIANCE') {
      this.logger.warn(`Compliance ${complianceId} already in status ${compliance.status}`);
      return compliance;
    }

    const updated = await this.prisma.auctionWinnerCompliance.update({
      where: { id: complianceId },
      data: {
        status: 'COMPLIED',
        compliedAt: new Date(),
        paymentReference: transactionId,
      },
      include: { listing: true },
    });

    await this.prisma.payment.updateMany({
      where: {
        auctionListingId: compliance.listingId,
        status: 'PENDING',
      },
      data: {
        status: 'COMPLETED',
        transactionId,
        paymentMethod: paymentMethod as any,
      },
    });

    if (compliance.pawnshopId) {
      await this.legalProofService.createProof({
        pawnshopId: compliance.pawnshopId,
        recordType: 'RECEIPT_PROOF',
        title: `Auction payment — ${compliance.winnerFullName}`,
        summary: `Payment of ₱${compliance.winningBid.toFixed(2)} for auction listing #${compliance.listingId}`,
        payload: {
          complianceId,
          listingId: compliance.listingId,
          amount: compliance.winningBid,
          transactionId,
          status: 'COMPLIED',
        },
        createdBy: 'system',
        auctionListingId: compliance.listingId,
      });

      try {
        await this.receipt.generateReceipt({
          pawnshopId: compliance.pawnshopId,
          receiptType: 'AUCTION_SALE',
          referenceType: 'AUCTION_COMPLIANCE',
          referenceId: complianceId,
          amount: compliance.winningBid,
          customerName: compliance.winnerFullName,
          customerAddress: compliance.winnerAddress || undefined,
          customerId: compliance.winnerId,
          lineItems: [
            {
              description: `Winning bid — ${compliance.listing?.title || 'Auction item'}`,
              amount: compliance.winningBid,
            },
          ],
          generatedBy: 'system',
        });
      } catch (receiptErr) {
        this.logger.error(`Failed to generate receipt: ${(receiptErr as Error).message}`);
      }
    }

    try {
      await this.tierService.recomputeCustomerTier(compliance.winnerId, 'system');
    } catch (tierErr) {
      this.logger.error(`Failed to update customer tier after auction payment: ${(tierErr as Error).message}`);
    }

    this.logger.log(`Payment confirmed for compliance ${complianceId} (tx: ${transactionId})`);
    return updated;
  }

}
