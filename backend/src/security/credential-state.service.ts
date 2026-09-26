import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

export interface CredentialStateView {
  id: string;
  profileId: string;
  mustChangePassword: boolean;
  reason: string | null;
  mfaEnabled: boolean;
  mfaEmail: string | null;
  markedAt: Date | null;
  resolvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type CredentialStateUnavailableKind = 'missing' | 'dependency';

export class CredentialStateUnavailableError extends Error {
  readonly code = 'CREDENTIAL_STATE_UNAVAILABLE' as const;

  constructor(
    readonly kind: CredentialStateUnavailableKind = 'dependency',
    readonly reason?: unknown,
  ) {
    super('Credential state is unavailable');
    this.name = 'CredentialStateUnavailableError';
  }
}

@Injectable()
export class CredentialStateService {
  constructor(private readonly prisma: PrismaService) {}

  async initializeSelfSelected(profileId: string): Promise<CredentialStateView> {
    this.assertProfileId(profileId);
    return this.prisma.credentialState.upsert({
      where: { profileId },
      create: {
        profileId,
        mustChangePassword: false,
        reason: null,
        markedAt: null,
        resolvedAt: null,
      },
      update: {},
    }) as Promise<CredentialStateView>;
  }

  async initializeProvisioned(
    profileId: string,
    reason = 'ADMINISTRATIVE_PROVISIONING',
  ): Promise<CredentialStateView> {
    this.assertProfileId(profileId);
    return this.prisma.credentialState.upsert({
      where: { profileId },
      create: {
        profileId,
        mustChangePassword: true,
        reason,
        markedAt: new Date(),
        resolvedAt: null,
      },
      update: {},
    }) as Promise<CredentialStateView>;
  }

  async getForUser(profileId: string): Promise<CredentialStateView> {
    this.assertProfileId(profileId);
    try {
      const state = await this.prisma.credentialState.findUnique({
        where: { profileId },
      });
      if (!state) throw new CredentialStateUnavailableError('missing');
      return state as CredentialStateView;
    } catch (error) {
      if (error instanceof CredentialStateUnavailableError) throw error;
      throw new CredentialStateUnavailableError('dependency', error);
    }
  }

  async getRequired(profileId: string): Promise<CredentialStateView> {
    return this.getForUser(profileId);
  }

  async resolveForcedChange(profileId: string): Promise<CredentialStateView> {
    this.assertProfileId(profileId);
    try {
      return (await this.prisma.credentialState.update({
        where: { profileId },
        data: { mustChangePassword: false, resolvedAt: new Date() },
      })) as CredentialStateView;
    } catch (error) {
      throw new CredentialStateUnavailableError('missing', error);
    }
  }

  async enableMfa(
    profileId: string,
    mfaEmail: string,
  ): Promise<CredentialStateView> {
    this.assertProfileId(profileId);
    const destination = typeof mfaEmail === 'string' ? mfaEmail.trim() : '';
    if (!destination) {
      throw new Error('A destination address is required to enable MFA');
    }
    try {
      return (await this.prisma.credentialState.update({
        where: { profileId },
        data: { mfaEnabled: true, mfaEmail: destination },
      })) as CredentialStateView;
    } catch (error) {
      throw new CredentialStateUnavailableError('dependency', error);
    }
  }

  async disableMfa(profileId: string): Promise<CredentialStateView> {
    this.assertProfileId(profileId);
    try {
      return (await this.prisma.credentialState.update({
        where: { profileId },
        data: { mfaEnabled: false, mfaEmail: null },
      })) as CredentialStateView;
    } catch (error) {
      throw new CredentialStateUnavailableError('dependency', error);
    }
  }

  private assertProfileId(profileId: string): void {
    if (!profileId || !profileId.trim()) {
      throw new Error('Profile id is required for credential state');
    }
  }
}
