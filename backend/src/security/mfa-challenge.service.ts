import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../prisma.service';
import { SecurityEmailService } from './security-email.service';

export type MfaChallengePurpose = 'ENABLE' | 'LOGIN' | 'DISABLE' | string;

export interface MfaChallengeIssueInput {
  profileId: string;
  email: string;
  purpose: MfaChallengePurpose;
  sessionId?: string | null;
}

export interface MfaChallengeSafeView {
  challengeId: string;
  expiresAt: Date;
  maskedEmail: string;
}

export interface MfaChallengeVerifyInput {
  profileId: string;
  challengeId: string;
  code: string;
  purpose: MfaChallengePurpose;
  sessionId?: string | null;
}

type MfaChallengeVerificationResult =
  | { challengeId: string }
  | { error: 'MFA_CHALLENGE_INVALID' | 'MFA_CHALLENGE_LOCKED' };

@Injectable()
export class MfaChallengeService {
  static readonly CODE_LENGTH = 6;
  static readonly MAX_ATTEMPTS = 5;
  static readonly EXPIRY_MS = 10 * 60 * 1000;

  private readonly pepper: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: SecurityEmailService,
  ) {
    const pepper = String(process.env.MFA_CODE_HMAC_PEPPER || '').trim();
    if (pepper.length < 32) {
      throw new Error(
        'MFA_CODE_HMAC_PEPPER must be configured with at least 32 characters',
      );
    }
    this.pepper = pepper;
  }

  async issue(input: MfaChallengeIssueInput): Promise<MfaChallengeSafeView> {
    this.assertIssueInput(input);
    const code = this.generateCode();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + MfaChallengeService.EXPIRY_MS);

    const record = await this.prisma.$transaction(async (tx) => {
      await tx.mfaEmailChallenge.updateMany({
        where: {
          profileId: input.profileId,
          purpose: input.purpose,
          consumedAt: null,
        },
        data: { consumedAt: now },
      });

      return tx.mfaEmailChallenge.create({
        data: {
          profileId: input.profileId,
          sessionId: input.sessionId ?? null,
          purpose: input.purpose,
          codeHash: this.hashCode(input.profileId, code),
          attempts: 0,
          maxAttempts: MfaChallengeService.MAX_ATTEMPTS,
          expiresAt,
          consumedAt: null,
        },
      });
    });

    try {
      await this.emailService.send({
        email: input.email,
        purpose: input.purpose,
        code,
        expiresInMinutes: MfaChallengeService.EXPIRY_MS / 60000,
      });
    } catch (error) {
      await this.prisma.mfaEmailChallenge.updateMany({
        where: { id: record.id, consumedAt: null },
        data: { consumedAt: new Date() },
      });
      throw new ServiceUnavailableException({
        success: false,
        error: 'MFA_EMAIL_DELIVERY_UNAVAILABLE',
        message: 'Unable to deliver the verification email',
      });
    }

    return this.toSafeView(record, input.email);
  }

  async resend(input: MfaChallengeIssueInput): Promise<MfaChallengeSafeView> {
    return this.issue(input);
  }

  async verify(input: MfaChallengeVerifyInput): Promise<{ challengeId: string }> {
    this.assertVerifyInput(input);
    const candidateHash = this.hashCode(input.profileId, input.code);
    const now = new Date();

    const result = await this.prisma.$transaction(async (tx) => {
      const challenge = await tx.mfaEmailChallenge.findFirst({
        where: {
          id: input.challengeId,
          profileId: input.profileId,
          purpose: input.purpose,
        },
      });

      if (!challenge || challenge.consumedAt || challenge.expiresAt <= now) {
        return { error: 'MFA_CHALLENGE_INVALID' as const };
      }
      if (challenge.attempts >= challenge.maxAttempts) {
        return { error: 'MFA_CHALLENGE_LOCKED' as const };
      }

      const expected = Buffer.from(challenge.codeHash, 'hex');
      const candidate = Buffer.from(candidateHash, 'hex');
      const matches =
        expected.length === candidate.length &&
        expected.length > 0 &&
        timingSafeEqual(expected, candidate);

      if (!matches) {
        const incremented = await tx.mfaEmailChallenge.updateMany({
          where: {
            id: challenge.id,
            consumedAt: null,
            attempts: { lt: challenge.maxAttempts },
          },
          data: { attempts: { increment: 1 } },
        });
        if (incremented.count === 0) {
          return { error: 'MFA_CHALLENGE_LOCKED' as const };
        }
        return { error: 'MFA_CHALLENGE_INVALID' as const };
      }

      const consumed = await tx.mfaEmailChallenge.updateMany({
        where: {
          id: challenge.id,
          consumedAt: null,
          expiresAt: { gt: now },
          attempts: { lt: challenge.maxAttempts },
        },
        data: { consumedAt: now },
      });
      if (consumed.count !== 1) {
        return { error: 'MFA_CHALLENGE_INVALID' as const };
      }

      return { challengeId: challenge.id };
    });

    if ('error' in result) {
      throw this.safeChallengeError(result.error);
    }
    return result;
  }

  async consume(
    profileId: string,
    challengeId: string,
    purpose: MfaChallengePurpose,
  ): Promise<boolean> {
    const result = await this.prisma.mfaEmailChallenge.updateMany({
      where: {
        id: challengeId,
        profileId,
        purpose,
        consumedAt: null,
        expiresAt: { gt: new Date() },
        attempts: { lt: MfaChallengeService.MAX_ATTEMPTS },
      },
      data: { consumedAt: new Date() },
    });
    return result.count === 1;
  }

  async expire(challengeId: string, profileId: string): Promise<boolean> {
    const result = await this.prisma.mfaEmailChallenge.updateMany({
      where: {
        id: challengeId,
        profileId,
        consumedAt: null,
        expiresAt: { lte: new Date() },
      },
      data: { consumedAt: new Date() },
    });
    return result.count === 1;
  }

  private generateCode(): string {
    return randomInt(0, 1_000_000).toString().padStart(MfaChallengeService.CODE_LENGTH, '0');
  }

  private hashCode(profileId: string, code: string): string {
    return createHmac('sha256', this.pepper)
      .update(`${profileId}:${code}`)
      .digest('hex');
  }

  private toSafeView(
    record: { id: string; expiresAt: Date },
    email: string,
  ): MfaChallengeSafeView {
    return {
      challengeId: record.id,
      expiresAt: record.expiresAt,
      maskedEmail: this.maskEmail(email),
    };
  }

  private maskEmail(email: string): string {
    const normalized = email.trim().toLowerCase();
    const at = normalized.lastIndexOf('@');
    if (at <= 0) return '***';
    const local = normalized.slice(0, at);
    const domain = normalized.slice(at);
    const visible = local.length <= 2 ? local[0] || '*' : local.slice(0, 2);
    return `${visible}${'•'.repeat(Math.max(1, Math.min(4, local.length - visible.length)))}${domain}`;
  }

  private assertIssueInput(input: MfaChallengeIssueInput): void {
    if (!input || !input.profileId?.trim() || !input.email?.trim() || !input.purpose?.trim()) {
      throw new BadRequestException({
        success: false,
        error: 'MFA_CHALLENGE_INVALID',
        message: 'A valid challenge request is required',
      });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim())) {
      throw new BadRequestException({
        success: false,
        error: 'MFA_CHALLENGE_INVALID',
        message: 'A valid challenge request is required',
      });
    }
  }

  private assertVerifyInput(input: MfaChallengeVerifyInput): void {
    if (
      !input ||
      !input.profileId?.trim() ||
      !input.challengeId?.trim() ||
      !/^\d{6}$/.test(input.code || '') ||
      !input.purpose?.trim()
    ) {
      throw this.safeChallengeError('MFA_CHALLENGE_INVALID');
    }
  }

  private safeChallengeError(error: string): BadRequestException {
    return new BadRequestException({
      success: false,
      error,
      message: 'The verification challenge is invalid or no longer available',
    });
  }
}
