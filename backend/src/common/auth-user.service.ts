import { Injectable, UnauthorizedException } from '@nestjs/common';
import { SupabaseAdminService } from './supabase-admin.service';
import * as jwt from 'jsonwebtoken';

export interface AuthContext {
  userId: string;
  sessionId: string;
}

const SESSION_CLAIMS = ['session_id', 'sessionId', 'sid'] as const;

@Injectable()
export class AuthUserService {
  constructor(private readonly supabaseAdmin: SupabaseAdminService) {}

  async getAuthContextFromAuthHeader(authHeader?: string): Promise<AuthContext> {
    const token = this.extractBearerToken(authHeader);
    const jwtSecret = process.env.JWT_SECRET || 'pawn_gold_dev_secret';

    let verifiedPayload: Record<string, any> | null = null;
    try {
      verifiedPayload = jwt.verify(token, jwtSecret) as Record<string, any>;
    } catch {
      verifiedPayload = null;
    }

    const nativeUserId =
      typeof verifiedPayload?.sub === 'string' ? verifiedPayload.sub : '';
    if (nativeUserId) {
      const nativeSessionId = this.readSessionId(verifiedPayload);
      if (!nativeSessionId) {
        throw new UnauthorizedException(
          'Token is not bound to an active session',
        );
      }
      return { userId: nativeUserId, sessionId: nativeSessionId };
    }

    const { data, error } = await this.supabaseAdmin.client.auth.getUser(token);
    if (error || !data?.user?.id) {
      throw new UnauthorizedException('Invalid or expired token');
    }

    // Supabase already validated this exact token, so its own session claim is
    // trusted for the session id only. The profile id always comes from the
    // verified user, never from a client-supplied claim.
    const supabaseSessionId = this.readSessionId(this.decodeClaims(token));
    if (!supabaseSessionId) {
      throw new UnauthorizedException('Token is not bound to an active session');
    }

    return { userId: data.user.id, sessionId: supabaseSessionId };
  }

  async getUserIdFromAuthHeader(authHeader?: string): Promise<string> {
    const token = this.extractBearerToken(authHeader);

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

  private extractBearerToken(authHeader?: string): string {
    if (!authHeader)
      throw new UnauthorizedException('Missing authorization header');
    const [scheme, token] = authHeader.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token) {
      throw new UnauthorizedException('Invalid authorization format');
    }
    return token;
  }

  private readSessionId(claims: Record<string, any> | null | undefined): string {
    for (const claim of SESSION_CLAIMS) {
      const value = claims?.[claim];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return '';
  }

  private decodeClaims(token: string): Record<string, any> {
    const segment = token.split('.')[1];
    if (!segment) return {};
    try {
      const json = Buffer.from(segment, 'base64url').toString('utf8');
      const claims = JSON.parse(json);
      return claims && typeof claims === 'object' ? claims : {};
    } catch {
      return {};
    }
  }
}
