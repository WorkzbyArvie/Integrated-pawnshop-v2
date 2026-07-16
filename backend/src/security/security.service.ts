import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { createClient } from '@supabase/supabase-js';

@Injectable()
export class SecurityService {
  constructor(private readonly prisma: PrismaService) {}

  private get supabaseAdmin() {
    const supabaseUrl = process.env.VITE_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error('Supabase admin configuration is missing');
    }
    return createClient(supabaseUrl, serviceRoleKey);
  }

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

    const { error } = await this.supabaseAdmin.auth.admin.updateUserById(
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
    } catch {
      // Non-blocking logging.
    }
  }
}
