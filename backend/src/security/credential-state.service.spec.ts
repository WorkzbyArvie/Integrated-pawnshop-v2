import { CredentialStateService, CredentialStateUnavailableError } from './credential-state.service';

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

  describe('profile-scoped MFA transitions', () => {
    it('turns MFA on for the profile and records its destination', async () => {
      credentialState.update.mockResolvedValue({
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
      expect(credentialState.update).toHaveBeenCalledWith({
        where: { profileId: 'profile-1' },
        data: { mfaEnabled: true, mfaEmail: 'juan@example.com' },
      });
    });

    it('turns MFA off for the profile and clears the stored destination', async () => {
      credentialState.update.mockResolvedValue({
        profileId: 'profile-1',
        mfaEnabled: false,
        mfaEmail: null,
      });

      await service.disableMfa('profile-1');

      expect(credentialState.update).toHaveBeenCalledWith({
        where: { profileId: 'profile-1' },
        data: { mfaEnabled: false, mfaEmail: null },
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
      credentialState.update.mockRejectedValue(new Error('write rejected'));

      await expect(
        service.enableMfa('profile-1', 'juan@example.com'),
      ).rejects.toMatchObject({ code: 'CREDENTIAL_STATE_UNAVAILABLE' });
      await expect(service.disableMfa('profile-1')).rejects.toBeInstanceOf(
        CredentialStateUnavailableError,
      );
    });
  });
});
