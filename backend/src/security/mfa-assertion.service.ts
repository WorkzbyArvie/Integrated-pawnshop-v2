import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

export const MFA_ASSERTION_HEADER = 'x-mfa-assertion';
export const MFA_ASSERTION_TTL_MS = 15 * 60 * 1000;

export interface MfaAssertionIssued {
  assertion: string;
  expiresAt: Date;
}

@Injectable()
export class MfaAssertionService {
  static readonly TTL_MS = MFA_ASSERTION_TTL_MS;

  constructor(private readonly prisma: PrismaService) {
    void this.prisma;
  }

  async issue(profileId: string, sessionId: string): Promise<MfaAssertionIssued> {
    return { assertion: '', expiresAt: new Date(0) };
  }

  async validate(
    profileId: string,
    sessionId: string,
    presented?: string | null,
  ): Promise<boolean> {
    return false;
  }
}
