import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { KycStatus, Prisma } from '@prisma/client';

import { PrismaService } from '../prisma.service';
import { ReviewCustomerKycDto } from './dto/review-customer-kyc.dto';
import { UpsertCustomerKycDto } from './dto/upsert-customer-kyc.dto';
import {
  assertValidKycDocumentUrl,
  normalizeAndValidateKycIdNumber,
  normalizeAndValidatePhoneNumber,
  normalizeKycFullName,
} from './kyc-validation';

@Injectable()
export class KycService {
  constructor(private prisma: PrismaService) {}

  async upsertCustomerKyc(dto: UpsertCustomerKycDto, callerPawnshopId: string) {
    const fullName = normalizeKycFullName(dto.fullName);
    const contactNumber = normalizeAndValidatePhoneNumber(dto.contactNumber);
    const idNumber = normalizeAndValidateKycIdNumber(dto.idType, dto.idNumber);
    assertValidKycDocumentUrl(dto.idFrontUrl, 'ID front');
    if (dto.idBackUrl) assertValidKycDocumentUrl(dto.idBackUrl, 'ID back');
    if (dto.selfieUrl) assertValidKycDocumentUrl(dto.selfieUrl, 'Selfie');

    let customerId = dto.customerId;
    if (!customerId) {
      const existing = await this.prisma.customer.findFirst({
        where: { fullName, contactNumber, pawnshopId: callerPawnshopId },
        select: { id: true },
      });
      if (existing) {
        customerId = existing.id;
      } else {
        const created = await this.prisma.customer.create({
          data: {
            fullName,
            contactNumber,
            address: dto.address,
            pawnshopId: callerPawnshopId,
            kycStatus: 'NOT_SUBMITTED',
          },
        });
        customerId = created.id;
      }
    } else {
      const existing = await this.prisma.customer.findUnique({
        where: { id: customerId },
        select: { id: true },
      });
      if (!existing) throw new NotFoundException('Customer not found');
    }

    return this.prisma.$transaction(async (tx) => {
      const kyc = await tx.customerKyc.upsert({
        where: { customerId },
        create: {
          customerId,
          pawnshopId: callerPawnshopId,
          fullName,
          contactNumber,
          address: dto.address,
          idType: dto.idType,
          idNumber,
          idFrontUrl: dto.idFrontUrl,
          idBackUrl: dto.idBackUrl,
          selfieUrl: dto.selfieUrl,
          verificationData: dto.verificationData as Prisma.InputJsonValue,
          status: 'PENDING',
        },
        update: {
          pawnshopId: callerPawnshopId,
          fullName,
          contactNumber,
          address: dto.address,
          idType: dto.idType,
          idNumber,
          idFrontUrl: dto.idFrontUrl,
          idBackUrl: dto.idBackUrl,
          selfieUrl: dto.selfieUrl,
          verificationData: dto.verificationData as Prisma.InputJsonValue,
          status: 'PENDING',
        },
      });
      await tx.customer.update({
        where: { id: customerId },
        data: { kycStatus: 'PENDING' },
      });
      return kyc;
    });
  }

  async listCustomers(callerPawnshopId: string, status?: string) {
    return this.prisma.customerKyc.findMany({
      where: {
        pawnshopId: callerPawnshopId,
        ...(status ? { status: status as KycStatus } : {}),
      },
      include: { customer: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async review(
    id: string,
    dto: ReviewCustomerKycDto,
    callerPawnshopId: string,
    reviewedBy: string,
    userRole?: string,
  ) {
    const record = await this.prisma.customerKyc.findUnique({
      where: { id },
      include: { customer: true },
    });
    if (!record) throw new NotFoundException('Customer KYC record not found');

    if (record.pawnshopId !== callerPawnshopId && userRole !== 'SUPER_ADMIN') {
      throw new ForbiddenException('KYC record belongs to another pawnshop');
    }

    if (record.status !== 'PENDING') {
      throw new BadRequestException('Customer KYC already decided');
    }

    if (dto.decision === 'REJECTED' && !(dto.rejectionReason ?? '').trim()) {
      throw new BadRequestException(
        'A rejection reason is required when rejecting a KYC submission',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.customerKyc.update({
        where: { id },
        data: {
          status: dto.decision,
          reviewedBy,
          reviewedAt: new Date(),
          rejectionReason: dto.decision === 'REJECTED' ? dto.rejectionReason : null,
        },
      });
      await tx.customer.update({
        where: { id: record.customerId },
        data: { kycStatus: dto.decision },
      });
      return updated;
    });
  }
}
