import { Injectable, UnauthorizedException } from '@nestjs/common';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class AuthUserService {
  private readonly supabaseAdmin: SupabaseClient;

  constructor() {
    const supabaseUrl = process.env.VITE_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error('Supabase admin configuration is missing');
    }
    this.supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);
  }

  async getUserIdFromAuthHeader(authHeader?: string): Promise<string> {
    if (!authHeader)
      throw new UnauthorizedException('Missing authorization header');
    const [scheme, token] = authHeader.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token) {
      throw new UnauthorizedException('Invalid authorization format');
    }

    const { data, error } = await this.supabaseAdmin.auth.getUser(token);
    if (error || !data?.user?.id) {
      throw new UnauthorizedException('Invalid or expired token');
    }

    return data.user.id;
  }
}
