import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { SupabaseAdminService } from '../common/supabase-admin.service';

@Injectable()
export class SecurityService {
  private readonly logger = new Logger(SecurityService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly supabaseAdmin: SupabaseAdminService,
  ) {}

  async changeMyPassword(userId: string, data: { newPassword: string }) {
    const password = data?.newPassword || '';
    if (password.length < 8) {
      throw new Error('Password must be at least 8 characters');
    }

    const hasUpper = /[A-Z]/.test(password);
    const hasLower = /[a-z]/.test(password);
    const hasNumber = /\d/.test(password);
    if (!hasUpper || !hasLower || !hasNumber) {
      throw new Error('Password must include uppercase, lowercase, and number');
    }

    const { error } = await this.supabaseAdmin.client.auth.admin.updateUserById(
      userId,
      {
        password,
      },
    );

    if (error) {
      await this.logSecurityEvent(userId, 'PASSWORD_CHANGE_FAILED', false);
      throw new Error(error.message || 'Failed to update password');
    }

    await this.logSecurityEvent(userId, 'PASSWORD_CHANGED', true);
    return { success: true, message: 'Password updated successfully' };
  }

  async getMySecurityLogs(userId: string) {
    return this.prisma.securityLog.findMany({
      where: { profileId: userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  private async logSecurityEvent(
    profileId: string,
    action: string,
    success = true,
  ) {
    try {
      await this.prisma.securityLog.create({
        data: {
          profileId,
          action,
          success,
        },
      });
    } catch (err) {
      this.logger.error(`Failed to write security log: action=${action} profileId=${profileId}`, (err as Error).stack);
    }
  }
}
