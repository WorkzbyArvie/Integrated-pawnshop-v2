import { Injectable, UnauthorizedException } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class AuctionAuthService {
  private readonly supabaseAdmin: SupabaseClient;

  constructor() {
    const supabaseUrl = process.env.VITE_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error('Supabase service role is not configured');
    }

    this.supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);
  }

  async getActorId(authHeader?: string): Promise<string> {
    const token = this.extractBearer(authHeader);

    if (!token) {
      throw new UnauthorizedException('Missing authorization token');
    }

    const { data, error } = await this.supabaseAdmin.auth.getUser(token);

    if (error || !data?.user?.id) {
      throw new UnauthorizedException('Invalid or expired session');
    }

    return data.user.id;
  }

  private extractBearer(authHeader?: string): string | null {
    if (!authHeader) return null;
    const [scheme, value] = authHeader.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !value) return null;
    return value.trim();
  }
}
