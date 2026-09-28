import { Controller, Get, Param, Post, Body, Query, Req, Res } from '@nestjs/common';
import type { Response, Request } from 'express';
import { ReceiptService } from './receipt.service';
import { Public } from '../common/decorators/public.decorator';
import { RequiresPermission } from '../common/decorators/requires-permission.decorator';
import { PERMISSIONS } from '../common/permissions/permissions.const';

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

  /**
   * Mints a short-lived signed link for the receipt PDF.
   *
   * This is the authenticated half: it is permission-gated and refuses when the
   * receipt belongs to a different shop than the caller. Clients cannot put a
   * bearer token on the link they eventually open, so authorisation happens here
   * and the result is a signed, expiring URL.
   */
  @Get(':id/pdf')
  @RequiresPermission(PERMISSIONS['finance.manage'])
  async getPdf(
    @Param('id') id: string,
    @Req() req: { user: { pawnshopId: string | null; role: string } } & Request,
  ) {
    const receipt = await this.receiptService.get(id);
    this.receiptService.assertTenantAccess(receipt, req.user);

    const info = await this.receiptService.getPdfInfo(id);
    const signed = this.receiptService.createSignedPdfPath(id);
    const baseUrl = `${req.protocol}://${req.get('host')}`;

    return {
      ...info,
      pdfUrl: `${baseUrl}${signed.path}`,
      expiresAt: signed.expiresAt,
    };
  }

  /**
   * Receipt PDF download.
   *
   * Was `@Public()` with no check of any kind, so anyone holding a receipt id
   * could download a document containing the customer's name, address, amounts
   * and line items. It now accepts only a signature this service issued, for
   * five minutes. See `createSignedPdfPath`.
   */
  @Public()
  @Get(':id/pdf/download')
  async downloadPdf(
    @Param('id') id: string,
    @Query('expires') expires: string | undefined,
    @Query('sig') signature: string | undefined,
    @Res() res: Response,
  ) {
    this.receiptService.verifySignedPdfLink(id, expires, signature);

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
