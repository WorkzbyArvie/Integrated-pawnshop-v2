import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import type { Request } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';

import { Public } from '../common/decorators/public.decorator';
import { Throttle } from '../common/decorators/throttle.decorator';
import { RequiresPermission } from '../common/decorators/requires-permission.decorator';
import { PERMISSIONS } from '../common/permissions/permissions.const';
import { PublicAppraisalService } from './public-appraisal.service';
import { CreateReservationDto } from './dto/create-reservation.dto';
import { PublicQuoteDto } from './dto/public-quote.dto';

/**
 * The shape `FileInterceptor` actually produces.
 *
 * `@UploadedFile()` is typed as the browser's `File`, which has no `buffer` —
 * the bytes are on the Multer type, and the global `Express.Multer` namespace
 * is not available in this project's tsconfig. Declared locally rather than
 * reaching for a cast at the use site.
 */
interface MulterFile {
  buffer: Buffer;
  mimetype: string;
  size: number;
  originalname: string;
}

/**
 * The public half of the pawn flow.
 *
 * Everything a prospective pawner can do before visiting: see which branches can
 * actually transact, price an item, submit an application. An application is a
 * quote and a booking — **never a loan**. A loan requires physical possession of
 * the collateral, and nothing in this controller creates one.
 *
 * Every route is `@Public()` and rate limited. These are unauthenticated and do
 * database work, which is exactly the combination worth bounding.
 */
@Controller('public/pawn')
export class PublicAppraisalController {
  constructor(private readonly service: PublicAppraisalService) {}

  /**
   * Branches currently able to accept pawns.
   *
   * Only shops with every required regulatory document verified and unexpired.
   * Advertising a branch and refusing at the counter is worse than not listing
   * it.
   */
  @Public()
  @Throttle({ ttl: 60_000, limit: 30 })
  @Get('branches')
  listBranches() {
    return this.service.listBranches();
  }

  /**
   * Price an item for a chosen branch. Read-only, creates nothing.
   *
   * `POST /loan/appraisal/quote` cannot serve this: it resolves the shop from
   * the *staff member's* profile, which is right at the counter and wrong for an
   * applicant, who has no profile and is choosing the shop.
   */
  @Public()
  @Throttle({ ttl: 60_000, limit: 20 })
  @Post('quote')
  @HttpCode(HttpStatus.OK)
  quote(@Body() dto: PublicQuoteDto) {
    return this.service.quote(dto);
  }

  /** Submit an application. */
  @Public()
  @Throttle({ ttl: 60 * 60_000, limit: 5 })
  @Post('reservations')
  create(
    @Body() dto: CreateReservationDto,
    @Query('submittedFrom') submittedFrom?: string,
  ) {
    return this.service.create(dto, submittedFrom);
  }

  /**
   * Attach a photograph for an application.
   *
   * The unauthenticated counterpart of `POST /auth/kyc/upload`, which needs an
   * account and so cannot serve someone applying from their phone.
   *
   * This is the one genuinely dangerous route here — an open write into object
   * storage — so the path is derived entirely on the server. A client-supplied
   * filename or folder would let a caller write anywhere in the bucket,
   * including over someone else's identity document, so neither is accepted. The
   * extension is chosen from an allowlist keyed off the declared MIME type, not
   * from the name, and the returned URL carries a random namespace that nobody
   * can guess ahead of the upload.
   */
  @Public()
  @Throttle({ ttl: 60 * 60_000, limit: 12 })
  @Post('uploads')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 8 * 1024 * 1024 } }))
  async upload(
    @UploadedFile() file: MulterFile | undefined,
    @Query('kind') kind?: string,
  ) {
    if (!file?.buffer) {
      throw new BadRequestException('No photograph was received. Please try again.');
    }
    // Only the three fields the service reads are handed over. The declared
    // `File` type is the browser's and has no `buffer`, which is where the
    // bytes actually are — the cast is the honest boundary, not a shortcut.
    return this.service.storeApplicantUpload(
      { buffer: file.buffer, mimetype: file.mimetype, size: file.size },
      kind,
    );
  }

  /**
   * Look an application up by reference.
   *
   * Unauthenticated by necessity — a pawner who applied from their phone has no
   * account — so the reference is the capability. It returns only what the
   * applicant already submitted plus the status, and never the identity
   * document URLs: a leaked reference should not leak someone's ID photographs.
   */
  @Public()
  @Throttle({ ttl: 60_000, limit: 30 })
  @Get('reservations/:reference')
  findOne(@Param('reference') reference: string) {
    return this.service.findByReference(reference);
  }

  /**
   * The shop-side queue of applications received.
   *
   * Tenant scoping is the caller's own, exactly as in
   * `pawn-ticket.controller.getPendingApproval`. A `?pawnshopId=` that took
   * precedence would let any account holding `pawn_ticket.create` name another
   * shop and read its applicants' names, phone numbers, addresses and item
   * descriptions — so the query param may only *narrow* the read, and only for
   * the platform operator.
   */
  @RequiresPermission(PERMISSIONS['pawn_ticket.create'])
  @Throttle({ ttl: 60_000, limit: 60 })
  @Get('reservations')
  listForShop(
    @Req() req: Request,
    @Query('pawnshopId') pawnshopId?: string,
    @Query('status') status?: string,
  ) {
    const user = (req as any).user as { role?: string; pawnshopId?: string } | undefined;
    const isPlatform = user?.role === 'SUPER_ADMIN';
    const callerPawnshopId = user?.pawnshopId ?? '';
    const scopedPawnshopId = isPlatform ? pawnshopId || callerPawnshopId : callerPawnshopId;

    if (!scopedPawnshopId) {
      throw new BadRequestException(
        'No pawnshop is associated with your account. Select a shop before viewing applications.',
      );
    }

    return this.service.listForShop(scopedPawnshopId, status);
  }
}
