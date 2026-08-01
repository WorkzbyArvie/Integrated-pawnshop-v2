import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AuctionStatus } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { TOSService } from '../contract/tos.service';
import { ContractTemplateService } from '../contract/contract-template.service';
import { CreateAuctionListingDto } from './dto/create-auction-listing.dto';
import { ListAuctionListingsQueryDto } from './dto/list-auction-listings.dto';
import { PlaceBidDto } from './dto/place-bid.dto';
import { PublishAuctionListingDto } from './dto/publish-auction-listing.dto';
import { CreateAuctionRatingDto } from './dto/create-auction-rating.dto';
import { FinanceService } from '../finance/finance.service';
import { LedgerEntryType, LedgerCategory } from '@prisma/client';
import { createHash, randomUUID } from 'crypto';

@Injectable()
export class AuctionService {
  private readonly logger = new Logger(AuctionService.name);

  constructor(
    private prisma: PrismaService,
    private financeService: FinanceService,
    private tosService: TOSService,
    private contractTemplateService: ContractTemplateService,
  ) {}

  private normalizeRole(role?: string | null): string {
    const normalized = (role || '')
      .trim()
      .toUpperCase()
      .replace(/[\s-]+/g, '_');

    if (normalized === 'BRANCH_ADMIN') {
      return 'ADMIN';
    }
    if (normalized === 'SHOP_ADMIN') {
      return 'ADMIN';
    }
    if (normalized === 'SUPER') {
      return 'SUPER_ADMIN';
    }

    return normalized;
  }

