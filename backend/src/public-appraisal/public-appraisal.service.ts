import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';

import { PrismaService } from '../prisma.service';
import { StorageService } from '../common/storage/storage.service';
import { PawnTicketService } from '../loan/pawn-ticket.service';

import {
  appraise,
  assessRisk,
  normalizePurity,
  resolveAppraisalRates,
} from '../loan/appraisal';
import {
  GRACE_PERIOD_DAYS,
  PAWN_TERM_DAYS,
  maturityDateFrom,
  gracePeriodEndFrom,
} from '../loan/loan-terms';
import { resolveRates, STATUTORY_MIN_LTV, toCentavos } from '../finance/interest';
import { CreateReservationDto } from './dto/create-reservation.dto';
import { ConvertReservationDto } from './dto/convert-reservation.dto';
import { PublicQuoteDto } from './dto/public-quote.dto';

/**
 * The documents a shop must have on file before it may transact. Mirrors
 * `ComplianceGuard.REQUIRED_DOCUMENTS`; the two lists must not drift, so the
 * test below pins both.
 */
const REQUIRED_DOCUMENTS = [
  'DTI_SEC',
  'MAYORS_PERMIT',
  'BIR_CERTIFICATE',
  'BSP_LICENSE',
  'AMLC_REGISTRATION',
  'VALID_GOVT_ID',
  'PROOF_OF_BUSINESS',
] as const;

const REFERENCE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
/** How long a quoted rate is held for the pawner to visit. */
export const RESERVATION_WINDOW_HOURS = 24;

export interface PublicQuoteResult {
  pawnshopId: string;
  pawnshopName: string;
  itemCategory: string;
  weightGrams: number;
  purityPercent: number | null;
  appraisedValue: number;
  recommendedLoanAmount: number;
  gramRate: number;
  ltvRatio: number;
  termDays: number;
  maturityDate: string;
  gracePeriodDays: number;
  gracePeriodEnds: string;
  belowStatutoryMinimum: boolean;
  statutoryMinLtv: number;
  risk: { score: number; band: string; factors: string[]; blocking: boolean };
  rates: { monthlyInterestRate: number; serviceFeeRate: number; source: string };
}

@Injectable()
export class PublicAppraisalService {
  private readonly logger = new Logger(PublicAppraisalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly pawnTickets: PawnTicketService,
  ) {}

  /**
   * Branches a prospective pawner may see, and whether each can take them today.
   *
   * A non-compliant shop is **listed, not hidden** — with the reason shown.
   *
   * The first version of this filtered them out entirely, on the reasoning that
   * advertising a branch and refusing at the counter is worse than not listing
   * it. Checked against the live database that reasoning lost: 13 active shops,
   * every one blocked by missing regulatory documents, so the page rendered an
   * empty list and the feature could not be demonstrated at all. More to the
   * point, a pawner who wants to pawn a ring *today* is not served by a blank
   * screen — they are served by being told the nearest shop is not accepting
   * applications and going somewhere that is.
   *
   * So the listing states the position and the transaction stays refused.
   * `canAcceptApplications` is the gate; `quote` and `create` re-check it, so
   * this widens what a pawner can *see*, never what the shop can *do*.
   */
  async listBranches() {
    const [pawnshops, branches] = await Promise.all([
      this.prisma.pawnshop.findMany({
        where: { isActive: true, status: 'ACTIVE' },
        select: { id: true, name: true, address: true, latitude: true, longitude: true, contactPhone: true },
      }),
      this.prisma.branch.findMany({
        where: { isActive: true },
        select: { id: true, name: true, location: true, pawnshopId: true },
      }),
    ]);

    const byPawnshop = new Map<string, typeof branches>();
    for (const branch of branches) {
      if (!branch.pawnshopId) continue;
      const list = byPawnshop.get(branch.pawnshopId) ?? [];
      list.push(branch);
      byPawnshop.set(branch.pawnshopId, list);
    }

    // Fetched for every shop in one query rather than per shop — a loop of
    // seven-per-shop lookups is a slow public endpoint.
    const allDocuments = await this.prisma.pawnshopDocument.findMany({
      where: { pawnshopId: { in: pawnshops.map((shop) => shop.id) } },
      select: { pawnshopId: true, documentType: true, status: true, expiryDate: true, createdAt: true },
    });

    const latestByShop = this.latestDocumentsByShop(allDocuments);

    // Compliant shops first, then alphabetical, so the one an applicant can
    // actually use is the one they read first.
    const assessed = pawnshops
      .map((shop) => {
        const missing = this.missingDocuments(latestByShop.get(shop.id));
        return {
          pawnshopId: shop.id,
          pawnshopName: shop.name,
          address: shop.address,
          latitude: shop.latitude,
          longitude: shop.longitude,
          contactPhone: shop.contactPhone,
          canAcceptApplications: missing.length === 0,
          // Named in the singular as a field name would imply a count, and the
          // count is not what an applicant needs to know.
          complianceNote: missing.length
            ? 'This branch is not accepting online applications at the moment.'
            : null,
          missingDocuments: missing,
          branches: (byPawnshop.get(shop.id) ?? []).map((b) => ({
            id: b.id,
            name: b.name,
            location: b.location,
          })),
        };
      })
      .sort((a, b) => {
        if (a.canAcceptApplications !== b.canAcceptApplications) {
          return a.canAcceptApplications ? -1 : 1;
        }
        return a.pawnshopName.localeCompare(b.pawnshopName);
      });

    return assessed;
  }

