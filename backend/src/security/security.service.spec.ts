import {
  BadRequestException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { CredentialStateService } from './credential-state.service';
import { PasswordPolicyService } from './password-policy.service';
import {
  CREDENTIAL_ACTIVITY_LIMIT,
  CREDENTIAL_ERROR_CODES,
  MFA_ERROR_CODES,
  SECURITY_LOG_ACTIONS,
  SecurityService,
  maskEmailAddress,
} from './security.service';
import { MfaAssertionService } from './mfa-assertion.service';
import {
  MFA_CHALLENGE_PURPOSES,
  MfaChallengeService,
} from './mfa-challenge.service';

const VALID_PASSWORD = 'Str0ng!Passw0rd';
const CURRENT_PASSWORD = 'Legacy!Passw0rd';
const CHALLENGE_ID = '11111111-2222-4333-8444-555555555555';
const CHALLENGE_EXPIRY = new Date('2026-09-10T08:10:00.000Z');
const ASSERTION_EXPIRY = new Date('2026-09-10T08:15:00.000Z');
const ASSERTION_VALUE = 'issued-assertion-value';

const STATE = {
  id: 'state-1',
  profileId: 'profile-1',
  mustChangePassword: true,
  reason: 'ADMINISTRATIVE_PROVISIONING',
  mfaEnabled: true,
  mfaEmail: 'juan.delacruz@example.com',
  markedAt: new Date('2026-09-01T00:00:00.000Z'),
  resolvedAt: null,
  createdAt: new Date('2026-09-01T00:00:00.000Z'),
  updatedAt: new Date('2026-09-01T00:00:00.000Z'),
};

const MFA_OFF_STATE = { ...STATE, mustChangePassword: false, mfaEnabled: false, mfaEmail: null };

describe('SecurityService', () => {
  let order: string[];
  let credentialState: {
    findUnique: jest.Mock;
    update: jest.Mock;
    getRequired: jest.Mock;
  };
  let prisma: any;
  let supabaseClient: any;
  let supabaseAdmin: any;
  let mfaChallenges: {
    issue: jest.Mock;
    verify: jest.Mock;
    resolvePurpose: jest.Mock;
    buildUndeliveredView: jest.Mock;
  };
  let mfaAssertions: { issue: jest.Mock; validate: jest.Mock };
  let service: SecurityService;

  const pushAuditCreate = (action: string, success: boolean) =>
    order.push(`audit-create:${action}:${success}`);

  beforeEach(() => {
    order = [];
    credentialState = {
      findUnique: jest.fn(),
      getRequired: jest.fn(),
      update: jest.fn((args: any) => {
        if (typeof args?.data?.mfaEnabled === 'boolean') {
          order.push(args.data.mfaEnabled ? 'state:enableMfa' : 'state:disableMfa');
          return Promise.resolve({
            ...STATE,
            mfaEnabled: args.data.mfaEnabled,
            mfaEmail: args.data.mfaEmail ?? null,
          });
        }
        return Promise.resolve({
          ...STATE,
          mustChangePassword: false,
          resolvedAt: new Date(),
        });
      }),
    };
    prisma = {
      credentialState,
      securityLog: {
        create: jest.fn((args: any) => {
          pushAuditCreate(args.data.action, args.data.success);
          return Promise.resolve({ id: 'audit-1' });
        }),
        update: jest.fn((args: any) => {
          order.push(`audit-update:${args.data.success}`);
          return Promise.resolve({ id: args.where.id });
        }),
        findMany: jest.fn(),
        findFirst: jest.fn(),
      },
      profile: {
        findUnique: jest.fn(() =>
          Promise.resolve({ pawnshopId: 'tenant-1' }),
        ),
        findFirst: jest.fn(),
      },
    };
    supabaseClient = {
      auth: {
        admin: {
          getUserById: jest.fn(() => {
            order.push('supabase:getUserById');
            return Promise.resolve({
              data: { user: { id: 'profile-1', email: 'juan@example.com' } },
              error: null,
            });
          }),
          updateUserById: jest.fn(() => {
            order.push('supabase:updateUserById');
            return Promise.resolve({ data: {}, error: null });
          }),
        },
        signInWithPassword: jest.fn(() => {
          order.push('supabase:signInWithPassword');
          return Promise.resolve({
            data: { user: { id: 'profile-1' }, session: { access_token: 'verification-token' } },
            error: null,
          });
        }),
        signOut: jest.fn(() => {
          order.push('supabase:signOut');
          return Promise.resolve({ error: null });
        }),
      },
    };
    supabaseAdmin = { client: supabaseClient };
    mfaChallenges = {
      issue: jest.fn((input: any) => {
        order.push(`challenge:issue:${input.purpose}`);
        return Promise.resolve({
          challengeId: CHALLENGE_ID,
          expiresAt: CHALLENGE_EXPIRY,
          maskedEmail: 'ju••••@example.com',
        });
      }),
      verify: jest.fn((input: any) => {
        order.push(`challenge:verify:${input.purpose}`);
        return Promise.resolve({ challengeId: input.challengeId });
      }),
      resolvePurpose: jest.fn(() =>
        Promise.resolve(MFA_CHALLENGE_PURPOSES.ENABLE),
      ),
      buildUndeliveredView: jest.fn(() => ({
        challengeId: '99999999-8888-4777-8666-555555555555',
        expiresAt: CHALLENGE_EXPIRY,
        maskedEmail: 'un••••@example.com',
      })),
    };
    mfaAssertions = {
      issue: jest.fn(() => {
        order.push('assertion:issue');
        return Promise.resolve({
          assertion: ASSERTION_VALUE,
          expiresAt: ASSERTION_EXPIRY,
        });
      }),
      validate: jest.fn(),
    };

    service = new SecurityService(
      prisma,
      supabaseAdmin,
      new PasswordPolicyService(),
      new CredentialStateService(prisma),
      mfaChallenges as unknown as MfaChallengeService,
      mfaAssertions as unknown as MfaAssertionService,
    );
  });

  describe('maskEmailAddress', () => {
    it('masks the local part and keeps the domain', () => {
      const masked = maskEmailAddress('juan.delacruz@example.com');
      expect(masked).toBeTruthy();
      expect(masked).not.toContain('juan.delacruz');
      expect(masked?.endsWith('@example.com')).toBe(true);
    });

    it('returns null for absent or unusable addresses', () => {
      expect(maskEmailAddress(null)).toBeNull();
      expect(maskEmailAddress('')).toBeNull();
      expect(maskEmailAddress('nodomain')).toBeNull();
    });
  });

  describe('getCredentialStatus', () => {
    beforeEach(() => {
      credentialState.findUnique.mockResolvedValue(STATE);
      prisma.securityLog.findFirst.mockResolvedValue({
        createdAt: new Date('2026-09-10T08:00:00.000Z'),
      });
    });

    it('returns only the safe own-profile projection', async () => {
      const status = await service.getCredentialStatus('profile-1');

      expect(Object.keys(status).sort()).toEqual(
        [
          'markedAt',
          'mfaEnabled',
          'mfaEmailMasked',
          'mustChangePassword',
          'passwordUpdatedAt',
          'reason',
        ].sort(),
      );
      expect(status).toEqual({
        mustChangePassword: true,
        reason: 'ADMINISTRATIVE_PROVISIONING',
        markedAt: STATE.markedAt,
        mfaEnabled: true,
        mfaEmailMasked: expect.any(String),
        passwordUpdatedAt: new Date('2026-09-10T08:00:00.000Z'),
      });
      expect(JSON.stringify(status)).not.toContain('juan.delacruz');
      expect(JSON.stringify(status)).not.toContain('profile-1');
    });

    it('scopes the state lookup to the authenticated profile', async () => {
      await service.getCredentialStatus('profile-1');
      expect(credentialState.findUnique).toHaveBeenCalledWith({
        where: { profileId: 'profile-1' },
      });
    });

    it('returns a null password timestamp when no successful change is audited', async () => {
      prisma.securityLog.findFirst.mockResolvedValue(null);
      await expect(service.getCredentialStatus('profile-1')).resolves.toMatchObject({
        passwordUpdatedAt: null,
      });
    });

    it('fails closed with a typed 503 when the state row is missing', async () => {
      credentialState.findUnique.mockResolvedValue(null);
      await expect(service.getCredentialStatus('profile-1')).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
      await expect(service.getCredentialStatus('profile-1')).rejects.toMatchObject({
        response: expect.objectContaining({
          error: CREDENTIAL_ERROR_CODES.STATE_UNAVAILABLE,
        }),
      });
    });

    it('fails closed with the same typed contract on a dependency failure', async () => {
      credentialState.findUnique.mockRejectedValue(new Error('database unavailable'));
      await expect(service.getCredentialStatus('profile-1')).rejects.toMatchObject({
        response: expect.objectContaining({
          error: CREDENTIAL_ERROR_CODES.STATE_UNAVAILABLE,
        }),
      });
    });
  });

  describe('getMyActivity', () => {
    it('reads only the authenticated profile and caps the page at 50', async () => {
      prisma.securityLog.findMany.mockResolvedValue([
        { id: 'log-1', action: SECURITY_LOG_ACTIONS.PASSWORD_CHANGED, success: true, createdAt: new Date() },
      ]);

      const result = await service.getMyActivity('profile-1');

      expect(prisma.securityLog.findMany).toHaveBeenCalledWith({
        where: { profileId: 'profile-1' },
        orderBy: { createdAt: 'desc' },
        take: CREDENTIAL_ACTIVITY_LIMIT,
        select: { id: true, action: true, success: true, createdAt: true },
      });
      expect(CREDENTIAL_ACTIVITY_LIMIT).toBe(50);
      expect(result.events).toHaveLength(1);
    });
  });

  describe('getMyActivityLog', () => {
    it('serves the legacy bare array the existing mobile client still parses', async () => {
      prisma.securityLog.findMany.mockResolvedValue([
        { id: 'log-1', action: SECURITY_LOG_ACTIONS.PASSWORD_CHANGED, success: true, createdAt: new Date() },
      ]);

      const events = await service.getMyActivityLog('profile-1');

      expect(Array.isArray(events)).toBe(true);
      expect(events[0]).toEqual({
        id: 'log-1',
        action: SECURITY_LOG_ACTIONS.PASSWORD_CHANGED,
        success: true,
        createdAt: expect.any(Date),
      });
      expect(prisma.securityLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { profileId: 'profile-1' } }),
      );
    });
  });

  describe('changeMyPassword', () => {
    beforeEach(() => {
      credentialState.findUnique.mockResolvedValue(STATE);
      credentialState.update.mockImplementation(() => {
        order.push('state:resolve');
        return Promise.resolve({ ...STATE, mustChangePassword: false, resolvedAt: new Date() });
      });
    });

    it('audits the attempt first, verifies, updates, resolves state, then marks success', async () => {
      const result = await service.changeMyPassword('profile-1', {
        currentPassword: CURRENT_PASSWORD,
        newPassword: VALID_PASSWORD,
        confirmPassword: VALID_PASSWORD,
      });

      expect(order).toEqual([
        `audit-create:${SECURITY_LOG_ACTIONS.PASSWORD_CHANGED}:false`,
        'supabase:getUserById',
        'supabase:signInWithPassword',
        'supabase:signOut',
        'supabase:updateUserById',
        'state:resolve',
        'audit-update:true',
      ]);
      expect(result).toEqual({ changed: true, mustChangePassword: false });
    });

    it('writes the audit row with actor, target and tenant but no secret values', async () => {
      await service.changeMyPassword('profile-1', {
        currentPassword: CURRENT_PASSWORD,
        newPassword: VALID_PASSWORD,
        confirmPassword: VALID_PASSWORD,
      });

      const [args] = prisma.securityLog.create.mock.calls[0];
      expect(args.data).toEqual({
        profileId: 'profile-1',
        actorProfileId: 'profile-1',
        targetProfileId: 'profile-1',
        pawnshopId: 'tenant-1',
        action: SECURITY_LOG_ACTIONS.PASSWORD_CHANGED,
        success: false,
      });
      expect(JSON.stringify(args.data)).not.toContain(VALID_PASSWORD);
      expect(JSON.stringify(args.data)).not.toContain(CURRENT_PASSWORD);
    });

    it('omits the tenant column when the profile has no pawnshop', async () => {
      prisma.profile.findUnique.mockResolvedValue({ pawnshopId: null });
      await service.changeMyPassword('profile-1', {
        currentPassword: CURRENT_PASSWORD,
        newPassword: VALID_PASSWORD,
        confirmPassword: VALID_PASSWORD,
      });
      const [args] = prisma.securityLog.create.mock.calls[0];
      expect(args.data).not.toHaveProperty('pawnshopId');
    });

    it('rejects a wrong current password with no Supabase write', async () => {
      supabaseClient.auth.signInWithPassword.mockResolvedValue({
        data: { user: null, session: null },
        error: { message: 'Invalid login credentials' },
      });

      await expect(
        service.changeMyPassword('profile-1', {
          currentPassword: 'wrong-password',
          newPassword: VALID_PASSWORD,
          confirmPassword: VALID_PASSWORD,
        }),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      expect(supabaseClient.auth.admin.updateUserById).not.toHaveBeenCalled();
      expect(credentialState.update).not.toHaveBeenCalled();
      expect(prisma.securityLog.update).not.toHaveBeenCalled();
    });

    it('never returns the Supabase failure text for a rejected current password', async () => {
      supabaseClient.auth.signInWithPassword.mockResolvedValue({
        data: { user: null, session: null },
        error: { message: 'Invalid login credentials for juan@example.com' },
      });

      await expect(
        service.changeMyPassword('profile-1', {
          currentPassword: 'wrong-password',
          newPassword: VALID_PASSWORD,
          confirmPassword: VALID_PASSWORD,
        }),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          error: CREDENTIAL_ERROR_CODES.CURRENT_PASSWORD_INVALID,
        }),
      });
    });

    it('discards the verification session even when verification fails', async () => {
      supabaseClient.auth.signInWithPassword.mockResolvedValue({
        data: { user: null, session: null },
        error: { message: 'Invalid login credentials' },
      });

      await expect(
        service.changeMyPassword('profile-1', {
          currentPassword: 'wrong-password',
          newPassword: VALID_PASSWORD,
          confirmPassword: VALID_PASSWORD,
        }),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      expect(supabaseClient.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
      expect(order).toContain('supabase:signOut');
    });

    it('enforces the shared policy with rule keys and no Supabase write', async () => {
      await expect(
        service.changeMyPassword('profile-1', {
          currentPassword: CURRENT_PASSWORD,
          newPassword: 'weak',
          confirmPassword: 'weak',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(supabaseClient.auth.admin.updateUserById).not.toHaveBeenCalled();
      expect(credentialState.update).not.toHaveBeenCalled();
    });

    it('rejects a confirmation mismatch before any Supabase write', async () => {
      await expect(
        service.changeMyPassword('profile-1', {
          currentPassword: CURRENT_PASSWORD,
          newPassword: VALID_PASSWORD,
          confirmPassword: 'Different!Passw0rd',
        }),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          error: CREDENTIAL_ERROR_CODES.CONFIRMATION_MISMATCH,
        }),
      });

      expect(supabaseClient.auth.admin.updateUserById).not.toHaveBeenCalled();
      expect(prisma.securityLog.update).not.toHaveBeenCalled();
    });

    it('retains failure evidence and keeps forced state when Supabase rejects the update', async () => {
      supabaseClient.auth.admin.updateUserById.mockResolvedValue({
        data: null,
        error: { message: 'Password should be at least 6 characters' },
      });

      await expect(
        service.changeMyPassword('profile-1', {
          currentPassword: CURRENT_PASSWORD,
          newPassword: VALID_PASSWORD,
          confirmPassword: VALID_PASSWORD,
        }),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);

      expect(credentialState.update).not.toHaveBeenCalled();
      expect(prisma.securityLog.update).not.toHaveBeenCalled();
      const [args] = prisma.securityLog.create.mock.calls[0];
      expect(args.data.success).toBe(false);
    });

    it('fails closed before any audit when the state row is missing', async () => {
      credentialState.findUnique.mockResolvedValue(null);

      await expect(
        service.changeMyPassword('profile-1', {
          currentPassword: CURRENT_PASSWORD,
          newPassword: VALID_PASSWORD,
          confirmPassword: VALID_PASSWORD,
        }),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          error: CREDENTIAL_ERROR_CODES.STATE_UNAVAILABLE,
        }),
      });

      expect(prisma.securityLog.create).not.toHaveBeenCalled();
      expect(supabaseClient.auth.signInWithPassword).not.toHaveBeenCalled();
    });

    it('clears the forced flag in the credential state after success', async () => {
      await service.changeMyPassword('profile-1', {
        currentPassword: CURRENT_PASSWORD,
        newPassword: VALID_PASSWORD,
        confirmPassword: VALID_PASSWORD,
      });

      expect(credentialState.update).toHaveBeenCalledWith({
        where: { profileId: 'profile-1' },
        data: { mustChangePassword: false, resolvedAt: expect.any(Date) },
      });
    });
  });

  describe('completeRecovery', () => {
    beforeEach(() => {
      credentialState.findUnique.mockResolvedValue(STATE);
      credentialState.update.mockImplementation(() => {
        order.push('state:resolve');
        return Promise.resolve({ ...STATE, mustChangePassword: false, resolvedAt: new Date() });
      });
    });

    it('updates Supabase, clears state, then records the recovery audit as one boundary', async () => {
      const result = await service.completeRecovery('profile-1', {
        newPassword: VALID_PASSWORD,
        confirmPassword: VALID_PASSWORD,
      });

      expect(order).toEqual([
        'supabase:updateUserById',
        'state:resolve',
        `audit-create:${SECURITY_LOG_ACTIONS.PASSWORD_CHANGED_VIA_RECOVERY}:true`,
      ]);
      expect(result).toEqual({ changed: true, mustChangePassword: false });
    });

    it('never requires or replays the current password on the recovery path', async () => {
      await service.completeRecovery('profile-1', {
        newPassword: VALID_PASSWORD,
        confirmPassword: VALID_PASSWORD,
      });

      expect(supabaseClient.auth.signInWithPassword).not.toHaveBeenCalled();
    });

    it('does not clear state when the Supabase update fails', async () => {
      supabaseClient.auth.admin.updateUserById.mockResolvedValue({
        data: null,
        error: { message: 'Auth rate limit exceeded' },
      });

      await expect(
        service.completeRecovery('profile-1', {
          newPassword: VALID_PASSWORD,
          confirmPassword: VALID_PASSWORD,
        }),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);

      expect(credentialState.update).not.toHaveBeenCalled();
      const [args] = prisma.securityLog.create.mock.calls[0];
      expect(args.data).toEqual(
        expect.objectContaining({
          action: SECURITY_LOG_ACTIONS.PASSWORD_CHANGED_VIA_RECOVERY,
          success: false,
        }),
      );
    });

    it('refuses to clear state when no credential state row exists', async () => {
      credentialState.findUnique.mockResolvedValue(null);

      await expect(
        service.completeRecovery('profile-1', {
          newPassword: VALID_PASSWORD,
          confirmPassword: VALID_PASSWORD,
        }),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          error: CREDENTIAL_ERROR_CODES.STATE_UNAVAILABLE,
        }),
      });

      expect(supabaseClient.auth.admin.updateUserById).not.toHaveBeenCalled();
      expect(credentialState.update).not.toHaveBeenCalled();
    });

    it('enforces the shared policy and confirmation on the recovery path', async () => {
      await expect(
        service.completeRecovery('profile-1', {
          newPassword: 'weak',
          confirmPassword: 'weak',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      await expect(
        service.completeRecovery('profile-1', {
          newPassword: VALID_PASSWORD,
          confirmPassword: 'Different!Passw0rd',
        }),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          error: CREDENTIAL_ERROR_CODES.CONFIRMATION_MISMATCH,
        }),
      });

      expect(supabaseClient.auth.admin.updateUserById).not.toHaveBeenCalled();
    });
  });

  describe('startMfaEnrollment', () => {
    beforeEach(() => {
      credentialState.findUnique.mockResolvedValue(MFA_OFF_STATE);
    });

    it('reauthenticates before it sends a code and then issues an enrollment challenge', async () => {
      const view = await service.startMfaEnrollment('profile-1', 'session-1', {
        currentPassword: CURRENT_PASSWORD,
      });

      expect(order).toEqual([
        'supabase:getUserById',
        'supabase:signInWithPassword',
        'supabase:signOut',
        `challenge:issue:${MFA_CHALLENGE_PURPOSES.ENABLE}`,
        `audit-create:${SECURITY_LOG_ACTIONS.MFA_ENROLLMENT_STARTED}:true`,
      ]);
      expect(view).toEqual({
        challengeId: CHALLENGE_ID,
        expiresAt: CHALLENGE_EXPIRY,
        maskedEmail: 'ju••••@example.com',
      });
    });

    it('binds the challenge to the profile, the enrollment purpose and the current session', async () => {
      await service.startMfaEnrollment('profile-1', 'session-1', {
        currentPassword: CURRENT_PASSWORD,
      });

      expect(mfaChallenges.issue).toHaveBeenCalledWith({
        profileId: 'profile-1',
        email: 'juan@example.com',
        purpose: MFA_CHALLENGE_PURPOSES.ENABLE,
        sessionId: 'session-1',
      });
    });

    it('prefers an already recorded MFA destination over the auth address', async () => {
      credentialState.findUnique.mockResolvedValue({
        ...MFA_OFF_STATE,
        mfaEmail: 'recorded@example.com',
      });

      await service.startMfaEnrollment('profile-1', 'session-1', {
        currentPassword: CURRENT_PASSWORD,
      });

      expect(mfaChallenges.issue).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'recorded@example.com' }),
      );
    });

    it('never enables MFA while only issuing the challenge', async () => {
      await service.startMfaEnrollment('profile-1', 'session-1', {
        currentPassword: CURRENT_PASSWORD,
      });

      expect(credentialState.update).not.toHaveBeenCalled();
    });

    it('rejects a wrong current password without issuing a challenge', async () => {
      supabaseClient.auth.signInWithPassword.mockResolvedValue({
        data: { user: null, session: null },
        error: { message: 'Invalid login credentials' },
      });

      await expect(
        service.startMfaEnrollment('profile-1', 'session-1', {
          currentPassword: 'wrong-password',
        }),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          error: CREDENTIAL_ERROR_CODES.CURRENT_PASSWORD_INVALID,
        }),
      });

      expect(mfaChallenges.issue).not.toHaveBeenCalled();
      expect(credentialState.update).not.toHaveBeenCalled();
    });

    it('fails closed before any reauthentication when the state row is unavailable', async () => {
      credentialState.findUnique.mockResolvedValue(null);

      await expect(
        service.startMfaEnrollment('profile-1', 'session-1', {
          currentPassword: CURRENT_PASSWORD,
        }),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          error: CREDENTIAL_ERROR_CODES.STATE_UNAVAILABLE,
        }),
      });

      expect(supabaseClient.auth.signInWithPassword).not.toHaveBeenCalled();
      expect(mfaChallenges.issue).not.toHaveBeenCalled();
    });

    it('returns no code, hash, or full destination', async () => {
      const view = await service.startMfaEnrollment('profile-1', 'session-1', {
        currentPassword: CURRENT_PASSWORD,
      });

      expect(Object.keys(view).sort()).toEqual([
        'challengeId',
        'expiresAt',
        'maskedEmail',
      ]);
      expect(JSON.stringify(view)).not.toContain('juan@example.com');
      expect(JSON.stringify(view)).not.toMatch(/\b\d{6}\b/);
    });
  });

  describe('startMfaLoginChallenge', () => {
    const loginProfile = {
      id: 'profile-1',
      email: 'juan@example.com',
      credentialState: { mfaEnabled: true, mfaEmail: 'juan@example.com' },
    };

    it('issues a login-purpose challenge for an MFA-enabled account', async () => {
      prisma.profile.findFirst.mockResolvedValue(loginProfile);

      const view = await service.startMfaLoginChallenge('  Juan@Example.com ');

      expect(prisma.profile.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            email: { equals: 'juan@example.com', mode: 'insensitive' },
          },
        }),
      );
      expect(mfaChallenges.issue).toHaveBeenCalledWith({
        profileId: 'profile-1',
        email: 'juan@example.com',
        purpose: MFA_CHALLENGE_PURPOSES.LOGIN,
        sessionId: null,
      });
      expect(Object.keys(view).sort()).toEqual([
        'challengeId',
        'expiresAt',
        'maskedEmail',
      ]);
    });

    it('returns the identical safe shape without issuing anything for an unknown address', async () => {
      prisma.profile.findFirst.mockResolvedValue(null);

      const view = await service.startMfaLoginChallenge('nobody@example.com');

      expect(mfaChallenges.issue).not.toHaveBeenCalled();
      expect(mfaChallenges.buildUndeliveredView).toHaveBeenCalledWith(
        'nobody@example.com',
      );
      expect(Object.keys(view).sort()).toEqual([
        'challengeId',
        'expiresAt',
        'maskedEmail',
      ]);
    });

    it('returns the identical safe shape for an account whose MFA is off', async () => {
      prisma.profile.findFirst.mockResolvedValue({
        ...loginProfile,
        credentialState: { mfaEnabled: false, mfaEmail: null },
      });

      await service.startMfaLoginChallenge('juan@example.com');

      expect(mfaChallenges.issue).not.toHaveBeenCalled();
      expect(mfaChallenges.buildUndeliveredView).toHaveBeenCalledTimes(1);
    });

    it('fails closed rather than silently skipping MFA when the lookup breaks', async () => {
      prisma.profile.findFirst.mockRejectedValue(
        new Error('database unavailable'),
      );

      await expect(
        service.startMfaLoginChallenge('juan@example.com'),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(mfaChallenges.buildUndeliveredView).not.toHaveBeenCalled();
    });

    it('returns no code and no full destination', async () => {
      prisma.profile.findFirst.mockResolvedValue(loginProfile);

      const view = await service.startMfaLoginChallenge('juan@example.com');

      expect(JSON.stringify(view)).not.toContain('juan@example.com');
      expect(JSON.stringify(view)).not.toMatch(/\b\d{6}\b/);
    });
  });

  describe('verifyMfaChallenge', () => {
    beforeEach(() => {
      credentialState.findUnique.mockResolvedValue(MFA_OFF_STATE);
    });

    it('enables MFA and issues an assertion only after the enrollment challenge verifies', async () => {
      const result = await service.verifyMfaChallenge(
        'profile-1',
        'session-1',
        { challengeId: CHALLENGE_ID, code: '123456' },
      );

      expect(order).toEqual([
        `challenge:verify:${MFA_CHALLENGE_PURPOSES.ENABLE}`,
        'supabase:getUserById',
        'state:enableMfa',
        `audit-create:${SECURITY_LOG_ACTIONS.MFA_ENABLED}:true`,
        'assertion:issue',
      ]);
      expect(result).toEqual({
        assertion: ASSERTION_VALUE,
        expiresAt: ASSERTION_EXPIRY,
      });
    });

    it('scopes the enrollment mutation to the authenticated profile and its destination', async () => {
      await service.verifyMfaChallenge('profile-1', 'session-1', {
        challengeId: CHALLENGE_ID,
        code: '123456',
      });

      expect(credentialState.update).toHaveBeenCalledWith({
        where: { profileId: 'profile-1' },
        data: { mfaEnabled: true, mfaEmail: 'juan@example.com' },
      });
    });

    it('issues an assertion for a login challenge without touching MFA state', async () => {
      mfaChallenges.resolvePurpose.mockResolvedValue(
        MFA_CHALLENGE_PURPOSES.LOGIN,
      );

      const result = await service.verifyMfaChallenge(
        'profile-1',
        'session-1',
        { challengeId: CHALLENGE_ID, code: '123456' },
      );

      expect(credentialState.update).not.toHaveBeenCalled();
      expect(result.assertion).toBe(ASSERTION_VALUE);
    });

    it('refuses to let the generic verify route complete a disablement', async () => {
      mfaChallenges.resolvePurpose.mockResolvedValue(
        MFA_CHALLENGE_PURPOSES.DISABLE,
      );

      await expect(
        service.verifyMfaChallenge('profile-1', 'session-1', {
          challengeId: CHALLENGE_ID,
          code: '123456',
        }),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          error: MFA_ERROR_CODES.DISABLE_ROUTE_REQUIRED,
        }),
      });

      expect(mfaChallenges.verify).not.toHaveBeenCalled();
      expect(credentialState.update).not.toHaveBeenCalled();
      expect(mfaAssertions.issue).not.toHaveBeenCalled();
    });

    it('rejects an unknown challenge id before any state change or assertion', async () => {
      mfaChallenges.resolvePurpose.mockResolvedValue(null);

      await expect(
        service.verifyMfaChallenge('profile-1', 'session-1', {
          challengeId: CHALLENGE_ID,
          code: '123456',
        }),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ error: 'MFA_CHALLENGE_INVALID' }),
      });

      expect(credentialState.update).not.toHaveBeenCalled();
      expect(mfaAssertions.issue).not.toHaveBeenCalled();
    });

    it('never enables MFA when the code check fails', async () => {
      mfaChallenges.verify.mockRejectedValue(
        new BadRequestException({
          success: false,
          error: 'MFA_CHALLENGE_INVALID',
          message: 'The verification challenge is invalid or no longer available',
        }),
      );

      await expect(
        service.verifyMfaChallenge('profile-1', 'session-1', {
          challengeId: CHALLENGE_ID,
          code: '000000',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(credentialState.update).not.toHaveBeenCalled();
      expect(mfaAssertions.issue).not.toHaveBeenCalled();
    });

    it('audits a locked challenge as MFA_LOCKED and a wrong code as MFA_VERIFICATION_FAILED', async () => {
      mfaChallenges.verify.mockRejectedValueOnce(
        new BadRequestException({
          success: false,
          error: 'MFA_CHALLENGE_LOCKED',
          message: 'The verification challenge is invalid or no longer available',
        }),
      );

      await expect(
        service.verifyMfaChallenge('profile-1', 'session-1', {
          challengeId: CHALLENGE_ID,
          code: '000000',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(order).toContain(
        `audit-create:${SECURITY_LOG_ACTIONS.MFA_LOCKED}:false`,
      );

      mfaChallenges.verify.mockRejectedValueOnce(
        new BadRequestException({
          success: false,
          error: 'MFA_CHALLENGE_INVALID',
          message: 'The verification challenge is invalid or no longer available',
        }),
      );

      await expect(
        service.verifyMfaChallenge('profile-1', 'session-1', {
          challengeId: CHALLENGE_ID,
          code: '000000',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(order).toContain(
        `audit-create:${SECURITY_LOG_ACTIONS.MFA_VERIFICATION_FAILED}:false`,
      );
    });

    it('writes the actor, target, tenant and outcome envelope for the verification', async () => {
      await service.verifyMfaChallenge('profile-1', 'session-1', {
        challengeId: CHALLENGE_ID,
        code: '123456',
      });

      const call = prisma.securityLog.create.mock.calls.find(
        ([args]: any) => args.data.action === SECURITY_LOG_ACTIONS.MFA_ENABLED,
      );
      expect(call[0].data).toEqual({
        profileId: 'profile-1',
        actorProfileId: 'profile-1',
        targetProfileId: 'profile-1',
        pawnshopId: 'tenant-1',
        action: SECURITY_LOG_ACTIONS.MFA_ENABLED,
        success: true,
        metadata: { challengeId: CHALLENGE_ID },
      });
    });

    it('keeps a non-UUID challenge id out of the audit metadata', async () => {
      mfaChallenges.resolvePurpose.mockResolvedValue(null);

      await expect(
        service.verifyMfaChallenge('profile-1', 'session-1', {
          challengeId: 'code-is-123456-not-a-uuid',
          code: '123456',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      const call = prisma.securityLog.create.mock.calls.at(-1);
      expect(call[0].data.action).toBe(
        SECURITY_LOG_ACTIONS.MFA_VERIFICATION_FAILED,
      );
      expect(call[0].data).not.toHaveProperty('metadata');
      expect(JSON.stringify(call[0].data)).not.toContain('123456');
    });

    it('fails closed without enabling MFA when the state mutation is rejected', async () => {
      credentialState.update.mockRejectedValue(new Error('write rejected'));

      await expect(
        service.verifyMfaChallenge('profile-1', 'session-1', {
          challengeId: CHALLENGE_ID,
          code: '123456',
        }),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);

      expect(mfaAssertions.issue).not.toHaveBeenCalled();
      expect(order).toContain(
        `audit-create:${SECURITY_LOG_ACTIONS.MFA_ENABLED}:false`,
      );
    });

    it('returns only the freshly issued assertion and its expiry', async () => {
      const result = await service.verifyMfaChallenge(
        'profile-1',
        'session-1',
        { challengeId: CHALLENGE_ID, code: '123456' },
      );

      expect(Object.keys(result).sort()).toEqual(['assertion', 'expiresAt']);
      expect(JSON.stringify(result)).not.toContain('123456');
    });
  });
});
