import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ComplianceDocStatus, ComplianceDocType, NotificationChannel, NotificationStatus, NotificationType } from '@prisma/client';
import { createTransport, type Transporter } from 'nodemailer';
import { PrismaService } from '../prisma.service';
import { NotificationService } from '../notification/notification.service';
import { UploadDocumentDto } from './dto/upload-document.dto';
import { VerifyDocumentDto } from './dto/verify-document.dto';

const REQUIRED_DOCUMENTS: ComplianceDocType[] = [
  'DTI_REGISTRATION',
  'MAYORS_PERMIT',
  'BIR_COR',
  'BSP_LICENSE',
  'AMLC_REGISTRATION',
  'GOVERNMENT_ID',
  'PROOF_OF_ADDRESS',
];

const EXPIRY_WARNING_DAYS = [30, 14, 7];

@Injectable()
export class ComplianceService {
  private readonly logger = new Logger(ComplianceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
  ) {}

  async uploadDocument(userId: string, dto: UploadDocumentDto) {
    const profile = await this.getProfileOrThrow(userId);
    if (!profile.pawnshopId) {
      throw new BadRequestException('No pawnshop associated with your account');
    }

    const existing = await this.prisma.pawnshopDocument.findFirst({
      where: {
        pawnshopId: profile.pawnshopId,
        documentType: dto.documentType,
        status: { in: ['UPLOADED', 'UNDER_REVIEW'] },
      },
    });

    if (existing) {
      throw new BadRequestException(
        `A ${dto.documentType} document is already pending review. Wait for verification or rejection before uploading a new one.`,
      );
    }

    const document = await this.prisma.pawnshopDocument.create({
      data: {
        pawnshopId: profile.pawnshopId,
        documentType: dto.documentType,
        fileName: dto.fileName,
        fileUrl: dto.fileUrl,
        fileSize: dto.fileSize || null,
        status: 'UPLOADED',
        expiryDate: dto.expiryDate ? new Date(dto.expiryDate) : null,
        uploadedBy: userId,
      },
    });

    return document;
  }

  async getDocuments(userId: string, pawnshopId?: string) {
    const profile = await this.getProfileOrThrow(userId);

    let targetPawnshopId = profile.pawnshopId;
    if (pawnshopId && profile.role === 'SUPER_ADMIN') {
      targetPawnshopId = pawnshopId;
    }

    if (!targetPawnshopId) {
      throw new BadRequestException('No pawnshop associated');
    }

    const documents = await this.prisma.pawnshopDocument.findMany({
      where: { pawnshopId: targetPawnshopId },
      orderBy: { createdAt: 'desc' },
    });

    return documents;
  }

  async verifyDocument(userId: string, documentId: string, dto: VerifyDocumentDto) {
    const profile = await this.getProfileOrThrow(userId);
    if (profile.role !== 'SUPER_ADMIN') {
      throw new ForbiddenException('Only Super Admin can verify documents');
    }

    const document = await this.prisma.pawnshopDocument.findUnique({
      where: { id: documentId },
    });

    if (!document) {
      throw new NotFoundException('Document not found');
    }

    if (document.status !== 'UPLOADED' && document.status !== 'UNDER_REVIEW') {
      throw new BadRequestException(`Document is already ${document.status}`);
    }

    const updated = await this.prisma.pawnshopDocument.update({
      where: { id: documentId },
      data: {
        status: dto.status,
        verifiedBy: userId,
        verifiedAt: new Date(),
        rejectionReason: dto.rejectionReason || null,
      },
    });

    return updated;
  }