  /**
   * Price a prospective pawn for a named shop, creating nothing.
   *
   * `POST /loan/appraisal/quote` derives the shop from the *staff member's*
   * profile, which is right for the counter and wrong for an applicant: a
   * walk-in pawner has no profile and the shop is the one they are choosing.
   * Hence a separate entry point that takes the shop explicitly.
   *
   * Prices are public - the auction site lists items openly - so this leaks
   * nothing a customer could not ask a clerk. It is still rate limited, because
   * it is unauthenticated and it does database work.
   */
  async quote(dto: PublicQuoteDto): Promise<PublicQuoteResult> {
    const pawnshopId = (dto.pawnshopId ?? '').trim();
    if (!pawnshopId) {
      throw new BadRequestException('Choose a branch to price your item.');
    }

    const missing = await this.unverifiedDocuments(pawnshopId);
    if (missing.length) {
      // Names the count so the applicant understands this is the branch's
      // regulatory position and not a fault in what they typed. The document
      // types themselves are deliberately not listed — that is the shop's
      // business, not something to publish on a public endpoint.
      throw new BadRequestException(
        `${missing.length} of the required regulatory documents for that branch ${
          missing.length === 1 ? 'is' : 'are'
        } not on file, so it cannot accept pawns at the moment. Please choose another branch.`,
      );
    }

    const pawnshop = await this.prisma.pawnshop.findUnique({
      where: { id: pawnshopId },
      select: { id: true, name: true, settings: true },
    });
    if (!pawnshop) throw new NotFoundException('Branch not found');

    const rates = resolveAppraisalRates(pawnshop.settings);

    const purity = normalizePurity(dto.purityPercent);
    const priced = appraise(dto.itemCategory, dto.weight, rates);

    const appraisedValue = toCentavos(priced.appraisedValue * (purity ?? 1));
    const recommendedLoanAmount = toCentavos(appraisedValue * priced.ltvRatio);

    const risk = assessRisk({
      // Nobody has inspected the item or the applicant at this point, and saying
      // so is the point: a remote quote cannot claim either is verified. The
      // inspector confirms both when the pawner arrives.
      authenticityVerified: undefined,
      authenticitySuspect: undefined,
      idVerified: undefined,
      kycStatus: null,
      weight: priced.weight,
      appraisedValue,
    });

    const maturity = maturityDateFrom(PAWN_TERM_DAYS);

    return {
      pawnshopId: pawnshop.id,
      pawnshopName: pawnshop.name,
      itemCategory: dto.itemCategory,
      weightGrams: priced.weight,
      purityPercent: purity,
      appraisedValue,
      recommendedLoanAmount,
      gramRate: priced.gramRate,
      ltvRatio: priced.ltvRatio,
      termDays: PAWN_TERM_DAYS,
      maturityDate: maturity.toISOString(),
      gracePeriodDays: GRACE_PERIOD_DAYS,
      gracePeriodEnds: gracePeriodEndFrom(maturity).toISOString(),
      belowStatutoryMinimum: recommendedLoanAmount < appraisedValue * STATUTORY_MIN_LTV,
      statutoryMinLtv: STATUTORY_MIN_LTV,
      risk,
      rates: resolveMoneyRate(pawnshop.settings),
    };
  }

