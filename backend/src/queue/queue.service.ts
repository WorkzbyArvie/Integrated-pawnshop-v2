import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { CreateQueueTicketDto } from './dto/create-queue-ticket.dto';
import { UpdateQueueTicketDto } from './dto/update-queue-ticket.dto';
import { QueueFiltersDto } from './dto/queue-filters.dto';
import {
  QueueStatus,
  QueueType,
  NotificationChannel,
  NotificationType,
  MessageSenderRole,
} from '@prisma/client';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { NotificationService } from '../notification/notification.service';

@Injectable()
export class QueueService {
  private readonly logger = new Logger(QueueService.name);
  private readonly supabase: SupabaseClient;

  constructor(
    private prisma: PrismaService,
    private notificationService: NotificationService,
  ) {
    const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (supabaseUrl && serviceRoleKey) {
      this.supabase = createClient(supabaseUrl, serviceRoleKey);
    }
  }

  /**
   * Generate a unique queue number for the pawnshop
   * Format: {TYPE_PREFIX}{MMDD}-{SEQUENTIAL_NUMBER}
   * Example: P0309-001 (Pawning, Mar 9), R0309-005 (Renewal)
   */
  private async generateQueueNumber(
    pawnshopId: string,
    queueType: QueueType,
  ): Promise<string> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Count today's tickets for this type
    const count = await this.prisma.queueTicket.count({
      where: {
        pawnshopId,
        queueType,
        joinedAt: {
          gte: today,
          lt: tomorrow,
        },
      },
    });

