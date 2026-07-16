import { Module } from '@nestjs/common';
import { LoanController } from './loan.controller';
import { LoanService } from './loan.service';
import { LoanForfeitureService } from './loan-forfeiture.service';
import { LoanApplicationService } from './loan-application.service';
import { LoanContractService } from './loan-contract.service';
import { EligibilityService } from './eligibility.service';
import { RepaymentService } from './repayment.service';
import { PenaltyService } from './penalty.service';
import { FinanceModule } from '../finance/finance.module';
import { UserLoansController } from './user-loans.controller';
import { UserLoansService } from './user-loans.service';
import { PaymongoService } from '../subscription/paymongo.service';
import { LegalProofService } from './legal-proof.service';
import { ContractModule } from '../contract/contract.module';
import { ReceiptModule } from '../receipt/receipt.module';
import { PawnTicketController } from './pawn-ticket.controller';
import { PawnTicketService } from './pawn-ticket.service';

@Module({
  imports: [FinanceModule, ContractModule, ReceiptModule],
  controllers: [LoanController, UserLoansController, PawnTicketController],
  providers: [
    LoanService,
    LoanForfeitureService,
    LoanApplicationService,
    LoanContractService,
    EligibilityService,
    RepaymentService,
    PenaltyService,
    UserLoansService,
    PaymongoService,
    LegalProofService,
    PawnTicketService,
  ],
  exports: [
    LoanService,
    LoanApplicationService,
    LoanContractService,
    EligibilityService,
    RepaymentService,
    PenaltyService,
    UserLoansService,
    LegalProofService,
    PawnTicketService,
  ],
})
export class LoanModule {}
