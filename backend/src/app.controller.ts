import {
  Controller,
  Get,
  Post,
  Body,
  Delete,
  Param,
  Patch,
  Headers,
  HttpException,
  HttpStatus,
  UnauthorizedException,
} from '@nestjs/common';
import { Public } from './common/decorators/public.decorator';
import { Roles } from './common/decorators/roles.decorator';
import { Throttle } from './common/decorators/throttle.decorator';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Public()
  @Get()
  rootHealth() {
    return {
      success: true,
      service: 'pawngold-backend',
      status: 'ok',
    };
  }

  @Public()
  @Get('health')
  health() {
    return {
      success: true,
      status: 'ok',
      uptime: process.uptime(),
    };
  }

  // --- Helper: extract user ID from Bearer token ---
  private async extractUserId(authHeader?: string): Promise<string> {
    if (!authHeader)
      throw new UnauthorizedException('Missing authorization header');
    const [scheme, token] = authHeader.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token)
      throw new UnauthorizedException('Invalid authorization format');
    const userId = await this.appService.getUserIdFromToken(token);
    if (!userId) throw new UnauthorizedException('Invalid or expired token');
    return userId;
  }

  // --- AUTH ENDPOINTS (Development Local Auth) ---
  @Public()
  @Throttle({ ttl: 60_000, limit: 5 })
  @Post('auth/local-login')
  localLogin(@Body() body: any) {
    return this.appService.localLogin(body);
  }

  @Public()
  @Throttle({ ttl: 60_000, limit: 3 })
  @Post('auth/request-auth-code')
  async requestAuthCode(@Body() body: any) {
    try {
      return await this.appService.requestAuthCode(body);
    } catch (error: any) {
      throw new HttpException(
        {
          success: false,
          error: error.message || 'Failed to request authentication code',
          message: error.message || 'Failed to request authentication code',
        },
        error.statusCode || HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Post('auth/verify-auth-code')
  async verifyAuthCode(@Body() body: any) {
    try {
      return await this.appService.verifyAuthCode(body);
    } catch (error: any) {
      throw new HttpException(
        {
          success: false,
          error: error.message || 'Failed to verify authentication code',
          message: error.message || 'Failed to verify authentication code',
        },
        error.statusCode || HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Post('auth/register-bidder')
  async registerBidder(@Body() body: any) {
    try {
      console.log('[Controller] registerBidder called for:', body.email);
      const result = await this.appService.registerBidder(body);
      console.log('[Controller] ✅ registerBidder succeeded');
      return result;
    } catch (error: any) {
      console.error('[Controller] ❌ registerBidder failed:', error.message);
      throw new HttpException(
        {
          success: false,
          error: error.message || 'Failed to register bidder',
          message: error.message || 'Failed to register bidder',
        },
        error.statusCode || HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Post('auth/create-branch-admin')
  async createBranchAdmin(
    @Headers('authorization') authHeader: string | undefined,
    @Body() body: any,
  ) {
    try {
      // Require authenticated admin
      const userId = await this.extractUserId(authHeader);
      await this.appService.requireAdmin(userId);

      console.log('[Controller] createBranchAdmin called with:', {
        email: body.email,
        role: body.role,
        pawnshop_id: body.pawnshop_id,
      });

      const result = await this.appService.createBranchAdmin(userId, body);

      console.log('[Controller] ✅ createBranchAdmin succeeded');
      return result;
    } catch (error: any) {
      console.error('[Controller] ❌ createBranchAdmin failed:', {
        message: error.message,
        code: error.code,
        statusCode: error.statusCode,
      });

      // Return a proper HTTP error response
      throw new HttpException(
        {
          success: false,
          error: error.message || 'Failed to create branch admin',
          message: error.message || 'Failed to create branch admin',
        },
        error.statusCode || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('staff/:id/password')
  async changeStaffPassword(
    @Param('id') staffId: string,
    @Headers('authorization') authHeader: string | undefined,
    @Body() body: { newPassword: string },
  ) {
    try {
      const userId = await this.extractUserId(authHeader);
      return await this.appService.changeStaffPassword(
        userId,
        staffId,
        body?.newPassword,
      );
    } catch (error: any) {
      throw new HttpException(
        {
          success: false,
          message: error.message || 'Failed to change staff password',
        },
        error.status || HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Patch('staff/:id/role')
  async changeStaffRole(
    @Param('id') staffId: string,
    @Headers('authorization') authHeader: string | undefined,
    @Body() body: { newRole: string },
  ) {
    try {
      const userId = await this.extractUserId(authHeader);
      return await this.appService.changeStaffRole(
        userId,
        staffId,
        body?.newRole,
      );
    } catch (error: any) {
      throw new HttpException(
        {
          success: false,
          message: error.message || 'Failed to change staff role',
        },
        error.status || HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Delete('staff/:id')
  async removeStaff(
    @Param('id') staffId: string,
    @Headers('authorization') authHeader: string | undefined,
  ) {
    try {
      const userId = await this.extractUserId(authHeader);
      return await this.appService.removeStaffAccount(userId, staffId);
    } catch (error: any) {
      throw new HttpException(
        {
          success: false,
          message: error.message || 'Failed to remove staff account',
        },
        error.status || HttpStatus.BAD_REQUEST,
      );
    }
  }

  // --- KYC ENDPOINTS ---
  @Get('auth/kyc/status')
  async getKycStatus(@Headers('authorization') authHeader: string | undefined) {
    const userId = await this.extractUserId(authHeader);
    return this.appService.getKycStatus(userId);
  }

  @Post('auth/kyc/submit')
  async submitKyc(
    @Headers('authorization') authHeader: string | undefined,
    @Body() body: any,
  ) {
    try {
      const userId = await this.extractUserId(authHeader);
      return await this.appService.submitKyc(userId, body);
    } catch (error: any) {
      throw new HttpException(
        { success: false, message: error.message || 'KYC submission failed' },
        error.status || HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Get('auth/kyc/pending')
  async listPendingKyc(
    @Headers('authorization') authHeader: string | undefined,
  ) {
    const userId = await this.extractUserId(authHeader);
    // Only admins can view pending KYC
    await this.appService.requireAdmin(userId);
    return this.appService.listPendingKyc();
  }

  @Patch('auth/kyc/:id/review')
  async reviewKyc(
    @Param('id') kycId: string,
    @Headers('authorization') authHeader: string | undefined,
    @Body()
    body: { decision: 'VERIFIED' | 'REJECTED'; rejectionReason?: string },
  ) {
    try {
      const userId = await this.extractUserId(authHeader);
      await this.appService.requireAdmin(userId);
      return await this.appService.reviewKyc(
        kycId,
        userId,
        body.decision,
        body.rejectionReason,
      );
    } catch (error: any) {
      throw new HttpException(
        { success: false, message: error.message || 'KYC review failed' },
        error.status || HttpStatus.BAD_REQUEST,
      );
    }
  }

  // --- MOBILE PAWN TICKET (from bidder app) ---
  @Post('tickets/mobile')
  async createMobileTicket(
    @Headers('authorization') authHeader: string | undefined,
    @Body() body: any,
  ) {
    try {
      const userId = await this.extractUserId(authHeader);
      return await this.appService.createMobileTicket(userId, body);
    } catch (error: any) {
      throw new HttpException(
        { success: false, message: error.message || 'Ticket creation failed' },
        error.status || HttpStatus.BAD_REQUEST,
      );
    }
  }

  // --- TICKETS ENDPOINTS ---
  @Post('tickets')
  createTicket(@Body() body: any) {
    return this.appService.createTicket(body);
  }

  @Get('tickets')
  findAllTickets() {
    return this.appService.getAllTickets();
  }

  @Patch('tickets/:id/redeem')
  redeemTicket(
    @Param('id') id: string,
    @Headers('pawnshop-id') pawnshopId: string,
    @Headers('user-id') userId: string,
  ) {
    return this.appService.redeemTicket(Number(id), pawnshopId, userId);
  }

  @Delete('tickets/:id')
  removeTicket(@Param('id') id: string) {
    return this.appService.deleteTicket(Number(id));
  }

  // --- PAWNSHOPS ENDPOINTS ---
  @Get('pawnshops')
  findAllPawnshops() {
    return this.appService.getAllPawnshops();
  }

  @Patch('pawnshops/:id/location')
  async updatePawnshopLocation(
    @Param('id') id: string,
    @Headers('authorization') authHeader: string | undefined,
    @Body() body: { latitude: number; longitude: number; address?: string },
  ) {
    try {
      const userId = await this.extractUserId(authHeader);
      await this.appService.requireAdmin(userId);
      return await this.appService.updatePawnshopLocation(id, body);
    } catch (error: any) {
      throw new HttpException(
        {
          success: false,
          message: error.message || 'Failed to update location',
        },
        error.status || HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Post('pawnshops/nearby')
  async getNearbyPawnshops(
    @Body() body: { latitude: number; longitude: number; radiusKm?: number },
  ) {
    return this.appService.getNearbyPawnshops(
      body.latitude,
      body.longitude,
      body.radiusKm || 50,
    );
  }

  // --- CRM / CUSTOMER ENDPOINTS ---
  @Get('customers')
  findAllCustomers() {
    return this.appService.getAllCustomers();
  }

  @Get('customers/:id')
  findOneCustomer(@Param('id') id: string) {
    return this.appService.getCustomerById(id);
  }

  // Add this inside the AppController class
  @Post('customers')
  createCustomer(@Body() body: any) {
    return this.appService.createCustomer(body);
  }
}
