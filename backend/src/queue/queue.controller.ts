import {
  BadRequestException,
  Controller,
  ForbiddenException,
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
import { QueueService } from './queue.service';
import { CreateQueueTicketDto } from './dto/create-queue-ticket.dto';
import { UpdateQueueTicketDto } from './dto/update-queue-ticket.dto';
import { QueueFiltersDto } from './dto/queue-filters.dto';
import { AuthUserService } from '../common/auth-user.service';
import { PrismaService } from '../prisma.service';

/**
 * Queue Controller
 * Handles queue management with strict pawnshop isolation
 * All routes require pawnshop-id header for multi-tenancy
 */
@Controller('queue')
export class QueueController {
  private readonly logger = new Logger(QueueController.name);

  constructor(
    private readonly queueService: QueueService,
    private readonly authUserService: AuthUserService,
    private readonly prisma: PrismaService,
  ) {}

  private normalizeRole(role?: string | null): string {
    return (role || '').toUpperCase();
  }

  private async assertTenantAccess(
    authHeader: string | undefined,
    pawnshopId: string,
    action: string,
  ): Promise<string> {
    if (!pawnshopId) {
      throw new BadRequestException('pawnshop-id header is required');
    }

    const actorUserId =
      await this.authUserService.getUserIdFromAuthHeader(authHeader);
    const profile = await this.prisma.profile.findUnique({
      where: { id: actorUserId },
      select: { role: true, pawnshopId: true },
    });

    if (!profile) {
      throw new ForbiddenException('Profile not found for authenticated user');
    }

    const role = this.normalizeRole(profile.role);
    if (role === 'SUPER_ADMIN') {
      const grants = await this.prisma.$queryRaw<
        Array<{ id: string; expires_at: Date }>
      >`
        SELECT id, expires_at
        FROM public.support_access_grants
        WHERE pawnshop_id = ${pawnshopId}::uuid
          AND granted_to = ${actorUserId}::uuid
          AND status = 'ACTIVE'
          AND expires_at > NOW()
        ORDER BY expires_at DESC
        LIMIT 1
      `;

      const grant = grants[0];
      if (!grant) {
        throw new ForbiddenException(
          'No active approved support-access grant for this pawnshop.',
        );
      }

      return actorUserId;
    }

    if (!profile.pawnshopId || profile.pawnshopId !== pawnshopId) {
      throw new ForbiddenException(
        'You can only access queue data for your own pawnshop.',
      );
    }

    return actorUserId;
  }

  /**
   * Create a new queue ticket
   * POST /queue
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Headers('authorization') authHeader: string | undefined,
    @Headers('pawnshop-id') pawnshopId: string,
    @Body() dto: CreateQueueTicketDto,
  ) {
    await this.assertTenantAccess(authHeader, pawnshopId, 'QUEUE_CREATE');
    this.logger.log(`Creating queue ticket for pawnshop: ${pawnshopId}`);
    return this.queueService.create(pawnshopId, dto);
  }

  /**
   * Create a queue ticket from the mobile app (auto-resolves customer from auth token)
   * POST /queue/mobile
   */
  @Post('mobile')
  @HttpCode(HttpStatus.CREATED)
  async createFromMobile(
    @Headers('authorization') authHeader: string | undefined,
    @Body()
    body: { queueType: string; description?: string; pawnshopId: string },
  ) {
    this.logger.log(`Creating mobile queue ticket`);
    return this.queueService.createFromMobile(authHeader, body);
  }

  /**
   * Get the authenticated mobile user's active queue tickets
   * GET /queue/my-tickets
   */
  @Get('my-tickets')
  async getMyTickets(@Headers('authorization') authHeader: string | undefined) {
    return this.queueService.getMyTickets(authHeader);
  }

  /**
   * Cancel a queue ticket from the mobile app (owner only)
   * POST /queue/my-tickets/:id/cancel
   */
  @Post('my-tickets/:id/cancel')
  async cancelMyTicket(
    @Headers('authorization') authHeader: string | undefined,
    @Param('id') id: string,
    @Body() body: { reason: string },
  ) {
    return this.queueService.cancelMyTicket(authHeader, id, body.reason);
  }

  /**
   * Get messages for a ticket (customer, auth via JWT)
   * GET /queue/my-tickets/:id/messages
   */
  @Get('my-tickets/:id/messages')
  async getMyTicketMessages(
    @Headers('authorization') authHeader: string | undefined,
    @Param('id') id: string,
  ) {
    return this.queueService.getMyTicketMessages(authHeader, id);
  }

  /**
   * Send a message on a ticket (customer, auth via JWT)
   * POST /queue/my-tickets/:id/messages
   */
  @Post('my-tickets/:id/messages')
  async sendMyTicketMessage(
    @Headers('authorization') authHeader: string | undefined,
    @Param('id') id: string,
    @Body() body: { message: string },
  ) {
    return this.queueService.sendMyTicketMessage(authHeader, id, body.message);
  }

  /**
   * Get all queue tickets with filters
   * GET /queue
   */
  @Get()
  async findAll(
    @Headers('authorization') authHeader: string | undefined,
    @Headers('pawnshop-id') pawnshopId: string,
    @Query() filters: QueueFiltersDto,
  ) {
    await this.assertTenantAccess(authHeader, pawnshopId, 'QUEUE_LIST');
    return this.queueService.findAll(pawnshopId, filters);
  }

  /**
   * Get queue statistics
   * GET /queue/statistics
   */
  @Get('statistics')
  async getStatistics(
    @Headers('authorization') authHeader: string | undefined,
    @Headers('pawnshop-id') pawnshopId: string,
    @Query('branchId') branchId?: number,
  ) {
    await this.assertTenantAccess(authHeader, pawnshopId, 'QUEUE_STATS');
    return this.queueService.getStatistics(pawnshopId, branchId);
  }

  /**
   * Call next customer in queue
   * POST /queue/call-next
   */
  @Post('call-next')
  async callNext(
    @Headers('authorization') authHeader: string | undefined,
    @Headers('pawnshop-id') pawnshopId: string,
    @Body() body: { staffId: string; counterNumber: string; branchId?: number },
  ) {
    await this.assertTenantAccess(authHeader, pawnshopId, 'QUEUE_CALL_NEXT');
    return this.queueService.callNext(
      pawnshopId,
      body.staffId,
      body.counterNumber,
      body.branchId,
    );
  }

  /**
   * Get messages for a ticket (staff, auth via pawnshop-id header)
   * GET /queue/tickets/:id/messages
   */
  @Get('tickets/:id/messages')
  async getTicketMessages(
    @Headers('authorization') authHeader: string | undefined,
    @Headers('pawnshop-id') pawnshopId: string,
    @Param('id') id: string,
  ) {
    await this.assertTenantAccess(authHeader, pawnshopId, 'QUEUE_GET_MESSAGES');
    return this.queueService.getTicketMessages(pawnshopId, id);
  }

  /**
   * Send a message on a ticket (staff, auth via pawnshop-id header)
   * POST /queue/tickets/:id/messages
   */
  @Post('tickets/:id/messages')
  async sendTicketMessage(
    @Headers('authorization') authHeader: string | undefined,
    @Headers('pawnshop-id') pawnshopId: string,
    @Param('id') id: string,
    @Body() body: { message: string },
  ) {
    const actorUserId = await this.assertTenantAccess(
      authHeader,
      pawnshopId,
      'QUEUE_SEND_MESSAGE',
    );
    return this.queueService.sendTicketMessage(
      pawnshopId,
      id,
      actorUserId,
      body.message,
    );
  }

  /**
   * Get a specific queue ticket
   * GET /queue/:id
   */
  @Get(':id')
  async findOne(
    @Headers('authorization') authHeader: string | undefined,
    @Headers('pawnshop-id') pawnshopId: string,
    @Param('id') id: string,
  ) {
    await this.assertTenantAccess(authHeader, pawnshopId, 'QUEUE_GET_ONE');
    return this.queueService.findOne(pawnshopId, id);
  }

  /**
   * Update a queue ticket
   * PATCH /queue/:id
   */
  @Patch(':id')
  async update(
    @Headers('authorization') authHeader: string | undefined,
    @Headers('pawnshop-id') pawnshopId: string,
    @Param('id') id: string,
    @Body() dto: UpdateQueueTicketDto,
  ) {
    await this.assertTenantAccess(authHeader, pawnshopId, 'QUEUE_UPDATE');
    return this.queueService.update(pawnshopId, id, dto);
  }

  /**
   * Cancel a queue ticket
   * POST /queue/:id/cancel
   */
  @Post(':id/cancel')
  async cancel(
    @Headers('authorization') authHeader: string | undefined,
    @Headers('pawnshop-id') pawnshopId: string,
    @Param('id') id: string,
  ) {
    await this.assertTenantAccess(authHeader, pawnshopId, 'QUEUE_CANCEL');
    return this.queueService.cancel(pawnshopId, id);
  }
}
