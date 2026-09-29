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

/**
 * Human labels for the denial message. A guard that says "not compliant" without
 * naming the document is not actionable, and the person who has to fix it is the
 * shop owner, not the person reading the error.
 */
const DOCUMENT_LABELS: Record<string, string> = {
  DTI_REGISTRATION: 'DTI/SEC Registration',
  MAYORS_PERMIT: "Mayor's Permit",
  BIR_COR: 'BIR Certificate of Registration',
  BSP_LICENSE: 'BSP Pawnshop License',
  AMLC_REGISTRATION: 'AMLC Registration',
  GOVERNMENT_ID: 'Valid Government ID',
  PROOF_OF_ADDRESS: 'Proof of Business Address',
};

const label = (type: string) =>
  DOCUMENT_LABELS[type] || type.replace(/_/g, ' ').toLowerCase();

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

    // A score is not a licence.
    //
    // The score band for `uploaded` is 40 of 100, so a shop that had uploaded
    // all seven mandatory documents but had none of them approved yet scored 70
    // and sailed past the threshold. Uploading is not the same act as holding a
    // valid licence - anyone can put a file in a bucket - and the panel's point
    // about legality is that the system has to be able to say a shop is *not*
    // permitted to operate, and mean it.
    //
    // So the gate is now: every mandatory document must be VERIFIED by a Super
    // Admin and must not have lapsed. The score stays for display and for the
    // partial-progress view, but it no longer decides whether a shop may open a
    // pawn ticket, disburse a loan or bid in an auction.
    //
    // This runs before the score check on purpose. The score message is a bare
    // "10% is below the required 40%" - true, and useless to the shop owner who
    // has to act on it. Naming the documents is the whole point of the denial,
    // and it is the same answer in every partial state, so there is no reason to
    // make anyone read the vaguer one first.
    const blocking = await this.findUnverifiedRequired(profile.pawnshopId);

    if (blocking.length > 0) {
      this.logger.warn(
        `Pawnshop ${profile.pawnshopId} blocked: ${blocking.length} required document(s) not verified and current`,
      );
      throw new ForbiddenException({
        success: false,
        error: 'COMPLIANCE_VERIFICATION_REQUIRED',
        message:
          `Your shop cannot process transactions until these documents are on file, ` +
          `verified by a Super Admin, and unexpired: ${blocking.map(label).join(', ')}.`,
        data: { documents: blocking },
      });
    }

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

  /**
   * The mandatory documents that are not both approved and unexpired.
   *
   * Only the newest row per type counts, matching the scoring path, so a shop
   * cannot be held to a rejected submission after a valid replacement is on
   * file - nor escape by leaving a stale approved row underneath a rejected one.
   */
  private async findUnverifiedRequired(pawnshopId: string): Promise<string[]> {
    const documents = await this.prisma.pawnshopDocument.findMany({
      where: { pawnshopId },
    });

    const latestByType = new Map<string, (typeof documents)[0]>();
    for (const doc of documents) {
      const existing = latestByType.get(doc.documentType);
      if (!existing || doc.createdAt > existing.createdAt) {
        latestByType.set(doc.documentType, doc);
      }
    }

    const now = new Date();
    return REQUIRED_DOCUMENTS.filter((required) => {
      const doc = latestByType.get(required);
      if (!doc) return true;
      if (doc.status !== 'VERIFIED') return true;
      if (doc.expiryDate && doc.expiryDate < now) return true;
      return false;
    });
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
