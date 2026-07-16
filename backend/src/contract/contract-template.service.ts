import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

@Injectable()
export class ContractTemplateService {
  constructor(private readonly prisma: PrismaService) {}

  async listTemplates(type?: string) {
    const where: any = { isActive: true };
    if (type) where.type = type;
    return this.prisma.contractTemplate.findMany({ where, orderBy: { name: 'asc' } });
  }

  async getTemplate(id: string) {
    const template = await this.prisma.contractTemplate.findUnique({ where: { id } });
    if (!template) throw new NotFoundException('Contract template not found');
    return template;
  }

  async createTemplate(data: {
    name: string;
    type: string;
    content: string;
    variables?: string[];
    version?: string;
  }) {
    return this.prisma.contractTemplate.create({
      data: {
        name: data.name,
        type: data.type as any,
        content: data.content,
        variables: data.variables || [],
        version: data.version || '1.0',
      },
    });
  }

  async updateTemplate(id: string, data: Partial<{
    name: string; content: string; variables: string[]; isActive: boolean; version: string;
  }>) {
    await this.getTemplate(id);
    return this.prisma.contractTemplate.update({ where: { id }, data });
  }

  async deleteTemplate(id: string) {
    await this.getTemplate(id);
    return this.prisma.contractTemplate.delete({ where: { id } });
  }

  async listClauses(type?: string) {
    const where: any = { isActive: true };
    if (type) where.type = type;
    return this.prisma.contractClause.findMany({ where, orderBy: { sortOrder: 'asc' } });
  }

  async createClause(data: { name: string; content: string; type?: string; sortOrder?: number; isMandatory?: boolean }) {
    return this.prisma.contractClause.create({
      data: {
        name: data.name,
        content: data.content,
        type: data.type as any || null,
        sortOrder: data.sortOrder || 0,
        isMandatory: data.isMandatory || false,
      },
    });
  }
}
