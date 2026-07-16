import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

@Injectable()
export class TOSService {
  constructor(private readonly prisma: PrismaService) {}

  async acceptTOS(params: {
    profileId: string;
    pawnshopId: string;
    contractType: string;
    tosVersion: string;
    ipAddress?: string;
    userAgent?: string;
  }) {
    const existing = await this.prisma.tOSAcceptance.findUnique({
      where: {
        profileId_contractType: {
          profileId: params.profileId,
          contractType: params.contractType as any,
        },
      },
    });

    if (existing) {
      return this.prisma.tOSAcceptance.update({
        where: { id: existing.id },
        data: {
          tosVersion: params.tosVersion,
          acceptedAt: new Date(),
          ipAddress: params.ipAddress,
          userAgent: params.userAgent,
        },
      });
    }

    const acceptance = await this.prisma.tOSAcceptance.create({
      data: {
        profileId: params.profileId,
        contractType: params.contractType as any,
        tosVersion: params.tosVersion,
        ipAddress: params.ipAddress,
        userAgent: params.userAgent,
      },
    });

    await this.prisma.legalProof.create({
      data: {
        proofNumber: `PROOF-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 8)}`,
        pawnshopId: params.pawnshopId,
        recordType: 'TOS_ACCEPTANCE_PROOF',
        title: `TOS Acceptance: ${params.contractType}`,
        summary: `User ${params.profileId} accepted ${params.contractType} v${params.tosVersion}`,
        payload: { profileId: params.profileId, contractType: params.contractType, version: params.tosVersion },
        sourceHash: this.hashPayload({ profileId: params.profileId, contractType: params.contractType, version: params.tosVersion }),
        createdBy: params.profileId,
      },
    });

    return acceptance;
  }

  async hasAccepted(profileId: string, contractType: string): Promise<boolean> {
    const acceptance = await this.prisma.tOSAcceptance.findUnique({
      where: {
        profileId_contractType: {
          profileId,
          contractType: contractType as any,
        },
      },
    });
    return !!acceptance;
  }

  async getAcceptance(profileId: string, contractType: string) {
    return this.prisma.tOSAcceptance.findUnique({
      where: {
        profileId_contractType: {
          profileId,
          contractType: contractType as any,
        },
      },
    });
  }

  async getProfileAcceptances(profileId: string) {
    return this.prisma.tOSAcceptance.findMany({
      where: { profileId },
    });
  }

  private hashPayload(obj: any): string {
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(JSON.stringify(obj)).digest('hex');
  }
}
