import {
  Controller, Get, Post, Patch, Delete, Param, Body, Query, UsePipes, ValidationPipe,
} from '@nestjs/common';
import { ContractTemplateService } from './contract-template.service';
import { ContractRendererService } from './contract-renderer.service';

@Controller('contracts')
export class ContractController {
  constructor(
    private readonly templateService: ContractTemplateService,
    private readonly rendererService: ContractRendererService,
  ) {}

  @Get('templates')
  async listTemplates(@Query('type') type?: string) {
    return this.templateService.listTemplates(type);
  }

  @Get('templates/:id')
  async getTemplate(@Param('id') id: string) {
    return this.templateService.getTemplate(id);
  }

  @Post('templates')
  async createTemplate(@Body() body: any) {
    return this.templateService.createTemplate(body);
  }

  @Patch('templates/:id')
  async updateTemplate(@Param('id') id: string, @Body() body: any) {
    return this.templateService.updateTemplate(id, body);
  }

  @Delete('templates/:id')
  async deleteTemplate(@Param('id') id: string) {
    return this.templateService.deleteTemplate(id);
  }

  @Get('clauses')
  async listClauses(@Query('type') type?: string) {
    return this.templateService.listClauses(type);
  }

  @Post('clauses')
  async createClause(@Body() body: any) {
    return this.templateService.createClause(body);
  }

  @Post('render/:templateId')
  async renderContract(
    @Param('templateId') templateId: string,
    @Body() body: { data: Record<string, any>; pawnshopId: string; userId: string },
  ) {
    return this.rendererService.renderContract(templateId, body.data, body.pawnshopId, body.userId);
  }

  @Get('render/:contractId/pdf')
  async getContractPdf(@Param('contractId') contractId: string) {
    return this.rendererService.getPdfUrl(contractId);
  }
}
