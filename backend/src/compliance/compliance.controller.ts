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

@Controller('compliance')
export class ComplianceController {
  constructor(private readonly complianceService: ComplianceService) {}

  @Post('documents')
  @RequiresPermission('compliance.manage_documents')
  async uploadDocument(@Req() req: any, @Body() dto: UploadDocumentDto) {
    return this.complianceService.uploadDocument(req.user.id, dto);
  }

  @Get('documents')
  @RequiresPermission('compliance.view')
  async getDocuments(
    @Req() req: any,
    @Query('pawnshopId') pawnshopId?: string,
  ) {
    return this.complianceService.getDocuments(req.user.id, pawnshopId);
  }

  @Put('documents/:id/verify')
  @RequiresPermission('platform.manage')
  async verifyDocument(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: VerifyDocumentDto,
  ) {
    return this.complianceService.verifyDocument(req.user.id, id, dto);
  }

  @Post('documents/:id/renew')
  @RequiresPermission('compliance.manage_documents')
  async renewDocument(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: UploadDocumentDto,
  ) {
    return this.complianceService.renewDocument(req.user.id, id, dto);
  }

  @Get()
  @RequiresPermission('compliance.view')
  async root(@Req() req: any) {
    return this.complianceService.getComplianceScore(req.user.id);
  }

  @Get('score')
  @RequiresPermission('compliance.view')
  async getComplianceScore(@Req() req: any) {
    return this.complianceService.getComplianceScore(req.user.id);
  }

  @Get('pending-reviews')
  @RequiresPermission('platform.manage')
  async getPendingReviews() {
    return this.complianceService.getPendingReviews();
  }

  @Get('all-pawnshops')
  @RequiresPermission('platform.manage')
  async getAllPawnshopCompliance() {
    return this.complianceService.getAllPawnshopCompliance();
  }

  @Get('super-admin-overview')
  @RequiresPermission('platform.manage')
  async getSuperAdminOverview() {
    return this.complianceService.getSuperAdminOverview();
  }
}