  async renewDocument(userId: string, documentId: string, dto: UploadDocumentDto) {
    const profile = await this.getProfileOrThrow(userId);
    if (!profile.pawnshopId) {
      throw new BadRequestException('No pawnshop associated');
    }

    const oldDocument = await this.prisma.pawnshopDocument.findUnique({
      where: { id: documentId },
    });

    if (!oldDocument) {
      throw new NotFoundException('Document not found');
    }

    if (oldDocument.pawnshopId !== profile.pawnshopId) {
      throw new ForbiddenException('Not your document');
    }

    await this.prisma.pawnshopDocument.update({
      where: { id: documentId },
      data: { status: 'EXPIRED' },
    });

    const newDocument = await this.prisma.pawnshopDocument.create({
      data: {
        pawnshopId: profile.pawnshopId,
        documentType: oldDocument.documentType,
        fileName: dto.fileName,
        fileUrl: dto.fileUrl,
        fileSize: dto.fileSize || null,
        status: 'UPLOADED',
        expiryDate: dto.expiryDate ? new Date(dto.expiryDate) : null,
        uploadedBy: userId,
      },
    });

    return newDocument;
  }

  async requestDocumentReplacement(userId: string, documentId: string) {
    const profile = await this.getProfileOrThrow(userId);
    if (profile.role !== 'SUPER_ADMIN') {
      throw new ForbiddenException('Only Super Admin can request a document replacement');
    }

    const document = await this.prisma.pawnshopDocument.findUnique({
      where: { id: documentId },
    });

    if (!document) {
      throw new NotFoundException('Document not found');
    }

    if (document.status !== 'VERIFIED' && document.status !== 'EXPIRED') {
      throw new BadRequestException(
        `Only a VERIFIED or EXPIRED document can be flagged for replacement (current: ${document.status}).`,
      );
    }

    const updated = await this.prisma.pawnshopDocument.update({
      where: { id: documentId },
      data: {
        status: 'REJECTED',
        verifiedAt: null,
        rejectionReason:
          document.status === 'EXPIRED'
            ? 'Document has expired. Please upload a renewed copy.'
            : 'Renewal requested by platform. Please upload a new, updated copy of this document.',
      },
    });

    await this.notifyOwnerDocumentReplacement(document.pawnshopId, document.documentType, updated.rejectionReason);

    return updated;
  }

  private async notifyOwnerDocumentReplacement(pawnshopId: string, documentType: string, reason: string) {
    try {
      const ownerProfile = await this.prisma.profile.findFirst({
        where: { pawnshopId, role: 'OWNER' },
      });
      if (ownerProfile) {
        await this.notificationService.sendNotification({
          recipientId: ownerProfile.id,
          channel: NotificationChannel.IN_APP,
          type: NotificationType.COMPLIANCE_REMINDER,
          title: 'Document Replacement Requested',
          body: `Action needed: ${documentType.replace(/_/g, ' ')}. ${reason}`,
          data: { documentType, pawnshopId, reason },
        });
      }
    } catch (err: any) {
      this.logger.error(`Failed to send replacement notification: ${err.message}`);
    }
  }

  async getComplianceScore(userId: string) {
    const profile = await this.getProfileOrThrow(userId);

    let targetPawnshopId = profile.pawnshopId;
    if (profile.role === 'SUPER_ADMIN') {
      return null;
    }

    if (!targetPawnshopId) {
      throw new BadRequestException('No pawnshop associated');
    }

    return this.calculateComplianceScore(targetPawnshopId);
  }

  async calculateComplianceScore(pawnshopId: string) {
    const [documents, subscription] = await Promise.all([
      this.prisma.pawnshopDocument.findMany({ where: { pawnshopId } }),
      this.prisma.subscription.findFirst({
        where: { pawnshopId, status: { in: ['ACTIVE', 'TRIAL'] } },
      }),
    ]);

    return this.computeComplianceScore(pawnshopId, documents, !!subscription);
  }

