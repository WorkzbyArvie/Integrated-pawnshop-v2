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
  ) {}

  /**
   * Branches a prospective pawner may apply to.
   *
   * Only shops that can actually transact are listed. Advertising a branch and
   * then refusing at the counter is worse than not listing it, and the whole
   * point of moving this online is that a pawner does not travel to be told no.
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

    const out: Array<{
      pawnshopId: string;
      pawnshopName: string;
      address: string | null;
      latitude: number | null;
      longitude: number | null;
      contactPhone: string | null;
      branches: Array<{ id: number; name: string; location: string }>;
    }> = [];

    for (const shop of pawnshops) {
      const missing = await this.unverifiedDocuments(shop.id);
      if (missing.length) continue;
      out.push({
        pawnshopId: shop.id,
        pawnshopName: shop.name,
        address: shop.address,
        latitude: shop.latitude,
        longitude: shop.longitude,
        contactPhone: shop.contactPhone,
        branches: (byPawnshop.get(shop.id) ?? []).map((b) => ({
          id: b.id,
          name: b.name,
          location: b.location,
        })),
      });
    }

    return out;
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
      throw new BadRequestException(
        'That branch cannot accept pawns at the moment - its regulatory documents are not on file. Please choose another branch.',
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

  private async unverifiedDocuments(pawnshopId: string): Promise<string[]> {
    const documents = await this.prisma.pawnshopDocument.findMany({
      where: { pawnshopId },
    });

    const latest = new Map<string, (typeof documents)[number]>();
    for (const doc of documents) {
      const existing = latest.get(doc.documentType);
      if (!existing || doc.createdAt > existing.createdAt) {
        latest.set(doc.documentType, doc);
      }
    }

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
