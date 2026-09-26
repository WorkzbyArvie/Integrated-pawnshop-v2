import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { SupabaseAdminService } from '../common/supabase-admin.service';
import { PasswordPolicyService } from './password-policy.service';
import {
  CredentialStateService,
  CredentialStateUnavailableError,
  CredentialStateView,
} from './credential-state.service';
import { MfaAssertionService } from './mfa-assertion.service';
import {
  MFA_CHALLENGE_ERROR_CODES,
  MFA_CHALLENGE_PURPOSES,
  MfaChallengeSafeView,
  MfaChallengeService,
  isKnownMfaChallengePurpose,
} from './mfa-challenge.service';

export const SECURITY_LOG_ACTIONS = {
  PASSWORD_CHANGED: 'PASSWORD_CHANGED',
  PASSWORD_CHANGED_VIA_RECOVERY: 'PASSWORD_CHANGED_VIA_RECOVERY',
  MFA_ENROLLMENT_STARTED: 'MFA_ENROLLMENT_STARTED',
  MFA_ENABLED: 'MFA_ENABLED',
  MFA_VERIFICATION_FAILED: 'MFA_VERIFICATION_FAILED',
  MFA_LOGIN_VERIFIED: 'MFA_LOGIN_VERIFIED',
  MFA_DISABLED: 'MFA_DISABLED',
  MFA_LOCKED: 'MFA_LOCKED',
} as const;

export type SecurityLogAction =
  (typeof SECURITY_LOG_ACTIONS)[keyof typeof SECURITY_LOG_ACTIONS];

export const CREDENTIAL_ERROR_CODES = {
  STATE_UNAVAILABLE: 'CREDENTIAL_STATE_UNAVAILABLE',
  CURRENT_PASSWORD_INVALID: 'CURRENT_PASSWORD_INVALID',
  CONFIRMATION_MISMATCH: 'PASSWORD_CONFIRMATION_MISMATCH',
  UPDATE_FAILED: 'PASSWORD_UPDATE_FAILED',
  VERIFICATION_UNAVAILABLE: 'CREDENTIAL_VERIFICATION_UNAVAILABLE',
} as const;

export const MFA_ERROR_CODES = {
  CHALLENGE_UNAVAILABLE: 'MFA_CHALLENGE_UNAVAILABLE',
  DISABLE_ROUTE_REQUIRED: 'MFA_DISABLE_ROUTE_REQUIRED',
  STATE_UPDATE_FAILED: 'MFA_STATE_UPDATE_FAILED',
} as const;

export const CREDENTIAL_ACTIVITY_LIMIT = 50;

export interface MfaAuditMetadata {
  challengeId?: string | null;
}

export interface MfaAssertionView {
  assertion: string;
  expiresAt: Date;
}

export interface MfaDisablementResult {
  disabled: true;
}

export interface MfaDisablementView
  extends MfaChallengeSafeView,
    Partial<MfaDisablementResult> {}

export interface CredentialStatusView {
  mustChangePassword: boolean;
  reason: string | null;
  markedAt: Date | null;
  mfaEnabled: boolean;
  mfaEmailMasked: string | null;
  passwordUpdatedAt: Date | null;
}

export interface CredentialActivityEvent {
  id: string;
  action: string;
  success: boolean;
  createdAt: Date;
}

export interface CredentialActivityView {
  events: CredentialActivityEvent[];
}