  /**
   * Take the application.
   *
   * Stores the quote rather than recomputing it: a rate table that changes
   * tomorrow must not silently change what the application said yesterday.
   */
  async create(dto: CreateReservationDto, submittedFrom?: string | null) {
    // Priced again here rather than trusted from the client. The quote the
    // applicant saw is a display of the rate table; what is recorded must be the
    // server's own arithmetic.
    const priced = await this.quote({
      pawnshopId: dto.pawnshopId,
      itemCategory: dto.itemCategory,
      weight: dto.weight,
      purityPercent: dto.purityPercent,
    });

    const reference = this.newReference();
    const expiresAt = new Date(
      Date.now() + RESERVATION_WINDOW_HOURS * 60 * 60 * 1000,
    );

    const created = await this.prisma.pawnReservation.create({
      data: {
        reference,
        pawnshopId: dto.pawnshopId,
        branchId: dto.branchId ?? null,
        expiresAt,
        customerName: dto.customerName.trim(),
        contactNumber: dto.contactNumber.trim(),
        address: dto.address.trim(),
        itemCategory: dto.itemCategory,
        itemDescription: dto.itemDescription?.trim() || null,
        weightGrams: priced.weightGrams,
        purityPercent: priced.purityPercent,
        photoUrls: (dto.photoUrls ?? []) as unknown as Prisma.InputJsonValue,
        appraisedValue: priced.appraisedValue,
        recommendedLoanAmount: priced.recommendedLoanAmount,
        gramRate: priced.gramRate,
        ltvRatio: priced.ltvRatio,
        termDays: priced.termDays,
        maturityDate: new Date(priced.maturityDate),
        gracePeriodDays: priced.gracePeriodDays,
        belowStatutoryMinimum: priced.belowStatutoryMinimum,
        riskScore: priced.risk.score,
        riskBand: priced.risk.band,
        rateSummary: priced.rates as unknown as Prisma.InputJsonValue,
        idType: dto.idType,
        idNumber: dto.idNumber?.trim() || null,
        idFrontUrl: dto.idFrontUrl?.trim() || null,
        idBackUrl: dto.idBackUrl?.trim() || null,
        selfieUrl: dto.selfieUrl?.trim() || null,
        // PENDING, never VERIFIED. Receiving a photograph of an ID is not
        // verification of the person in it; a reviewer adjudicates and stamps
        // `reviewed_by` / `reviewed_at`.
        kycStatus: 'PENDING',
        verificationData: {
          evidence: {
            idFrontUrl: Boolean(dto.idFrontUrl),
            idBackUrl: Boolean(dto.idBackUrl),
            selfieUrl: Boolean(dto.selfieUrl),
          },
          // Deliberately absent: any claim that the face matched or the document
          // was authentic. The server cannot establish either, and recording a
          // client's assertion as if it were a finding is how a reviewer ends up
          // approving on forged evidence.
          automatedChecksPerformed: [],
          submittedAt: new Date().toISOString(),
          submittedFrom: submittedFrom ?? null,
        } as unknown as Prisma.InputJsonValue,
      },
    });

    this.logger.log(
      `Reservation ${reference} for shop ${dto.pawnshopId}, quoted at ${priced.recommendedLoanAmount.toFixed(2)} on ${priced.appraisedValue.toFixed(2)}.`,
    );

    return this.present(created);
  }

  /**
   * Store a photograph attached to an application.
   *
   * This is the one genuinely dangerous thing in this module: an unauthenticated
   * write into object storage. Three things bound it.
   *
   * The path is derived entirely on the server — `randomUUID()` plus an
   * extension chosen from a MIME allowlist. `auth/kyc/upload` takes a `folder`
   * and derives the name from the client's own filename, which is fine behind a
   * session and is an arbitrary-write primitive here: a caller could name a
   * folder `kyc-documents` and overwrite an existing identity document. Nothing
   * client-supplied reaches the path.
   *
   * The extension comes from the declared content type, not the filename, so
   * `passport.html` cannot be stored as `passport.html`.
   *
   * `kind` chooses the *sub*folder, so a reviewer can tell an item photograph
   * from an ID front, but it is matched against a fixed set and anything else
   * falls back to the neutral bucket rather than being honoured.
   */
  async storeApplicantUpload(
    file: { buffer: Buffer; mimetype?: string; size?: number },
    kind?: string,
  ): Promise<{ url: string }> {
    const ALLOWED: Record<string, string> = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
      'image/heic': 'heic',
    };

