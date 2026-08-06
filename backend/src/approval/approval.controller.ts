import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  RequestMethod,
} from '@nestjs/common';
import type { Request } from 'express';

import { ApprovalService } from './approval.service';
import { ApprovalQueueQueryDto } from './dto/approval-queue-query.dto';
import { DecideApprovalDto } from './dto/decide-approval.dto';
import { AuditLog } from '../common/decorators/audit-log.decorator';
import { RequiresPermission } from '../common/decorators/requires-permission.decorator';
import { PERMISSIONS } from '../common/permissions/permissions.const';

const PATH_METADATA = 'path';
const METHOD_METADATA = 'method';

const GetRoot = (): MethodDecorator => (
  _target: object,
  _propertyKey: string | symbol,
  descriptor: PropertyDescriptor,
) => {
  Reflect.defineMetadata(PATH_METADATA, '', descriptor.value);
  Reflect.defineMetadata(METHOD_METADATA, RequestMethod.GET, descriptor.value);
  return descriptor;
};

@Controller('approval-queue')
export class ApprovalController {
  constructor(private readonly approvalService: ApprovalService) {}

  @GetRoot()
  @HttpCode(HttpStatus.OK)
  @RequiresPermission(PERMISSIONS['approval.view_queue'])
  getQueue(@Query() query: ApprovalQueueQueryDto, @Req() req: Request) {
    const user = (req as any).user ?? req;
    return this.approvalService.getQueue(
      query,
      user.pawnshopId ?? req.headers?.['pawnshop-id'],
    );
  }

  @AuditLog('APPROVAL_APPROVE')
  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @RequiresPermission(PERMISSIONS['approval.approve_appraisal'])
  approve(@Param('id') id: string, @Body() dto: DecideApprovalDto, @Req() req: Request) {
    const user = (req as any).user ?? req;
    return this.approvalService.decideApproval(
      id,
      dto,
      user.id,
      user.role,
      true,
      user.pawnshopId ?? req.headers?.['pawnshop-id'],
    );
  }

  @AuditLog('APPROVAL_REJECT')
  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @RequiresPermission(PERMISSIONS['approval.approve_appraisal'])
  reject(@Param('id') id: string, @Body() dto: DecideApprovalDto, @Req() req: Request) {
    const user = (req as any).user ?? req;
    return this.approvalService.decideApproval(
      id,
      dto,
      user.id,
      user.role,
      false,
      user.pawnshopId ?? req.headers?.['pawnshop-id'],
    );
  }
}
