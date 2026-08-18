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
      take: query.limit ?? 100,
      skip: query.offset ?? 0,
      select: {
        id: true,
        targetType: true,
        targetId: true,
        status: true,
        amount: true,
        payload: true,
        createdAt: true,
        decidedAt: true,
        decisionComment: true,
        requestedBy: { select: { id: true, fullName: true } },
        decidedBy: { select: { id: true, fullName: true } },
      },
    });

    const targetIds = [...new Set(records.map((record) => record.targetId))];
    const needsRedemptionSettings = records.some(
      (record) => record.targetType === 'REDEMPTION',
    );

    const [tickets, pawnshop] = await Promise.all([
      targetIds.length
        ? this.prisma.ticket.findMany({
            where: {
              id: {
                in: targetIds
                  .map((id) => Number(id))
                  .filter((id) => Number.isFinite(id)),
              },
            },
            select: {
              id: true,
              ticketNumber: true,
              category: true,
              weight: true,
              isHighRisk: true,
              description: true,
              customer: {
                select: {
                  fullName: true,
                  contactNumber: true,
                  loyaltyTier: true,
                },
              },
            },
          })
        : Promise.resolve([]),
      needsRedemptionSettings
        ? this.prisma.pawnshop.findUnique({
            where: { id: callerPawnshopId },
            select: { settings: true },
          })
        : Promise.resolve(null),
    ]);

    const foundTickets = tickets ?? [];
    const ticketById = new Map(foundTickets.map((ticket) => [String(ticket.id), ticket]));

    const settings = (pawnshop?.settings ?? {}) as Record<string, unknown>;
    const threshold = Number(settings.redemptionApprovalThreshold ?? 50000);

    return records.map((record) => {
      const ticket = ticketById.get(String(record.targetId));
      const payload = (record.payload ?? {}) as Record<string, unknown>;
      const description = ticket?.description ?? '';
      const photoUrlMatch = description.match(/\[PHOTO_URLS\]\s+(\[[\s\S]*?\])/i);
      let photoUrls: string[] = [];
      if (photoUrlMatch) {
        try {
          const parsed = JSON.parse(photoUrlMatch[1]);
          photoUrls = Array.isArray(parsed)
            ? parsed.filter((url): url is string => typeof url === 'string' && /^https?:\/\//i.test(url))
            : [];
        } catch {
          photoUrls = [];
        }
      }
      const itemName = description.split('[PHOTO_URLS]')[0].trim() || null;
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
        itemName,
        photoUrls,
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
        decidedBy: record.decidedBy
          ? { id: record.decidedBy.id, fullName: record.decidedBy.fullName ?? '' }
          : null,
        createdAt: record.createdAt,
        decidedAt: record.decidedAt,
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

    const isTopApprover = ['OWNER', 'SUPER_ADMIN'].includes((userRole ?? '').toUpperCase());
    if (record.requestedById === decidedBy && !isTopApprover) {
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

    let handoff: Record<string, unknown> | null = null;
    let resumed = false;

    if (approve) {
      if (record.targetType === 'APPRAISAL') {
        const ticket = await this.prisma.ticket.findUnique({
          where: { id: Number(record.targetId) },
        });
        if (ticket && ticket.lifecycleStatus !== 'PENDING_APPROVAL') {
          handoff = await this.resumeAppraisalHandoff(ticket.id, ticket.contractId);
          resumed = Boolean(handoff?.applicationId || handoff?.contractId);
        } else {
          handoff = (await this.pawnTicketService.applyApprovedAppraisal(
            Number(record.targetId),
            payload,
            decidedBy,
            userRole,
          )) as unknown as Record<string, unknown>;
        }
      } else if (record.targetType === 'REDEMPTION') {
        handoff = (await this.pawnTicketService.releaseApprovedRedemption(
          Number(record.targetId),
          {
            amountPaid: record.amount ?? 0,
            paymentMethod: (payload.paymentMethod as string) || 'CASH',
            referenceNumber: payload.referenceNumber as string | undefined,
            notes: payload.notes as string | undefined,
          },
          decidedBy,
          userRole,
        )) as unknown as Record<string, unknown>;
      }
    } else if (record.targetType === 'APPRAISAL') {
      await this.pawnTicketService.rejectAppraisal(Number(record.targetId), userRole);
    } else if (record.targetType === 'REDEMPTION') {
      await this.pawnTicketService.rejectRedemption(Number(record.targetId), userRole);
    }

    const isAppraisalApprove = approve && record.targetType === 'APPRAISAL';

    const updated = await this.prisma.approvalRecord.update({
      where: { id },
      data: {
        status: !approve ? 'REJECTED' : isAppraisalApprove ? 'PENDING' : 'APPROVED',
        decidedById: decidedBy,
        decidedAt: new Date(),
        decisionComment: dto.decisionComment,
      },
    });

    if (!approve || record.targetType !== 'APPRAISAL') {
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
    }

    return {
      ...updated,
      resumed,
      applicationId: handoff?.applicationId,
      contractId: handoff?.contractId,
      loanId: handoff?.loanId,
    };
  }

  private async resumeAppraisalHandoff(ticketId: number, contractId: string | null | undefined) {
    const [contract, loan] = await Promise.all([
      contractId
        ? this.prisma.loanContract.findUnique({ where: { id: contractId } })
        : Promise.resolve(null),
      this.prisma.loan.findFirst({ where: { ticketId } }),
    ]);
    return {
      applicationId: contract?.applicationId ?? loan?.applicationId,
      contractId: contractId ?? null,
      loanId: loan?.id,
    };
  }
}
