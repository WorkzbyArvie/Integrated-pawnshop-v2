import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);
  private readonly strictStartup: boolean;
  private readonly configuredDbHost?: string;
  private isConnected = false;
  private lastConnectivityLogAt = 0;

  constructor() {
    const rawUrl = process.env.DATABASE_URL;
    const trimmedUrl = rawUrl?.trim();
    const strictStartupEnv =
      process.env.DB_STRICT_STARTUP ?? process.env.PRISMA_STRICT_STARTUP;
    const strictStartup =
      strictStartupEnv == null
        ? true
        : !['false', '0', 'no', 'off'].includes(
            strictStartupEnv.trim().toLowerCase(),
          );
    let prismaUrl = trimmedUrl;

    const defaultConnectionLimit = process.env.PRISMA_CONNECTION_LIMIT?.trim() || '1';
    const defaultPoolTimeout = process.env.PRISMA_POOL_TIMEOUT?.trim() || '20';

    if (trimmedUrl) {
      try {
        const parsed = new URL(trimmedUrl);
        const isSupabaseHost = parsed.hostname.includes('supabase.co');

        // Supabase Postgres endpoints require SSL for stable connectivity.
        if (isSupabaseHost && !parsed.searchParams.has('sslmode')) {
          parsed.searchParams.set('sslmode', 'require');
        }

        if (!parsed.searchParams.has('connection_limit')) {
          parsed.searchParams.set('connection_limit', defaultConnectionLimit);
        }
        if (!parsed.searchParams.has('pool_timeout')) {
          parsed.searchParams.set('pool_timeout', defaultPoolTimeout);
        }
        prismaUrl = parsed.toString();
      } catch {
        prismaUrl = trimmedUrl;
      }
    }

    super(
      prismaUrl
        ? {
            datasources: {
              db: {
                url: prismaUrl,
              },
            },
          }
        : {},
    );

      this.strictStartup = strictStartup;

    if (trimmedUrl) {
      try {
        const parsed = new URL(trimmedUrl);
        this.configuredDbHost = parsed.hostname;
        this.logger.log(
          `Prisma DB target: ${parsed.hostname}:${parsed.port || '5432'} as ${parsed.username}`,
        );
        this.logger.log(
          `Prisma pool settings: connection_limit=${new URL(prismaUrl!).searchParams.get('connection_limit') || 'default'}, pool_timeout=${new URL(prismaUrl!).searchParams.get('pool_timeout') || 'default'}`,
        );
      } catch {
        this.logger.warn('DATABASE_URL is set but could not be parsed as a URL');
      }
    } else {
      this.logger.warn('DATABASE_URL is missing');
    }
  }

  async onModuleInit() {
    try {
      await this.$connect();
      this.isConnected = true;
      this.logger.log('Prisma connected');
    } catch (error: any) {
      this.isConnected = false;
      this.logger.error(
        `Prisma initial connection failed: ${error?.message || error}`,
      );
      if (
        this.isDatabaseConnectivityError(error) &&
        this.configuredDbHost?.startsWith('db.') &&
        this.configuredDbHost?.endsWith('.supabase.co')
      ) {
        this.logger.warn(
          'Supabase direct DB host is often IPv6-only. If your network is IPv4-only, use the Session pooler URL from Supabase Dashboard > Connect > Session mode.',
        );
      }
      if (this.strictStartup) {
        this.logger.error(
          'DB_STRICT_STARTUP is enabled; aborting startup to prevent broken API responses.',
        );
        throw error;
      }

      this.logger.warn(
        'Continuing startup because DB_STRICT_STARTUP=false; DB-backed routes may fail until DB is reachable.',
      );
    }
  }

  isDatabaseAvailable(): boolean {
    return this.isConnected;
  }

  isDatabaseConnectivityError(error: any): boolean {
    const message = `${error?.message || ''}`.toLowerCase();
    const code = `${error?.code || ''}`.toUpperCase();

    return (
      code === 'P1000' ||
      code === 'P1001' ||
      message.includes("can't reach database server") ||
      message.includes('tenant or user not found') ||
      message.includes('password authentication failed') ||
      message.includes('connection refused') ||
      message.includes('timeout')
    );
  }

  private logConnectivityIssue(message: string) {
    const now = Date.now();
    if (now - this.lastConnectivityLogAt < 60_000) {
      return;
    }

    this.lastConnectivityLogAt = now;
    this.logger.warn(message);
  }

  async ensureConnected(context = 'runtime query'): Promise<boolean> {
    if (this.isConnected) {
      return true;
    }

    try {
      await this.$connect();
      this.isConnected = true;
      this.logger.log(`Prisma reconnected (${context})`);
      return true;
    } catch (error: any) {
      this.isConnected = false;
      this.logConnectivityIssue(
        `Skipping ${context}: database is unreachable (${error?.message || error})`,
      );
      return false;
    }
  }

  async onModuleDestroy() {
    this.isConnected = false;
    await this.$disconnect();
  }
}
