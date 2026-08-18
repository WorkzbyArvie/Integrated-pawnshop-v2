import { Global, Module } from '@nestjs/common';
import { TierService } from './tier.service';

@Global()
@Module({
  providers: [TierService],
  exports: [TierService],
})
export class TierModule {}
