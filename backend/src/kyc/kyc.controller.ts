import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';

import { KycService } from './kyc.service';
import { ReviewCustomerKycDto } from './dto/review-customer-kyc.dto';
import { UpsertCustomerKycDto } from './dto/upsert-customer-kyc.dto';
import { AuditLog } from '../common/decorators/audit-log.decorator';
import { RequiresPermission } from '../common/decorators/requires-permission.decorator';
import { PERMISSIONS } from '../common/permissions/permissions.const';

@Controller('kyc')
export class KycController {
  constructor(private readonly kycService: KycService) {}

  @Post('customers')
  @HttpCode(HttpStatus.OK)
  upsert(@Body() dto: UpsertCustomerKycDto, @Req() req: Request) {
    const user = (req as any).user ?? req;
    return this.kycService.upsertCustomerKyc(
      dto,
      user.pawnshopId ?? req.headers?.['pawnshop-id'],
    );
  }

  @Get('customers')
  @HttpCode(HttpStatus.OK)
  @RequiresPermission(PERMISSIONS['kyc.view'])
  list(@Query('status') status: string | undefined, @Req() req: Request) {
    const user = (req as any).user ?? req;
    return this.kycService.listCustomers(
      user.pawnshopId ?? req.headers?.['pawnshop-id'],
      status,
    );
  }

  @AuditLog('KYC_REVIEW')
  @Patch('customers/:id/review')
  @HttpCode(HttpStatus.OK)
  @RequiresPermission(PERMISSIONS['kyc.verify'])
  review(@Param('id') id: string, @Body() dto: ReviewCustomerKycDto, @Req() req: Request) {
    const user = (req as any).user ?? req;
    return this.kycService.review(
      id,
      dto,
      user.pawnshopId ?? req.headers?.['pawnshop-id'],
      user.id,
      user.role,
    );
  }
}
