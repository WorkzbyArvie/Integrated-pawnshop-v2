import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { NotificationChannel, NotificationType } from '@prisma/client';

import { PrismaService } from '../prisma.service';
import { PawnTicketService } from '../loan/pawn-ticket.service';
import { NotificationService } from '../notification/notification.service';
import { ApprovalQueueQueryDto } from './dto/approval-queue-query.dto';
import { DecideApprovalDto } from './dto/decide-approval.dto';

@Injectable()
export class ApprovalService {
  constructor(
    private prisma: PrismaService,
    private pawnTicketService: PawnTicketService,
    private notificationService: NotificationService,
  ) {}

  async getQueue(query: ApprovalQueueQueryDto, callerPawnshopId: string) {
    const where: any = {
      pawnshopId: callerPawnshopId,
      status:
        query.status === 'DECIDED'
          ? { in: ['APPROVED', 'REJECTED', 'CANCELLED'] }
          : 'PENDING',
    };
    if (query.targetType ?? query.type) where.targetType = query.targetType ?? query.type;

    const records = await this.prisma.approvalRecord.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { requestedBy: true },
    });

    const targetIds = [...new Set(records.map((record) => record.targetId))];
    const foundTickets = targetIds.length
      ? await this.prisma.ticket.findMany({
          where: {
            id: { in: targetIds.map((id) => Number(id)).filter((id) => Number.isFinite(id)) },
          },
          include: { customer: true },
        })
      : [];
    const tickets = foundTickets ?? [];
    const ticketById = new Map(tickets.map((ticket) => [String(ticket.id), ticket]));

    let settings: Record<string, unknown> = {};
    if (records.some((record) => record.targetType === 'REDEMPTION')) {
      const pawnshop = await this.prisma.pawnshop.findUnique({
        where: { id: callerPawnshopId },
        select: { settings: true },
      });
      settings = (pawnshop?.settings as Record<string, unknown> | null) ?? {};
    }
    const threshold = Number(settings.redemptionApprovalThreshold ?? 50000);

    return records.map((record) => {
      const ticket = ticketById.get(String(record.targetId));
      const payload = (record.payload ?? {}) as Record<string, unknown>;
      return {
        id: record.id,
        targetType: record.targetType,
        targetId: record.targetId,
        ticketNumber: ticket?.ticketNumber ?? String(payload.ticketNumber ?? ''),
        customer: ticket?.customer
          ? {
              fullName: ticket.customer.fullName ?? '',
              contactNumber: ticket.customer.contactNumber ?? '',
              loyaltyTier: ticket.customer.loyaltyTier ?? null,
            }
          : null,
        category: ticket?.category ?? null,
        weight: ticket?.weight ?? null,
        itemCondition: payload.itemCondition ?? null,
        appraisedValue: record.amount,
        recommendedLoanAmount: payload.recommendedLoanAmount ?? null,
        riskScore: payload.riskScore ?? null,
        isHighRisk:
          ticket?.isHighRisk ?? (Number(payload.riskScore) || 0) > 40,
        appraisalNotes: payload.appraisalNotes ?? null,
        amountPaid: record.targetType === 'REDEMPTION' ? record.amount : undefined,
        threshold: record.targetType === 'REDEMPTION' ? threshold : undefined,
        requestedBy: record.requestedBy
          ? { id: record.requestedBy.id, fullName: record.requestedBy.fullName ?? '' }
          : null,
        createdAt: record.createdAt,
        decisionComment: record.decisionComment,
        status: record.status,
      };
    });
  }

  async decideApproval(
    id: string,
    dto: DecideApprovalDto,
    decidedBy: string,
    userRole: string | undefined,
    approve: boolean,
    callerPawnshopId: string,
  ) {
    const record = await this.prisma.approvalRecord.findUnique({ where: { id } });
    if (!record) throw new NotFoundException('Approval record not found');

    if (record.status !== 'PENDING') {
      throw new BadRequestException(
        `Approval record already decided (status: ${record.status})`,
      );
    }

    if (record.requestedById === decidedBy) {
      throw new ForbiddenException('You cannot decide on your own approval request');
    }

    if (record.pawnshopId !== callerPawnshopId && userRole !== 'SUPER_ADMIN') {
      throw new ForbiddenException('Approval record belongs to another pawnshop');
    }

    if (!approve && !(dto.decisionComment ?? '').trim()) {
      throw new BadRequestException(
        'A decision comment is required when rejecting an approval request',
      );
    }

    const payload = (record.payload ?? {}) as Record<string, unknown>;

    if (approve) {
      if (record.targetType === 'APPRAISAL') {
        await this.pawnTicketService.applyApprovedAppraisal(
          Number(record.targetId),
          payload,
          decidedBy,
          userRole,
        );
      } else if (record.targetType === 'REDEMPTION') {
        await this.pawnTicketService.releaseApprovedRedemption(
          Number(record.targetId),
          {
            amountPaid: record.amount ?? 0,
            paymentMethod: (payload.paymentMethod as string) || 'CASH',
            referenceNumber: payload.referenceNumber as string | undefined,
            notes: payload.notes as string | undefined,
          },
          decidedBy,
          userRole,
        );
      }
    } else if (record.targetType === 'APPRAISAL') {
      await this.pawnTicketService.rejectAppraisal(Number(record.targetId), userRole);
    }

    const updated = await this.prisma.approvalRecord.update({
      where: { id },
      data: {
        status: approve ? 'APPROVED' : 'REJECTED',
        decidedById: decidedBy,
        decidedAt: new Date(),
        decisionComment: dto.decisionComment,
      },
    });

    try {
      await this.notificationService.sendNotification({
        recipientId: record.requestedById,
        channel: NotificationChannel.IN_APP,
        type: NotificationType.SYSTEM_ANNOUNCEMENT,
        title: approve ? 'Approval granted' : 'Approval rejected',
        body: `Your ${record.targetType.toLowerCase()} approval request was ${
          approve ? 'approved' : 'rejected'
        }.`,
        data: {
          approvalRecordId: record.id,
          targetType: record.targetType,
          status: approve ? 'APPROVED' : 'REJECTED',
        },
      });
    } catch (err) {
      // best-effort notification — never fails the decision
    }

    return updated;
  }
}
