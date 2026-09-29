import { IsEnum, IsOptional, IsString, IsDateString, MaxLength } from 'class-validator';
import { ComplianceDocType } from '@prisma/client';

export class UploadDocumentDto {
  @IsEnum(ComplianceDocType)
  documentType: ComplianceDocType;

  @IsString()
  @MaxLength(500)
  fileUrl: string;

  @IsString()
  @MaxLength(255)
  fileName: string;

  @IsOptional()
  fileSize?: number;

  /**
   * Required, not optional.
   *
   * The compliance guard scores a `notExpired` band, and a document with no
   * expiry counted as valid forever. That is the opposite of what a legality
   * argument needs: a document nobody is obliged to renew is one that quietly
   * stops being enforced, and the shop keeps operating on a lapsed permit
   * indefinitely. Requiring the date makes the shop make an explicit, dated
   * assertion about validity, and makes it the party responsible for returning
   * before the date passes.
   *
   * A date in the past is rejected too: uploading an already-expired document
   * would satisfy "an expiry date exists" while contributing nothing, which
   * reintroduces the same silent gap through the front door.
   */
  @IsDateString()
  expiryDate: string;
}
