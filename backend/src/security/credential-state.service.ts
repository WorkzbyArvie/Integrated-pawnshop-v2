import { Injectable } from '@nestjs/common';

export class CredentialStateUnavailableError extends Error {
  readonly code = 'CREDENTIAL_STATE_UNAVAILABLE' as const;

  constructor(readonly cause?: unknown) {
    super('Credential state is unavailable');
    this.name = 'CredentialStateUnavailableError';
  }
}

@Injectable()
export class CredentialStateService {
  async initializeSelfSelected(_profileId: string): Promise<Record<string, unknown>> {
    return {
      profileId: _profileId,
      mustChangePassword: true,
      reason: null,
    };
  }

  async initializeProvisioned(_profileId: string): Promise<Record<string, unknown>> {
    return {
      profileId: _profileId,
      mustChangePassword: true,
      reason: 'ADMINISTRATIVE_PROVISIONING',
    };
  }

  async getForUser(_profileId: string): Promise<Record<string, unknown>> {
    return {
      profileId: _profileId,
      mustChangePassword: true,
    };
  }
}
