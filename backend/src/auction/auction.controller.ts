import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { Throttle } from '../common/decorators/throttle.decorator';
import { AuctionService } from './auction.service';
import { AuctionAuthService } from './auction-auth.service';
import { AuctionPaymentService } from './auction-payment.service';
import { CreateAuctionListingDto } from './dto/create-auction-listing.dto';
import { ListAuctionListingsQueryDto } from './dto/list-auction-listings.dto';
import { PlaceBidDto } from './dto/place-bid.dto';
import { PublishAuctionListingDto } from './dto/publish-auction-listing.dto';
import { CreateAuctionRatingDto } from './dto/create-auction-rating.dto';

@Controller('auction')
export class AuctionController {
  private readonly logger = new Logger(AuctionController.name);

  constructor(
    private readonly auctionService: AuctionService,
    private readonly auctionAuthService: AuctionAuthService,
    private readonly auctionPaymentService: AuctionPaymentService,
  ) {}

  @Public()
  @Get('listings')
  listListings(@Query() query: ListAuctionListingsQueryDto) {
    return this.auctionService.listListings(query);
  }

  @Get('queue')
  async getQueue(
    @Headers('authorization') authHeader: string | undefined,
    @Query('branchId') branchId?: string,
  ) {
    const actorId = await this.auctionAuthService.getActorId(authHeader);
    return this.auctionService.getQueue(actorId, branchId);
  }

  @Public()
  @Get('listings/:id')
  getListing(@Param('id', ParseIntPipe) id: number) {
    return this.auctionService.getListing(id);
  }

  @Get('listings/:id/leaderboard')
  async getListingLeaderboard(
    @Param('id', ParseIntPipe) id: number,
    @Headers('authorization') authHeader: string | undefined,
  ) {
    const actorId = await this.auctionAuthService.getActorId(authHeader);
    return this.auctionService.getListingLeaderboard(id, actorId);
  }

  @Get('listings/:id/proofs')
  async getListingProofs(
    @Param('id', ParseIntPipe) id: number,
    @Headers('authorization') authHeader: string | undefined,
  ) {
    const actorId = await this.auctionAuthService.getActorId(authHeader);
    return this.auctionService.getListingProofs(id, actorId);
  }

  @Post('listings')
  async createListing(
    @Headers('authorization') authHeader: string | undefined,
    @Body() dto: CreateAuctionListingDto,
  ) {
    const actorId = await this.auctionAuthService.getActorId(authHeader);
    return this.auctionService.createListing(dto, actorId);
  }

  @Patch('listings/:id/publish')
  async publishListing(
    @Param('id', ParseIntPipe) id: number,
    @Headers('authorization') authHeader: string | undefined,
    @Body() dto: PublishAuctionListingDto,
  ) {
    const actorId = await this.auctionAuthService.getActorId(authHeader);
    return this.auctionService.publishListing(id, dto, actorId);
  }

  @Patch('listings/:id/cancel')
  async cancelListing(
    @Param('id', ParseIntPipe) id: number,
    @Headers('authorization') authHeader: string | undefined,
  ) {
    const actorId = await this.auctionAuthService.getActorId(authHeader);
    return this.auctionService.cancelListing(id, actorId);
  }

  @Patch('queue/:ticketId/return')
  async returnToVault(
    @Param('ticketId', ParseIntPipe) ticketId: number,
    @Headers('authorization') authHeader: string | undefined,
  ) {
    const actorId = await this.auctionAuthService.getActorId(authHeader);
    return this.auctionService.returnToVault(ticketId, actorId);
  }

  @Patch('queue/:ticketId/sold')
  async markSold(
    @Param('ticketId', ParseIntPipe) ticketId: number,
    @Headers('authorization') authHeader: string | undefined,
  ) {
    const actorId = await this.auctionAuthService.getActorId(authHeader);
    return this.auctionService.markSold(ticketId, actorId);
  }

