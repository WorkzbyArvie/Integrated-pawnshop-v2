import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { Branding, Prisma } from '@prisma/client';

@Injectable()
export class BrandingService {
  private readonly logger = new Logger(BrandingService.name);
  private brandingSchemaAvailable: boolean | null = null;
  private hasLoggedMissingSchema = false;

  constructor(private prisma: PrismaService) {}

  private isMissingBrandingSchemaError(error: unknown): boolean {
    const message = String((error as any)?.message || '').toLowerCase();
    return (
      message.includes('does not exist') &&
      (message.includes('relation') ||
        message.includes('column') ||
        message.includes('brandings') ||
        message.includes('branding'))
    );
  }

  private markBrandingSchemaUnavailable(error: unknown): void {
    this.brandingSchemaAvailable = false;
    if (!this.hasLoggedMissingSchema) {
      this.logger.warn(
        `Branding schema unavailable; falling back to defaults. ${String((error as any)?.message || error)}`,
      );
      this.hasLoggedMissingSchema = true;
    }
  }

  async create(data: Prisma.BrandingCreateInput): Promise<Branding> {
    if (this.brandingSchemaAvailable === false) {
      throw new BadRequestException(
        'Branding feature is unavailable because branding schema is not provisioned.',
      );
    }

    try {
      const created = await this.prisma.branding.create({ data });
      this.brandingSchemaAvailable = true;
      return created;
    } catch (error) {
      if (this.isMissingBrandingSchemaError(error)) {
        this.markBrandingSchemaUnavailable(error);
        throw new BadRequestException(
          'Branding feature is unavailable because branding schema is not provisioned.',
        );
      }
      throw error;
    }
  }

  async findAll(): Promise<Branding[]> {
    if (this.brandingSchemaAvailable === false) {
      return [];
    }

    try {
      const rows = await this.prisma.branding.findMany();
      this.brandingSchemaAvailable = true;
      return rows;
    } catch (error) {
      if (this.isMissingBrandingSchemaError(error)) {
        this.markBrandingSchemaUnavailable(error);
      } else {
        this.logger.warn(
          `Branding findAll fallback activated: ${String((error as any)?.message || error)}`,
        );
      }

      // Keep public auction frontend stable even when branding table is absent.
      return [];
    }
  }

  async findOne(id: number): Promise<Branding | null> {
    if (this.brandingSchemaAvailable === false) {
      return null;
    }

    try {
      const row = await this.prisma.branding.findUnique({ where: { id } });
      this.brandingSchemaAvailable = true;
      return row;
    } catch (error) {
      if (this.isMissingBrandingSchemaError(error)) {
        this.markBrandingSchemaUnavailable(error);
      } else {
        this.logger.warn(
          `Branding findOne fallback activated for id ${id}: ${String((error as any)?.message || error)}`,
        );
      }

      return null;
    }
  }

  async update(id: number, data: Prisma.BrandingUpdateInput): Promise<Branding> {
    if (this.brandingSchemaAvailable === false) {
      throw new BadRequestException(
        'Branding feature is unavailable because branding schema is not provisioned.',
      );
    }

    try {
      const updated = await this.prisma.branding.update({ where: { id }, data });
      this.brandingSchemaAvailable = true;
      return updated;
    } catch (error) {
      if (this.isMissingBrandingSchemaError(error)) {
        this.markBrandingSchemaUnavailable(error);
        throw new BadRequestException(
          'Branding feature is unavailable because branding schema is not provisioned.',
        );
      }
      throw error;
    }
  }

  async remove(id: number): Promise<Branding> {
    if (this.brandingSchemaAvailable === false) {
      throw new BadRequestException(
        'Branding feature is unavailable because branding schema is not provisioned.',
      );
    }

    try {
      const deleted = await this.prisma.branding.delete({ where: { id } });
      this.brandingSchemaAvailable = true;
      return deleted;
    } catch (error) {
      if (this.isMissingBrandingSchemaError(error)) {
        this.markBrandingSchemaUnavailable(error);
        throw new BadRequestException(
          'Branding feature is unavailable because branding schema is not provisioned.',
        );
      }
      throw error;
    }
  }
}
