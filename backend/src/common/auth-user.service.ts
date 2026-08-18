import { Injectable, UnauthorizedException } from '@nestjs/common';
import { SupabaseAdminService } from './supabase-admin.service';

@Injectable()
export class AuthUserService {
  constructor(private readonly supabaseAdmin: SupabaseAdminService) {}

  async getUserIdFromAuthHeader(authHeader?: string): Promise<string> {
    if (!authHeader)
      throw new UnauthorizedException('Missing authorization header');
    const [scheme, token] = authHeader.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token) {
      throw new UnauthorizedException('Invalid authorization format');
    }

    const { data, error } = await this.supabaseAdmin.client.auth.getUser(token);
    if (error || !data?.user?.id) {
      throw new UnauthorizedException('Invalid or expired token');
    }

    return data.user.id;
  }
}
