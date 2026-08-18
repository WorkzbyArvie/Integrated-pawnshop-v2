import { Injectable, Logger } from '@nestjs/common';
import { SupabaseAdminService } from '../supabase-admin.service';

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private bucketName = process.env.SUPABASE_STORAGE_BUCKET || 'documents';

  constructor(private readonly supabaseAdmin: SupabaseAdminService) {}

  async uploadPdf(
    buffer: Buffer,
    folder: 'contracts' | 'receipts' | 'proofs',
    fileName: string,
  ): Promise<string> {
    if (!this.supabaseAdmin.isAvailable) {
      const localPath = `${folder}/${fileName}`;
      this.logger.warn(`No Supabase client — returning local path: ${localPath}`);
      return localPath;
    }

    const filePath = `${folder}/${fileName}`;

    const { data, error } = await this.supabaseAdmin.client.storage
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

    const { data: urlData } = this.supabaseAdmin.client.storage
      .from(this.bucketName)
      .getPublicUrl(filePath);

    return urlData?.publicUrl || filePath;
  }

  async getDownloadUrl(path: string): Promise<string | null> {
    if (!this.supabaseAdmin.isAvailable) return path.startsWith('http') ? path : null;

    if (path.startsWith('http')) return path;

    const { data } = this.supabaseAdmin.client.storage
      .from(this.bucketName)
      .getPublicUrl(path);

    return data?.publicUrl || null;
  }
}
