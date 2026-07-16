import { Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { Prisma, ProofRecordType } from '@prisma/client';
import { PrismaService } from '../prisma.service';

type ProofPayload = Record<string, unknown>;

type ProofInput = {
  pawnshopId: string;
  recordType: ProofRecordType;
  title: string;
  summary: string;
  createdBy: string;
  payload: ProofPayload;
  applicationId?: string;
  loanId?: number;
  paymentId?: string;
  ledgerEntryId?: string;
  ticketId?: number;
  contractId?: string;
};

@Injectable()
export class LegalProofService {
  constructor(private readonly prisma: PrismaService) {}

  private sortValue(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((item) => this.sortValue(item));
    }

    if (value && typeof value === 'object') {
      return Object.keys(value as Record<string, unknown>)
        .sort()
        .reduce<Record<string, unknown>>((acc, key) => {
          acc[key] = this.sortValue((value as Record<string, unknown>)[key]);
          return acc;
        }, {});
    }

    return value;
  }

  private hashPayload(payload: ProofPayload): string {
    const canonical = JSON.stringify(this.sortValue(payload));
    return createHash('sha256').update(canonical).digest('hex');
  }

  private buildProofNumber(): string {
    const timestamp = Date.now().toString(36).toUpperCase();
    const suffix = randomUUID().slice(0, 8).toUpperCase();
    return `PROOF-${timestamp}-${suffix}`;
  }

  async createProof(input: ProofInput) {
    return this.prisma.legalProof.create({
      data: {
        proofNumber: this.buildProofNumber(),
        pawnshopId: input.pawnshopId,
        recordType: input.recordType,
        title: input.title,
        summary: input.summary,
        payload: input.payload as Prisma.InputJsonValue,
        sourceHash: this.hashPayload(input.payload),
        createdBy: input.createdBy,
        applicationId: input.applicationId,
        loanId: input.loanId,
        paymentId: input.paymentId,
        ledgerEntryId: input.ledgerEntryId,
        ticketId: input.ticketId,
        contractId: input.contractId,
      },
    });
  }

  async listByApplication(applicationId: string) {
    return this.prisma.legalProof.findMany({
      where: { applicationId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async listByPayment(paymentId: string) {
    return this.prisma.legalProof.findMany({
      where: { paymentId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async listByLoan(loanId: number) {
    return this.prisma.legalProof.findMany({
      where: { loanId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async listByContract(contractId: string) {
    return this.prisma.legalProof.findMany({
      where: { contractId },
      orderBy: { createdAt: 'desc' },
    });
  }
}