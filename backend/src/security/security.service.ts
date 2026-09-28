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
  ADMIN_PASSWORD_RESET: 'ADMIN_PASSWORD_RESET',
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

export type MfaDisablementView = MfaChallengeSafeView | MfaDisablementResult;

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

export const CREDENTIAL_AUDIT_METADATA_KEYS = [
  'challengeId',
  'targetRole',
  'failureStage',
] as const;

export type CredentialAuditMetadataKey =
  (typeof CREDENTIAL_AUDIT_METADATA_KEYS)[number];

export function sanitizeCredentialAuditMetadata(
  metadata?: Record<string, unknown> | null,
): Record<string, string> | undefined {
  if (!metadata) return undefined;

  const safe: Record<string, string> = {};
  for (const key of CREDENTIAL_AUDIT_METADATA_KEYS) {
    const value = metadata[key];
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (!trimmed) continue;
    if (key === 'challengeId' && !UUID_PATTERN.test(trimmed)) continue;
    safe[key] = trimmed;
  }

  return Object.keys(safe).length > 0 ? safe : undefined;
}

export interface CredentialAuditEnvelopeInput {
  profileId: string;
  actorProfileId: string;
  targetProfileId: string;
  pawnshopId?: string | null;
  action: SecurityLogAction;
  success: boolean;
  metadata?: Record<string, unknown> | null;
}

