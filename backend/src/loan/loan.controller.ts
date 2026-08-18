import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Req,
  Res,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { LoanApplicationService } from './loan-application.service';
import { LoanContractService } from './loan-contract.service';
import { EligibilityService } from './eligibility.service';
import { RepaymentService } from './repayment.service';
import { PenaltyService } from './penalty.service';
import { LoanService } from './loan.service';
import { LoanForfeitureService } from './loan-forfeiture.service';
import {
  CreateLoanApplicationDto,
  UpdateApplicationStatusDto,
} from './dto/create-loan-application.dto';
import {
  GenerateRepaymentScheduleDto,
  UpdateSchedulePaymentDto,
} from './dto/repayment-schedule.dto';
import { CreatePaymentDto } from './dto/payment.dto';
import { RenewLoanDto } from './dto/renew-loan.dto';
import { Throttle } from '../common/decorators/throttle.decorator';
import { AuditLog } from '../common/decorators/audit-log.decorator';
import { RequiresPermission } from '../common/decorators/requires-permission.decorator';
import { PERMISSIONS } from '../common/permissions/permissions.const';
import { RequiresCompliance } from '../common/decorators/requires-compliance.decorator';

@Controller('loan')
export class LoanController {
  constructor(
    private readonly loanApplicationService: LoanApplicationService,
    private readonly loanContractService: LoanContractService,
    private readonly eligibilityService: EligibilityService,
    private readonly repaymentService: RepaymentService,
    private readonly penaltyService: PenaltyService,
    private readonly loanService: LoanService,
    private readonly loanForfeitureService: LoanForfeitureService,
  ) {}

  // ============================================================================
  // LOAN APPLICATION ENDPOINTS
  // ============================================================================

  @Post('applications')
  @HttpCode(HttpStatus.CREATED)
  @RequiresPermission(PERMISSIONS['loan.collect'])
  createApplication(@Body() dto: CreateLoanApplicationDto) {
    return this.loanApplicationService.createApplication(dto);
  }