    const prefix = this.getQueuePrefix(queueType);
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    const number = (count + 1).toString().padStart(3, '0');
    return `${prefix}${mm}${dd}-${number}`;
  }

  private getQueuePrefix(queueType: QueueType): string {
    const prefixes = {
      PAWNING: 'P',
      RENEWAL: 'R',
      REDEMPTION: 'D',
      AUCTION_INQUIRY: 'A',
      GENERAL: 'G',
    };
    return prefixes[queueType] || 'Q';
  }

  private async sendInAppQueueNotification(params: {
    recipientId: string;
    type: NotificationType;
    title: string;
    body: string;
    data: Record<string, unknown>;
  }): Promise<void> {
    try {
      await this.notificationService.sendNotification({
        recipientId: params.recipientId,
        channel: NotificationChannel.IN_APP,
        type: params.type,
        title: params.title,
        body: params.body,
        data: params.data,
      });
    } catch (notifError: any) {
      this.logger.warn(
        `Failed to send queue notification to ${params.recipientId}: ${notifError?.message || notifError}`,
      );
    }
  }

  /**
   * Create a new queue ticket with pawnshop isolation
   */
  async create(pawnshopId: string, dto: CreateQueueTicketDto): Promise<any> {
    try {
      const [customer, existingTicket] = await Promise.all([
        this.prisma.customer.findFirst({
          where: { id: dto.customerId, pawnshopId },
        }),
        this.prisma.queueTicket.findFirst({
          where: {
            customerId: dto.customerId,
            pawnshopId,
            status: { in: [QueueStatus.WAITING, QueueStatus.SERVING] },
          },
        }),
      ]);

      if (!customer) {
        throw new ForbiddenException(
          'Customer not found or does not belong to this pawnshop',
        );
      }

      if (existingTicket) {
        throw new BadRequestException(
          'Customer already has an active queue ticket',
        );
      }

      const [queueNumber, waitingCount] = await Promise.all([
        this.generateQueueNumber(pawnshopId, dto.queueType),
        this.prisma.queueTicket.count({
          where: {
            pawnshopId,
            branchId: dto.branchId,
            status: QueueStatus.WAITING,
          },
        }),
      ]);

      const estimatedWaitMinutes = Math.max(5, waitingCount * 15); // 15 min per ticket

      // Create queue ticket
      const ticket = await this.prisma.queueTicket.create({
        data: {
          queueNumber,
          pawnshopId,
          branchId: dto.branchId,
          customerId: dto.customerId,
          queueType: dto.queueType,
          priority: dto.priority || 0,
          estimatedWaitMinutes,
          notes: dto.notes,
          metadata: dto.metadata || {},
        },
        include: {
          customer: {
            select: {
              id: true,
              fullName: true,
              contactNumber: true,
            },
          },
          branch: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });

      this.logger.log(
        `Queue ticket ${queueNumber} created for customer ${dto.customerId} in pawnshop ${pawnshopId}`,
      );

      return ticket;
    } catch (error: any) {
      this.logger.error(
        `Failed to create queue ticket: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Get queue tickets with pawnshop isolation
   */
  async findAll(pawnshopId: string, filters: QueueFiltersDto): Promise<any> {
    try {
      const where: any = { pawnshopId };

      if (filters.status) where.status = filters.status;
      if (filters.queueType) where.queueType = filters.queueType;
      if (filters.branchId) where.branchId = filters.branchId;
      if (filters.customerId) where.customerId = filters.customerId;

      if (filters.dateFrom || filters.dateTo) {
        where.joinedAt = {};
        if (filters.dateFrom) where.joinedAt.gte = new Date(filters.dateFrom);
        if (filters.dateTo) where.joinedAt.lte = new Date(filters.dateTo);
      }

      const [tickets, total] = await Promise.all([
        this.prisma.queueTicket.findMany({
          where,
          include: {
            customer: {
              select: {
                id: true,
                fullName: true,
                contactNumber: true,
              },
            },
            branch: {
              select: {
                id: true,
                name: true,
              },
            },
          },
          orderBy: [{ priority: 'desc' }, { joinedAt: 'asc' }],
          skip: filters.offset,
          take: filters.limit,
        }),
        this.prisma.queueTicket.count({ where }),
      ]);

      return {
        data: tickets,
        meta: {
          total,
          limit: filters.limit,
          offset: filters.offset,
        },
      };
    } catch (error: any) {
      this.logger.error(
        `Failed to fetch queue tickets: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Get a single queue ticket by ID with pawnshop isolation
   */
  async findOne(pawnshopId: string, id: string): Promise<any> {
    const ticket = await this.prisma.queueTicket.findFirst({
      where: {
        id,
        pawnshopId,
      },
      include: {
        customer: {
          select: {
            id: true,
            fullName: true,
            contactNumber: true,
            address: true,
          },
        },
        branch: {
          select: {
            id: true,
            name: true,
            location: true,
          },
        },
      },
    });

    if (!ticket) {
      throw new NotFoundException('Queue ticket not found');
    }

    return ticket;
  }

  /**
   * Update queue ticket (call, serve, complete)
   */
  async update(
    pawnshopId: string,
    id: string,
    dto: UpdateQueueTicketDto,
  ): Promise<any> {
    try {
      const existing = await this.prisma.queueTicket.findFirst({
        where: { id, pawnshopId },
        select: { id: true, status: true, customerId: true, queueNumber: true },
      });

      if (!existing) {
        throw new NotFoundException('Queue ticket not found');
      }

      if (dto.status) {
        this.validateStatusTransition(existing.status, dto.status);
      }

      const ticket = await this.prisma.queueTicket.update({
        where: { id },
        data: {
          ...dto,
          ...(dto.status === QueueStatus.SERVING && !dto.servedAt
            ? { servedAt: new Date() }
            : {}),
          ...(dto.status === QueueStatus.COMPLETED && !dto.completedAt
            ? { completedAt: new Date() }
            : {}),
        },
        include: {
          customer: {
            select: {
              id: true,
              fullName: true,
              contactNumber: true,
            },
          },
        },
      });

      this.logger.log(`Queue ticket ${id} updated in pawnshop ${pawnshopId}`);

      if (
        dto.status === QueueStatus.SERVING &&
        existing.status !== QueueStatus.SERVING
      ) {
        const counter = dto.counterNumber || ticket.counterNumber || 'your assigned';
        await this.sendInAppQueueNotification({
          recipientId: ticket.customerId,
          type: NotificationType.QUEUE_READY,
          title: 'Your Turn Is Ready!',
          body: `Queue ticket ${ticket.queueNumber} is now serving. Please proceed to Counter ${counter}.`,
          data: {
            queueTicketId: ticket.id,
            queueNumber: ticket.queueNumber,
            counterNumber: ticket.counterNumber || dto.counterNumber || null,
            queueType: ticket.queueType,
          },
        });
      }

      return ticket;
    } catch (error: any) {
      this.logger.error(
        `Failed to update queue ticket: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Call the next ticket in queue
   */
  async callNext(
    pawnshopId: string,
    staffId: string,
    counterNumber: string,
    branchId?: number,
  ): Promise<any> {
    try {
      const where: any = {
        pawnshopId,
        status: QueueStatus.WAITING,
      };

      if (branchId) where.branchId = branchId;

      const result = await this.prisma.$transaction(async (tx) => {
        const nextTicket = await tx.queueTicket.findFirst({
          where,
          orderBy: [{ priority: 'desc' }, { joinedAt: 'asc' }],
          include: { customer: true },
        });

        if (!nextTicket) {
          throw new NotFoundException('No waiting tickets in queue');
        }

        const ticket = await tx.queueTicket.update({
          where: { id: nextTicket.id },
          data: {
            status: QueueStatus.SERVING,
            assignedStaffId: staffId,
            counterNumber,
            calledAt: new Date(),
            servedAt: new Date(),
          },
          include: {
            customer: {
              select: {
                id: true,
                fullName: true,
                contactNumber: true,
              },
            },
          },
        });

        return ticket;
      });

      this.logger.log(
        `Queue ticket ${result.queueNumber} called by staff ${staffId} at counter ${counterNumber}`,
      );

      await this.sendInAppQueueNotification({
        recipientId: result.customerId,
        type: NotificationType.QUEUE_READY,
        title: 'Your Turn Is Ready!',
        body: `Queue ticket ${result.queueNumber} has been called. Please proceed to Counter ${counterNumber}.`,
        data: {
          queueTicketId: result.id,
          queueNumber: result.queueNumber,
          counterNumber,
          staffId,
          queueType: result.queueType,
        },
      });

      return result;
    } catch (error: any) {
      this.logger.error(
        `Failed to call next ticket: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Cancel a queue ticket
   */
  async cancel(pawnshopId: string, id: string): Promise<any> {
    const ticket = await this.update(pawnshopId, id, {
      status: QueueStatus.CANCELLED,
      completedAt: new Date(),
    });

    this.logger.log(`Queue ticket ${id} cancelled in pawnshop ${pawnshopId}`);
    return ticket;
  }

  /**
   * Create a queue ticket from the mobile app.
   * Auto-resolves the customer from the Supabase JWT, auto-creates Customer record if needed.
   */
  async createFromMobile(
    authHeader: string | undefined,
    body: { queueType: string; description?: string; pawnshopId: string },
  ): Promise<any> {
    // 1. Extract userId from Supabase JWT
    if (!authHeader)
      throw new UnauthorizedException('Missing authorization header');
    const [scheme, token] = authHeader.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token)
      throw new UnauthorizedException('Invalid auth format');

    if (!this.supabase)
      throw new Error('Supabase not configured');

    const {
      data: { user },
      error,
    } = await this.supabase.auth.getUser(token);
    if (error || !user)
      throw new UnauthorizedException('Invalid or expired token');
    const userId = user.id;

    // 2. Validate pawnshop exists
    const pawnshopId = body.pawnshopId;
    if (!pawnshopId) throw new BadRequestException('pawnshopId is required');

    const pawnshop = await this.prisma.pawnshop.findUnique({
      where: { id: pawnshopId },
    });
    if (!pawnshop) throw new BadRequestException('Pawnshop not found');

    // 3. Find or create Customer record for this user in this pawnshop
    const profile = await this.prisma.profile.findUnique({
      where: { id: userId },
    });
    let customer = await this.prisma.customer.findFirst({
      where: { id: userId, pawnshopId },
    });
    if (!customer) {
      // Try without pawnshop filter (customer might exist for another shop)
      const existingCustomer = await this.prisma.customer.findFirst({
        where: { id: userId },
      });
      if (existingCustomer && !existingCustomer.pawnshopId) {
        // Update existing customer to link to this pawnshop
        customer = await this.prisma.customer.update({
          where: { id: userId },
          data: { pawnshopId },
        });
      } else if (!existingCustomer) {
        customer = await this.prisma.customer.create({
          data: {
            id: userId,
            fullName: profile?.fullName || user.email || 'Mobile Customer',
            contactNumber: profile?.email || user.email || 'N/A',
            address: 'N/A',
            pawnshopId,
          },
        });
      } else {
        // Customer exists but for a different pawnshop — use it anyway (the queue uses customerId+pawnshopId)
        customer = existingCustomer;
        // Update pawnshopId so queue validation passes
        customer = await this.prisma.customer.update({
          where: { id: userId },
          data: { pawnshopId },
        });
      }
    }

    // 4. Check for existing active queue ticket
    const existingTicket = await this.prisma.queueTicket.findFirst({
      where: {
        customerId: customer.id,
        pawnshopId,
        status: { in: [QueueStatus.WAITING, QueueStatus.SERVING] },
      },
    });
    if (existingTicket) {
      throw new BadRequestException(
        'You already have an active queue ticket at this branch',
      );
    }

    // 5. Resolve QueueType from body
    const validTypes: Record<string, QueueType> = {
      PAWNING: QueueType.PAWNING,
      RENEWAL: QueueType.RENEWAL,
      REDEMPTION: QueueType.REDEMPTION,
      AUCTION_INQUIRY: QueueType.AUCTION_INQUIRY,
      GENERAL: QueueType.GENERAL,
    };
    const queueType = validTypes[body.queueType || ''] || QueueType.GENERAL;

    // 6. Generate queue number + estimate wait
    const queueNumber = await this.generateQueueNumber(pawnshopId, queueType);
    const waitingCount = await this.prisma.queueTicket.count({
      where: { pawnshopId, status: QueueStatus.WAITING },
    });
    const estimatedWaitMinutes = Math.max(5, waitingCount * 15);

    // 7. Create the queue ticket
    const ticket = await this.prisma.queueTicket.create({
      data: {
        queueNumber,
        pawnshopId,
        customerId: customer.id,
        queueType,
        priority: 0,
        estimatedWaitMinutes,
        notes: body.description || queueType,
        metadata: {
          queueType: body.queueType,
          description: body.description,
          source: 'mobile_app',
        },
      },
      include: {
        customer: { select: { id: true, fullName: true, contactNumber: true } },
      },
    });

    this.logger.log(
      `Mobile queue ticket ${queueNumber} created for user ${userId} in pawnshop ${pawnshopId}`,
    );

    await this.sendInAppQueueNotification({
      recipientId: userId,
      type: NotificationType.SYSTEM_ANNOUNCEMENT,
      title: 'Queue Ticket Created',
      body: `Your queue ticket ${ticket.queueNumber} is confirmed. Estimated wait time: ${ticket.estimatedWaitMinutes} minutes.`,
      data: {
        queueTicketId: ticket.id,
        queueNumber: ticket.queueNumber,
        estimatedWaitMinutes: ticket.estimatedWaitMinutes,
        queueType: ticket.queueType,
        pawnshopId,
      },
    });

    return {
      queueNumber: ticket.queueNumber,
      estimatedWaitMinutes: ticket.estimatedWaitMinutes,
      position: waitingCount + 1,
      status: ticket.status,
    };
  }

  /**
   * Get queue tickets for the authenticated mobile user
   * (active tickets plus recent historical tickets).
   */
  async getMyTickets(authHeader: string | undefined): Promise<any> {
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException(
        'Missing or invalid authorization header',
      );
    }
    const token = authHeader.replace('Bearer ', '');

    if (!this.supabase) {
      throw new UnauthorizedException('Supabase not configured');
    }

    const {
      data: { user },
      error,
    } = await this.supabase.auth.getUser(token);
    if (error || !user) {
      throw new UnauthorizedException('Invalid or expired token');
    }

    const userId = user.id;
    const tickets = await this.prisma.queueTicket.findMany({
      where: {
        customerId: userId,
      },
      include: {
        pawnshop: { select: { id: true, name: true } },
      },
      orderBy: { joinedAt: 'desc' },
      take: 100,
    });

    return tickets;
  }

  /**
   * Cancel a queue ticket from the mobile app (owner-only).
   * Verifies the requesting user owns the ticket.
   */
  async cancelMyTicket(
    authHeader: string | undefined,
    ticketId: string,
    reason: string,
  ): Promise<any> {
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException(
        'Missing or invalid authorization header',
      );
    }
    const token = authHeader.replace('Bearer ', '');

    if (!this.supabase) {
      throw new UnauthorizedException('Supabase not configured');
    }

    const {
      data: { user },
      error,
    } = await this.supabase.auth.getUser(token);
    if (error || !user) {
      throw new UnauthorizedException('Invalid or expired token');
    }

    // Fetch ticket and verify ownership
    const ticket = await this.prisma.queueTicket.findUnique({
      where: { id: ticketId },
    });

    if (!ticket) {
      throw new NotFoundException('Ticket not found');
    }

    if (ticket.customerId !== user.id) {
      throw new UnauthorizedException('You can only cancel your own tickets');
    }

    // Only allow cancellation of WAITING or SERVING tickets
    if (
      ticket.status !== QueueStatus.WAITING &&
      ticket.status !== QueueStatus.SERVING
    ) {
      throw new BadRequestException(
        `Cannot cancel a ticket with status ${ticket.status}`,
      );
    }

    const updated = await this.prisma.queueTicket.update({
      where: { id: ticketId },
      data: {
        status: QueueStatus.CANCELLED,
        completedAt: new Date(),
        metadata: {
          ...(typeof ticket.metadata === 'object' && ticket.metadata !== null
            ? ticket.metadata
            : {}),
          cancelledBy: 'customer',
          cancellationReason: reason,
        },
      },
      include: {
        pawnshop: { select: { id: true, name: true } },
      },
    });

    this.logger.log(
      `Queue ticket ${ticketId} cancelled by customer ${user.id}, reason: ${reason}`,
    );

    await this.sendInAppQueueNotification({
      recipientId: user.id,
      type: NotificationType.SYSTEM_ANNOUNCEMENT,
      title: 'Queue Ticket Cancelled',
      body: `Your queue ticket ${ticket.queueNumber} has been cancelled successfully.`,
      data: {
        queueTicketId: ticket.id,
        queueNumber: ticket.queueNumber,
        queueType: ticket.queueType,
        status: QueueStatus.CANCELLED,
        reason,
      },
    });

    return updated;
  }

  /**
   * Get queue statistics for dashboard
   */
  async getStatistics(pawnshopId: string, branchId?: number): Promise<any> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const baseWhere: any = { pawnshopId };
    if (branchId) baseWhere.branchId = branchId;

    const [statusGroups, todayCount, avgResult, typeGroups] = await Promise.all([
      this.prisma.queueTicket.groupBy({
        by: ['status'],
        where: baseWhere,
        _count: true,
      }),
      this.prisma.queueTicket.count({
        where: { ...baseWhere, joinedAt: { gte: today } },
      }),
      this.prisma.queueTicket.aggregate({
        where: {
          ...baseWhere,
          status: QueueStatus.COMPLETED,
          completedAt: { gte: today, not: null },
          servedAt: { not: null },
        },
        _avg: { estimatedWaitMinutes: true },
      }),
      this.prisma.queueTicket.groupBy({
        by: ['queueType'],
        where: { ...baseWhere, joinedAt: { gte: today } },
        _count: true,
      }),
    ]);

    const statusMap = new Map(statusGroups.map((r) => [r.status, r._count]));
    const byType: Record<string, number> = {};
    for (const row of typeGroups) {
      byType[row.queueType] = row._count;
    }

    const waiting = statusMap.get('WAITING') || 0;
    const serving = statusMap.get('SERVING') || 0;

    return {
      totalToday: todayCount,
      waiting,
      serving,
      completed: statusMap.get('COMPLETED') || 0,
      noShow: statusMap.get('NO_SHOW') || 0,
      cancelled: statusMap.get('CANCELLED') || 0,
      averageWaitMinutes: Math.round(avgResult._avg.estimatedWaitMinutes || 0),
      averageServiceMinutes: 0,
      byType,
      totalActive: waiting + serving,
    };
  }

  /**
   * Validate status transition rules
   */
  private validateStatusTransition(
    currentStatus: QueueStatus,
    newStatus: QueueStatus,
  ): void {
    const validTransitions: Record<QueueStatus, QueueStatus[]> = {
      [QueueStatus.WAITING]: [
        QueueStatus.SERVING,
        QueueStatus.CANCELLED,
        QueueStatus.NO_SHOW,
      ],
      [QueueStatus.SERVING]: [
        QueueStatus.COMPLETED,
        QueueStatus.CANCELLED,
        QueueStatus.NO_SHOW,
      ],
      [QueueStatus.COMPLETED]: [],
      [QueueStatus.CANCELLED]: [],
      [QueueStatus.NO_SHOW]: [],
    };

    if (!validTransitions[currentStatus]?.includes(newStatus)) {
      throw new BadRequestException(
        `Invalid status transition from ${currentStatus} to ${newStatus}`,
      );
    }
  }

  // =========================================================================
  // TICKET CHAT
  // =========================================================================

  /**
   * Helper: resolve user from Bearer token
   */
  private async resolveUser(authHeader: string | undefined) {
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException(
        'Missing or invalid authorization header',
      );
    }
    const token = authHeader.replace('Bearer ', '');

    if (!this.supabase) {
      throw new UnauthorizedException('Supabase not configured');
    }

    const {
      data: { user },
      error,
    } = await this.supabase.auth.getUser(token);
    if (error || !user) {
      throw new UnauthorizedException('Invalid or expired token');
    }
    return user;
  }

  /**
   * Customer gets messages for their own ticket
   */
  async getMyTicketMessages(authHeader: string | undefined, ticketId: string) {
    const user = await this.resolveUser(authHeader);

    const ticket = await this.prisma.queueTicket.findUnique({
      where: { id: ticketId },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');
    if (ticket.customerId !== user.id)
      throw new UnauthorizedException('Not your ticket');

    return this.prisma.ticketMessage.findMany({
      where: { ticketId },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Customer sends a message on their ticket
   */
  async sendMyTicketMessage(
    authHeader: string | undefined,
    ticketId: string,
    message: string,
  ) {
    const user = await this.resolveUser(authHeader);

    const ticket = await this.prisma.queueTicket.findUnique({
      where: { id: ticketId },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');
    if (ticket.customerId !== user.id)
      throw new UnauthorizedException('Not your ticket');

    return this.prisma.ticketMessage.create({
      data: {
        ticketId,
        senderId: user.id,
        senderRole: MessageSenderRole.CUSTOMER,
        message,
      },
    });
  }

  /**
   * Staff gets messages for a ticket in their pawnshop
   */
  async getTicketMessages(pawnshopId: string, ticketId: string) {
    const ticket = await this.prisma.queueTicket.findUnique({
      where: { id: ticketId },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');
    if (ticket.pawnshopId !== pawnshopId)
      throw new UnauthorizedException('Ticket not in your pawnshop');

    return this.prisma.ticketMessage.findMany({
      where: { ticketId },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Staff sends a message on a ticket in their pawnshop
   */
  async sendTicketMessage(
    pawnshopId: string,
    ticketId: string,
    senderId: string,
    message: string,
  ) {
    const ticket = await this.prisma.queueTicket.findUnique({
      where: { id: ticketId },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');
    if (ticket.pawnshopId !== pawnshopId)
      throw new UnauthorizedException('Ticket not in your pawnshop');

    return this.prisma.ticketMessage.create({
      data: {
        ticketId,
        senderId,
        senderRole: MessageSenderRole.STAFF,
        message,
      },
    });
  }
}
