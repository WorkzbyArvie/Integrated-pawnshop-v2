import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../prisma.service';
import { AuthUserService } from '../auth-user.service';
import { COMPLIANCE_KEY } from '../decorators/requires-compliance.decorator';

const REQUIRED_DOCUMENTS = [
  'DTI_REGISTRATION',
  'MAYORS_PERMIT',
  'BIR_COR',
  'BSP_LICENSE',
  'AMLC_REGISTRATION',
  'GOVERNMENT_ID',
  'PROOF_OF_ADDRESS',
];

@Injectable()
export class ComplianceGuard implements CanActivate {
  private readonly logger = new Logger(ComplianceGuard.name);

  constructor(
    private reflector: Reflector,
    private prisma: PrismaService,
    private authUser: AuthUserService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredScore = this.reflector.getAllAndOverride<number>(COMPLIANCE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredScore || requiredScore <= 0) return true;

    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers?.authorization as string | undefined;

    let userId: string;
    try {
      userId = await this.authUser.getUserIdFromAuthHeader(authHeader);
    } catch {
      return true;
    }

    const profile = await this.prisma.profile.findUnique({
      where: { id: userId },
      select: { role: true, pawnshopId: true },
    });

    if (!profile || profile.role === 'SUPER_ADMIN') return true;
    if (!profile.pawnshopId) return true;

    const score = await this.calculateScore(profile.pawnshopId);

    if (score < requiredScore) {
      this.logger.warn(
        `Compliance score ${score} < required ${requiredScore} for pawnshop ${profile.pawnshopId}`,
      );
      throw new ForbiddenException(
        `Compliance score ${score}% is below the required ${requiredScore}%. Please upload and verify required documents.`,
      );
    }

    return true;
  }

  private async calculateScore(pawnshopId: string): Promise<number> {
    const totalRequired = REQUIRED_DOCUMENTS.length;
    const documents = await this.prisma.pawnshopDocument.findMany({
      where: { pawnshopId },
    });

    const latestByType = new Map<string, typeof documents[0]>();
    for (const doc of documents) {
      const existing = latestByType.get(doc.documentType);
      if (!existing || doc.createdAt > existing.createdAt) {
        latestByType.set(doc.documentType, doc);
      }
    }

    let uploaded = 0;
    let verified = 0;
    let notExpired = 0;

    for (const reqType of REQUIRED_DOCUMENTS) {
      const doc = latestByType.get(reqType);
      if (doc) {
        uploaded++;
        const isExpired = doc.expiryDate && doc.expiryDate < new Date();
        if (doc.status === 'VERIFIED' && !isExpired) verified++;
        if (!isExpired) notExpired++;
      }
    }

    const subscription = await this.prisma.subscription.findFirst({
      where: { pawnshopId, status: { in: ['ACTIVE', 'TRIAL'] } },
    });

    return Math.round(
      (uploaded / totalRequired) * 40 +
      (verified / totalRequired) * 30 +
      (notExpired / totalRequired) * 20 +
      (subscription ? 10 : 0),
    );
  }
}
