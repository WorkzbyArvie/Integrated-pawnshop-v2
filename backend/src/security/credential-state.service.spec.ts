import { CredentialStateService, CredentialStateUnavailableError } from './credential-state.service';

describe('CredentialStateService', () => {
  const credentialState = {
    upsert: jest.fn(),
    findUnique: jest.fn(),
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
});
