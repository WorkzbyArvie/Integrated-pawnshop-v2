import {
  Controller,
  Get,
  Post,
  Body,
  Delete,
  Param,
  Patch,
  Query,
  Headers,
  HttpException,
  HttpStatus,
  UnauthorizedException,
  Res,
  Req,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Public } from './common/decorators/public.decorator';
import { RequiresPermission } from './common/decorators/requires-permission.decorator';
import { PERMISSIONS } from './common/permissions/permissions.const';
import { Throttle } from './common/decorators/throttle.decorator';
import { AppService } from './app.service';
import { AccountRegistrationDto } from './security/dto/account-registration.dto';
import { CustomerListQueryDto } from './dto/customer-list-query.dto';
import { TicketListQueryDto } from './dto/ticket-list-query.dto';
import { UpdateTicketDescriptionDto } from './dto/update-ticket-description.dto';
import { StaffPasswordDto } from './security/dto/staff-password.dto';
import { CredentialStateUnavailableError } from './security/credential-state.service';
import { StorageService } from './common/storage/storage.service';
import type { Request, Response } from 'express';
import type { File } from 'multer';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly storageService: StorageService,
  ) {}

  @Public()
  @Get('healthz')
  healthz(@Req() _req: Request, @Res() res: Response) {
    return res.status(200).json({ status: 'ok' });
  }

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

  // --- VALIDATION ENDPOINTS ---
  @Public()
  @Get('auth/check-email')
  async checkEmail(@Query('email') email: string, @Query('role') role?: string) {
    return this.appService.checkEmailAvailability(email, role);
  }

  /**
   * Duplicate-customer check for counter staff entering a new pawn.
   *
   * Previously `@Public()` and accepting `pawnshopId` as a query parameter.
   * That made it an unauthenticated PII oracle: submit a name and a contact
   * number, receive the matching customer record including their id and tenant,
   * and omit `pawnshopId` to search every shop in the database. It now requires
   * a session, is gated on the permission that already guards ticket creation,
   * and derives the tenant from the authenticated principal instead of trusting
   * the request. The matched record is no longer returned - callers only need
   * the boolean, and the sole consumer already used just that.
   */
  @Get('customers/check')
  @RequiresPermission(PERMISSIONS['pawn_ticket.create'])
  async checkCustomer(
    @Req() req: { user: { pawnshopId: string | null } },
    @Query('fullName') fullName: string,
    @Query('contactNumber') contactNumber: string,
  ) {
    return this.appService.checkCustomerDuplicate(
      fullName,
      contactNumber,
      req.user?.pawnshopId,
    );
  }

  // --- AUTH ENDPOINTS (Development Local Auth) ---
  @Public()
  @Throttle({ ttl: 60_000, limit: 5 })
  @Post('auth/local-login')
  localLogin(@Body() body: any) {
    return this.appService.localLogin(body);
  }

  @Public()
  @Throttle({ ttl: 60_000, limit: 10 })
  @Post('auth/login-native')
  async loginNative(@Body() body: any) {
    try {
      return await this.appService.loginNative(body);
    } catch (error: any) {
      throw new HttpException(
        {
          success: false,
          error: error.message || 'Login failed',
          message: error.message || 'Login failed',
        },
        error.statusCode || HttpStatus.UNAUTHORIZED,
      );
    }
  }

  @Public()
  @Throttle({ ttl: 60_000, limit: 10 })
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

  @Public()
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

  @Public()
  @Post('auth/register-bidder')
  async registerBidder(@Body() body: AccountRegistrationDto) {
    try {
      console.log('[Controller] registerBidder called for:', body.email);
      const result = await this.appService.registerBidder(body);
      console.log('[Controller] ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ registerBidder succeeded');
      return result;
    } catch (error: any) {
      if (error instanceof HttpException) throw error;
      console.error('[Controller] ÃƒÆ’Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒâ€¦Ã¢â‚¬â„¢ registerBidder failed:', error.message);
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

  @Public()
  @Post('auth/register-owner')
  async registerOwner(@Body() body: AccountRegistrationDto) {
    try {
      console.log('[Controller] registerOwner called for:', body.email);
      const result = await this.appService.registerOwner(body);
      console.log('[Controller] ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ registerOwner succeeded');
      return result;
    } catch (error: any) {
      if (error instanceof HttpException) throw error;
      console.error('[Controller] ÃƒÆ’Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒâ€¦Ã¢â‚¬â„¢ registerOwner failed:', error.message);
      throw new HttpException(
        {
          success: false,
          error: error.message || 'Failed to register owner',
          message: error.message || 'Failed to register owner',
        },
        error.statusCode || HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Get('auth/credential-status')
  async getCredentialStatus(
    @Headers('authorization') authHeader: string | undefined,
  ) {
    const userId = await this.extractUserId(authHeader);
    return this.appService.getCredentialStatus(userId);
  }

  @Post('auth/create-branch-admin')
  async createBranchAdmin(
    @Headers('authorization') authHeader: string | undefined,
    @Body() body: AccountRegistrationDto,
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

      console.log('[Controller] ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ createBranchAdmin succeeded');
      return result;
    } catch (error: any) {
      if (error instanceof HttpException) throw error;
      console.error('[Controller] ÃƒÆ’Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒâ€¦Ã¢â‚¬â„¢ createBranchAdmin failed:', {
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
  @Throttle({ ttl: 60_000, limit: 10 })
  @RequiresPermission(PERMISSIONS['user.manage_staff'])
  async changeStaffPassword(
    @Param('id') staffId: string,
    @Headers('authorization') authHeader: string | undefined,
    @Body() body: StaffPasswordDto,
  ) {
    try {
      const userId = await this.extractUserId(authHeader);
      return await this.appService.changeStaffPassword(
        userId,
        staffId,
        body?.newPassword,
      );
    } catch (error: any) {
      if (error instanceof HttpException) throw error;
      const status =
        error instanceof CredentialStateUnavailableError
          ? HttpStatus.SERVICE_UNAVAILABLE
          : error.status || HttpStatus.BAD_REQUEST;
      throw new HttpException(
        {
          success: false,
          message: 'Failed to reset staff password',
        },
        status,
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
  @Post('auth/kyc/upload')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 8 * 1024 * 1024 },
    }),
  )
  async uploadKycDocument(
    @UploadedFile() file: File | undefined,
    @Body() body: any,
    @Headers('authorization') authHeader: string | undefined,
  ) {
    try {
      const userId = await this.extractUserId(authHeader);
      if (!file?.buffer) {
        throw new BadRequestException('File is required for upload.');
      }

      const folder = String(body?.folder || 'id-front');
      const rawName = String(file?.originalname || 'upload').toLowerCase();
      const extMatch = rawName.match(/\.(png|jpe?g|webp|heic)$/);
      const ext = extMatch ? extMatch[1] : 'jpg';

      const fileName = `${userId}_${Date.now()}.${ext}`;
      const url = await this.storageService.uploadImage(
        file.buffer,
        'kyc-documents',
        fileName,
        file.mimetype || 'image/jpeg',
      );

      return {
        success: true,
        url,
        folder,
        fileName,
      };
    } catch (error: any) {
      throw new HttpException(
        { success: false, message: error.message || 'Upload failed' },
        error.status || HttpStatus.BAD_REQUEST,
      );
    }
  }

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
    await this.appService.requireSuperAdmin(userId);
    return this.appService.listPendingKyc();
  }

  @Get('auth/kyc/all')
  async listAllKyc(
    @Headers('authorization') authHeader: string | undefined,
  ) {
    const userId = await this.extractUserId(authHeader);
    await this.appService.requireSuperAdmin(userId);
    return this.appService.listAllKyc();
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
      await this.appService.requireSuperAdmin(userId);
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
  @RequiresPermission(PERMISSIONS['pawn_ticket.view'])
  findAllTickets(@Query() query: TicketListQueryDto, @Req() req: Request) {
    const user = (req as any).user ?? req;
    return this.appService.getAllTickets(user, query);
  }

  @Patch('tickets/:id/description')
  @RequiresPermission(PERMISSIONS['inventory.manage'])
  updateTicketDescription(
    @Param('id') id: string,
    @Body() body: UpdateTicketDescriptionDto,
    @Req() req: Request,
  ) {
    const user = (req as any).user ?? req;
    return this.appService.updateTicketDescription(id, body.description, user);
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
  @RequiresPermission(PERMISSIONS['platform.manage'])
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
  @RequiresPermission(PERMISSIONS['customer.view_history'])
  findAllCustomers(@Query() query: CustomerListQueryDto, @Req() req: Request) {
    const user = (req as any).user ?? req;
    return this.appService.getAllCustomers(user, query);
  }

  @Get('customers/:id')
  @RequiresPermission(PERMISSIONS['customer.view_history'])
  async findOneCustomer(@Param('id') id: string, @Req() req: Request) {
    const user = (req as any).user ?? req;
    return this.appService.getCustomerById(id, user);
  }

  // Add this inside the AppController class
  @Post('customers')
  createCustomer(@Body() body: any) {
    return this.appService.createCustomer(body);
  }

  @Public()
  @Get('stats/public')
  async getPublicStats() {
    return this.appService.getPublicStats();
  }
}