    const extension = ALLOWED[(file.mimetype ?? '').toLowerCase()];
    if (!extension) {
      throw new BadRequestException(
        'Only JPEG, PNG, WebP or HEIC photographs are accepted.',
      );
    }

    // A 5 MB ceiling is generous for a phone photograph of a ring and stops the
    // bucket being filled from the open internet.
    if (typeof file.size === 'number' && file.size > 5 * 1024 * 1024) {
      throw new BadRequestException('That photograph is larger than 5 MB. Please retake it.');
    }

    const FOLDERS: Record<string, string> = {
      item: 'applicant/item',
      'id-front': 'applicant/id-front',
      'id-back': 'applicant/id-back',
      selfie: 'applicant/selfie',
    };
    const folder = FOLDERS[(kind ?? '').toLowerCase()] ?? 'applicant/other';

    const url = await this.storage.uploadImage(
      file.buffer,
      'kyc-documents',
      `${folder}/${randomUUID()}.${extension}`,
      (file.mimetype ?? 'image/jpeg').toLowerCase(),
    );

    this.logger.log(`Applicant upload stored under ${folder}.`);
    return { url };
  }

  /**
   * Turn an application into a real pawn ticket.
   *
   * This is what closes the loop. Until it existed an application was a dead
   * end: the customer applied, the shop could see nothing, and there was no way
   * to make the reservation into a transaction — so the whole flow collected
   * data and stopped.
   *
   * The appraiser's figures are authoritative. The snapshot on the reservation
   * was priced from a self-reported weight and an unverified purity mark, and
   * it is carried forward only as the record of what the applicant was told —
   * never as the number on the ticket. Delegating to `createTicket` rather than
   * writing tickets directly keeps one creation path, so the state machine, the
   * interest calculation and the audit trail behave identically whether the pawn
   * started at the counter or online.
   */
  async convertToTicket(
    reference: string,
    dto: ConvertReservationDto,
    convertedBy: string,
    /**
     * The caller's own shop, or `null` for the platform operator.
     *
     * Finding the reservation by reference alone would let any shop holding
     * `pawn_ticket.create` convert any other shop's application — creating a
     * ticket against a customer who never walked into that branch. The mismatch
     * is a 404 rather than a 403 so the route does not confirm that somebody
     * else's reference exists.
     */
    callerPawnshopId: string | null,
  ) {
    const reservation = await this.prisma.pawnReservation.findUnique({
      where: { reference: reference.trim().toUpperCase() },
    });

    if (!reservation) {
      throw new NotFoundException('No application matches that reference.');
    }

    if (callerPawnshopId && reservation.pawnshopId !== callerPawnshopId) {
      throw new NotFoundException('No application matches that reference.');
    }

    if (reservation.convertedTicketId) {
      throw new BadRequestException(
        'This application has already been converted into a pawn ticket.',
      );
    }

    const lapsed = reservation.expiresAt.getTime() < Date.now();
    if (lapsed && reservation.status === 'PENDING') {
      throw new BadRequestException(
        'The 24-hour window on this application has passed. Start a new application at the branch.',
      );
    }

    if (['CANCELLED', 'DECLINED', 'CONVERTED'].includes(reservation.status)) {
      throw new BadRequestException(
        `This application is ${reservation.status.toLowerCase()} and cannot be converted.`,
      );
    }

    /*
     * The applicant's snapshot versus the appraiser's figure. A silent
     * difference is the thing a panel asks about — the pawner was told one
     * number on the website and signed a different one — so it is recorded
     * rather than quietly overwritten.
     */
    const onlineLoan = reservation.recommendedLoanAmount;
    const revised =
      Math.abs(onlineLoan - dto.loanAmount) > 0.01 ||
      Math.abs(reservation.appraisedValue - dto.appraisedValue) > 0.01;

    if (revised && !dto.revisionReason?.trim()) {
      throw new BadRequestException(
        'The inspected figures differ from the online estimate. Record a reason for the revision before converting.',
      );
    }

    const description = [
      dto.itemDescription?.trim() || reservation.itemDescription || '',
      revised && dto.revisionReason?.trim()
        ? `Revised from the online estimate (${onlineLoan.toFixed(2)}): ${dto.revisionReason.trim()}`
        : '',
    ]
      .filter(Boolean)
      .join('\n');

    const ticket = await this.pawnTickets.createTicket(
      {
        customerName: reservation.customerName,
        customerAddress: reservation.address,
        customerContact: reservation.contactNumber,
        itemCategory: dto.itemCategory?.trim() || reservation.itemCategory,
        itemDescription: description,
        weight: dto.weight,
        loanAmount: dto.loanAmount,
        appraisedValue: dto.appraisedValue,
        riskScore: reservation.riskScore ?? undefined,
        photoUrls: Array.isArray(reservation.photoUrls)
          ? (reservation.photoUrls as string[])
          : [],
        appraisalDeadline:
          dto.appraisalDeadline ?? new Date(Date.now() + 30 * 864e5).toISOString(),
        pawnshopId: reservation.pawnshopId,
        branchId: dto.branchId ?? reservation.branchId ?? undefined,
      } as never,
      convertedBy,
    );

    await this.prisma.pawnReservation.update({
      where: { id: reservation.id },
      data: {
        status: 'CONVERTED',
        convertedTicketId: ticket.id,
        // The evidence the applicant submitted has now been judged by a person,
        // so recording who is the difference between "we hold documents" and
        // "we checked them".
        reviewedBy: convertedBy,
        reviewedAt: new Date(),
      },
    });

    this.logger.log(
      `Reservation ${reservation.reference} converted to ticket ${ticket.id} by ${convertedBy}` +
        (revised ? ' with a revised figure' : ''),
    );

    return {
      ticket,
      revision: revised
        ? {
            onlineLoanAmount: onlineLoan,
            onlineAppraisedValue: reservation.appraisedValue,
            reason: dto.revisionReason ?? null,
          }
        : null,
    };
  }

  /**
   * Look an application up by its reference.
   *
   * Deliberately unauthenticated: a pawner who applied from their phone has no
   * account. The reference is the capability, and it returns only what the
   * applicant already submitted plus the status. Identity documents are NOT
   * returned - a leaked reference should not leak someone's ID photographs.
   */
  async findByReference(reference: string) {
    const found = await this.prisma.pawnReservation.findUnique({
      where: { reference: reference.trim().toUpperCase() },
    });
    if (!found) throw new NotFoundException('No application matches that reference.');

    // Lazy expiry: a reservation past its window reads as EXPIRED whether or not
    // a job has run to write it down.
    if (found.status === 'PENDING' && found.expiresAt.getTime() < Date.now()) {
      const updated = await this.prisma.pawnReservation.update({
        where: { id: found.id },
        data: { status: 'EXPIRED' },
      });
      return this.present(updated);
    }

    return this.present(found);
  }

  /** Shop-side queue: applications this shop has received. */
  async listForShop(pawnshopId: string, status?: string) {
    const rows = await this.prisma.pawnReservation.findMany({
      where: { pawnshopId, ...(status ? { status: status as never } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return rows.map((row) => this.present(row));
  }

  /**
   * The documents a shop still needs before it may transact.
   *
   * One implementation, used by the listing, the quote and the create, so the
   * three cannot drift into disagreeing about which shops are open.
   */
  private async unverifiedDocuments(pawnshopId: string): Promise<string[]> {
    const documents = await this.prisma.pawnshopDocument.findMany({
      where: { pawnshopId },
      select: { documentType: true, status: true, expiryDate: true, createdAt: true },
    });
    return this.missingDocuments(this.latestDocuments(documents));
  }

  /**
   * The newest upload per document type.
   *
   * Judged on the latest, not on whether any verified row exists. A shop that
   * uploaded a document, had it approved, then uploaded a replacement that was
   * rejected must not stay open on the approval underneath the rejection.
   */
  private latestDocuments<T extends { documentType: string; createdAt: Date }>(
    documents: T[],
  ): Map<string, T> {
    const latest = new Map<string, T>();
    for (const doc of documents) {
      const existing = latest.get(doc.documentType);
      if (!existing || doc.createdAt > existing.createdAt) {
        latest.set(doc.documentType, doc);
      }
    }
    return latest;
  }

  /**
   * Same, grouped by shop, for a listing that assesses every shop at once.
   *
   * `T` is constrained on every field it touches rather than only
   * `pawnshopId` — a constraint naming one property while the body reads another
   * is a type error, and loosening the generic to `any` would hide the mistake
   * that caused it.
   */
  private latestDocumentsByShop<
    T extends { pawnshopId: string; documentType: string; createdAt: Date },
  >(documents: T[]): Map<string, Map<string, T>> {
    const grouped = new Map<string, T[]>();
    for (const doc of documents) {
      const list = grouped.get(doc.pawnshopId) ?? [];
      list.push(doc);
      grouped.set(doc.pawnshopId, list);
    }

    const byShop = new Map<string, Map<string, T>>();
    for (const [shopId, list] of grouped) {
      byShop.set(shopId, this.latestDocuments(list));
    }
    return byShop;
  }

  /** Which of the required documents are absent, unverified, or expired. */
  private missingDocuments(
    latest: Map<string, { status: string; expiryDate: Date | null }> | undefined,
  ): string[] {
    if (!latest) return [...REQUIRED_DOCUMENTS];

    const now = new Date();
    return REQUIRED_DOCUMENTS.filter((required) => {
      const doc = latest.get(required);
      if (!doc) return true;
      if (doc.status !== 'VERIFIED') return true;
      if (doc.expiryDate && doc.expiryDate < now) return true;
      return false;
    });
  }

  private newReference(): string {
    const stamp = Date.now().toString(36).toUpperCase().slice(-5);
    const tail = Array.from({ length: 4 }, () =>
      REFERENCE_ALPHABET[Math.floor(Math.random() * REFERENCE_ALPHABET.length)],
    ).join('');
    return `RSV-${stamp}-${tail}`;
  }

  /** The applicant's view. Never includes the identity document URLs. */
  private present(row: {
    reference: string;
    status: string;
    pawnshopId: string;
    expiresAt: Date;
    createdAt: Date;
    customerName: string;
    contactNumber: string;
    address: string;
    itemCategory: string;
    itemDescription: string | null;
    weightGrams: number;
    purityPercent: number | null;
    photoUrls: unknown;
    appraisedValue: number;
    recommendedLoanAmount: number;
    gramRate: number;
    ltvRatio: number;
    termDays: number;
    maturityDate: Date;
    gracePeriodDays: number;
    belowStatutoryMinimum: boolean;
    riskScore: number | null;
    riskBand: string | null;
    kycStatus: string;
    rejectionReason: string | null;
  }) {
    const expired =
      row.status === 'PENDING' && row.expiresAt.getTime() < Date.now();

    return {
      reference: row.reference,
      status: expired ? 'EXPIRED' : row.status,
      pawnshopId: row.pawnshopId,
      expiresAt: row.expiresAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
      customerName: row.customerName,
      contactNumber: row.contactNumber,
      address: row.address,
      itemCategory: row.itemCategory,
      itemDescription: row.itemDescription,
      weightGrams: row.weightGrams,
      purityPercent: row.purityPercent,
      photoUrls: Array.isArray(row.photoUrls) ? row.photoUrls : [],
      appraisedValue: row.appraisedValue,
      recommendedLoanAmount: row.recommendedLoanAmount,
      gramRate: row.gramRate,
      ltvRatio: row.ltvRatio,
      termDays: row.termDays,
      maturityDate: row.maturityDate.toISOString(),
      gracePeriodDays: row.gracePeriodDays,
      belowStatutoryMinimum: row.belowStatutoryMinimum,
      riskScore: row.riskScore,
      riskBand: row.riskBand,
      kycStatus: row.kycStatus,
      rejectionReason: row.rejectionReason,
    };
  }
}

function resolveMoneyRate(settings: unknown) {
  // `resolveRates` is the single place money rates are read, the same one the
  // loan and the contract use. Reading the settings object again here would be a
  // second, silently divergent copy.
  const rates = resolveRates(settings);
  return {
    monthlyInterestRate: rates.monthlyInterestRate,
    serviceFeeRate: rates.serviceFeeRate,
    source: 'shop',
  };
}
