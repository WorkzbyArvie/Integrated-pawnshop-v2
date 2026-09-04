import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { ComplianceService } from './compliance.service';
import { UploadDocumentDto } from './dto/upload-document.dto';
import { VerifyDocumentDto } from './dto/verify-document.dto';
import { RequiresPermission } from '../common/decorators/requires-permission.decorator';
import { PERMISSIONS } from '../common/permissions/permissions.const';

@Controller('compliance')
export class ComplianceController {
  constructor(private readonly complianceService: ComplianceService) {}

  @Post('documents')
  @RequiresPermission(PERMISSIONS['compliance.manage_documents'])
  async uploadDocument(@Req() req: any, @Body() dto: UploadDocumentDto) {
    return this.complianceService.uploadDocument(req.user.id, dto);
  }

  @Get('documents')
  @RequiresPermission(PERMISSIONS['compliance.view'])
  async getDocuments(
    @Req() req: any,
    @Query('pawnshopId') pawnshopId?: string,
  ) {
    return this.complianceService.getDocuments(req.user.id, pawnshopId);
  }

  @Put('documents/:id/verify')
  @RequiresPermission(PERMISSIONS['platform.manage'])
  async verifyDocument(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: VerifyDocumentDto,
  ) {
    return this.complianceService.verifyDocument(req.user.id, id, dto);
  }

  @Post('documents/:id/renew')
  @RequiresPermission(PERMISSIONS['compliance.manage_documents'])
  async renewDocument(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: UploadDocumentDto,
  ) {
    return this.complianceService.renewDocument(req.user.id, id, dto);
  }

  @Post('documents/:id/request-replacement')
  @RequiresPermission(PERMISSIONS['platform.manage'])
  async requestDocumentReplacement(@Req() req: any, @Param('id') id: string) {
    return this.complianceService.requestDocumentReplacement(req.user.id, id);
  }

  @Get()
  @RequiresPermission(PERMISSIONS['compliance.view'])
  async root(@Req() req: any) {
    return this.complianceService.getComplianceScore(req.user.id);
  }

  @Get('score')
  @RequiresPermission(PERMISSIONS['compliance.view'])
  async getComplianceScore(@Req() req: any) {
    return this.complianceService.getComplianceScore(req.user.id);
  }

  @Get('pending-reviews')
  @RequiresPermission(PERMISSIONS['platform.manage'])
  async getPendingReviews() {
    return this.complianceService.getPendingReviews();
  }

  @Get('all-pawnshops')
  @RequiresPermission(PERMISSIONS['platform.manage'])
  async getAllPawnshopCompliance() {
    return this.complianceService.getAllPawnshopCompliance();
  }

  @Get('super-admin-overview')
  @RequiresPermission(PERMISSIONS['platform.manage'])
  async getSuperAdminOverview() {
    return this.complianceService.getSuperAdminOverview();
  }

  @Get('expiry-register')
  @RequiresPermission(PERMISSIONS['compliance.view'])
  async getExpiryRegister(@Req() req: any) {
    return this.complianceService.getComplianceExpiryRegister(req.user.id);
  }

  @Get('reminder-history')
  @RequiresPermission(PERMISSIONS['compliance.view'])
  async getReminderHistory(@Req() req: any) {
    return this.complianceService.getComplianceReminderHistory(req.user.id);
  }
}
