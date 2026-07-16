import { Module } from '@nestjs/common';
import { ContractController } from './contract.controller';
import { ContractTemplateService } from './contract-template.service';
import { ContractRendererService } from './contract-renderer.service';
import { TOSService } from './tos.service';
import { PrismaModule } from '../prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [ContractController],
  providers: [ContractTemplateService, ContractRendererService, TOSService],
  exports: [ContractTemplateService, ContractRendererService, TOSService],
})
export class ContractModule {}
