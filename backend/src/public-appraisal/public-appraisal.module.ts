import { Module } from '@nestjs/common';

import { LoanModule } from '../loan/loan.module';

// `StorageService` comes from the global `CommonModule`, which exports it, so
// there is nothing to import for it. `LoanModule` is imported for
// `PawnTicketService`, which the conversion delegates to so that an application
// converted at the counter and a pawn started at the counter take one code
// path — same state machine, same interest arithmetic, same audit trail.
import { PublicAppraisalController } from './public-appraisal.controller';
import { PublicAppraisalService } from './public-appraisal.service';

@Module({
  imports: [LoanModule],
  controllers: [PublicAppraisalController],
  providers: [PublicAppraisalService],
  exports: [PublicAppraisalService],
})
export class PublicAppraisalModule {}