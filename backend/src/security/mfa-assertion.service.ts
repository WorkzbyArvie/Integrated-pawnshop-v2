import { Injectable } from '@nestjs/common';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../prisma.service';

export const MFA_ASSERTION_HEADER = 'x-mfa-assertion';
export const MFA_ASSERTION_TTL_MS = 15 * 60 * 1000;
export const MFA_ASSERTION_ERROR_CODES = {
  VERIFICATION_REQUIRED: 'MFA_VERIFICATION_REQUIRED',
} as const;

export interface MfaAssertionIssued {
  assertion: string;
  expiresAt: Date;
}

@Injectable()
export class MfaAssertionService {
  static readonly TTL_MS = MFA_ASSERTION_TTL_MS;
  static readonly TOKEN_BYTES = 32;

  private readonly pepper: string;

  constructor(private readonly prisma: PrismaService) {
    const pepper = String(process.env.MFA_CODE_HMAC_PEPPER || '').trim();
    if (pepper.length < 32) {
      throw new Error(
        'MFA_CODE_HMAC_PEPPER must be configured with at least 32 characters',
      );
    }
    this.pepper = pepper;
  }

  async issue(
    profileId: string,
    sessionId: string,
  ): Promise<MfaAssertionIssued> {
    const binding = this.normalizeBinding(profileId, sessionId);
    const assertion = randomBytes(MfaAssertionService.TOKEN_BYTES).toString(
      'base64url',
    );
    const expiresAt = new Date(Date.now() + MfaAssertionService.TTL_MS);

    await this.prisma.mfaSessionAssertion.create({
      data: {
        profileId: binding.profileId,
        sessionId: binding.sessionId,
        tokenHash: this.hashAssertion(assertion),
        expiresAt,
      },
    });

    return { assertion, expiresAt };
  }

  async validate(
    profileId: string,
    sessionId: string,
    presented?: string | null,
  ): Promise<boolean> {
    const candidate = typeof presented === 'string' ? presented.trim() : '';
    if (!candidate) return false;
    if (!profileId?.trim() || !sessionId?.trim()) return false;

    const tokenHash = this.hashAssertion(candidate);
    let record: { id: string; tokenHash: string } | null = null;
    try {
      record = await this.prisma.mfaSessionAssertion.findFirst({
        where: {
          profileId: profileId.trim(),
          sessionId: sessionId.trim(),
          tokenHash,
          expiresAt: { gt: new Date() },
        },
        select: { id: true, tokenHash: true },
      });
    } catch {
      return false;
    }

    if (!record?.tokenHash) return false;
    return this.constantTimeHashMatch(record.tokenHash, tokenHash);
  }

  private normalizeBinding(
    profileId: string,
    sessionId: string,
  ): { profileId: string; sessionId: string } {
    const normalizedProfile = profileId?.trim() || '';
    const normalizedSession = sessionId?.trim() || '';
    if (!normalizedProfile || !normalizedSession) {
      throw new Error(
        'A validated profile and session are required to issue an MFA assertion',
      );
    }
    return { profileId: normalizedProfile, sessionId: normalizedSession };
  }

  private hashAssertion(assertion: string): string {
    return createHmac('sha256', this.pepper).update(assertion).digest('hex');
  }

  private constantTimeHashMatch(stored: string, candidate: string): boolean {
    const expected = Buffer.from(String(stored), 'utf8');
    const actual = Buffer.from(candidate, 'utf8');
    if (expected.length !== actual.length || expected.length === 0) return false;
    return timingSafeEqual(expected, actual);
  }
}
