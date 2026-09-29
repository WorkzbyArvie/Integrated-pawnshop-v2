import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { ComplianceDocStatus } from '@prisma/client';

export class VerifyDocumentDto {
  @IsEnum(ComplianceDocStatus)
  status: ComplianceDocStatus;

  /**
   * Why the document was denied, and what to do about it.
   *
   * Named for the DENIED state rather than REJECTED. The Super Admin declined a
   * document, not the shop: the shop re-uploads and carries on, and the wording
   * is what tells the client that. A "rejection" reads as a verdict on the
   * applicant, which is both wrong and, here, actionable-sounding.
   */
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  denialReason?: string;
}
