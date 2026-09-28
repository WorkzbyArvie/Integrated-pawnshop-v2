import {
  CREDENTIAL_STATE_REASONS,
  CredentialStateService,
  CredentialStateUnavailableError,
} from './credential-state.service';

describe('CredentialStateService', () => {
  const credentialState = {
    upsert: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  };
  const prisma = { credentialState } as any;
  let service: CredentialStateService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new CredentialStateService(prisma);
  });

  it('initializes a self-selected profile without tenant state', async () => {
    credentialState.upsert.mockResolvedValue({
      profileId: 'profile-1',
      mustChangePassword: false,
      reason: null,
    });

    await service.initializeSelfSelected('profile-1');

    expect(credentialState.upsert).toHaveBeenCalledWith({
      where: { profileId: 'profile-1' },
      create: {
        profileId: 'profile-1',
        mustChangePassword: false,
        reason: null,
        markedAt: null,
        resolvedAt: null,
      },
      update: {},
    });
  });

  it('initializes an administratively provisioned profile as forced-change', async () => {
    credentialState.upsert.mockResolvedValue({
      profileId: 'profile-2',
      mustChangePassword: true,
      reason: 'ADMINISTRATIVE_PROVISIONING',
    });

    await service.initializeProvisioned('profile-2');

    expect(credentialState.upsert).toHaveBeenCalledWith({
      where: { profileId: 'profile-2' },
      create: {
        profileId: 'profile-2',
        mustChangePassword: true,
        reason: 'ADMINISTRATIVE_PROVISIONING',
        markedAt: expect.any(Date),
        resolvedAt: null,
      },
      update: {},
    });
  });

  it('returns the profile-scoped state when it exists', async () => {
    const state = { profileId: 'profile-1', mustChangePassword: false };
    credentialState.findUnique.mockResolvedValue(state);

    await expect(service.getForUser('profile-1')).resolves.toBe(state);
    expect(credentialState.findUnique).toHaveBeenCalledWith({
      where: { profileId: 'profile-1' },
    });
  });

  it('throws the typed unavailable error for a missing row', async () => {
    credentialState.findUnique.mockResolvedValue(null);

    await expect(service.getForUser('missing')).rejects.toBeInstanceOf(
      CredentialStateUnavailableError,
    );
    await expect(service.getForUser('missing')).rejects.toMatchObject({
      code: 'CREDENTIAL_STATE_UNAVAILABLE',
    });
  });

  it('wraps a dependency read failure with the same typed error', async () => {
    credentialState.findUnique.mockRejectedValue(new Error('database unavailable'));

    await expect(service.getForUser('profile-1')).rejects.toMatchObject({
      code: 'CREDENTIAL_STATE_UNAVAILABLE',
    });
  });

  it('exposes the same required-state read for the guard', async () => {
    const state = { profileId: 'profile-1', mustChangePassword: true };
    credentialState.findUnique.mockResolvedValue(state);

    await expect(service.getRequired('profile-1')).resolves.toBe(state);
  });

  describe('forced state reservation for an administrative reset', () => {
    const RESET_PENDING = CREDENTIAL_STATE_REASONS.ADMIN_RESET_PENDING;
    const RESET_CONFIRMED = CREDENTIAL_STATE_REASONS.ADMIN_RESET;
    const RESET_FAILED = CREDENTIAL_STATE_REASONS.ADMIN_RESET_FAILED;

    it('reserves mustChangePassword on the create branch before a password exists', async () => {
      credentialState.upsert.mockResolvedValue({
        profileId: 'profile-3',
        mustChangePassword: true,
        reason: RESET_PENDING,
      });

      await service.reserveForcedChange('profile-3');

      expect(credentialState.upsert).toHaveBeenCalledWith({
        where: { profileId: 'profile-3' },
        create: {
          profileId: 'profile-3',
          mustChangePassword: true,
          reason: RESET_PENDING,
          markedAt: expect.any(Date),
          resolvedAt: null,
        },
        update: {
          mustChangePassword: true,
          reason: RESET_PENDING,
          markedAt: expect.any(Date),
          resolvedAt: null,
        },
      });
    });

    it('forces an existing resolved row back to true on the update branch', async () => {
      credentialState.upsert.mockResolvedValue({
        profileId: 'profile-3',
        mustChangePassword: true,
        reason: RESET_PENDING,
      });

      await service.reserveForcedChange('profile-3', RESET_PENDING);

      const [args] = credentialState.upsert.mock.calls[0];
      expect(args.update.mustChangePassword).toBe(true);
      expect(args.update.resolvedAt).toBeNull();
    });

    it('surfaces a rejected reservation as a typed dependency failure', async () => {
      credentialState.upsert.mockRejectedValue(new Error('prisma write rejected'));

      await expect(service.reserveForcedChange('profile-3')).rejects.toBeInstanceOf(
        CredentialStateUnavailableError,
      );
      await expect(service.reserveForcedChange('profile-3')).rejects.toMatchObject({
        code: 'CREDENTIAL_STATE_UNAVAILABLE',
        kind: 'dependency',
      });
    });

    it('refuses a blank profile instead of writing an unscoped reservation', async () => {
      await expect(service.reserveForcedChange('  ')).rejects.toThrow(
        /Profile id is required/i,
      );
      expect(credentialState.upsert).not.toHaveBeenCalled();
    });

    it('confirms the administrative reason while keeping the forced state true', async () => {
      credentialState.update.mockResolvedValue({
        profileId: 'profile-3',
        mustChangePassword: true,
        reason: RESET_CONFIRMED,
      });

      await expect(service.confirmForcedChange('profile-3')).resolves.toMatchObject({
        mustChangePassword: true,
        reason: RESET_CONFIRMED,
      });

      expect(credentialState.update).toHaveBeenCalledWith({
        where: { profileId: 'profile-3' },
        data: {
          mustChangePassword: true,
          reason: RESET_CONFIRMED,
          markedAt: expect.any(Date),
          resolvedAt: null,
        },
      });
    });

    it('never clears the forced state when a later step fails', async () => {
      credentialState.update.mockResolvedValue({
        profileId: 'profile-3',
        mustChangePassword: true,
        reason: RESET_FAILED,
      });

      await service.recordForcedChangeFailure('profile-3');

      expect(credentialState.update).toHaveBeenCalledWith({
        where: { profileId: 'profile-3' },
        data: { mustChangePassword: true, reason: RESET_FAILED },
      });
      const serialized = JSON.stringify(credentialState.update.mock.calls);
      expect(serialized).not.toContain('"mustChangePassword":false');
    });

    it('wraps a rejected confirmation and failure marker with the typed error', async () => {
      credentialState.update.mockRejectedValue(new Error('write rejected'));

      await expect(service.confirmForcedChange('profile-3')).rejects.toMatchObject({
        code: 'CREDENTIAL_STATE_UNAVAILABLE',
      });
      await expect(
        service.recordForcedChangeFailure('profile-3'),
      ).rejects.toBeInstanceOf(CredentialStateUnavailableError);
    });

    it('refuses a blank profile for confirmation and failure marking', async () => {
      await expect(service.confirmForcedChange('')).rejects.toThrow(
        /Profile id is required/i,
      );
      await expect(service.recordForcedChangeFailure(' ')).rejects.toThrow(
        /Profile id is required/i,
      );
      expect(credentialState.update).not.toHaveBeenCalled();
    });
  });

  describe('profile-scoped MFA transitions', () => {
    it('turns MFA on for the profile and records its destination', async () => {
      credentialState.upsert.mockResolvedValue({
        profileId: 'profile-1',
        mfaEnabled: true,
        mfaEmail: 'juan@example.com',
      });

      await expect(
        service.enableMfa('profile-1', '  juan@example.com  '),
      ).resolves.toEqual(
        expect.objectContaining({
          mfaEnabled: true,
          mfaEmail: 'juan@example.com',
        }),
      );
      expect(credentialState.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { profileId: 'profile-1' },
          update: { mfaEnabled: true, mfaEmail: 'juan@example.com' },
        }),
      );
    });

    it('turns MFA off for the profile and clears the stored destination', async () => {
      credentialState.upsert.mockResolvedValue({
        profileId: 'profile-1',
        mfaEnabled: false,
        mfaEmail: null,
      });

      await service.disableMfa('profile-1');

      expect(credentialState.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { profileId: 'profile-1' },
          update: { mfaEnabled: false, mfaEmail: null },
        }),
      );
    });

    // The regression. enableMfa and disableMfa used a bare update(), which throws
    // when the row is absent rather than creating it. An account with no
    // credential row could therefore never enable MFA, and the failure landed
    // after the code had been sent and verified -- so the UI kept promising an
    // email that could no longer be produced, with no in-product way back. It
    // reached production as an owner locked out of sign-in.
    it('enrols MFA when the credential row does not exist yet', async () => {
      credentialState.upsert.mockResolvedValue({
        profileId: 'profile-1',
        mfaEnabled: true,
        mfaEmail: 'juan@example.com',
      });

      await service.enableMfa('profile-1', 'juan@example.com');

      // Never update: that is the call which throws.
      expect(credentialState.update).not.toHaveBeenCalled();

      const arg = credentialState.upsert.mock.calls[0][0];
      // The create branch carries the same defaults getRequired uses, so a row
      // born here is indistinguishable from one born there.
      expect(arg.create).toEqual({
        profileId: 'profile-1',
        mustChangePassword: false,
        reason: null,
        markedAt: null,
        mfaEnabled: true,
        mfaEmail: 'juan@example.com',
      });
    });

    it('disables MFA without throwing when the row does not exist', async () => {
      // The worse direction: a disable that throws leaves MFA on and the account
      // unable to sign in at all.
      credentialState.upsert.mockResolvedValue({
        profileId: 'profile-1',
        mfaEnabled: false,
        mfaEmail: null,
      });

      await service.disableMfa('profile-1');

      expect(credentialState.update).not.toHaveBeenCalled();
      expect(credentialState.upsert.mock.calls[0][0].create).toEqual({
        profileId: 'profile-1',
        mustChangePassword: false,
        reason: null,
        markedAt: null,
        mfaEnabled: false,
        mfaEmail: null,
      });
    });

    it('refuses to enable MFA without a usable destination', async () => {
      await expect(service.enableMfa('profile-1', '   ')).rejects.toThrow(
        /destination address is required/i,
      );
      expect(credentialState.update).not.toHaveBeenCalled();
    });

    it('refuses a blank profile rather than writing an unscoped row', async () => {
      await expect(service.enableMfa('', 'juan@example.com')).rejects.toThrow(
        /Profile id is required/i,
      );
      await expect(service.disableMfa('  ')).rejects.toThrow(
        /Profile id is required/i,
      );
      expect(credentialState.update).not.toHaveBeenCalled();
    });

    it('wraps a rejected transition with the typed unavailable error', async () => {
      // The transitions upsert rather than update, so the rejection is raised on
      // the call they actually make. Mocking update() here would leave the
      // promise resolved and the assertion meaningless.
      credentialState.upsert.mockRejectedValue(new Error('write rejected'));

      await expect(
        service.enableMfa('profile-1', 'juan@example.com'),
      ).rejects.toMatchObject({ code: 'CREDENTIAL_STATE_UNAVAILABLE' });
      await expect(service.disableMfa('profile-1')).rejects.toBeInstanceOf(
        CredentialStateUnavailableError,
      );
    });
  });
});
