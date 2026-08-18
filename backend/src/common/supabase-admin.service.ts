import { Injectable, Logger } from '@nestjs/common';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class SupabaseAdminService {
  private readonly logger = new Logger(SupabaseAdminService.name);
  private readonly _client: SupabaseClient | null;

  constructor() {
    const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (url && key) {
      this._client = createClient(url, key);
      this.logger.log('Shared Supabase admin client initialized');
    } else {
      this._client = null;
      this.logger.warn('Supabase credentials missing — admin client unavailable');
    }
  }

  get client(): SupabaseClient {
    if (!this._client) {
      throw new Error('Supabase admin client is not configured');
    }
    return this._client;
  }

  get isAvailable(): boolean {
    return this._client !== null;
  }
}
