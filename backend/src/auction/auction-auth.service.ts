import { Injectable, UnauthorizedException } from '@nestjs/common';
import { SupabaseAdminService } from '../common/supabase-admin.service';

@Injectable()
export class AuctionAuthService {
  constructor(private readonly supabaseAdmin: SupabaseAdminService) {}

  async getActorId(authHeader?: string): Promise<string> {
    const token = this.extractBearer(authHeader);

    if (!token) {
      throw new UnauthorizedException('Missing authorization token');
    }

    const { data, error } = await this.supabaseAdmin.client.auth.getUser(token);

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
