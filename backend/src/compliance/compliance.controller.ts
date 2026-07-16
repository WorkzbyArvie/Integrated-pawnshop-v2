import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ComplianceService } from './compliance.service';
import { VerifyComplianceDto } from './dto/verify-compliance.dto';
import { ReleaseItemDto } from './dto/release-item.dto';
import { ComplianceStatus } from '@prisma/client';

@Controller('compliance')
export class ComplianceController {
  private readonly logger = new Logger(ComplianceController.name);

  constructor(private readonly complianceService: ComplianceService) {}

  /**
   * Get all compliance records for pawnshop
   * GET /compliance
   */
  @Get()
  async findAll(
    @Headers('pawnshop-id') pawnshopId: string,
    @Query('status') status?: ComplianceStatus,
    @Query('branchId') branchId?: string,
  ) {
    return this.complianceService.findAll(pawnshopId, status, branchId);
  }

  /**
   * Get compliance statistics
   * GET /compliance/statistics
   */
  @Get('statistics')
  async getStatistics(
    @Headers('pawnshop-id') pawnshopId: string,
    @Query('branchId') branchId?: string,
  ) {
    return this.complianceService.getStatistics(pawnshopId, branchId);
  }

  /**
   * Get winner's compliance records
   * GET /compliance/winner/:winnerId
   */
  @Get('winner/:winnerId')
  async findByWinner(@Param('winnerId') winnerId: string) {
    return this.complianceService.findByWinner(winnerId);
  }

  /**
   * Get a specific compliance record
   * GET /compliance/:id
   */
  @Get(':id')
  async findOne(
    @Headers('pawnshop-id') pawnshopId: string,
    @Param('id') id: string,
    @Headers('user-id') userId?: string,
  ) {
    // Log access for audit purposes
    if (userId) {
      await this.complianceService.logAccess(id, userId, 'VIEW');
    }
    return this.complianceService.findOne(pawnshopId, id);
  }

  /**
   * Winner submits compliance proof
   * POST /compliance/:id/submit
   */
  @Post(':id/submit')
  @HttpCode(HttpStatus.OK)
  async submitCompliance(
    @Headers('user-id') winnerId: string,
    @Param('id') complianceId: string,
    @Body() dto: VerifyComplianceDto,
  ) {
    return this.complianceService.submitCompliance(winnerId, complianceId, dto);
  }

  /**
   * Pawnshop staff verifies compliance
   * POST /compliance/:id/verify
   */
  @Post(':id/verify')
  @HttpCode(HttpStatus.OK)
  async verifyCompliance(
    @Headers('pawnshop-id') pawnshopId: string,
    @Param('id') complianceId: string,
    @Body() body: { verifiedBy: string },
  ) {
    return this.complianceService.verifyCompliance(
      pawnshopId,
      complianceId,
      body.verifiedBy,
    );
  }

  /**
   * Release item to winner
   * POST /compliance/:id/release
   */
  @Post(':id/release')
  @HttpCode(HttpStatus.OK)
  async releaseItem(
    @Headers('pawnshop-id') pawnshopId: string,
    @Param('id') complianceId: string,
    @Body() dto: ReleaseItemDto,
  ) {
    return this.complianceService.releaseItem(pawnshopId, complianceId, dto);
  }

  /**
   * Extend compliance deadline
   * PATCH /compliance/:id/extend-deadline
   */
  @Patch(':id/extend-deadline')
  async extendDeadline(
    @Headers('pawnshop-id') pawnshopId: string,
    @Param('id') complianceId: string,
    @Body() body: { additionalHours: number },
  ) {
    return this.complianceService.extendDeadline(
      pawnshopId,
      complianceId,
      body.additionalHours,
    );
  }

  /**
   * Offer listing to next highest bidder (fallback winner)
   * POST /compliance/:id/offer-next
   */
  @Post(':id/offer-next')
  @HttpCode(HttpStatus.OK)
  async offerToNextBidder(
    @Headers('pawnshop-id') pawnshopId: string,
    @Param('id') complianceId: string,
    @Body() body: { promotedBy?: string },
  ) {
    return this.complianceService.offerToNextBidder(
      pawnshopId,
      complianceId,
      body.promotedBy,
    );
  }
}
