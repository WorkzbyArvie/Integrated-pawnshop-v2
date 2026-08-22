import { Module } from '@nestjs/common';
import { AuctionController } from './auction.controller';
import { AuctionService } from './auction.service';
import { AuctionAuthService } from './auction-auth.service';
import { AuctionSettlementService } from './auction-settlement.service';
import { AuctionPaymentService } from './auction-payment.service';
import { FinanceModule } from '../finance/finance.module';
import { ContractModule } from '../contract/contract.module';
import { SubscriptionModule } from '../subscription/subscription.module';
import { ReceiptModule } from '../receipt/receipt.module';
import { LoanModule } from '../loan/loan.module';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [FinanceModule, ContractModule, SubscriptionModule, ReceiptModule, LoanModule, NotificationModule],
  controllers: [AuctionController],
  providers: [
    AuctionService,
    AuctionAuthService,
    AuctionSettlementService,
    AuctionPaymentService,
  ],
  exports: [AuctionService, AuctionSettlementService, AuctionPaymentService],
})
export class AuctionModule {}