  @Get('bidders/tos-status')
  async getBidderTosStatus(
    @Headers('authorization') authHeader: string | undefined,
  ) {
    const actorId = await this.auctionAuthService.getActorId(authHeader);
    return this.auctionService.getBidderTosStatus(actorId);
  }

  @Post('bidders/accept-tos')
  async acceptBidderTos(
    @Headers('authorization') authHeader: string | undefined,
    @Body('listingId') listingId: number,
    @Headers('x-forwarded-for') ipAddress?: string,
    @Headers('user-agent') userAgent?: string,
  ) {
    const actorId = await this.auctionAuthService.getActorId(authHeader);
    return this.auctionService.acceptBidderTos(actorId, listingId, ipAddress, userAgent);
  }

  @Throttle({ ttl: 60_000, limit: 10 })
  @Post('listings/:id/bids')
  async placeBid(
    @Param('id', ParseIntPipe) id: number,
    @Headers('authorization') authHeader: string | undefined,
    @Body() dto: PlaceBidDto,
  ) {
    const actorId = await this.auctionAuthService.getActorId(authHeader);
    return this.auctionService.placeBid(id, dto, actorId);
  }

  @Get('bidders/my-bids')
  async getMyBids(@Headers('authorization') authHeader: string | undefined) {
    const actorId = await this.auctionAuthService.getActorId(authHeader);
    return this.auctionService.getMyBids(actorId);
  }

  @Post('listings/:id/ratings')
  async createRating(
    @Param('id', ParseIntPipe) id: number,
    @Headers('authorization') authHeader: string | undefined,
    @Body() dto: CreateAuctionRatingDto,
  ) {
    const actorId = await this.auctionAuthService.getActorId(authHeader);
    return this.auctionService.createRating(id, dto, actorId);
  }

  @Public()
  @Get('listings/:id/ratings')
  getListingRatings(@Param('id', ParseIntPipe) id: number) {
    return this.auctionService.getListingRatings(id);
  }

  @Get('bidders/my-winnings')
  async getMyWinnings(@Headers('authorization') authHeader: string | undefined) {
    const actorId = await this.auctionAuthService.getActorId(authHeader);
    return this.auctionService.getMyWinnings(actorId);
  }

  @Post('bidders/me/pay/:complianceId')
  async createPaymentCheckout(
    @Param('complianceId') complianceId: string,
    @Headers('authorization') authHeader: string | undefined,
  ) {
    const actorId = await this.auctionAuthService.getActorId(authHeader);
    return this.auctionPaymentService.createCheckout(complianceId, actorId);
  }

  @Public()
  @Post('payments/webhook')
  @HttpCode(HttpStatus.OK)
  async handlePaymentWebhook(@Body() body: any) {
    const event = body?.data?.attributes?.type
      ? { type: body.data.attributes.type, data: body.data.attributes.data }
      : body;

    this.logger.log(`Payment webhook received: ${event.type || 'unknown'}`);

    if (event.type === 'payment.paid' || event.data?.attributes?.status === 'paid') {
      const attrs = event.data?.attributes;
      const metadata = attrs?.metadata || event.data?.metadata || {};
      const complianceId = metadata.complianceId || metadata?.complianceId;

      if (complianceId) {
        await this.auctionPaymentService.confirmPayment(
          complianceId,
          attrs?.id || event.data?.id || 'unknown',
          attrs?.source?.type || 'E_WALLET',
        );
      }
    }

    return { received: true };
  }

  @Public()
  @Post('payments/webhook/simulate')
  @HttpCode(HttpStatus.OK)
  async simulatePaymentWebhook(@Body() body: { complianceId: string }) {
    this.logger.log(`Simulating payment webhook for compliance ${body.complianceId}`);
    await this.auctionPaymentService.confirmPayment(
      body.complianceId,
      `SIM-${Date.now()}`,
      'SIMULATED',
    );
    return { received: true, simulated: true };
  }
}
