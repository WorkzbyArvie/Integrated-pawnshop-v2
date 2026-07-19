import { Injectable, Logger } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private supabase: SupabaseClient | null = null;
  private bucketName = process.env.SUPABASE_STORAGE_BUCKET || 'documents';

  constructor() {
    const url = process.env.VITE_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (url && key) {
      this.supabase = createClient(url, key);
    } else {
      this.logger.warn('Supabase credentials not configured — storage will use local fallback paths');
    }
  }

  async uploadPdf(
    buffer: Buffer,
    folder: 'contracts' | 'receipts' | 'proofs',
    fileName: string,
  ): Promise<string> {
    if (!this.supabase) {
      const localPath = `${folder}/${fileName}`;
      this.logger.warn(`No Supabase client — returning local path: ${localPath}`);
      return localPath;
    }

    const filePath = `${folder}/${fileName}`;

    const { data, error } = await this.supabase.storage
      .from(this.bucketName)
      .upload(filePath, buffer, {
        contentType: 'application/pdf',
        upsert: true,
      });

    if (error) {
      this.logger.warn(`Supabase upload skipped (storage not configured): ${error.message}`);
      const localPath = `${folder}/${fileName}`;
      return localPath;
    }

    const { data: urlData } = this.supabase.storage
      .from(this.bucketName)
      .getPublicUrl(filePath);

    return urlData?.publicUrl || filePath;
  }

  async getDownloadUrl(path: string): Promise<string | null> {
    if (!this.supabase) return path.startsWith('http') ? path : null;

    if (path.startsWith('http')) return path;

    const { data } = this.supabase.storage
      .from(this.bucketName)
      .getPublicUrl(path);

    return data?.publicUrl || null;
  }
}