  @Get('applications')
  getApplications(
    @Query('pawnshopId') pawnshopId?: string,
    @Query('customerId') customerId?: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.loanApplicationService.getApplications({
      pawnshopId,
      customerId,
      status,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
  }

  @Get('applications/:id')
  getApplicationById(@Param('id') id: string) {
    return this.loanApplicationService.getApplicationById(id);
  }

  @Get('applications/:id/proofs')
  getApplicationProofs(@Param('id') id: string) {
    return this.loanApplicationService.getProofsForApplication(id);
  }

  @Patch('applications/:id/status')
  @RequiresPermission(PERMISSIONS['loan.manage'])
  updateApplicationStatus(
    @Param('id') id: string,
    @Body() dto: UpdateApplicationStatusDto,
  ) {
    return this.loanApplicationService.updateStatus(id, dto);
  }

  @Get('applications/pending/:role')
  getPendingApprovals(
    @Param('role') role: string,
    @Query('pawnshopId') pawnshopId?: string,
  ) {
    return this.loanApplicationService.getPendingApprovals(role, pawnshopId);
  }

  @Delete('applications/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequiresPermission(PERMISSIONS['loan.manage'])
  deleteApplication(@Param('id') id: string) {
    return this.loanApplicationService.deleteApplication(id);
  }

  // ============================================================================
  // ELIGIBILITY CHECK ENDPOINTS
  // ============================================================================

  @AuditLog('CHECK_ELIGIBILITY')
  @Post('eligibility/check')
  @RequiresPermission(PERMISSIONS['loan.create'])
  checkEligibility(
    @Body('applicationId') applicationId: string,
    @Req() req: Request,
  ) {
    const userId = (req as any).user?.id as string;
    return this.eligibilityService.checkEligibility(applicationId, userId);
  }

  @Get('eligibility/:applicationId')
  getEligibilityCheck(@Param('applicationId') applicationId: string) {
    return this.eligibilityService.getEligibilityCheck(applicationId);
  }

  @Get('customers/:customerId/credit-history')
  getCustomerCreditHistory(@Param('customerId') customerId: string) {
    return this.eligibilityService.getCustomerCreditHistory(customerId);
  }

  // ============================================================================
  // REPAYMENT SCHEDULE ENDPOINTS
  // ============================================================================

  @Post(':loanId/schedule/generate')
  @RequiresPermission(PERMISSIONS['loan.create'])
  generateSchedule(@Body() dto: GenerateRepaymentScheduleDto) {
    return this.repaymentService.generateSchedule(dto);
  }

  @Get(':loanId/schedule')
  getSchedule(@Param('loanId') loanId: string) {
    return this.repaymentService.getSchedule(parseInt(loanId, 10));
  }

  @Patch('schedule/payment')
  @RequiresPermission(PERMISSIONS['loan.manage'])
  updateSchedulePayment(@Body() dto: UpdateSchedulePaymentDto) {
    return this.repaymentService.updatePayment(dto);
  }

  @Post('schedule/check-overdue')
  checkOverduePayments() {
    return this.repaymentService.checkOverduePayments();
  }

  @Get('schedule/upcoming')
  getUpcomingPayments(@Query('pawnshopId') pawnshopId?: string) {
    return this.repaymentService.getUpcomingPayments(pawnshopId);
  }

  // ============================================================================
  // PENALTY ENDPOINTS
  // ============================================================================

  @Post('penalties/calculate')
  @RequiresPermission(PERMISSIONS['loan.collect'])
  calculatePenalties(@Body('loanId') loanId: number) {
    return this.penaltyService.calculatePenalties(loanId);
  }

  @Get(':loanId/penalties')
  getLoanPenalties(@Param('loanId') loanId: string) {
    return this.penaltyService.getLoanPenalties(parseInt(loanId, 10));
  }

  @AuditLog('WAIVE_PENALTY')
  @Patch('penalties/:id/waive')
  @RequiresPermission(PERMISSIONS['loan.manage'])
  waivePenalty(
    @Param('id') id: string,
    @Body('reason') reason: string,
    @Req() req: Request,
  ) {
    const userId = (req as any).user?.id as string;
    return this.penaltyService.waivePenalty(id, userId, reason);
  }

  @AuditLog('APPLY_PENALTY')
  @Post('penalties/manual')
  @RequiresPermission(PERMISSIONS['loan.manage'])
  applyManualPenalty(
    @Body()
    data: {
      loanId: number;
      penaltyType: string;
      amount: number;
      reason: string;
      scheduleId?: number;
    },
  ) {
    return this.penaltyService.applyManualPenalty(data);
  }

  // ============================================================================
  // FORFEITURE ENDPOINTS
  // ============================================================================

  @AuditLog('PROCESS_FORFEITURES')
  @Post('forfeitures/process')
  @HttpCode(HttpStatus.OK)
  @RequiresPermission(PERMISSIONS['loan.manage'])
  processForfeitures() {
    return this.loanForfeitureService.processForfeitures();
  }

  @AuditLog('QUEUE_FOR_AUCTION')
  @Post('forfeitures/:ticketId/queue-auction')
  @HttpCode(HttpStatus.OK)
  @RequiresPermission(PERMISSIONS['pawn_ticket.send_to_auction'])
  queueForAuction(
    @Param('ticketId') ticketId: string,
    @Req() req: Request,
  ) {
    const userRole = (req as any).user?.role as string | undefined;
    return this.loanForfeitureService.queueForAuction(
      parseInt(ticketId, 10),
      userRole,
    );
  }

  // ============================================================================
  // DISBURSEMENT ENDPOINTS
  // ============================================================================

  @RequiresCompliance(40)
  @AuditLog('DISBURSE_LOAN')
  @Post(':loanId/disburse')
  @HttpCode(HttpStatus.OK)
  @RequiresPermission(PERMISSIONS['loan.collect'])
  disburseLoan(
    @Param('loanId') loanId: string,
    @Req() req: Request,
  ) {
    const user = (req as any).user as { id: string; role: string } | undefined;
    return this.loanService.disburseLoan(
      parseInt(loanId, 10),
      user?.id ?? '',
      user?.role,
    );
  }

  // ============================================================================
  // RENEWAL ENDPOINTS
  // ============================================================================

  @AuditLog('RENEW_LOAN')
  @Throttle({ ttl: 60_000, limit: 10 })
  @Post('renew')
  @HttpCode(HttpStatus.OK)
  @RequiresPermission(PERMISSIONS['loan.collect'])
  renewLoan(@Body() dto: RenewLoanDto) {
    return this.loanService.renewLoan(dto);
  }

  // ============================================================================
  // PAYMENT ENDPOINTS
  // ============================================================================

  @AuditLog('RECORD_PAYMENT')
  @Throttle({ ttl: 60_000, limit: 20 })
  @Post('payments')
  @HttpCode(HttpStatus.CREATED)
  @RequiresPermission(PERMISSIONS['loan.collect'])
  recordPayment(@Body() dto: CreatePaymentDto) {
    return this.loanService.recordPayment(dto);
  }

  @Get(':loanId/payments')
  getPaymentHistory(@Param('loanId') loanId: string) {
    return this.loanService.getPaymentHistory(parseInt(loanId, 10));
  }

  @Get(':loanId/proofs')
  getLoanProofs(@Param('loanId') loanId: string) {
    return this.loanService.getProofsForLoan(parseInt(loanId, 10));
  }

  @Get('customers/:customerId/payments')
  getCustomerPaymentHistory(@Param('customerId') customerId: string) {
    return this.loanService.getCustomerPaymentHistory(customerId);
  }

  @Get('payments/:id')
  getPayment(@Param('id') id: string) {
    return this.loanService.getPayment(id);
  }

  @Get('payments/:id/proofs')
  getPaymentProofs(@Param('id') id: string) {
    return this.loanService.getProofsForPayment(id);
  }

  @Get(':loanId/status')
  getLoanStatus(@Param('loanId') loanId: string) {
    return this.loanService.getLoanStatus(loanId);
  }

  @Get(':loanId/history')
  getLoanFullHistory(@Param('loanId') loanId: string) {
    return this.loanService.getLoanFullHistory(loanId);
  }

  @Get('customers/:customerId/history')
  getCustomerFullHistory(@Param('customerId') customerId: string) {
    return this.loanService.getCustomerFullHistory(customerId);
  }

  @Get('customers/:customerId/dashboard')
  getCustomerDashboard(@Param('customerId') customerId: string) {
    return this.loanService.getCustomerDashboard(customerId);
  }

  // ============================================================================
  // CONTRACT ENDPOINTS
  // ============================================================================

  @AuditLog('GENERATE_CONTRACT')
  @Post('contracts/:applicationId/generate')
  @HttpCode(HttpStatus.CREATED)
  @RequiresPermission(PERMISSIONS['loan.manage'])
  generateContract(
    @Param('applicationId') applicationId: string,
    @Req() req: Request,
  ) {
    const userId = (req as any).user?.id as string;
    return this.loanContractService.generateContractForApplication(
      applicationId,
      userId,
    );
  }

  @Get('contracts/:applicationId')
  getContractByApplication(@Param('applicationId') applicationId: string) {
    return this.loanContractService.getContractByApplicationId(applicationId);
  }

  @Get('contract/:contractId')
  getContractById(@Param('contractId') contractId: string) {
    return this.loanContractService.getContractById(contractId);
  }

  @AuditLog('SIGN_CONTRACT_CUSTOMER')
  @Patch('contracts/:applicationId/sign-customer')
  signContractByCustomer(
    @Param('applicationId') applicationId: string,
    @Body('customerSignature') customerSignature: string,
  ) {
    return this.loanContractService.signByCustomer(
      applicationId,
      customerSignature,
    );
  }

  @AuditLog('SIGN_CONTRACT_STAFF')
  @Patch('contracts/:applicationId/sign-staff')
  @RequiresPermission(PERMISSIONS['contract.sign'])
  signContractByStaff(
    @Param('applicationId') applicationId: string,
    @Body('staffSignature') staffSignature: string,
    @Req() req: Request,
  ) {
    const user = (req as any).user as { id: string; role: string } | undefined;
    return this.loanContractService.signByStaff(
      applicationId,
      user?.id ?? '',
      staffSignature,
      user?.role,
    );
  }

  @Get('contracts/pawnshop/:pawnshopId')
  getContractsByPawnshop(
    @Param('pawnshopId') pawnshopId: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.loanContractService.getContractsByPawnshop(
      pawnshopId,
      limit ? parseInt(limit, 10) : 50,
      offset ? parseInt(offset, 10) : 0,
    );
  }

  @Get('contracts/:contractId/proofs')
  getContractProofs(@Param('contractId') contractId: string) {
    return this.loanContractService.getContractProofs(contractId);
  }

  @Get('contracts/:contractId/pdf')
  async downloadContractPdf(
    @Param('contractId') contractId: string,
    @Res() res: Response,
  ) {
    const { buffer, contractNumber } = await this.loanContractService.downloadContractPdf(contractId);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${contractNumber}.pdf"`,
    });
    res.end(buffer);
  }
}
