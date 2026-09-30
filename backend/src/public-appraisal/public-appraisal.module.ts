import { Module } from '@nestjs/common';

// `StorageService` comes from the global `CommonModule`, which exports it, so
// there is nothing to import here.
import { PublicAppraisalController } from './public-appraisal.controller';
import { PublicAppraisalService } from './public-appraisal.service';

@Module({
  controllers: [PublicAppraisalController],
  providers: [PublicAppraisalService],
  exports: [PublicAppraisalService],
})
export class PublicAppraisalModule {}
