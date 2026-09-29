import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

@Injectable()
export class ProfileService {
  constructor(private readonly prisma: PrismaService) {}

  async getMyProfile(userId: string) {
    const profile = await this.prisma.profile.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        fullName: true,
        phoneNumber: true,
        address: true,
        dateOfBirth: true,
        avatarUrl: true,
        role: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!profile) throw new Error('Profile not found');
    return profile;
  }

  /**
   * Role, staff specialisation, shop and branch for the caller's own account.
   *
   * Looked up strictly by the authenticated id. The browser previously repeated
   * this read and, when it came back empty, retried with `.eq('email', email)` -
   * a lookup any caller could aim at an arbitrary address, which is why the
   * `profiles` table could not simply be locked down to `auth.uid()`.
   */
  async getSessionContext(userId: string) {
    const profile = await this.prisma.profile.findUnique({
      where: { id: userId },
      select: {
        role: true,
        staffType: true,
        pawnshopId: true,
        branchId: true,
      },
    });

    return profile;
  }

  async updateMyProfile(
    userId: string,
    data: {
      fullName?: string;
      phoneNumber?: string;
      address?: string;
      dateOfBirth?: string;
      avatarUrl?: string;
    },
  ) {
    const existing = await this.prisma.profile.findUnique({
      where: { id: userId },
    });
    if (!existing) throw new Error('Profile not found');

    const updated = await this.prisma.profile.update({
      where: { id: userId },
      data: {
        fullName: data.fullName ?? existing.fullName,
        phoneNumber: data.phoneNumber ?? existing.phoneNumber,
        address: data.address ?? existing.address,
        avatarUrl: data.avatarUrl ?? existing.avatarUrl,
        dateOfBirth: data.dateOfBirth
          ? new Date(data.dateOfBirth)
          : existing.dateOfBirth,
        updatedAt: new Date(),
      },
      select: {
        id: true,
        email: true,
        fullName: true,
        phoneNumber: true,
        address: true,
        dateOfBirth: true,
        avatarUrl: true,
        role: true,
        updatedAt: true,
      },
    });

    const customer = await this.prisma.customer.findUnique({
      where: { id: userId },
    });
    if (customer) {
      await this.prisma.customer.update({
        where: { id: userId },
        data: {
          fullName: updated.fullName || customer.fullName,
          contactNumber: updated.phoneNumber || customer.contactNumber,
          address: updated.address || customer.address,
        },
      });
    }

    return updated;
  }

  async verifyBidderEmail(email: string) {
    const normalized = String(email || '')
      .trim()
      .toLowerCase();
    if (!normalized || !normalized.includes('@')) {
      return { exists: false };
    }

    const profile = await this.prisma.profile.findFirst({
      where: { email: normalized, role: 'BIDDER' },
      select: { id: true, email: true, fullName: true },
    });

    return {
      exists: !!profile,
      profile: profile || null,
    };
  }
}