  private computeComplianceScore(pawnshopId: string, documents: any[], subscriptionActive: boolean) {
    const totalRequired = REQUIRED_DOCUMENTS.length;

    const latestByType = new Map<ComplianceDocType, typeof documents[0]>();
    for (const doc of documents) {
      const existing = latestByType.get(doc.documentType);
      if (!existing || doc.createdAt > existing.createdAt) {
        latestByType.set(doc.documentType, doc);
      }
    }

    let uploaded = 0;
    let verified = 0;
    let notExpired = 0;

    const docStatuses: Array<{
      id: string;
      type: ComplianceDocType;
      status: string;
      expiryDate: Date | null;
      daysUntilExpiry: number | null;
      fileName: string;
    }> = [];

    for (const reqType of REQUIRED_DOCUMENTS) {
      const doc = latestByType.get(reqType);
      if (doc) {
        uploaded++;
        const isExpired = doc.expiryDate && doc.expiryDate < new Date();
        const daysUntilExpiry = doc.expiryDate
          ? Math.ceil((doc.expiryDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
          : null;

        if (doc.status === 'VERIFIED' && !isExpired) verified++;
        if (!isExpired) notExpired++;

        docStatuses.push({
          id: doc.id,
          type: reqType,
          status: isExpired ? 'EXPIRED' : doc.status,
          expiryDate: doc.expiryDate,
          daysUntilExpiry,
          fileName: doc.fileName,
        });
      } else {
        docStatuses.push({
          id: '',
          type: reqType,
          status: 'NOT_UPLOADED',
          expiryDate: null,
          daysUntilExpiry: null,
          fileName: '',
        });
      }
    }

    const score = Math.round(
      (uploaded / totalRequired) * 40 +
      (verified / totalRequired) * 30 +
      (notExpired / totalRequired) * 20 +
      (subscriptionActive ? 10 : 0)
    );

    return {
      score,
      documents: docStatuses,
      summary: {
        totalRequired,
        uploaded,
        verified,
        notExpired,
        subscriptionActive,
      },
    };
  }

  async getExpiringDocuments(daysAhead: number = 30) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() + daysAhead);

    const expiring = await this.prisma.pawnshopDocument.findMany({
      where: {
        status: 'VERIFIED',
        expiryDate: {
          lte: cutoff,
          gte: new Date(),
        },
      },
      include: {
        pawnshop: {
          select: { id: true, name: true, ownerEmail: true },
        },
      },
    });

    return expiring;
  }

  async getExpiredDocuments() {
    const expired = await this.prisma.pawnshopDocument.findMany({
      where: {
        status: 'VERIFIED',
        expiryDate: {
          lt: new Date(),
        },
      },
      include: {
        pawnshop: {
          select: { id: true, name: true, ownerEmail: true },
        },
      },
    });

    return expired;
  }

