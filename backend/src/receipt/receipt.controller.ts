import { Controller, Get, Param, Post, Body, Query } from '@nestjs/common';
import { ReceiptService } from './receipt.service';

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
  async getPdf(@Param('id') id: string) {
    return this.receiptService.getPdf(id);
  }

  @Post('void/:id')
  async void(
    @Param('id') id: string,
    @Body() body: { reason: string; voidedBy: string },
  ) {
    return this.receiptService.void(id, body.reason, body.voidedBy);
  }
}
