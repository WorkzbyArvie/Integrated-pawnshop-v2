import { Controller, Get, Param, Post, Body, Query, Req, Res } from '@nestjs/common';
import type { Response, Request } from 'express';
import { ReceiptService } from './receipt.service';
import { Public } from '../common/decorators/public.decorator';

@Controller('receipts')
export class ReceiptController {
  constructor(private readonly receiptService: ReceiptService) {}

  @Get()
  async list(
    @Query('pawnshopId') pawnshopId: string,
    @Query('type') type?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.receiptService.list(
      pawnshopId,
      type,
      limit ? parseInt(limit) : 20,
      offset ? parseInt(offset) : 0,
    );
  }

  @Get('by-reference/:referenceType/:referenceId')
  async findByReference(
    @Param('referenceType') referenceType: string,
    @Param('referenceId') referenceId: string,
  ) {
    return this.receiptService.findByReference(referenceType, referenceId);
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    return this.receiptService.get(id);
  }

  @Get(':id/pdf')
  async getPdf(@Param('id') id: string, @Req() req: Request) {
    const info = await this.receiptService.getPdfInfo(id);
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    return { ...info, pdfUrl: `${baseUrl}/receipts/${id}/pdf/download` };
  }

  @Public()
  @Get(':id/pdf/download')
  async downloadPdf(@Param('id') id: string, @Res() res: Response) {
    const buffer = await this.receiptService.getPdfBuffer(id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="receipt-${id}.pdf"`);
    res.send(buffer);
  }

  @Post('void/:id')
  async void(
    @Param('id') id: string,
    @Body() body: { reason: string; voidedBy: string },
  ) {
    return this.receiptService.void(id, body.reason, body.voidedBy);
  }
}