export function buildCredentialAuditEnvelope(input: CredentialAuditEnvelopeInput) {
  const metadata = sanitizeCredentialAuditMetadata(input.metadata);

  return {
    profileId: input.profileId,
    actorProfileId: input.actorProfileId,
    targetProfileId: input.targetProfileId,
    ...(input.pawnshopId ? { pawnshopId: input.pawnshopId } : {}),
    action: input.action,
    success: input.success,
    ...(metadata ? { metadata } : {}),
  };
}

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
    await this.completeSecurityEvent(audit);

    return { changed: true, mustChangePassword: false };
  }

  async completeRecovery(
    profileId: string,
    data: { newPassword: string; confirmPassword: string },
  ): Promise<{ changed: true; mustChangePassword: false }> {
    await this.requireCredentialState(profileId);

    this.assertConfirmation(data.newPassword, data.confirmPassword);
    this.passwordPolicy.assert(data.newPassword);

    const audit = await this.beginSecurityEvent(
      profileId,
      SECURITY_LOG_ACTIONS.PASSWORD_CHANGED_VIA_RECOVERY,
    );

    await this.assertSupabasePasswordUpdate(profileId, data.newPassword);
    await this.credentialState.resolveForcedChange(profileId);
    await this.completeSecurityEvent(audit);

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
  ): Promise<string> {
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

    return email;
  }

  private async discardVerificationSession(): Promise<void> {
    try {
      await this.supabaseAdmin.client.auth.signOut({ scope: 'local' });
    } catch (error) {
      this.logger.warn('Failed to discard the password verification session');
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
      `Password update rejected for profile ${profileId} (status ${
        (error as { status?: number }).status ?? 'unknown'
      })`,
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
    return buildCredentialAuditEnvelope({
      profileId,
      actorProfileId: profileId,
      targetProfileId: profileId,
      pawnshopId,
      action,
      success,
      metadata: metadata ? { ...metadata } : undefined,
    });
  }

  private async beginSecurityEvent(
    profileId: string,
    action: SecurityLogAction,
  ): Promise<string | null> {
    try {
      const data = await this.buildAuditData(profileId, action, false);
      const row = await this.prisma.securityLog.create({ data, select: { id: true } });
      return row?.id ?? null;
    } catch (error) {
      this.logger.error(
        `Failed to open credential audit: action=${action} profileId=${profileId}`,
      );
      return null;
    }
  }

  private async completeSecurityEvent(id: string | null): Promise<void> {
    if (!id) return;
    try {
      await this.prisma.securityLog.update({
        where: { id },
        data: { success: true },
      });
    } catch (error) {
      this.logger.error(`Failed to close credential audit: id=${id}`);
    }
  }

  private async recordSecurityEvent(
    profileId: string,
    action: SecurityLogAction,
    success: boolean,
    metadata?: MfaAuditMetadata,
  ): Promise<void> {
    try {
      const data = await this.buildAuditData(profileId, action, success, {
        ...metadata,
      });
      await this.prisma.securityLog.create({ data });
    } catch (error) {
      this.logger.error(
        `Failed to write security log: action=${action} profileId=${profileId}`,
      );
    }
  }

  async startMfaEnrollment(
    profileId: string,
    sessionId: string | null,
    data: { currentPassword: string },
  ): Promise<MfaChallengeSafeView> {
    const state = await this.requireCredentialState(profileId);
    const authEmail = await this.reauthenticateForMfa(
      profileId,
      data?.currentPassword,
    );
    const destination = state.mfaEmail?.trim() || authEmail;
    const view = await this.mfaChallenges.issue({
      profileId,
      email: destination,
      purpose: MFA_CHALLENGE_PURPOSES.ENABLE,
      sessionId: sessionId ?? null,
    });
    await this.recordSecurityEvent(
      profileId,
      SECURITY_LOG_ACTIONS.MFA_ENROLLMENT_STARTED,
      true,
      { challengeId: view.challengeId },
    );
    return view;
  }

  async verifyMfaChallenge(
    profileId: string,
    sessionId: string,
    data: { challengeId: string; code: string },
  ): Promise<MfaAssertionView> {
    const state = await this.requireCredentialState(profileId);
    const challengeId = String(data?.challengeId ?? '').trim();
    const code = String(data?.code ?? '').trim();

    const purpose = await this.mfaChallenges.resolvePurpose(profileId, challengeId);

    if (purpose === MFA_CHALLENGE_PURPOSES.DISABLE) {
      await this.recordSecurityEvent(
        profileId,
        SECURITY_LOG_ACTIONS.MFA_VERIFICATION_FAILED,
        false,
        { challengeId },
      );
      throw new BadRequestException({
        success: false,
        error: MFA_ERROR_CODES.DISABLE_ROUTE_REQUIRED,
        message: 'Email MFA must be turned off through the disable route.',
      });
    }

    if (!purpose || !isKnownMfaChallengePurpose(purpose)) {
      await this.recordSecurityEvent(
        profileId,
        SECURITY_LOG_ACTIONS.MFA_VERIFICATION_FAILED,
        false,
        { challengeId },
      );
      throw this.invalidChallenge();
    }

    try {
      await this.mfaChallenges.verify({ profileId, challengeId, code, purpose });
    } catch (error) {
      await this.recordSecurityEvent(
        profileId,
        this.challengeFailureAction(error),
        false,
        { challengeId },
      );
      throw error;
    }

    if (purpose === MFA_CHALLENGE_PURPOSES.ENABLE) {
      await this.commitMfaEnrollment(profileId, state, challengeId);
      await this.recordSecurityEvent(
        profileId,
        SECURITY_LOG_ACTIONS.MFA_ENABLED,
        true,
        { challengeId },
      );
    } else {
      await this.recordSecurityEvent(
        profileId,
        SECURITY_LOG_ACTIONS.MFA_LOGIN_VERIFIED,
        true,
        { challengeId },
      );
    }

    const issued = await this.mfaAssertions.issue(profileId, sessionId);
    return { assertion: issued.assertion, expiresAt: issued.expiresAt };
  }

  async startMfaLoginChallenge(email: string): Promise<MfaChallengeSafeView> {
    const normalized = String(email ?? '').trim().toLowerCase();
    if (!normalized) {
      throw new BadRequestException({
        success: false,
        error: MFA_ERROR_CODES.CHALLENGE_UNAVAILABLE,
        message: 'A valid email address is required',
      });
    }

    let account: {
      id: string;
      email: string | null;
      credentialState: { mfaEnabled: boolean; mfaEmail: string | null } | null;
    } | null = null;
    try {
      account = await this.prisma.profile.findFirst({
        where: { email: { equals: normalized, mode: 'insensitive' } },
        select: {
          id: true,
          email: true,
          credentialState: { select: { mfaEnabled: true, mfaEmail: true } },
        },
      });
    } catch (error) {
      this.logger.warn('MFA login challenge lookup unavailable');
      throw new ServiceUnavailableException({
        success: false,
        error: MFA_ERROR_CODES.CHALLENGE_UNAVAILABLE,
        message: 'Email verification is unavailable',
      });
    }

    const state = account?.credentialState;
    if (!account || state?.mfaEnabled !== true) {
      return this.mfaChallenges.buildUndeliveredView(normalized);
    }

    return this.mfaChallenges.issue({
      profileId: account.id,
      email: state.mfaEmail?.trim() || account.email?.trim() || normalized,
      purpose: MFA_CHALLENGE_PURPOSES.LOGIN,
      sessionId: null,
    });
  }

  async disableMfa(
    profileId: string,
    sessionId: string | null,
    data: { currentPassword: string; challengeId?: string; code?: string },
  ): Promise<MfaDisablementView> {
    const challengeId = String(data?.challengeId ?? '').trim();
    const code = String(data?.code ?? '').trim();

    if (Boolean(challengeId) !== Boolean(code)) {
      throw new BadRequestException({
        success: false,
        error: MFA_CHALLENGE_ERROR_CODES.INVALID,
        message: 'A challenge id and code must be supplied together',
      });
    }

    const state = await this.requireCredentialState(profileId);
    const authEmail = await this.reauthenticateForMfa(
      profileId,
      data?.currentPassword,
      challengeId || null,
    );

    if (!challengeId) {
      return this.mfaChallenges.issue({
        profileId,
        email: state.mfaEmail?.trim() || authEmail,
        purpose: MFA_CHALLENGE_PURPOSES.DISABLE,
        sessionId: sessionId ?? null,
      });
    }

    try {
      await this.mfaChallenges.verify({
        profileId,
        challengeId,
        code,
        purpose: MFA_CHALLENGE_PURPOSES.DISABLE,
      });
    } catch (error) {
      await this.recordSecurityEvent(
        profileId,
        this.challengeFailureAction(error),
        false,
        { challengeId },
      );
      throw error;
    }

    try {
      await this.credentialState.disableMfa(profileId);
    } catch (error) {
      this.logger.warn(
        `MFA disable state update failed for profile ${profileId}`,
      );
      await this.recordSecurityEvent(
        profileId,
        SECURITY_LOG_ACTIONS.MFA_DISABLED,
        false,
        { challengeId },
      );
      throw new ServiceUnavailableException({
        success: false,
        error: MFA_ERROR_CODES.STATE_UPDATE_FAILED,
        message: 'Email verification could not be turned off.',
      });
    }

    await this.recordSecurityEvent(
      profileId,
      SECURITY_LOG_ACTIONS.MFA_DISABLED,
      true,
      { challengeId },
    );
    return { disabled: true };
  }

  private async commitMfaEnrollment(
    profileId: string,
    state: CredentialStateView,
    challengeId: string,
  ): Promise<void> {
    const destination = await this.resolveEnrollmentEmail(profileId, state);
    try {
      await this.credentialState.enableMfa(profileId, destination);
    } catch (error) {
      this.logger.warn(`MFA enable state update failed for profile ${profileId}`);
      await this.recordSecurityEvent(
        profileId,
        SECURITY_LOG_ACTIONS.MFA_ENABLED,
        false,
        { challengeId },
      );
      throw new ServiceUnavailableException({
        success: false,
        error: MFA_ERROR_CODES.STATE_UPDATE_FAILED,
        message: 'Email verification could not be enabled.',
      });
    }
  }

  private async resolveEnrollmentEmail(
    profileId: string,
    state: CredentialStateView,
  ): Promise<string> {
    const recorded = state.mfaEmail?.trim();
    if (recorded) return recorded;

    const { data, error } =
      await this.supabaseAdmin.client.auth.admin.getUserById(profileId);
    const email = data?.user?.email?.trim();
    if (error || !email) {
      this.logger.warn(`MFA destination unavailable for profile ${profileId}`);
      throw new ServiceUnavailableException({
        success: false,
        error: MFA_ERROR_CODES.CHALLENGE_UNAVAILABLE,
        message: 'A verification destination is unavailable',
      });
    }
    return email;
  }

  private async reauthenticateForMfa(
    profileId: string,
    currentPassword: string,
    challengeId: string | null = null,
  ): Promise<string> {
    try {
      return await this.verifyCurrentPassword(profileId, currentPassword);
    } catch (error) {
      await this.recordSecurityEvent(
        profileId,
        SECURITY_LOG_ACTIONS.MFA_VERIFICATION_FAILED,
        false,
        { challengeId },
      );
      throw error;
    }
  }

  private challengeFailureAction(error: unknown): SecurityLogAction {
    const code = (error as { response?: { error?: string } })?.response?.error;
    return code === MFA_CHALLENGE_ERROR_CODES.LOCKED
      ? SECURITY_LOG_ACTIONS.MFA_LOCKED
      : SECURITY_LOG_ACTIONS.MFA_VERIFICATION_FAILED;
  }

  private invalidChallenge(): BadRequestException {
    return new BadRequestException({
      success: false,
      error: MFA_CHALLENGE_ERROR_CODES.INVALID,
      message: 'The verification challenge is invalid or no longer available',
    });
  }
}
