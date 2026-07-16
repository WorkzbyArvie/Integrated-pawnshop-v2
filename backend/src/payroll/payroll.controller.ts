import {
  Controller,
  Get,
  Post,
  Patch,
  Put,
  Body,
  Param,
  Query,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { PayrollService } from './payroll.service';
import { GeneratePayslipDto } from './dto/generate-payslip.dto';

@Controller('payroll')
export class PayrollController {
  private readonly logger = new Logger(PayrollController.name);

  constructor(private readonly payrollService: PayrollService) {}

  /**
   * Get base salary settings per position
   * GET /payroll/settings/positions
   */
  @Get('settings/positions')
  async getPositionSalarySettings(@Headers('pawnshop-id') pawnshopId: string) {
    return this.payrollService.getPositionSalarySettings(pawnshopId);
  }

  /**
   * Set base salary for a position
   * PUT /payroll/settings/positions/:position
   */
  @Put('settings/positions/:position')
  async upsertPositionSalary(
    @Headers('pawnshop-id') pawnshopId: string,
    @Param('position') position: string,
    @Body() body: { baseSalary: number; allowance?: number },
  ) {
    return this.payrollService.upsertPositionSalary(
      pawnshopId,
      position,
      body.baseSalary,
      body.allowance,
    );
  }

  /**
   * Set payroll frequency (days)
   * PUT /payroll/settings/frequency
   */
  @Put('settings/frequency')
  async upsertPayrollFrequency(
    @Headers('pawnshop-id') pawnshopId: string,
    @Body() body: { payrollFrequencyDays: number },
  ) {
    return this.payrollService.upsertPayrollFrequency(
      pawnshopId,
      body.payrollFrequencyDays,
    );
  }

  /**
   * Generate a payslip
   * POST /payroll/payslip
   */
  @Post('payslip')
  @HttpCode(HttpStatus.CREATED)
  async generatePayslip(
    @Headers('pawnshop-id') pawnshopId: string,
    @Body() dto: GeneratePayslipDto,
  ) {
    return this.payrollService.generatePayslip(pawnshopId, dto);
  }

  /**
   * Generate bulk payslips
   * POST /payroll/payslip/bulk
   */
  @Post('payslip/bulk')
  @HttpCode(HttpStatus.CREATED)
  async generateBulkPayslips(
    @Headers('pawnshop-id') pawnshopId: string,
    @Body()
    body: {
      periodStart: string;
      periodEnd: string;
      salaryMap: Record<string, number>;
    },
  ) {
    return this.payrollService.generateBulkPayslips(
      pawnshopId,
      body.periodStart,
      body.periodEnd,
      body.salaryMap,
    );
  }

  /**
   * Auto-generate payslips based on salary settings per position
   * POST /payroll/payslip/auto
   */
  @Post('payslip/auto')
  @HttpCode(HttpStatus.CREATED)
  async generateAutomaticPayslips(
    @Headers('pawnshop-id') pawnshopId: string,
    @Body()
    body: {
      periodStart: string;
      periodEnd: string;
      branchId?: number;
    },
  ) {
    return this.payrollService.generateAutomaticPayslips(
      pawnshopId,
      body.periodStart,
      body.periodEnd,
      body.branchId,
    );
  }

  /**
   * Get payslips
   * GET /payroll/payslips
   */
  @Get('payslips')
  async findAll(
    @Headers('pawnshop-id') pawnshopId: string,
    @Query('staffId') staffId?: string,
    @Query('status') status?: any,
    @Query('branchId') branchId?: string,
  ) {
    return this.payrollService.findAll(pawnshopId, staffId, status, branchId);
  }

  /**
   * Get a specific payslip
   * GET /payroll/payslips/:id
   */
  @Get('payslips/:id')
  async findOne(
    @Headers('pawnshop-id') pawnshopId: string,
    @Param('id') id: string,
  ) {
    return this.payrollService.findOne(pawnshopId, id);
  }

  /**
   * Get printable payslip payload
   * GET /payroll/payslips/:id/printable
   */
  @Get('payslips/:id/printable')
  async printable(
    @Headers('pawnshop-id') pawnshopId: string,
    @Param('id') id: string,
  ) {
    return this.payrollService.getPrintablePayslip(pawnshopId, id);
  }

  /**
   * Approve payslip
   * POST /payroll/payslips/:id/approve
   */
  @Post('payslips/:id/approve')
  async approve(
    @Headers('pawnshop-id') pawnshopId: string,
    @Param('id') id: string,
    @Body() body: { approvedBy: string },
  ) {
    return this.payrollService.approve(pawnshopId, id, body.approvedBy);
  }

  /**
   * Reject payslip
   * POST /payroll/payslips/:id/reject
   */
  @Post('payslips/:id/reject')
  async reject(
    @Headers('pawnshop-id') pawnshopId: string,
    @Param('id') id: string,
    @Body() body: { rejectedBy: string; reason?: string },
  ) {
    return this.payrollService.reject(
      pawnshopId,
      id,
      body.rejectedBy,
      body.reason,
    );
  }

  /**
   * Mark payslip as paid
   * POST /payroll/payslips/:id/pay
   */
  @Post('payslips/:id/pay')
  async markAsPaid(
    @Headers('pawnshop-id') pawnshopId: string,
    @Param('id') id: string,
    @Body() body: { paidBy: string },
  ) {
    return this.payrollService.markAsPaid(pawnshopId, id, body.paidBy);
  }

  /**
   * Get payroll summary
   * GET /payroll/summary
   */
  @Get('summary')
  async getSummary(
    @Headers('pawnshop-id') pawnshopId: string,
    @Query('periodStart') periodStart: string,
    @Query('periodEnd') periodEnd: string,
    @Query('branchId') branchId?: string,
  ) {
    return this.payrollService.getPayrollSummary(
      pawnshopId,
      periodStart,
      periodEnd,
      branchId,
    );
  }
}
