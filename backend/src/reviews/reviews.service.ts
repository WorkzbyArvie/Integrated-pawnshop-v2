import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { CreateReviewDto, ModerateReviewDto } from './dto/create-review.dto';

@Injectable()
export class ReviewsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(actorUserId: string, dto: CreateReviewDto) {
    const profile = await this.prisma.profile.findUnique({
      where: { id: actorUserId },
      select: { id: true, role: true, pawnshopId: true },
    });

    if (!profile) {
      throw new NotFoundException('User profile not found');
    }

    if (profile.role === 'SUPER_ADMIN') {
      throw new ForbiddenException(
        'Super administrators cannot submit platform reviews',
      );
    }

    const existing = await this.prisma.systemReview.findUnique({
      where: { profileId: actorUserId },
      select: { id: true },
    });

    if (existing) {
      throw new BadRequestException(
        'You have already submitted a review for the platform',
      );
    }

    return this.prisma.systemReview.create({
      data: {
        profileId: actorUserId,
        pawnshopId: profile.pawnshopId ?? null,
        rating: dto.rating,
        title: dto.title ?? null,
        comment: dto.comment,
        status: 'APPROVED',
      },
      include: { pawnshop: { select: { name: true } } },
    });
  }

  async mine(actorUserId: string) {
    const reviews = await this.prisma.systemReview.findMany({
      where: { profileId: actorUserId },
      include: { pawnshop: { select: { name: true } } },
    });
    return reviews[0] ?? null;
  }

  async listApproved() {
    const reviews = await this.prisma.systemReview.findMany({
      where: { status: 'APPROVED' },
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: { pawnshop: { select: { name: true } } },
    });

    const summary = await this.prisma.systemReview.aggregate({
      where: { status: 'APPROVED' },
      _avg: { rating: true },
      _count: { _all: true },
    });

    return {
      reviews: reviews.map((review) => ({
        id: review.id,
        rating: review.rating,
        title: review.title,
        comment: review.comment,
        pawnshopName: review.pawnshop?.name ?? null,
        createdAt: review.createdAt,
      })),
      summary: {
        averageRating: Number(summary._avg.rating?.toFixed(1) ?? 0),
        totalReviews: summary._count._all,
      },
    };
  }

  async listAll(actorUserId: string) {
    await this.assertModerator(actorUserId);
    return this.prisma.systemReview.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        profile: { select: { fullName: true, email: true } },
        pawnshop: { select: { name: true } },
      },
    });
  }

  async moderate(actorUserId: string, reviewId: string, dto: ModerateReviewDto) {
    await this.assertModerator(actorUserId);

    const review = await this.prisma.systemReview.findUnique({
      where: { id: reviewId },
      select: { id: true },
    });

    if (!review) {
      throw new NotFoundException('Review not found');
    }

    return this.prisma.systemReview.update({
      where: { id: reviewId },
      data: { status: dto.status },
    });
  }

  private async assertModerator(actorUserId: string) {
    const profile = await this.prisma.profile.findUnique({
      where: { id: actorUserId },
      select: { role: true },
    });

    if (!profile || profile.role !== 'SUPER_ADMIN') {
      throw new ForbiddenException(
        'Only super administrators can moderate reviews',
      );
    }
  }
}