  private async logAuctionAudit(params: {
    pawnshopId: string;
    actorUserId: string;
    action: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    try {
      await this.prisma.$executeRaw`
        INSERT INTO public.tenant_audit_logs
        (id, pawnshop_id, actor_user_id, action, metadata)
        VALUES (
          gen_random_uuid(),
          ${params.pawnshopId}::uuid,
          ${params.actorUserId}::uuid,
          ${params.action},
          ${JSON.stringify(params.metadata || {})}::jsonb
        )
      `;
    } catch {
      // Keep business flow non-blocking when audit table is unavailable.
    }
  }

  private hashPayload(payload: Record<string, unknown>): string {
    return createHash('sha256')
      .update(JSON.stringify(payload, Object.keys(payload).sort()))
      .digest('hex');
  }

  private async createAuctionProof(params: {
    pawnshopId: string;
    recordType: 'AUCTION_LISTING_PROOF' | 'AUCTION_PUBLISH_PROOF' | 'AUCTION_BID_PROOF';
    title: string;
    summary: string;
    createdBy: string;
    payload: Record<string, unknown>;
    auctionListingId?: number;
    auctionBidId?: number;
  }) {
    return this.prisma.legalProof.create({
      data: {
        proofNumber: `PROOF-${Date.now().toString(36).toUpperCase()}-${randomUUID().slice(0, 8).toUpperCase()}`,
        pawnshopId: params.pawnshopId,
        recordType: params.recordType as any,
        title: params.title,
        summary: params.summary,
        payload: params.payload as any,
        sourceHash: this.hashPayload(params.payload),
        createdBy: params.createdBy,
        auctionListingId: params.auctionListingId,
        auctionBidId: params.auctionBidId,
      },
    });
  }

  private async assertSuperAdminSupportAccess(
    actorId: string,
    pawnshopId: string,
    action: string,
  ): Promise<void> {
    const grants = await this.prisma.$queryRaw<Array<{ id: string; expires_at: Date }>>`
      SELECT id, expires_at
      FROM public.support_access_grants
      WHERE pawnshop_id = ${pawnshopId}::uuid
        AND granted_to = ${actorId}::uuid
        AND status = 'ACTIVE'
        AND expires_at > NOW()
      ORDER BY expires_at DESC
      LIMIT 1
    `;

    const grant = grants[0];
    if (!grant) {
      throw new ForbiddenException(
        'No active approved support-access grant for this pawnshop.',
      );
    }

    await this.logAuctionAudit({
      pawnshopId,
      actorUserId: actorId,
      action: 'SUPPORT_ACCESS_USED',
      metadata: {
        grantId: grant.id,
        requestedAction: action,
        expiresAt: grant.expires_at,
      },
    });
  }

  private isAdminRole(role?: string | null): boolean {
    const normalized = this.normalizeRole(role);
    return ['SUPER_ADMIN', 'OWNER', 'MANAGER', 'ADMIN'].includes(normalized);
  }

  private isMissingColumnError(error: unknown): boolean {
    const message = String((error as any)?.message || '').toLowerCase();
    return (
      message.includes('does not exist') &&
      (message.includes('column') || message.includes('auction_listings'))
    );
  }

  private isMissingTableOrColumnError(error: unknown): boolean {
    const message = String((error as any)?.message || '').toLowerCase();
    return (
      message.includes('does not exist') &&
      (message.includes('column') ||
        message.includes('relation') ||
        message.includes('auction_listings') ||
        message.includes('auction_images'))
    );
  }

  private isLegacySchemaBidError(error: unknown): boolean {
    const message = String((error as any)?.message || '').toLowerCase();
    return (
      this.isMissingTableOrColumnError(error) ||
      message.includes('unknown argument') ||
      message.includes('invalid invocation') ||
      message.includes('column') ||
      message.includes('relation')
    );
  }

  private async placeBidLegacyFallback(
    id: number,
    dto: PlaceBidDto,
    actorId: string,
    now: Date,
  ) {
    const rows = await this.prisma.$queryRaw<
      Array<{
        id: number;
        pawnshop_id: string;
        current_bid: number | null;
        starting_price: number | null;
        status: string;
      }>
    >`
      SELECT id, pawnshop_id, current_bid, starting_price, status
      FROM public.auction_listings
      WHERE id = ${id}
      LIMIT 1
    `;

    const listing = rows[0];
    if (!listing) {
      throw new NotFoundException('Auction listing not found');
    }

    if (listing.status !== 'LIVE') {
      throw new BadRequestException('Listing is not live');
    }

    const currentBid = Number(listing.current_bid ?? 0);
    const startingPrice = Number(listing.starting_price ?? 0);
    const effectiveCurrentBid = currentBid > 0 ? currentBid : startingPrice;
    const minimumBid = effectiveCurrentBid + 100;

    if (dto.amount < minimumBid || dto.amount <= currentBid) {
      throw new BadRequestException('Put Valid Amount');
    }

    const updated = await this.prisma.$executeRaw`
      UPDATE public.auction_listings
      SET current_bid = ${dto.amount}
      WHERE id = ${id}
        AND status = 'LIVE'
        AND COALESCE(current_bid, 0) < ${dto.amount}
    `;

    if (updated !== 1) {
      throw new ConflictException('Bid conflict, please try again');
    }

    await this.logAuctionAudit({
      pawnshopId: listing.pawnshop_id,
      actorUserId: actorId,
      action: 'AUCTION_BID_PLACED_LEGACY_FALLBACK',
      metadata: {
        listingId: id,
        bidId: null,
        amount: dto.amount,
        legacyFallback: true,
        at: now.toISOString(),
      },
    });

    return {
      bidId: null,
      listingId: id,
      currentBid: dto.amount,
      minBidIncrement: 100,
      nextMinimumBid: dto.amount + 100,
      endAt: null,
      extended: false,
      legacyFallback: true,
    };
  }

  private composeTransparentDescription(
    baseDescription: string | null,
    dto: CreateAuctionListingDto,
  ): string | null {
    const sections: string[] = [];

    if (dto.itemCondition?.trim()) {
      sections.push(`Condition: ${dto.itemCondition.trim()}`);
    }
    if (dto.itemSpecifications?.trim()) {
      sections.push(`Specifications: ${dto.itemSpecifications.trim()}`);
    }
    if (dto.provenanceDetails?.trim()) {
      sections.push(`Provenance: ${dto.provenanceDetails.trim()}`);
    }
    if (dto.disclosureNotes?.trim()) {
      sections.push(`Disclosures: ${dto.disclosureNotes.trim()}`);
    }

    if (sections.length === 0) {
      return baseDescription;
    }

    const detailBlock = `\n\nAuction Transparency Details\n${sections.join('\n')}`;
    return `${baseDescription || ''}${detailBlock}`.trim();
  }

  private async requireAdminForPawnshop(actorId: string, pawnshopId: string) {
    const profile = await this.prisma.profile.findUnique({
      where: { id: actorId },
      select: { role: true, pawnshopId: true },
    });

    if (!profile || !this.isAdminRole(profile.role)) {
      throw new ForbiddenException('Insufficient permissions');
    }

    const role = this.normalizeRole(profile.role);
    if (role === 'SUPER_ADMIN') {
      await this.assertSuperAdminSupportAccess(
        actorId,
        pawnshopId,
        'AUCTION_ADMIN_ACTION',
      );
      return;
    }

    if (profile.pawnshopId !== pawnshopId) {
      throw new ForbiddenException('Cross-pawnshop access denied');
    }
  }

  async createListing(dto: CreateAuctionListingDto, actorId: string) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: dto.ticketId },
      select: {
        id: true,
        pawnshopId: true,
        description: true,
        ticketNumber: true,
        category: true,
      },
    });

    if (!ticket) {
      throw new NotFoundException('Ticket not found');
    }

    if (!ticket.pawnshopId) {
      throw new BadRequestException('Ticket is missing pawnshop association');
    }

    await this.requireAdminForPawnshop(actorId, ticket.pawnshopId);

    const existing = await this.prisma.auctionListing.findUnique({
      where: { ticketId: ticket.id },
      select: { id: true },
    });

    if (existing) {
      throw new ConflictException(
        'Auction listing already exists for this ticket',
      );
    }

    if (dto.reservePrice && dto.reservePrice < dto.startingPrice) {
      throw new BadRequestException('Reserve price must be >= starting price');
    }

    const title =
      dto.title?.trim() ||
      ticket.description ||
      `Ticket ${ticket.ticketNumber}`;
    const baseDescription = dto.description?.trim() || ticket.description || null;
    const description = this.composeTransparentDescription(baseDescription, dto);

    const listing = await this.prisma.$transaction(async (tx) => {
      let listing;
      try {
        listing = await tx.auctionListing.create({
          data: {
            ticketId: ticket.id,
            pawnshopId: ticket.pawnshopId,
            title,
            description,
            startingPrice: dto.startingPrice,
            reservePrice: dto.reservePrice,
            minBidIncrement: dto.minBidIncrement ?? 100,
            bidExtensionMin: dto.bidExtensionMin ?? 5,
            status: AuctionStatus.DRAFT,
          } as any,
          select: {
            id: true,
            ticketId: true,
            pawnshopId: true,
            status: true,
            startAt: true,
            endAt: true,
            publishedAt: true,
          },
        });
      } catch (error) {
        if (!this.isMissingColumnError(error)) {
          throw error;
        }

        // Backward-compatible fallback for environments that have not applied
        // newer auction columns yet.
        listing = await tx.auctionListing.create({
          data: {
            ticketId: ticket.id,
            pawnshopId: ticket.pawnshopId,
            title,
            description,
            startingPrice: dto.startingPrice,
            reservePrice: dto.reservePrice,
            status: AuctionStatus.DRAFT,
          } as any,
          select: {
            id: true,
            ticketId: true,
            pawnshopId: true,
            status: true,
            startAt: true,
            endAt: true,
            publishedAt: true,
          },
        });
      }

      if (dto.imageUrls && dto.imageUrls.length > 0) {
        try {
          await tx.auctionImage.createMany({
            data: dto.imageUrls.map((url, index) => ({
              listingId: listing.id,
              url,
              sortOrder: index,
            })),
          });
        } catch (error) {
          if (!this.isMissingTableOrColumnError(error)) {
            throw error;
          }
          // Legacy schema fallback: keep listing creation successful even if
          // auction image table/columns are not present yet.
        }
      }

      return listing;
    }, {
      maxWait: 10000,
      timeout: 15000,
    });

    await this.logAuctionAudit({
      pawnshopId: ticket.pawnshopId,
      actorUserId: actorId,
      action: 'AUCTION_LISTING_CREATED',
      metadata: {
        listingId: listing.id,
        ticketId: ticket.id,
        startingPrice: dto.startingPrice,
        reservePrice: dto.reservePrice ?? null,
      },
    });

    await this.createAuctionProof({
      pawnshopId: ticket.pawnshopId,
      recordType: 'AUCTION_LISTING_PROOF',
      title: `Auction listing created for ${ticket.ticketNumber}`,
      summary: `Listing ${listing.id} was created from ticket ${ticket.ticketNumber}.`,
      createdBy: actorId,
      auctionListingId: listing.id,
      payload: {
        listingId: listing.id,
        ticketId: ticket.id,
        ticketNumber: ticket.ticketNumber,
        title,
        description,
        startingPrice: dto.startingPrice,
        reservePrice: dto.reservePrice ?? null,
        minBidIncrement: dto.minBidIncrement ?? 100,
        bidExtensionMin: dto.bidExtensionMin ?? 5,
      },
    });

    return listing;
  }

  async publishListing(
    id: number,
    dto: PublishAuctionListingDto,
    actorId: string,
  ) {
    const listing = await this.prisma.auctionListing.findUnique({
      where: { id },
      select: { id: true, status: true, pawnshopId: true },
    });

    if (!listing) {
      throw new NotFoundException('Auction listing not found');
    }

    await this.requireAdminForPawnshop(actorId, listing.pawnshopId);

    const startAt = dto.startAt ? new Date(dto.startAt) : new Date();

    let endAt: Date;
    if (dto.endAt) {
      endAt = new Date(dto.endAt);
    } else if (dto.durationHours) {
      endAt = new Date(startAt.getTime() + dto.durationHours * 60 * 60 * 1000);
    } else {
      // Default 7 days
      endAt = new Date(startAt.getTime() + 7 * 24 * 60 * 60 * 1000);
    }

    if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
      throw new BadRequestException('Invalid start or end date');
    }

    if (endAt <= startAt) {
      throw new BadRequestException('End time must be after start time');
    }

    const now = new Date();
    const status = startAt > now ? AuctionStatus.SCHEDULED : AuctionStatus.LIVE;

    let published;
    try {
      published = await this.prisma.auctionListing.update({
        where: { id },
        data: {
          startAt,
          endAt,
          status,
          publishedAt: now,
          updatedAt: now,
        },
        select: {
          id: true,
          status: true,
          startAt: true,
          endAt: true,
          publishedAt: true,
        },
      });
    } catch (error) {
      if (!this.isMissingColumnError(error)) {
        throw error;
      }

      published = await this.prisma.auctionListing.update({
        where: { id },
        data: {
          startAt,
          endAt,
          status,
          updatedAt: now,
        },
        select: {
          id: true,
          status: true,
          startAt: true,
          endAt: true,
          publishedAt: true,
        },
      });
    }

    await this.logAuctionAudit({
      pawnshopId: listing.pawnshopId,
      actorUserId: actorId,
      action: 'AUCTION_LISTING_PUBLISHED',
      metadata: {
        listingId: id,
        startAt,
        endAt,
        status,
      },
    });

    await this.createAuctionProof({
      pawnshopId: listing.pawnshopId,
      recordType: 'AUCTION_PUBLISH_PROOF',
      title: `Auction listing published: #${id}`,
      summary: `Listing ${id} was published with status ${status}.`,
      createdBy: actorId,
      auctionListingId: id,
      payload: {
        listingId: id,
        startAt,
        endAt,
        status,
      },
    });

    return published;
  }

  async listListings(query: ListAuctionListingsQueryDto) {
    const where: any = {};

    if (query.status) {
      where.status = query.status;
    } else {
      where.status = AuctionStatus.LIVE;
    }

    if (query.pawnshopId) {
      where.pawnshopId = query.pawnshopId;
    }

    if (query.branchId) {
      where.ticket = { is: { branchId: query.branchId } };
    }

    if (query.categoryId) {
      where.categoryId = query.categoryId;
    }

    if (query.search) {
      const search = query.search.trim();
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { ticket: { description: { contains: search, mode: 'insensitive' } } },
        { ticket: { category: { contains: search, mode: 'insensitive' } } },
      ];
    }

    const take = Math.min(query.limit ?? 12, 50);
    let listings: any[] = [];

    try {
      listings = await this.prisma.auctionListing.findMany({
        where,
        take: take + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
        orderBy: { id: 'desc' },
        include: {
          pawnshop: { select: { id: true, name: true, logoUrl: true } },
          category: { select: { id: true, name: true } },
          ticket: {
            select: {
              id: true,
              ticketNumber: true,
              category: true,
              description: true,
            },
          },
          images: true,
        },
      });
    } catch (error) {
      if (
        !this.isMissingTableOrColumnError(error) &&
        !this.isMissingColumnError(error)
      ) {
        this.logger.warn(
          `Public listings fallback activated: ${String((error as any)?.message || error)}`,
        );
        return { items: [], nextCursor: null };
      }

      // Do not break public auction pages on legacy schemas.
      return { items: [], nextCursor: null };
    }

    const hasMore = listings.length > take;
    const items = hasMore ? listings.slice(0, take) : listings;
    const nextCursor = hasMore ? (items[items.length - 1]?.id ?? null) : null;

    return { items, nextCursor };
  }

  async getListing(id: number) {
    const listing = await this.prisma.auctionListing.findUnique({
      where: { id },
      include: {
        pawnshop: { select: { id: true, name: true, logoUrl: true } },
        category: { select: { id: true, name: true } },
        ticket: {
          select: {
            id: true,
            ticketNumber: true,
            category: true,
            description: true,
          },
        },
        images: true,
        bids: { orderBy: { createdAt: 'desc' }, take: 10 },
      },
    });

    if (!listing) {
      throw new NotFoundException('Auction listing not found');
    }

    return listing;
  }

  async getListingProofs(id: number, actorId: string) {
    const listing = await this.prisma.auctionListing.findUnique({
      where: { id },
      select: { id: true, pawnshopId: true },
    });

    if (!listing) {
      throw new NotFoundException('Auction listing not found');
    }

    await this.requireAdminForPawnshop(actorId, listing.pawnshopId);

    return this.prisma.legalProof.findMany({
      where: { auctionListingId: id },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getListingLeaderboard(id: number, actorId: string) {
    const listing = await this.prisma.auctionListing.findUnique({
      where: { id },
      select: { id: true, pawnshopId: true },
    });

    if (!listing) {
      throw new NotFoundException('Auction listing not found');
    }

    await this.requireAdminForPawnshop(actorId, listing.pawnshopId);

    const groupedBids = await this.prisma.auctionBid.groupBy({
      by: ['bidderId'],
      where: { listingId: id },
      _max: { amount: true, createdAt: true },
      _count: { _all: true },
    });

    if (groupedBids.length === 0) {
      return {
        listingId: id,
        totalBidders: 0,
        topBidders: [],
      };
    }

    const bidderIds = groupedBids.map((row) => row.bidderId);
    const profiles = await this.prisma.profile.findMany({
      where: { id: { in: bidderIds } },
      select: {
        id: true,
        email: true,
        fullName: true,
        kyc: { select: { fullName: true } },
      },
    });

    const profileById = new Map(profiles.map((profile) => [profile.id, profile]));

    const ranked = groupedBids
      .map((row) => {
        const profile = profileById.get(row.bidderId);
        const highestBid = row._max.amount || 0;
        const displayName =
          profile?.kyc?.fullName ||
          profile?.fullName ||
          profile?.email ||
          `Bidder ${row.bidderId.slice(0, 8)}`;

        return {
          bidderId: row.bidderId,
          bidderName: displayName,
          bidderEmail: profile?.email || null,
          highestBid,
          totalBids: row._count._all,
          lastBidAt: row._max.createdAt,
        };
      })
      .sort((a, b) => {
        if (b.highestBid !== a.highestBid) {
          return b.highestBid - a.highestBid;
        }

        const aTime = a.lastBidAt ? new Date(a.lastBidAt).getTime() : 0;
        const bTime = b.lastBidAt ? new Date(b.lastBidAt).getTime() : 0;
        return bTime - aTime;
      });

    return {
      listingId: id,
      totalBidders: ranked.length,
      topBidders: ranked.slice(0, 3).map((entry, index) => ({
        rank: index + 1,
        ...entry,
      })),
      recentBidders: ranked,
    };
  }

  async placeBid(id: number, dto: PlaceBidDto, actorId: string) {
    if (!Number.isFinite(dto.amount) || dto.amount <= 0) {
      throw new BadRequestException('Put Valid Amount');
    }

    // Verify the bidder has a valid profile
    let bidderProfile = await this.prisma.profile.findUnique({
      where: { id: actorId },
      select: { role: true, pawnshopId: true },
    });

    if (!bidderProfile) {
      // Backfill profile for customer accounts created outside the staff app.
      try {
        await this.prisma.profile.create({
          data: {
            id: actorId,
            role: 'CUSTOMER',
          },
        });
      } catch {
        // Ignore duplicate-create races and re-read profile below.
      }

      bidderProfile = await this.prisma.profile.findUnique({
        where: { id: actorId },
        select: { role: true, pawnshopId: true },
      });

      if (!bidderProfile) {
        throw new ForbiddenException(
          'No profile found for your account. Please register first.',
        );
      }
    }

    // Require KYC verification for bidders.
    let kyc: { status: string } | null = null;
    try {
      kyc = await this.prisma.bidderKyc.findUnique({
        where: { profileId: actorId },
        select: { status: true },
      });
    } catch (error: any) {
      this.logger.error(`Failed KYC lookup for bidder ${actorId}: ${error?.message || error}`);
      throw new BadRequestException(
        'Unable to verify your KYC status right now. Please try again in a moment.',
      );
    }

    if (!kyc || kyc.status !== 'VERIFIED') {
      const statusMsg =
        !kyc || kyc.status === 'NOT_SUBMITTED'
          ? 'You must complete ID verification (KYC) before placing bids.'
          : kyc.status === 'PENDING'
            ? 'Your ID verification is under review. Please wait for admin approval before placing bids.'
            : 'Your ID verification was rejected. Please re-submit with valid documents.';
      throw new ForbiddenException(statusMsg);
    }

    // Require TOS acceptance before bidding
    const hasAcceptedTos = await this.tosService.hasAccepted(actorId, 'AUCTION_BIDDER_AGREEMENT');
    if (!hasAcceptedTos) {
      throw new ForbiddenException(
        'You must accept the Auction Bidder Agreement before placing bids.',
      );
    }

    const now = new Date();

    try {
      return await this.prisma.$transaction(async (tx) => {
        let listing: any;
        try {
          listing = (await tx.auctionListing.findUnique({
            where: { id },
            select: {
              id: true,
              pawnshopId: true,
              currentBid: true,
              startingPrice: true,
              minBidIncrement: true,
              bidExtensionMin: true,
              status: true,
              endAt: true,
              startAt: true,
            } as any,
          })) as any;
        } catch (error) {
          if (!this.isMissingColumnError(error)) {
            throw error;
          }

          // Legacy schema fallback if increment/extension columns are unavailable.
          try {
            listing = (await tx.auctionListing.findUnique({
              where: { id },
              select: {
                id: true,
                pawnshopId: true,
                currentBid: true,
                startingPrice: true,
                status: true,
                endAt: true,
                startAt: true,
              } as any,
            })) as any;
          } catch (fallbackError) {
            if (!this.isMissingColumnError(fallbackError)) {
              throw fallbackError;
            }

            // Minimal legacy fallback if time-window columns are also unavailable.
            listing = (await tx.auctionListing.findUnique({
              where: { id },
              select: {
                id: true,
                pawnshopId: true,
                currentBid: true,
                startingPrice: true,
                status: true,
              } as any,
            })) as any;
            if (listing) {
              listing.startAt = null;
              listing.endAt = null;
            }
          }

          if (listing) {
            listing.minBidIncrement = listing.minBidIncrement ?? 100;
            listing.bidExtensionMin = listing.bidExtensionMin ?? 5;
          }
        }

        if (!listing) {
          throw new NotFoundException('Auction listing not found');
        }

        if (listing.status !== AuctionStatus.LIVE) {
          throw new BadRequestException('Listing is not live');
        }

        if (listing.startAt && listing.startAt > now) {
          throw new BadRequestException('Listing has not started yet');
        }

        if (listing.endAt && listing.endAt <= now) {
          throw new BadRequestException('Listing has ended');
        }

        // Minimum bid validation
        const effectiveCurrentBid =
          listing.currentBid > 0 ? listing.currentBid : listing.startingPrice;
        const minimumBid = effectiveCurrentBid + (listing.minBidIncrement || 100);

        if (dto.amount < minimumBid) {
          throw new BadRequestException('Put Valid Amount');
        }

        if (dto.amount <= listing.currentBid) {
          throw new BadRequestException('Put Valid Amount');
        }

        // Anti-sniping: extend auction if bid placed in last N minutes
        const extensionMinutes = listing.bidExtensionMin || 5;
        let newEndAt = listing.endAt;
        if (listing.endAt) {
          const msUntilEnd = listing.endAt.getTime() - now.getTime();
          const extensionThresholdMs = extensionMinutes * 60 * 1000;
          if (msUntilEnd > 0 && msUntilEnd < extensionThresholdMs) {
            newEndAt = new Date(now.getTime() + extensionThresholdMs);
          }
        }

        let updateResult;
        try {
          updateResult = await tx.auctionListing.updateMany({
            where: { id, currentBid: listing.currentBid },
            data: {
              currentBid: dto.amount,
              bidCount: { increment: 1 },
              ...(newEndAt !== listing.endAt ? { endAt: newEndAt } : {}),
            },
          });
        } catch (error) {
          if (!this.isMissingColumnError(error)) {
            throw error;
          }

          // Legacy schema fallback when bidCount column is unavailable.
          updateResult = await tx.auctionListing.updateMany({
            where: { id, currentBid: listing.currentBid },
            data: {
              currentBid: dto.amount,
              ...(newEndAt !== listing.endAt ? { endAt: newEndAt } : {}),
            },
          });
        }

        if (updateResult.count !== 1) {
          throw new ConflictException('Bid conflict, please try again');
        }

        let bid: { id: number } | null = null;
        try {
          bid = await tx.auctionBid.create({
            data: {
              listingId: id,
              bidderId: actorId,
              amount: dto.amount,
            },
          });
        } catch (error) {
          // Keep bidding functional even if bid-history schema differs in production.
          this.logger.warn(
            `Bid history insert skipped for listing ${id}: ${String((error as any)?.message || error)}`,
          );
        }

        await this.logAuctionAudit({
          pawnshopId: listing.pawnshopId,
          actorUserId: actorId,
          action: 'AUCTION_BID_PLACED',
          metadata: {
            listingId: id,
            bidId: bid?.id ?? null,
            amount: dto.amount,
            extended: newEndAt !== listing.endAt,
          },
        });

        if (bid?.id) {
          await this.createAuctionProof({
            pawnshopId: listing.pawnshopId,
            recordType: 'AUCTION_BID_PROOF',
            title: `Bid placed on listing ${id}`,
            summary: `Bid of ₱${dto.amount.toFixed(2)} was placed on listing ${id}.`,
            createdBy: actorId,
            auctionListingId: id,
            auctionBidId: bid.id,
            payload: {
              listingId: id,
              bidId: bid.id,
              amount: dto.amount,
              extended: newEndAt !== listing.endAt,
              nextMinimumBid: dto.amount + (listing.minBidIncrement || 100),
            },
          });
        }

        return {
          bidId: bid?.id ?? null,
          listingId: id,
          currentBid: dto.amount,
          minBidIncrement: listing.minBidIncrement,
          nextMinimumBid: dto.amount + (listing.minBidIncrement || 100),
          endAt: newEndAt,
          extended: newEndAt !== listing.endAt,
        };
      });
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof ForbiddenException ||
        error instanceof NotFoundException ||
        error instanceof ConflictException
      ) {
        throw error;
      }

      this.logger.warn(
        `Using legacy bid fallback for listing ${id}: ${String((error as any)?.message || error)}`,
      );
      return this.placeBidLegacyFallback(id, dto, actorId, now);
    }
  }

  async acceptBidderTos(
    actorId: string,
    listingId?: number,
    ipAddress?: string,
    userAgent?: string,
  ) {
    let pawnshopId: string | null = null;

    if (listingId && listingId > 0) {
      const listing = await this.prisma.auctionListing.findUnique({
        where: { id: listingId },
        select: { pawnshopId: true },
      });
      pawnshopId = listing?.pawnshopId ?? null;
    }

    if (!pawnshopId) {
      const profile = await this.prisma.profile.findUnique({
        where: { id: actorId },
        select: { pawnshopId: true },
      });
      pawnshopId = profile?.pawnshopId ?? null;
    }

    if (!pawnshopId) {
      const anyListing = await this.prisma.auctionListing.findFirst({
        where: { status: 'LIVE' },
        select: { pawnshopId: true },
        orderBy: { id: 'desc' },
      });
      pawnshopId = anyListing?.pawnshopId ?? null;
    }

    if (!pawnshopId) {
      throw new BadRequestException('Unable to determine pawnshop for TOS acceptance');
    }

    const templates = await this.contractTemplateService.listTemplates('AUCTION_BIDDER_AGREEMENT');
    const latestTemplate = templates[0];
    const tosVersion = latestTemplate?.version || '1.0';

    return this.tosService.acceptTOS({
      profileId: actorId,
      pawnshopId,
      contractType: 'AUCTION_BIDDER_AGREEMENT',
      tosVersion,
      ipAddress,
      userAgent,
    });
  }

  async getBidderTosStatus(actorId: string) {
    const accepted = await this.tosService.hasAccepted(actorId, 'AUCTION_BIDDER_AGREEMENT');
    const acceptance = accepted
      ? await this.tosService.getAcceptance(actorId, 'AUCTION_BIDDER_AGREEMENT')
      : null;

    return {
      accepted,
      tosVersion: acceptance?.tosVersion || null,
      acceptedAt: acceptance?.acceptedAt || null,
    };
  }

  async getMyBids(actorId: string) {
    const bids = await this.prisma.auctionBid.findMany({
      where: { bidderId: actorId },
      orderBy: { createdAt: 'desc' },
      include: {
        listing: {
          include: {
            pawnshop: { select: { id: true, name: true, logoUrl: true } },
            images: { orderBy: { sortOrder: 'asc' }, take: 1 },
          },
        },
      },
    });

    const grouped = new Map<number, {
      listingId: number;
      listingTitle: string;
      pawnshopName: string;
      pawnshopLogoUrl: string | null;
      imageUrl: string | null;
      currentBid: number;
      listingStatus: string;
      myMaxBid: number;
      myBidCount: number;
      lastBidAt: Date;
    }>();

    for (const bid of bids) {
      const existing = grouped.get(bid.listingId);
      if (existing) {
        existing.myMaxBid = Math.max(existing.myMaxBid, bid.amount);
        existing.myBidCount++;
        if (bid.createdAt > existing.lastBidAt) {
          existing.lastBidAt = bid.createdAt;
        }
      } else {
        grouped.set(bid.listingId, {
          listingId: bid.listingId,
          listingTitle: bid.listing.title,
          pawnshopName: bid.listing.pawnshop.name,
          pawnshopLogoUrl: bid.listing.pawnshop.logoUrl,
          imageUrl: bid.listing.images[0]?.url || null,
          currentBid: bid.listing.currentBid,
          listingStatus: bid.listing.status,
          myMaxBid: bid.amount,
          myBidCount: 1,
          lastBidAt: bid.createdAt,
        });
      }
    }

    return Array.from(grouped.values());
  }

  async cancelListing(id: number, actorId: string) {
    const listing = await this.prisma.auctionListing.findUnique({
      where: { id },
      select: { id: true, status: true, pawnshopId: true, ticketId: true },
    });

    if (!listing) {
      throw new NotFoundException('Auction listing not found');
    }

    await this.requireAdminForPawnshop(actorId, listing.pawnshopId);

    if (listing.status === AuctionStatus.ENDED) {
      throw new BadRequestException('Ended listings cannot be cancelled');
    }

    const now = new Date();

    const cancelled = await this.prisma.auctionListing.update({
      where: { id },
      data: {
        status: AuctionStatus.CANCELLED,
        updatedAt: now,
      },
      include: {
        pawnshop: { select: { id: true, name: true, logoUrl: true } },
        category: { select: { id: true, name: true } },
        ticket: {
          select: {
            id: true,
            ticketNumber: true,
            category: true,
            description: true,
          },
        },
        images: true,
      },
    });

    await this.prisma.ticket.update({
      where: { id: listing.ticketId },
      data: { status: 'AUCTION', updatedAt: now },
    });

    await this.logAuctionAudit({
      pawnshopId: listing.pawnshopId,
      actorUserId: actorId,
      action: 'AUCTION_LISTING_CANCELLED',
      metadata: {
        listingId: id,
        ticketId: listing.ticketId,
      },
    });

    return cancelled;
  }

  async getQueue(actorId: string, branchId?: string) {
    const profile = await this.prisma.profile.findUnique({
      where: { id: actorId },
      select: { role: true, pawnshopId: true },
    });

    if (!profile || !this.isAdminRole(profile.role)) {
      throw new ForbiddenException('Insufficient permissions');
    }

    if (!profile.pawnshopId) {
      throw new BadRequestException('Pawnshop context is required');
    }

    const normalizedBranchId =
      branchId && Number.isFinite(Number(branchId)) && Number(branchId) > 0
        ? Number(branchId)
        : undefined;

    const tickets = await this.prisma.ticket.findMany({
      where: {
        pawnshopId: profile.pawnshopId,
        status: 'AUCTION',
        ...(normalizedBranchId !== undefined
          ? { branchId: normalizedBranchId }
          : {}),
      },
      select: {
        id: true,
        ticketNumber: true,
        description: true,
        category: true,
        loanAmount: true,
        expiryDate: true,
        auctionListing: {
          select: {
            id: true,
            status: true,
          },
        },
      },
      orderBy: { id: 'desc' },
    });

    return tickets.map((ticket) => ({
      id: ticket.id,
      ticketNumber: ticket.ticketNumber,
      description: ticket.description,
      category: ticket.category,
      loanAmount: ticket.loanAmount,
      expiryDate: ticket.expiryDate,
      listingId: ticket.auctionListing?.id ?? null,
      listingStatus: ticket.auctionListing?.status ?? null,
    }));
  }

  async returnToVault(ticketId: number, actorId: string) {
    const profile = await this.prisma.profile.findUnique({
      where: { id: actorId },
      select: { role: true, pawnshopId: true },
    });

    if (!profile || !this.isAdminRole(profile.role)) {
      throw new ForbiddenException('Insufficient permissions');
    }

    if (!profile.pawnshopId) {
      throw new BadRequestException('Pawnshop context is required');
    }

    const result = await this.prisma.ticket.updateMany({
      where: { id: ticketId, pawnshopId: profile.pawnshopId },
      data: { status: 'ACTIVE', updatedAt: new Date() },
    });

    if (result.count === 0) {
      throw new NotFoundException('Ticket not found');
    }

    await this.logAuctionAudit({
      pawnshopId: profile.pawnshopId,
      actorUserId: actorId,
      action: 'AUCTION_TICKET_RETURNED_TO_VAULT',
      metadata: {
        ticketId,
      },
    });

    return { id: ticketId, status: 'ACTIVE' };
  }

  async markSold(ticketId: number, actorId: string) {
    const profile = await this.prisma.profile.findUnique({
      where: { id: actorId },
      select: { role: true, pawnshopId: true },
    });

    if (!profile || !this.isAdminRole(profile.role)) {
      throw new ForbiddenException('Insufficient permissions');
    }

    if (!profile.pawnshopId) {
      throw new BadRequestException('Pawnshop context is required');
    }

    // Get ticket + listing info for the ledger entry
    const ticket = await this.prisma.ticket.findFirst({
      where: { id: ticketId, pawnshopId: profile.pawnshopId },
      select: {
        id: true,
        ticketNumber: true,
        loanAmount: true,
        auctionListing: { select: { id: true, currentBid: true, title: true } },
      },
    });

    const result = await this.prisma.ticket.updateMany({
      where: { id: ticketId, pawnshopId: profile.pawnshopId },
      data: { status: 'REDEEMED', updatedAt: new Date() },
    });

    if (result.count === 0) {
      throw new NotFoundException('Ticket not found');
    }

    // Record auction sale in finance ledger
    try {
      const saleAmount =
        ticket?.auctionListing?.currentBid || ticket?.loanAmount || 0;
      if (saleAmount > 0) {
        await this.financeService.createEntry(profile.pawnshopId, {
          entryType: LedgerEntryType.CREDIT,
          category: LedgerCategory.AUCTION_PAYMENT,
          amount: saleAmount,
          description: `Auction sale: ${ticket?.auctionListing?.title || 'Ticket #' + ticket?.ticketNumber} (Bid: ₱${saleAmount.toLocaleString()})`,
          performedBy: actorId,
          referenceType: 'AUCTION',
          referenceId: String(ticket?.auctionListing?.id || ticketId),
        });
      }
    } catch (err) {
      console.error(
        'Failed to create finance ledger entry for auction sale:',
        err,
      );
    }

    await this.logAuctionAudit({
      pawnshopId: profile.pawnshopId,
      actorUserId: actorId,
      action: 'AUCTION_TICKET_MARKED_SOLD',
      metadata: {
        ticketId,
        listingId: ticket?.auctionListing?.id ?? null,
        saleAmount:
          ticket?.auctionListing?.currentBid || ticket?.loanAmount || 0,
      },
    });

    return { id: ticketId, status: 'REDEEMED' };
  }

  // ==================== RATING METHODS ====================

  async createRating(
    listingId: number,
    dto: CreateAuctionRatingDto,
    actorId: string,
  ) {
    const listing = await this.prisma.auctionListing.findUnique({
      where: { id: listingId },
      select: { id: true, status: true },
    });

    if (!listing) {
      throw new NotFoundException('Auction listing not found');
    }

    if (
      listing.status !== AuctionStatus.ENDED &&
      listing.status !== AuctionStatus.CANCELLED
    ) {
      throw new BadRequestException(
        'Can only rate completed or cancelled auctions',
      );
    }

    // Check if user already rated this type
    const existing = await this.prisma.auctionRating.findFirst({
      where: {
        listingId,
        customerId: actorId,
        ratingType: dto.ratingType as any,
      },
    });

    if (existing) {
      // Update existing rating
      const updated = await this.prisma.auctionRating.update({
        where: { id: existing.id },
        data: {
          rating: dto.rating,
          comment: dto.comment,
        },
      });

      const listingScope = await this.prisma.auctionListing.findUnique({
        where: { id: listingId },
        select: { pawnshopId: true },
      });

      if (listingScope?.pawnshopId) {
        await this.logAuctionAudit({
          pawnshopId: listingScope.pawnshopId,
          actorUserId: actorId,
          action: 'AUCTION_RATING_UPDATED',
          metadata: {
            listingId,
            ratingType: dto.ratingType,
            rating: dto.rating,
          },
        });
      }

      return updated;
    }

    const created = await this.prisma.auctionRating.create({
      data: {
        listingId,
        customerId: actorId,
        rating: dto.rating,
        comment: dto.comment,
        ratingType: dto.ratingType as any,
      },
    });

    const listingScope = await this.prisma.auctionListing.findUnique({
      where: { id: listingId },
      select: { pawnshopId: true },
    });

    if (listingScope?.pawnshopId) {
      await this.logAuctionAudit({
        pawnshopId: listingScope.pawnshopId,
        actorUserId: actorId,
        action: 'AUCTION_RATING_CREATED',
        metadata: {
          listingId,
          ratingId: created.id,
          ratingType: dto.ratingType,
          rating: dto.rating,
        },
      });
    }

    return created;
  }

  async getListingRatings(listingId: number) {
    const listing = await this.prisma.auctionListing.findUnique({
      where: { id: listingId },
      select: { id: true },
    });

    if (!listing) {
      throw new NotFoundException('Auction listing not found');
    }

    const ratings = await this.prisma.auctionRating.findMany({
      where: { listingId },
      orderBy: { createdAt: 'desc' },
      include: {
        customer: { select: { fullName: true } },
      },
    });

    const avgRating =
      ratings.length > 0
        ? ratings.reduce((sum, r) => sum + r.rating, 0) / ratings.length
        : 0;

    return {
      ratings,
      averageRating: Math.round(avgRating * 10) / 10,
      totalRatings: ratings.length,
    };
  }

  async getMyWinnings(actorId: string) {
    const winnings = await this.prisma.auctionWinnerCompliance.findMany({
      where: { winnerId: actorId },
      orderBy: { createdAt: 'desc' },
      include: {
        listing: {
          include: {
            pawnshop: { select: { id: true, name: true, logoUrl: true } },
            images: { orderBy: { sortOrder: 'asc' }, take: 1 },
          },
        },
      },
    });

    return winnings.map((w) => ({
      id: w.id,
      listingId: w.listingId,
      listingTitle: w.listing.title,
      listingStatus: w.listing.status,
      pawnshopName: w.listing.pawnshop.name,
      pawnshopLogoUrl: w.listing.pawnshop.logoUrl,
      imageUrl: w.listing.images[0]?.url || null,
      winningBid: w.winningBid,
      status: w.status,
      createdAt: w.createdAt,
      compliedAt: w.compliedAt,
      complianceDeadline: w.complianceDeadline,
      paymentReference: w.paymentReference,
      contractSignedAt: w.contractSignedAt,
      signedName: w.signedName,
    }));
  }

  async listSettlements(
    pawnshopId: string,
    status?: string,
    limit = 20,
    offset = 0,
  ) {
    const where: any = { pawnshopId };
    if (status) where.status = status;

    const [data, total] = await Promise.all([
      this.prisma.auctionWinnerCompliance.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
        include: {
          listing: {
            select: { id: true, title: true, status: true, endAt: true },
          },
        },
      }),
      this.prisma.auctionWinnerCompliance.count({ where }),
    ]);

    return { data, total, limit, offset };
  }

  async releaseCompliance(id: string, releasedBy: string, notes?: string) {
    const compliance = await this.prisma.auctionWinnerCompliance.findUnique({
      where: { id },
    });
    if (!compliance) throw new NotFoundException('Compliance record not found');

    if (!['COMPLIED', 'READY_FOR_RELEASE'].includes(compliance.status)) {
      throw new BadRequestException(
        `Cannot release item with status ${compliance.status}. Must be COMPLIED or READY_FOR_RELEASE.`,
      );
    }

    return this.prisma.auctionWinnerCompliance.update({
      where: { id },
      data: {
        status: 'RELEASED',
        releasedAt: new Date(),
        releasedBy,
        releaseNotes: notes || null,
      },
    });
  }

  async manualSettle(dto: {
    listingId: number;
    winnerId: string;
    winnerFullName: string;
    winnerPhone: string;
    winningBid: number;
  }) {
    const listing = await this.prisma.auctionListing.findUnique({
      where: { id: dto.listingId },
    });
    if (!listing) throw new NotFoundException('Listing not found');

    const existing = await this.prisma.auctionWinnerCompliance.findUnique({
      where: { listingId: dto.listingId },
    });
    if (existing) {
      throw new ConflictException('Listing already has a compliance record');
    }

    const deadline = new Date();
    deadline.setDate(deadline.getDate() + 3);

    return this.prisma.auctionWinnerCompliance.create({
      data: {
        listingId: dto.listingId,
        winnerId: dto.winnerId,
        pawnshopId: listing.pawnshopId,
        winningBid: dto.winningBid,
        status: 'PENDING_COMPLIANCE',
        complianceDeadline: deadline,
        winnerFullName: dto.winnerFullName,
        winnerPhone: dto.winnerPhone,
      },
    });
  }

  async signContract(id: string, signedName: string) {
    const compliance = await this.prisma.auctionWinnerCompliance.findUnique({
      where: { id },
    });
    if (!compliance) throw new NotFoundException('Compliance record not found');

    if (compliance.contractSignedAt) {
      throw new BadRequestException('Contract already signed');
    }

    return this.prisma.auctionWinnerCompliance.update({
      where: { id },
      data: {
        contractSignedAt: new Date(),
        signedName,
      },
    });
  }
}