  async getPendingReviews() {
    const pending = await this.prisma.pawnshopDocument.findMany({
      where: {
        status: { in: ['UPLOADED', 'UNDER_REVIEW'] },
      },
      select: {
        id: true,
        documentType: true,
        fileName: true,
        fileUrl: true,
        fileSize: true,
        hasViewed: true,
        status: true,
        rejectionReason: true,
        createdAt: true,
        pawnshop: {
          select: { id: true, name: true, ownerEmail: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    return pending;
  }

  async getAllPawnshopCompliance() {
    const pawnshops = await this.prisma.pawnshop.findMany({
      where: { status: 'ACTIVE', isActive: true },
      select: {
        id: true,
        name: true,
        registrationNumber: true,
        address: true,
        contactPhone: true,
        contactEmail: true,
        ownerEmail: true,
        createdAt: true,
      },
    });

    if (pawnshops.length === 0) return [];

    const pawnshopIds = pawnshops.map((ps) => ps.id);

    const [allDocs, allSubscriptions] = await Promise.all([
      this.prisma.pawnshopDocument.findMany({
        where: { pawnshopId: { in: pawnshopIds } },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.subscription.findMany({
        where: { pawnshopId: { in: pawnshopIds }, status: { in: ['ACTIVE', 'TRIAL'] } },
        select: { pawnshopId: true },
      }),
    ]);

    const docsByPawnshop = new Map<string, typeof allDocs>();
    for (const doc of allDocs) {
      const list = docsByPawnshop.get(doc.pawnshopId) || [];
      list.push(doc);
      docsByPawnshop.set(doc.pawnshopId, list);
    }

    const subscribedIds = new Set(allSubscriptions.map((s) => s.pawnshopId));

    return pawnshops.map((ps) => {
      const docs = docsByPawnshop.get(ps.id) || [];
      return {
        pawnshopId: ps.id,
        pawnshopName: ps.name,
        ...this.computeComplianceScore(ps.id, docs, subscribedIds.has(ps.id)),
      };
    });
  }

  async getSuperAdminOverview() {
    const [pendingReviews, allPawnshops, kycPending] = await Promise.all([
      this.getPendingReviews(),
      this.getAllPawnshopCompliance(),
      this.prisma.bidderKyc.findMany({
        where: { status: 'PENDING' },
        select: {
          id: true,
          fullName: true,
          idType: true,
          idNumber: true,
          dateOfBirth: true,
          address: true,
          phoneNumber: true,
          idFrontUrl: true,
          idBackUrl: true,
          selfieUrl: true,
          status: true,
          createdAt: true,
          verificationData: true,
          profile: {
            select: { email: true, fullName: true, role: true },
          },
        },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    return { pendingReviews, allPawnshops, kycPending };
  }

  @Cron(CronExpression.EVERY_DAY_AT_6AM)
  async checkExpiringDocuments() {
    this.logger.log('Checking for expiring documents...');

    for (const days of EXPIRY_WARNING_DAYS) {
      const expiring = await this.getExpiringDocuments(days);
      for (const doc of expiring) {
        const severity = days <= 7 ? 'CRITICAL' : days <= 14 ? 'WARNING' : 'INFO';
        this.logger.warn(
          `[${severity}] Document ${doc.documentType} for ${doc.pawnshop.name} expires in ${days} days`,
        );

        const ownerProfile = await this.prisma.profile.findFirst({
          where: { pawnshopId: doc.pawnshop.id, role: 'OWNER' },
          select: { id: true, email: true },
        });

        if (ownerProfile) {
          try {
            await this.notificationService.sendNotification({
              recipientId: ownerProfile.id,
              channel: NotificationChannel.IN_APP,
              type: NotificationType.COMPLIANCE_REMINDER,
              title: `Document Expiring Soon`,
              body: `Your ${doc.documentType.replace(/_/g, ' ')} expires in ${days} days. Please upload a renewed copy.`,
              data: {
                documentType: doc.documentType,
                pawnshopId: doc.pawnshop.id,
                expiryDate: doc.expiryDate?.toISOString(),
                daysUntilExpiry: days,
              },
            });

            const label = doc.documentType.replace(/_/g, ' ');
            const subject = `[${severity}] ${label} expires in ${days} days`;
            const text = `Your ${label} for ${doc.pawnshop.name} expires in ${days} days. Please upload a renewed, verified copy to stay compliant with PawnGold.`;
            const html = `<div style="font-family:'Segoe UI',Arial,sans-serif;color:#1a1d29;line-height:1.6">
              <h2 style="margin:0 0 12px;color:#8a6d3b">${label} expiring soon</h2>
              <p>${text}</p>
              <p style="margin-top:12px;color:#6b7280;font-size:13px">— PawnGold Compliance Team</p>
            </div>`;
            await this.sendComplianceEmail(ownerProfile.email, subject, text, html);
          } catch (err: any) {
            this.logger.error(`Failed to send expiry notification: ${err.message}`);
          }
        }
      }
    }

    const expired = await this.getExpiredDocuments();
    for (const doc of expired) {
      this.logger.error(
        `Document ${doc.documentType} for ${doc.pawnshop.name} has EXPIRED`,
      );

      const ownerProfile = await this.prisma.profile.findFirst({
        where: { pawnshopId: doc.pawnshop.id, role: 'OWNER' },
        select: { id: true, email: true },
      });

      if (ownerProfile) {
        try {
          await this.notificationService.sendNotification({
            recipientId: ownerProfile.id,
            channel: NotificationChannel.IN_APP,
              type: NotificationType.COMPLIANCE_REMINDER,
              title: `Document Expired`,
            body: `Your ${doc.documentType.replace(/_/g, ' ')} has expired. Upload a renewed copy to maintain compliance.`,
            data: {
              documentType: doc.documentType,
              pawnshopId: doc.pawnshop.id,
              expiryDate: doc.expiryDate?.toISOString(),
              daysUntilExpiry: 0,
            },
          });

          const label = doc.documentType.replace(/_/g, ' ');
          const subject = `[EXPIRED] ${label} has expired`;
          const text = `Your ${label} for ${doc.pawnshop.name} has expired. Upload a renewed, verified copy to maintain compliance with PawnGold.`;
          const html = `<div style="font-family:'Segoe UI',Arial,sans-serif;color:#1a1d29;line-height:1.6">
            <h2 style="margin:0 0 12px;color:#b91c1c">${label} has expired</h2>
            <p>${text}</p>
            <p style="margin-top:12px;color:#6b7280;font-size:13px">— PawnGold Compliance Team</p>
          </div>`;
          await this.sendComplianceEmail(ownerProfile.email, subject, text, html);
        } catch (err: any) {
          this.logger.error(`Failed to send expiry notification: ${err.message}`);
        }
      }
    }
  }

  private async getProfileOrThrow(userId: string) {
    const profile = await this.prisma.profile.findUnique({
      where: { id: userId },
      select: { id: true, role: true, pawnshopId: true, email: true },
    });
    if (!profile) {
      throw new NotFoundException('Profile not found');
    }
    return profile;
  }

  async getComplianceExpiryRegister(userId: string) {
    const profile = await this.getProfileOrThrow(userId);
    const isSuperAdmin = profile.role === 'SUPER_ADMIN';
    const now = Date.now();

    const pawnshops = isSuperAdmin
      ? await this.prisma.pawnshop.findMany({
          where: { status: 'ACTIVE', isActive: true },
          select: { id: true, name: true, ownerEmail: true },
        })
      : profile.pawnshopId
      ? await this.prisma.pawnshop.findMany({
          where: { id: profile.pawnshopId },
          select: { id: true, name: true, ownerEmail: true },
        })
      : [];

    if (pawnshops.length === 0) return { pawnshops: [] };

    const pawnshopIds = pawnshops.map((ps) => ps.id);
    const allDocs = await this.prisma.pawnshopDocument.findMany({
      where: { pawnshopId: { in: pawnshopIds } },
      orderBy: { createdAt: 'asc' },
    });

    const docsByPawnshop = new Map<string, typeof allDocs>();
    for (const doc of allDocs) {
      const list = docsByPawnshop.get(doc.pawnshopId) || [];
      list.push(doc);
      docsByPawnshop.set(doc.pawnshopId, list);
    }

    const register = pawnshops.map((ps) => {
      const docs = docsByPawnshop.get(ps.id) || [];
      const latestByType = new Map<ComplianceDocType, (typeof allDocs)[number]>();
      for (const doc of docs) {
        const existing = latestByType.get(doc.documentType);
        if (!existing || doc.createdAt > existing.createdAt) {
          latestByType.set(doc.documentType, doc);
        }
      }

      const rows = REQUIRED_DOCUMENTS.map((reqType) => {
        const doc = latestByType.get(reqType);
        if (!doc) {
          return {
            id: '',
            type: reqType,
            status: 'NOT_UPLOADED',
            expiryDate: null,
            daysUntilExpiry: null,
            fileName: '',
          };
        }
        const isExpired = doc.expiryDate && doc.expiryDate.getTime() < now;
        const daysUntilExpiry = doc.expiryDate
          ? Math.ceil((doc.expiryDate.getTime() - now) / (1000 * 60 * 60 * 24))
          : null;
        return {
          id: doc.id,
          type: reqType,
          status: isExpired ? 'EXPIRED' : doc.status,
          expiryDate: doc.expiryDate,
          daysUntilExpiry,
          fileName: doc.fileName,
        };
      });

      rows.sort((a, b) => {
        const av = a.daysUntilExpiry ?? Number.POSITIVE_INFINITY;
        const bv = b.daysUntilExpiry ?? Number.POSITIVE_INFINITY;
        return av - bv;
      });

      return {
        pawnshopId: ps.id,
        pawnshopName: ps.name,
        ownerEmail: ps.ownerEmail,
        documents: rows,
        expiringCount: rows.filter(
          (d) => d.daysUntilExpiry !== null && d.daysUntilExpiry <= 30,
        ).length,
        expiredCount: rows.filter((d) => d.status === 'EXPIRED').length,
      };
    });

    register.sort((a, b) => {
      const aMin = Math.min(...a.documents.map((d) => d.daysUntilExpiry ?? Number.POSITIVE_INFINITY));
      const bMin = Math.min(...b.documents.map((d) => d.daysUntilExpiry ?? Number.POSITIVE_INFINITY));
      return aMin - bMin;
    });

    return { pawnshops: register };
  }

  async getComplianceReminderHistory(userId: string) {
    const profile = await this.getProfileOrThrow(userId);
    const isSuperAdmin = profile.role === 'SUPER_ADMIN';

    const notifications = await this.prisma.notification.findMany({
      where: {
        type: 'COMPLIANCE_REMINDER',
        ...(!isSuperAdmin ? { recipientId: profile.id } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });

    const records = notifications.map((n) => {
      const data = (n.data || {}) as Record<string, unknown>;
      return {
        id: n.id,
        title: n.title,
        body: n.body,
        channel: n.channel,
        createdAt: n.createdAt,
        documentType: (data.documentType as string) || '',
        pawnshopId: (data.pawnshopId as string) || '',
        expiryDate: (data.expiryDate as string) || null,
        daysUntilExpiry: (data.daysUntilExpiry as number) ?? null,
      };
    });

    return { reminders: records };
  }

  private async sendComplianceEmail(to: string, subject: string, text: string, html: string): Promise<boolean> {
    if (!to) return false;

    const fromEmail = String(
      process.env.RESEND_FROM_EMAIL || process.env.SMTP_FROM_EMAIL || process.env.MAIL_FROM_EMAIL || '',
    ).trim();
    const fromName = String(
      process.env.RESEND_FROM_NAME || process.env.SMTP_FROM_NAME || process.env.MAIL_FROM_NAME || 'PawnGold Platform',
    ).trim();

    const resendApiKey = String(process.env.RESEND_API_KEY || '').trim();
    if (resendApiKey && fromEmail) {
      try {
        const response = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${resendApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: `"${fromName}" <${fromEmail}>`,
            to: [to],
            subject,
            text,
            html,
          }),
        });
        if (response.ok) return true;
        const errorBody = await response.text().catch(() => '');
        this.logger.warn(`Resend email failed (${response.status}): ${errorBody}`);
      } catch (err: any) {
        this.logger.warn(`Resend email error: ${err.message}`);
      }
    }

    const smtpCandidates = this.buildSmtpTransportCandidates();
    if (fromEmail && smtpCandidates.length > 0) {
      for (const options of smtpCandidates as any[]) {
        const transporter: Transporter = createTransport(options);
        try {
          await transporter.sendMail({
            from: `"${fromName}" <${fromEmail}>`,
            to,
            subject,
            text,
            html,
          });
          return true;
        } catch (err: any) {
          this.logger.warn(`SMTP email error: ${err.message}`);
        } finally {
          transporter.close();
        }
      }
    }

    this.logger.warn('No email transport configured; skipping compliance email.');
    return false;
  }

  private buildSmtpTransportCandidates(): any[] {
    const host = process.env.SMTP_HOST;
    if (!host) return [];
    const candidates = [
      {
        host,
        port: Number(process.env.SMTP_PORT) || 587,
        secure: false,
        auth:
          process.env.SMTP_USER && process.env.SMTP_PASS
            ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
            : undefined,
      },
    ];
    return candidates;
  }

}
