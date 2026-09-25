import { Injectable, UnauthorizedException } from '@nestjs/common';
import { SupabaseAdminService } from './supabase-admin.service';
import * as jwt from 'jsonwebtoken';

export interface AuthContext {
  userId: string;
  sessionId: string;
}

@Injectable()
export class AuthUserService {
  constructor(private readonly supabaseAdmin: SupabaseAdminService) {}

  async getAuthContextFromAuthHeader(authHeader?: string): Promise<AuthContext> {
    void authHeader;
    return { userId: '', sessionId: '' };
  }

  async getUserIdFromAuthHeader(authHeader?: string): Promise<string> {
    if (!authHeader)
      throw new UnauthorizedException('Missing authorization header');
    const [scheme, token] = authHeader.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token) {
      throw new UnauthorizedException('Invalid authorization format');
    }

    const jwtSecret = process.env.JWT_SECRET || 'pawn_gold_dev_secret';
    try {
      const payload = jwt.verify(token, jwtSecret) as any;
      if (payload?.sub) return payload.sub;
    } catch {
      // Fall through to Supabase validation below.
    }

    const { data, error } = await this.supabaseAdmin.client.auth.getUser(token);
    if (error || !data?.user?.id) {
      throw new UnauthorizedException('Invalid or expired token');
    }

    return data.user.id;
  }
}