export function maskEmailAddress(value: string | null | undefined): string | null {
  if (!value) return null;
  const at = value.lastIndexOf('@');
  if (at <= 0) return null;
  const local = value.slice(0, at);
  const domain = value.slice(at);
  return `${local.charAt(0)}${'•'.repeat(Math.max(local.length - 1, 1))}${domain}`;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class SecurityService {
  private readonly logger = new Logger(SecurityService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly supabaseAdmin: SupabaseAdminService,
    private readonly passwordPolicy: PasswordPolicyService,
    private readonly credentialState: CredentialStateService,
    private readonly mfaChallenges: MfaChallengeService,
    private readonly mfaAssertions: MfaAssertionService,
  ) {}

  async getCredentialStatus(
    profileId: string,
  ): Promise<CredentialStatusView> {
    const state = await this.requireCredentialState(profileId);
    const passwordUpdatedAt = await this.readLastPasswordChange(profileId);

    return {
      mustChangePassword: state.mustChangePassword,
      reason: state.reason ?? null,
      markedAt: state.markedAt ?? null,
      mfaEnabled: state.mfaEnabled === true,
      mfaEmailMasked: maskEmailAddress(state.mfaEmail ?? null),
      passwordUpdatedAt,
    };
  }

  async getMyActivity(profileId: string): Promise<CredentialActivityView> {
    const events = await this.readActivity(profileId);
    return { events };
  }

  async getMyActivityLog(profileId: string): Promise<CredentialActivityEvent[]> {
    return this.readActivity(profileId);
  }

  private async readActivity(
    profileId: string,
  ): Promise<CredentialActivityEvent[]> {
    return this.prisma.securityLog.findMany({
      where: { profileId },
      orderBy: { createdAt: 'desc' },
      take: CREDENTIAL_ACTIVITY_LIMIT,
      select: { id: true, action: true, success: true, createdAt: true },
    });
  }

  async changeMyPassword(
    profileId: string,
    data: { currentPassword: string; newPassword: string; confirmPassword: string },
  ): Promise<{ changed: true; mustChangePassword: false }> {
    await this.requireCredentialState(profileId);

    const audit = await this.beginSecurityEvent(
      profileId,
      SECURITY_LOG_ACTIONS.PASSWORD_CHANGED,
    );

    await this.verifyCurrentPassword(profileId, data.currentPassword);
    this.assertConfirmation(data.newPassword, data.confirmPassword);
    this.passwordPolicy.assert(data.newPassword);

    await this.assertSupabasePasswordUpdate(profileId, data.newPassword);
    await this.credentialState.resolveForcedChange(profileId);
    await this.completeSecurityEvent(audit.id);

    return { changed: true, mustChangePassword: false };
  }

  async completeRecovery(
    profileId: string,
    data: { newPassword: string; confirmPassword: string },
  ): Promise<{ changed: true; mustChangePassword: false }> {
    await this.requireCredentialState(profileId);

    this.assertConfirmation(data.newPassword, data.confirmPassword);
    this.passwordPolicy.assert(data.newPassword);

    try {
      await this.assertSupabasePasswordUpdate(profileId, data.newPassword);
    } catch (error) {
      await this.recordSecurityEvent(
        profileId,
        SECURITY_LOG_ACTIONS.PASSWORD_CHANGED_VIA_RECOVERY,
        false,
      );
      throw error;
    }

    await this.credentialState.resolveForcedChange(profileId);
    await this.recordSecurityEvent(
      profileId,
      SECURITY_LOG_ACTIONS.PASSWORD_CHANGED_VIA_RECOVERY,
      true,
    );

    return { changed: true, mustChangePassword: false };
  }

  private async requireCredentialState(
    profileId: string,
  ): Promise<CredentialStateView> {
    try {
      const state = await this.credentialState.getRequired(profileId);
      if (!state) throw new CredentialStateUnavailableError('missing');
      return state;
    } catch (error) {
      const kind =
        error instanceof CredentialStateUnavailableError
          ? error.kind
          : 'dependency';
      this.logger.warn(
        `Credential state ${kind} for profile ${profileId}`,
      );
      throw new ServiceUnavailableException({
        success: false,
        error: CREDENTIAL_ERROR_CODES.STATE_UNAVAILABLE,
        message: 'Credential state is unavailable',
      });
    }
  }

  private async verifyCurrentPassword(
    profileId: string,
    currentPassword: string,
  ): Promise<void> {
    const { data, error } =
      await this.supabaseAdmin.client.auth.admin.getUserById(profileId);
    const email = data?.user?.email;
    if (error || !email) {
      this.logger.warn(
        `Current-password verification unavailable for profile ${profileId}`,
      );
      throw new ServiceUnavailableException({
        success: false,
        error: CREDENTIAL_ERROR_CODES.VERIFICATION_UNAVAILABLE,
        message: 'Credential verification is unavailable',
      });
    }

    const verification = await this.supabaseAdmin.client.auth.signInWithPassword({
      email,
      password: currentPassword,
    });
    await this.discardVerificationSession();

    if (verification.error || !verification.data?.user) {
      throw new UnauthorizedException({
        success: false,
        error: CREDENTIAL_ERROR_CODES.CURRENT_PASSWORD_INVALID,
        message: 'Current password is incorrect.',
      });
    }
  }

  private async discardVerificationSession(): Promise<void> {
    try {
      await this.supabaseAdmin.client.auth.signOut({ scope: 'local' });
    } catch (error) {
      this.logger.warn(
        `Failed to discard password verification session: ${(error as Error).message}`,
      );
    }
  }

  private async assertSupabasePasswordUpdate(
    profileId: string,
    password: string,
  ): Promise<void> {
    const { error } = await this.supabaseAdmin.client.auth.admin.updateUserById(
      profileId,
      { password },
    );
    if (!error) return;

    this.logger.warn(
      `Password update rejected for profile ${profileId}: ${error.message}`,
    );
    throw new ServiceUnavailableException({
      success: false,
      error: CREDENTIAL_ERROR_CODES.UPDATE_FAILED,
      message: 'Password could not be updated.',
    });
  }

  private assertConfirmation(newPassword: string, confirmPassword: string): void {
    if (newPassword !== confirmPassword) {
      throw new BadRequestException({
        success: false,
        error: CREDENTIAL_ERROR_CODES.CONFIRMATION_MISMATCH,
        message: 'Password confirmation does not match.',
      });
    }
  }

  private async readLastPasswordChange(
    profileId: string,
  ): Promise<Date | null> {
    const last = await this.prisma.securityLog.findFirst({
      where: {
        profileId,
        success: true,
        action: {
          in: [
            SECURITY_LOG_ACTIONS.PASSWORD_CHANGED,
            SECURITY_LOG_ACTIONS.PASSWORD_CHANGED_VIA_RECOVERY,
          ],
        },
      },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });

    return last?.createdAt ?? null;
  }

  private async readTenantId(profileId: string): Promise<string | null> {
    const profile = await this.prisma.profile.findUnique({
      where: { id: profileId },
      select: { pawnshopId: true },
    });
    return profile?.pawnshopId ?? null;
  }

  private async buildAuditData(
    profileId: string,
    action: SecurityLogAction,
    success: boolean,
    metadata?: MfaAuditMetadata,
  ) {
    const pawnshopId = await this.readTenantId(profileId);
    const safeChallengeId = this.safeChallengeId(metadata?.challengeId);
    return {
      profileId,
      actorProfileId: profileId,
      targetProfileId: profileId,
      ...(pawnshopId ? { pawnshopId } : {}),
      action,
      success,
      ...(safeChallengeId ? { metadata: { challengeId: safeChallengeId } } : {}),
    };
  }

  private safeChallengeId(challengeId: string | null | undefined): string | null {
    const value = typeof challengeId === 'string' ? challengeId.trim() : '';
    return UUID_PATTERN.test(value) ? value : null;
  }

  private async beginSecurityEvent(
    profileId: string,
    action: SecurityLogAction,
  ): Promise<{ id: string }> {
    const data = await this.buildAuditData(profileId, action, false);
    return this.prisma.securityLog.create({ data, select: { id: true } });
  }

  private async completeSecurityEvent(id: string): Promise<void> {
    await this.prisma.securityLog.update({
      where: { id },
      data: { success: true },
    });
  }

  private async recordSecurityEvent(
    profileId: string,
    action: SecurityLogAction,
    success: boolean,
    metadata?: MfaAuditMetadata,
  ): Promise<void> {
    try {
      const data = await this.buildAuditData(profileId, action, success, metadata);
      await this.prisma.securityLog.create({ data });
    } catch (error) {
      this.logger.error(
        `Failed to write security log: action=${action} profileId=${profileId}`,
        (error as Error).stack,
      );
    }
  }

  async startMfaEnrollment(
    profileId: string,
    sessionId: string | null,
    data: { currentPassword: string },
  ): Promise<MfaChallengeSafeView> {
    throw new Error('SecurityService.startMfaEnrollment is not implemented');
  }

  async verifyMfaChallenge(
    profileId: string,
    sessionId: string,
    data: { challengeId: string; code: string },
  ): Promise<MfaAssertionView> {
    throw new Error('SecurityService.verifyMfaChallenge is not implemented');
  }

  async startMfaLoginChallenge(email: string): Promise<MfaChallengeSafeView> {
    throw new Error('SecurityService.startMfaLoginChallenge is not implemented');
  }

  async disableMfa(
    profileId: string,
    sessionId: string | null,
    data: { currentPassword: string; challengeId?: string; code?: string },
  ): Promise<MfaDisablementView> {
    throw new Error('SecurityService.disableMfa is not implemented');
  }
}
